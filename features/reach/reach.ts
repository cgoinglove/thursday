import { readFile, stat } from "node:fs/promises";
import type { ModelMessage } from "ai";
import { appEvents } from "@/app/api/events/app-event.server";
import { REACH } from "@/config";
import { LiveSettingsSchema } from "@/features/ai/live.schema";
import { modelErrorToString } from "@/features/ai/model";
import { answerThread } from "@/features/bot/bot.runner";
import type { Thread } from "@/features/bot/bot.schema";
import { acceptRoomRelays } from "@/features/bot/room.query";
import { listInboxThreads } from "@/features/bot/thread.query";
import {
  readConfig,
  removeConfig,
  writeConfig,
} from "@/features/config/config.query";
import { openWork } from "@/features/thursday/open-work";
import { endCall, isCallOpen } from "@/features/thursday/thursday.query";
import {
  answerInWriting,
  openTextCall,
} from "@/features/thursday/thursday.text";
import { pathsIn, viewKindOf } from "@/features/workspace/file-kind";
import { filesOnDisk, insideWorkspace } from "@/features/workspace/workspace";
import { keepGivenFiles } from "@/features/workspace/workspace.query";
import { logger } from "@/lib/logger";
import { isPublicError } from "@/lib/public-error";
import { plainText } from "@/lib/utils";
import {
  type Button,
  type Channel,
  ChannelRefusal,
  type Incoming,
} from "./channel";
import { createDiscord } from "./discord";
import {
  REACH_CHANNELS,
  REACH_KEYS,
  type ReachChannelName,
  type ReachPerson,
  type ReachStatus,
  reachPersonKey,
} from "./reach.schema";
import { createSlack } from "./slack";
import { createTelegram } from "./telegram";

/**
 * Thursday from a phone. The server connects outward to a chat service the user set up —
 * their own bot on Telegram, Discord or Slack, nothing opened to the outside — and answers
 * with the backend a call in writing runs (thursday.text): same prompt, memory, tools and
 * rows, so it is a call like any other, held here instead of by a page. One person may
 * write through each service, and the screen is where they are let in: someone who can
 * write to her can, through her, run things on this computer. Open work that the computer
 * has not told goes to the service they last wrote from, as a turn of that conversation, so
 * an answer written back lands where she can route it, and a question's options go as
 * buttons that answer the bot directly.
 *
 * Her settings are the browser's (thursday.store), which the server cannot read: a
 * conversation from a phone runs on the defaults.
 */

/** How each service is made from its keys, in `REACH_KEYS` order. The one place that knows there are three. */
const MAKE: Record<ReachChannelName, (...keys: string[]) => Channel> = {
  telegram: (token) => createTelegram(token),
  discord: (token) => createDiscord(token),
  slack: (app, bot) => createSlack(app, bot),
};

/** The conversation with one person, for as long as it is kept going (REACH.idleMs). */
type Line = {
  callId: string;
  standing: string | null;
  messages: ModelMessage[];
  lastAt: number;
};

/** One service being listened to. */
type Live = {
  name: ReachChannelName;
  channel: Channel;
  stop: AbortController;
  bot: string | null;
  problem: string | null;
  asking: ReachPerson | null;
  line: Line | null;
  /** One turn at a time: a second message waits for the first to be answered. */
  turn: Promise<void>;
};

/** A button under a question: which bot's question it answers, and with what. */
type Choice = {
  threadId: string;
  bot: string;
  question: string;
  answer: string;
};

type State = {
  live: Map<ReachChannelName, Live>;
  /** Where they last wrote from: open work goes there, once, rather than to every service. */
  last: ReachChannelName | null;
  /** Open work already put to a phone, by item key (open-work). */
  told: Set<string>;
  /** Open work waiting out REACH.notifyAfterMs, by item key. */
  due: Map<string, ReturnType<typeof setTimeout>>;
  choices: Map<string, Choice>;
  listening: (() => void) | null;
  /** A look at the inbox already on its way: a working bot changes threads many times a second. */
  looking: ReturnType<typeof setTimeout> | null;
};

// Pinned, as the event bus is: a dev reload evaluates this module again, and a second
// listener on one token is refused by the service
const pinned = globalThis as { __reach?: State };
const state: State = (pinned.__reach ??= {
  live: new Map(),
  last: null,
  told: new Set(),
  due: new Map(),
  choices: new Map(),
  listening: null,
  looking: null,
});

const changed = () => appEvents.emit({ type: "reach" });

async function readPerson(name: ReachChannelName): Promise<ReachPerson | null> {
  const kept = await readConfig(reachPersonKey(name));
  if (!kept) return null;
  try {
    const person = JSON.parse(kept) as Partial<ReachPerson>;
    return typeof person.chat === "string" && typeof person.name === "string"
      ? { chat: person.chat, name: person.name }
      : null;
  } catch {
    return null;
  }
}

export async function readReachStatus(): Promise<ReachStatus> {
  return {
    channels: await Promise.all(
      [...state.live.values()].map(async (live) => ({
        name: live.name,
        bot: live.bot,
        allowed: await readPerson(live.name),
        asking: live.asking,
        problem: live.problem,
      })),
    ),
  };
}

/** The service a config key belongs to, for whoever writes keys (config.action). */
export const reachChannelOf = (key: string): ReachChannelName | null =>
  REACH_CHANNELS.find((name) => REACH_KEYS[name].includes(key)) ?? null;

/**
 * Listens to every service whose keys are set. Called at boot for all of them, and with a
 * service's name whenever one of its keys changes (config.action): a new token is a new
 * bot, so whoever was let in to the old one is not carried over.
 */
export async function startReach(fresh?: ReachChannelName): Promise<void> {
  for (const name of fresh ? [fresh] : REACH_CHANNELS) {
    const was = state.live.get(name);
    was?.stop.abort();
    state.live.delete(name);
    if (fresh) {
      await removeConfig(reachPersonKey(name));
      if (was?.line) await endCall(was.line.callId).catch(() => {});
    }

    const keys = await Promise.all(REACH_KEYS[name].map(readConfig));
    if (!keys.every((key): key is string => Boolean(key))) continue;
    const live: Live = {
      name,
      channel: MAKE[name](...keys),
      stop: new AbortController(),
      bot: null,
      problem: null,
      asking: null,
      line: null,
      turn: Promise.resolve(),
    };
    state.live.set(name, live);
    void listen(live);
  }

  if (state.live.size)
    state.listening ??= appEvents.subscribe((event) => {
      if (event.type !== "threads" || state.looking) return;
      state.looking = setTimeout(() => {
        state.looking = null;
        void lookForOpenWork().catch((cause) =>
          logger.error("reach: open work", cause),
        );
      }, 2_000);
    });
  changed();
}

async function listen(live: Live) {
  const { signal } = live.stop;
  const trouble = (why: string | null) => {
    if (live.problem === why) return;
    live.problem = why;
    changed();
  };
  while (!signal.aborted) {
    try {
      await live.channel.listen(
        {
          ready: (bot) => {
            live.bot = bot;
            live.problem = null;
            changed();
          },
          incoming: (incoming) =>
            void take(live, incoming).catch((cause) =>
              logger.error(`reach ${live.name}: what arrived`, cause),
            ),
        },
        signal,
      );
    } catch (cause) {
      if (signal.aborted) return;
      const why = cause instanceof Error ? cause.message : String(cause);
      // A token the service turns away is the user's to fix; asking again would not change it
      if (cause instanceof ChannelRefusal) {
        logger.warn(`reach ${live.name}: ${why}`);
        return trouble(why);
      }
      // No network, the service down, a second listener on the token: said, and tried again
      trouble(why);
    }
    await new Promise((resolve) => setTimeout(resolve, REACH.retryMs));
  }
}

async function take(live: Live, incoming: Incoming) {
  const { channel } = live;
  const person = await readPerson(live.name);

  if (incoming.kind === "press") {
    if (person?.chat !== incoming.chat) return;
    return choose(live, person, incoming.data, incoming.under);
  }

  if (person?.chat !== incoming.chat) {
    if (person) {
      await channel.say(
        incoming.chat,
        "This Thursday already answers someone else.",
      );
      return;
    }
    live.asking = { chat: incoming.chat, name: incoming.name };
    changed();
    await channel.say(
      incoming.chat,
      "Almost there. Open Thursday on your computer and press Allow, then write again.",
    );
    return;
  }

  state.last = live.name;
  // What it brought is kept in the workspace and named by path, as the write line names it
  const kept = incoming.files.length
    ? await keepGivenFiles(
        await Promise.all(incoming.files.map((file) => file.fetch())),
      )
    : [];
  const words = [incoming.words, ...kept].filter(Boolean).join("\n");
  if (!words) {
    if (incoming.unreadable)
      await channel.say(
        incoming.chat,
        "I can read words, pictures and files here — not voice or video yet. Write it instead.",
      );
    return;
  }
  void write(live, person, words, words);
}

/** Lets in whoever is asking through that service. The screen's Allow (reach.action). */
export async function allowReach(
  name: ReachChannelName,
  chat: string,
): Promise<void> {
  const live = state.live.get(name);
  const asking = live?.asking;
  if (!live || !asking || asking.chat !== chat) return;
  await writeConfig(reachPersonKey(name), JSON.stringify(asking));
  live.asking = null;
  changed();
  await live.channel
    .say(chat, "You are in. Write here and Thursday answers.")
    .catch((cause) => logger.warn(`reach ${name}: could not say so`, cause));
}

/** Turns away whoever is asking; they may ask again. */
export function declineReach(name: ReachChannelName): void {
  const live = state.live.get(name);
  if (live) live.asking = null;
  changed();
}

/** Nobody may write through that service any more; the bot stays, so the next to write asks to be let in. */
export async function forgetReach(name: ReachChannelName): Promise<void> {
  await removeConfig(reachPersonKey(name));
  const live = state.live.get(name);
  if (live) await hangUp(live);
  changed();
}

/** Ends the conversation as a call. */
async function hangUp(live: Live) {
  const line = live.line;
  live.line = null;
  if (line) await endCall(line.callId).catch(() => {});
}

/**
 * One turn, after whatever turn is running. `said` is what the person wrote, kept as their
 * turn; null when `words` is open work put in for a bot, which is no turn of theirs.
 */
function write(
  live: Live,
  person: ReachPerson,
  words: string,
  said: string | null,
  buttons?: Button[],
): Promise<boolean> {
  const done = live.turn.then(() => answer(live, person, words, said, buttons));
  live.turn = done.then(
    () => {},
    () => {},
  );
  return done;
}

async function answer(
  live: Live,
  person: ReachPerson,
  words: string,
  said: string | null,
  buttons?: Button[],
): Promise<boolean> {
  const { channel } = live;
  // "typing…" lasts a few seconds on the service's side, so it is said again while she works
  void channel.typing(person.chat).catch(() => {});
  const typing = setInterval(
    () => void channel.typing(person.chat).catch(() => {}),
    4_000,
  );
  try {
    const settings = LiveSettingsSchema.parse({});
    // Quiet for long enough, or closed under it (the tab went, the server restarted): the
    // next words open a new call, which reads the last one back under Earlier calls
    const kept = live.line;
    const stale =
      !kept ||
      Date.now() - kept.lastAt > REACH.idleMs ||
      !(await isCallOpen(kept.callId));
    if (stale) {
      await hangUp(live);
      live.line = {
        ...(await openTextCall(settings)),
        messages: [],
        lastAt: 0,
      };
    }
    const line = live.line as Line;
    const result = await answerInWriting({
      callId: line.callId,
      settings,
      standing: line.standing,
      messages: [...line.messages, { role: "user", content: words }],
      said,
    });
    line.messages = result.messages;
    line.lastAt = Date.now();

    // A turn she ended without a word still shows what she did, in the call screen's words
    const text = plainText(result.text) || result.did.join("\n");
    const parts = inParts(text || "…");
    for (const [at, part] of parts.entries())
      await channel.say(
        person.chat,
        part,
        at === parts.length - 1 ? buttons : undefined,
      );
    await sendFiles(live, person, result.text);
    return true;
  } catch (cause) {
    // What a provider refused is the user's to act on, so it reaches them as it was said
    const why = isPublicError(cause)
      ? cause.message
      : modelErrorToString(cause);
    logger.warn(`reach ${live.name}: ${why}`);
    await channel.say(person.chat, why).catch(() => {});
    return false;
  } finally {
    clearInterval(typing);
  }
}

/** An answer in chat-sized pieces, cut at a paragraph or a line where one is near. */
function inParts(text: string): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > REACH.chars) {
    const head = rest.slice(0, REACH.chars);
    const at = Math.max(head.lastIndexOf("\n\n"), head.lastIndexOf("\n"));
    const cut = at > REACH.chars / 2 ? at : REACH.chars;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** The files her answer names go with it: a phone cannot open a path on this computer. */
async function sendFiles(live: Live, person: ReachPerson, text: string) {
  const paths = (await filesOnDisk(pathsIn(text), null)).slice(-REACH.files);
  for (const path of paths) {
    const full = await insideWorkspace(path);
    const info = full ? await stat(full).catch(() => null) : null;
    if (!full || !info || info.size > REACH.fileBytes) continue;
    await live.channel
      .sendFile(
        person.chat,
        await readFile(full),
        path.split("/").pop() ?? "file",
        viewKindOf(path) === "image",
      )
      .catch((cause) =>
        logger.warn(`reach ${live.name}: could not send ${path}`, cause),
      );
  }
}

/** The service open work goes to: where they last wrote from, else the first that has someone let in. */
async function whereTo(): Promise<{ live: Live; person: ReachPerson } | null> {
  const names = [
    ...(state.last ? [state.last] : []),
    ...REACH_CHANNELS.filter((name) => name !== state.last),
  ];
  for (const name of names) {
    const live = state.live.get(name);
    const person = live ? await readPerson(name) : null;
    if (live && person) return { live, person };
  }
  return null;
}

/**
 * Open work goes to the phone once the computer has had its chance (REACH.notifyAfterMs):
 * a question, or an ending nobody has seen. Progress does not — a phone that buzzes for
 * every step is one that gets muted.
 */
async function lookForOpenWork() {
  if (!(await whereTo())) return;
  const open = waiting(await listInboxThreads());
  const keys = new Set(open.map((item) => item.key));
  // What stopped waiting — answered, seen, told on the computer — never goes
  for (const [key, timer] of state.due) {
    if (keys.has(key)) continue;
    clearTimeout(timer);
    state.due.delete(key);
  }
  for (const item of open) {
    if (state.told.has(item.key) || state.due.has(item.key)) continue;
    state.due.set(
      item.key,
      setTimeout(() => void tell(item.key), REACH.notifyAfterMs),
    );
  }
}

const waiting = (threads: Thread[]) =>
  openWork(threads).filter((item) => item.kind !== "progress");

async function tell(key: string) {
  state.due.delete(key);
  const to = await whereTo();
  if (!to || state.told.has(key)) return;

  const threads = await listInboxThreads();
  const item = waiting(threads).find((one) => one.key === key);
  if (!item) return;

  // A question's own options answer the bot directly, without a turn of hers in between
  const thread = threads.find((one) =>
    one.room.questions.some((question) => `question:${question.id}` === key),
  );
  const question = thread?.room.questions.find(
    (one) => `question:${one.id}` === key,
  );
  const buttons = (question?.options ?? []).map((option, at) => {
    const data = `${question?.id.slice(0, 40)}:${at}`;
    state.choices.set(data, {
      threadId: thread?.id ?? "",
      bot: question?.bot ?? "",
      question: question?.id ?? "",
      answer: option,
    });
    return { text: option, data };
  });

  state.told.add(key);
  const told = await write(to.live, to.person, item.line, null, buttons);
  // Hers to tell again if it never got there; accepted as on a page once it did
  if (told) await acceptRoomRelays(item.relayIds);
  else state.told.delete(key);
}

async function choose(
  live: Live,
  person: ReachPerson,
  data: string,
  under: { id: string; text: string } | null,
) {
  const choice = state.choices.get(data);
  if (!choice) {
    await live.channel.say(
      person.chat,
      "That question is no longer open here. Write your answer instead.",
    );
    return;
  }
  for (const [key, one] of state.choices)
    if (one.question === choice.question) state.choices.delete(key);
  try {
    await answerThread(choice.threadId, choice.answer, "user", choice.bot);
    if (under)
      await live.channel.settle(
        person.chat,
        under.id,
        `${under.text}\n\n→ ${choice.answer}`,
      );
    // She is told, as she is when a question is answered on screen: a fact, not a turn
    live.line?.messages.push({
      role: "user",
      content: `[The user answered ${choice.bot}'s question from their phone: ${choice.answer}. It has reached ${choice.bot}.]`,
    });
  } catch (cause) {
    await live.channel.say(
      person.chat,
      isPublicError(cause) ? cause.message : "That answer did not get through.",
    );
  }
}
