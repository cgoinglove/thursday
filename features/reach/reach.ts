import { readFile, stat } from "node:fs/promises";
import type { ModelMessage } from "ai";
import { appEvents, presence } from "@/app/api/events/app-event.server";
import { BROWSER_GONE_MS, REACH } from "@/config";
import { modelErrorToString } from "@/features/ai/model";
import { clockNow } from "@/features/ai/prompts/prompt-helper";
import { asWords } from "@/features/ai/words";
import { answerThread } from "@/features/bot/bot.runner";
import type { Thread } from "@/features/bot/bot.schema";
import { acceptRoomRelays } from "@/features/bot/room.query";
import {
  listCallJobs,
  listInboxThreads,
  markSeen,
} from "@/features/bot/thread.query";
import {
  readConfig,
  removeConfig,
  writeConfig,
} from "@/features/config/config.query";
import { type OpenWork, openWork } from "@/features/thursday/open-work";
import { endCall, isCallOpen } from "@/features/thursday/thursday.query";
import {
  answerInWriting,
  openTextCall,
  type TurnNote,
} from "@/features/thursday/thursday.text";
import { toolLine } from "@/features/thursday/tool-line";
import { pathsIn, viewKindOf } from "@/features/workspace/file-kind";
import { filesOnDisk, insideWorkspace } from "@/features/workspace/workspace";
import { keepGivenFiles } from "@/features/workspace/workspace.query";
import { toDate } from "@/lib/date-like";
import { logger } from "@/lib/logger";
import { isPublicError } from "@/lib/public-error";
import {
  type Button,
  type Channel,
  ChannelRefusal,
  type Incoming,
  type IncomingFile,
} from "./channel";
import { asChat, inPieces } from "./chat-text";
import { createDiscord } from "./discord";
import { picturesOf } from "./pictures";
import {
  REACH_CHANNELS,
  REACH_KEYS,
  REACH_LABEL,
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
 * write to her can, through her, run things on this computer.
 *
 * A turn is what they wrote and what she answered; work she handed over comes back later,
 * by itself. It comes as the bot wrote it, with its files, and no turn of hers is spent
 * saying it again — she is left a fact, so what is written back lands where she can route
 * it, and a question's options go as buttons that answer the bot directly. What they write
 * while she is still working joins that turn rather than waiting for one of its own.
 *
 * Who she is and what she may do is the app's, kept where a call reads it
 * (thursday.query readLiveSettings), so the person here meets the same Thursday the
 * screen does. What stays in a browser is how that machine talks to her, which a chat
 * has no use for.
 */

/** How each service is made from its keys, in `REACH_KEYS` order. The one place that knows there are three. */
const MAKE: Record<ReachChannelName, (...keys: string[]) => Channel> = {
  telegram: (token) => createTelegram(token),
  discord: (token) => createDiscord(token),
  slack: (app, bot) => createSlack(app, bot),
};

/** The conversation with one person, for as long as it is kept going (REACH.idleMs, or work it started). */
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
  /** Where to go to reach this bot, as the service named it (`channel.ts`). */
  link: string | null;
  problem: string | null;
  asking: ReachPerson | null;
  line: Line | null;
  /** The calls its conversations were kept as: a thread started from one comes back here. */
  calls: Set<string>;
  /** One turn at a time: what arrives during it joins it (`notes`). */
  busy: boolean;
  /**
   * What has yet to enter the conversation: their words while a turn runs, and facts put
   * in for them. A running turn takes them between its steps; the next takes the rest first.
   */
  notes: TurnNote[];
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
  /** Open work settled here, by item key (open-work): sent to a phone, or left to the screen. */
  told: Set<string>;
  choices: Map<string, Choice>;
  listening: (() => void) | null;
  /** A look at the inbox already on its way: a working bot changes threads many times a second. */
  looking: ReturnType<typeof setTimeout> | null;
  /** Closes lines nobody is writing to any more (sweepIdleLines). */
  idle: ReturnType<typeof setInterval> | null;
};

// Pinned, as the event bus is: a dev reload evaluates this module again, and a second
// listener on one token is refused by the service
const pinned = globalThis as { __reach?: State };
const state: State = (pinned.__reach ??= {
  live: new Map(),
  last: null,
  told: new Set(),
  choices: new Map(),
  listening: null,
  looking: null,
  idle: null,
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
        link: live.link,
        allowed: await readPerson(live.name),
        asking: live.asking,
        problem: live.problem,
      })),
    ),
  };
}

/** The calls held open here for someone on a phone: no tab holds them, so none leaving closes them (instrumentation). */
export const heldCalls = (): string[] =>
  [...state.live.values()].flatMap((live) =>
    live.line ? [live.line.callId] : [],
  );

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
      link: null,
      problem: null,
      asking: null,
      line: null,
      calls: new Set(),
      busy: false,
      notes: [],
    };
    state.live.set(name, live);
    void listen(live);
  }

  if (state.live.size) {
    state.listening ??= appEvents.subscribe((event) => {
      if (event.type === "threads") lookSoon();
    });
    // What boot's own sweep stopped (instrumentation sweepThreads) was emitted before
    // this subscription existed, and nothing re-emits it
    lookSoon();
    state.idle ??= setInterval(() => {
      void sweepIdleLines().catch((cause) =>
        logger.error("reach: idle lines", cause),
      );
    }, REACH.idleMs).unref();
  }
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
          ready: (bot, link) => {
            live.bot = bot;
            live.link = link;
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
    // One at a time: overwriting would drop the first person without a word, and
    // put a name on the screen's Allow that is not the one who asked for it.
    if (live.asking && live.asking.chat !== incoming.chat) {
      await channel.say(
        incoming.chat,
        "Someone else is already waiting to be let in here.",
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
  // What it brought is kept in the workspace and named by path, as the write line names it.
  // A file that did not come through is said at once, and what was written with it still
  // goes to her, with the fact, so she answers it without reading a file that is not there
  const { kept, lost } = await takeFiles(live, incoming.files);
  if (lost.length)
    await channel
      .say(
        incoming.chat,
        lost
          .map(({ name, why }) => `${name} did not come through: ${why}.`)
          .join("\n"),
      )
      .catch((cause) =>
        logger.warn(`reach ${live.name}: could not say so`, cause),
      );
  const words = [incoming.words, ...kept].filter(Boolean).join("\n");
  if (!words) {
    if (incoming.unreadable && !lost.length)
      await channel.say(
        incoming.chat,
        "I can read words, pictures and files here — not voice or video yet. Write it instead.",
      );
    return;
  }
  if (lost.length)
    live.notes.push({
      text: `[Sent from their phone with what follows, and lost on the way: ${lost.map(({ name, why }) => `${name} (${why})`).join("; ")}. They have been told.]`,
      said: false,
    });
  hear(live, person, words);
}

type Lost = { name: string; why: string };

/**
 * What they sent, kept in the workspace, and what was not, each with why: past what the
 * service hands a bot or REACH.fileBytes, or lost on the way.
 */
async function takeFiles(
  live: Live,
  files: IncomingFile[],
): Promise<{ kept: string[]; lost: Lost[] }> {
  const most = Math.min(live.channel.limits.take, REACH.fileBytes);
  const lost: Lost[] = [];
  const wanted = files.filter((file) => {
    if (!file.size || file.size <= most) return true;
    lost.push({
      name: file.name,
      why: `it is ${megabytes(file.size)}, and the most taken from ${REACH_LABEL[live.name]} is ${megabytes(most)}`,
    });
    return false;
  });
  const fetched = await Promise.allSettled(wanted.map((file) => file.fetch()));
  const arrived: File[] = [];
  for (const [at, one] of fetched.entries())
    if (one.status === "fulfilled") arrived.push(one.value);
    else lost.push({ name: wanted[at].name, why: reasonOf(one.reason) });
  if (!arrived.length) return { kept: [], lost };
  try {
    return { kept: await keepGivenFiles(arrived), lost };
  } catch (cause) {
    const why = reasonOf(cause);
    return {
      kept: [],
      lost: [...lost, ...arrived.map((file) => ({ name: file.name, why }))],
    };
  }
}

const reasonOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

/** A size as a chat says it: whole megabytes, rounded up so a file just past a cap never reads as under it. */
const megabytes = (bytes: number) => `${Math.ceil(bytes / (1024 * 1024))} MB`;

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
  if (live) {
    // What waited for them is not the next person's to read
    live.notes = [];
    live.calls.clear();
    await hangUp(live);
  }
  changed();
}

/**
 * Ends a line nobody has written to in REACH.idleMs. A phone conversation is kept
 * as a call, and a call left open is one `isAnyCallLive` keeps finding — so a
 * finished job is put on a screen rather than sent as a desktop notice
 * (bot.runner), on a machine whose browser is closed. Someone who writes a few
 * times and stops, which is most of them, leaves exactly that. `answer` makes the
 * same judgement when the next words arrive; this is for when they never do.
 */
async function sweepIdleLines(): Promise<void> {
  for (const live of state.live.values())
    if (live.line && !live.busy && (await idle(live.line))) await hangUp(live);
}

/**
 * Quiet for REACH.idleMs with nothing it started still running. She handed work over and
 * her turn ended, as a bot's does when it calls another; the conversation is what that
 * work comes back to, so it is kept until it has.
 */
async function idle(line: Line): Promise<boolean> {
  if (Date.now() - line.lastAt <= REACH.idleMs) return false;
  const started = await listCallJobs([line.callId]);
  return !started.some((job) => job.status === "running");
}

/** Ends the conversation as a call. */
async function hangUp(live: Live) {
  const line = live.line;
  live.line = null;
  if (line) await endCall(line.callId).catch(() => {});
}

/**
 * What they wrote. While a turn runs it joins that turn, read before her next step as a
 * bot reads what it is told mid-job (bot.run); a chat cannot stop anyone writing twice, and
 * a second turn for it would answer the first thing again. Otherwise it starts a turn, and
 * what came too late for that turn's last step gets the next.
 */
function hear(live: Live, person: ReachPerson, words: string) {
  if (live.busy) return void live.notes.push({ text: words, said: true });
  live.busy = true;
  void (async () => {
    try {
      for (let next: string | null = words; next !== null; ) {
        await answer(live, person, next);
        const late = live.notes.filter((note) => note.said);
        live.notes = live.notes.filter((note) => !note.said);
        next = late.length ? late.map((note) => note.text).join("\n") : null;
      }
    } finally {
      live.busy = false;
    }
  })();
}

async function answer(live: Live, person: ReachPerson, words: string) {
  const { channel } = live;
  // "typing…" lasts a few seconds on the service's side, so it is said again while she works
  void channel.typing(person.chat).catch(() => {});
  const typing = setInterval(
    () => void channel.typing(person.chat).catch(() => {}),
    4_000,
  );
  // Facts that waited go in ahead of the words; theirs that arrive from here on join the turn
  const facts = live.notes.filter((note) => !note.said);
  live.notes = live.notes.filter((note) => note.said);
  try {
    // Quiet for long enough, or closed under it (the server restarted): the next words
    // open a new call, which reads the last one back under Earlier calls
    const kept = live.line;
    if (!kept || !(await isCallOpen(kept.callId)) || (await idle(kept))) {
      await hangUp(live);
      live.line = {
        ...(await openTextCall()),
        messages: [],
        lastAt: 0,
      };
      live.calls.add(live.line.callId);
    }
    const line = live.line as Line;
    const result = await answerInWriting({
      callId: line.callId,
      standing: line.standing,
      messages: [
        ...line.messages,
        ...facts.map((note) => ({ role: "user" as const, content: note.text })),
        { role: "user", content: words },
      ],
      said: words,
      notes: () => live.notes.splice(0),
    });
    line.messages = carried(result.messages);
    line.lastAt = Date.now();

    // What she did goes under what she said, in the call screen's words: a chat has no
    // activity line, and a turn she ended without a word still shows that much
    const did = [...new Set(result.did)].join(" · ");
    await sayAll(
      live,
      person,
      [asChat(result.text), did && `— ${did}`].filter(Boolean).join("\n\n"),
    );
    await sendFiles(live, person, result.text);
  } catch (cause) {
    live.notes.unshift(...facts);
    // A conversation that never had a turn is no call to keep open: an open call is taken
    // to be listening (bot.runner), and nothing would ever close this one
    if (live.line && !live.line.lastAt) await hangUp(live);
    // What a provider refused is the user's to act on, so it reaches them as it was said
    const why = isPublicError(cause)
      ? cause.message
      : modelErrorToString(cause);
    logger.warn(`reach ${live.name}: ${why}`);
    await channel.say(person.chat, why).catch(() => {});
  } finally {
    clearInterval(typing);
  }
}

/**
 * What of the conversation goes with the next turn. Up to the last thing they wrote it is
 * words alone: what a tool answered and what she thought are most of what a turn weighs,
 * every turn sends all of it again, and a thread is looked up again when it matters. From
 * there on it is whole, so a follow-up still reads what she just found. A step that was
 * only a tool call is kept as what she did, in the call screen's words, so she does not
 * start the same work again. Past REACH.messages the oldest go down to REACH.trimTo, from
 * where they speak, so no tool call is parted from its result.
 */
function carried(messages: ModelMessage[]): ModelMessage[] {
  const last = Math.max(
    messages.findLastIndex((message) => message.role === "user"),
    0,
  );
  const kept = [
    ...asWords(
      messages.slice(0, last),
      (name, input) => toolLine(name, JSON.stringify(input ?? {})) ?? name,
      (text) =>
        text.length > REACH.oldChars
          ? `${text.slice(0, REACH.oldChars)}…`
          : text,
    ),
    ...messages.slice(last),
  ];
  if (kept.length <= REACH.messages) return kept;
  const from = kept.findIndex(
    (message, at) =>
      at >= kept.length - REACH.trimTo && message.role === "user",
  );
  return from > 0 ? kept.slice(from) : kept;
}

/** A text in chat-sized pieces, `buttons` under the last. */
async function sayAll(
  live: Live,
  person: ReachPerson,
  text: string,
  buttons?: Button[],
) {
  const parts = inPieces(text || "…", REACH.chars);
  for (const [at, part] of parts.entries())
    await live.channel.say(
      person.chat,
      part,
      at === parts.length - 1 ? buttons : undefined,
    );
}

/**
 * The files her answer names go with it: a phone cannot open a path on this computer. A
 * page goes with pictures of it, since no chat opens one (pictures), in one message where
 * the service takes them together. The newest REACH.files go; what does not — past that
 * count, past what the service or REACH.fileBytes takes, or refused on the way — is named in
 * the chat as still on this computer, and she is left the fact.
 */
async function sendFiles(live: Live, person: ReachPerson, text: string) {
  const named = await filesOnDisk(pathsIn(text), null);
  const left: Lost[] = named
    .slice(0, Math.max(named.length - REACH.files, 0))
    .map((path) => ({
      name: path,
      why: `only ${REACH.files} files go with one answer`,
    }));
  const { limits } = live.channel;
  const most = Math.min(limits.file, REACH.fileBytes);
  for (const path of named.slice(-REACH.files)) {
    const full = await insideWorkspace(path);
    const info = full ? await stat(full).catch(() => null) : null;
    if (!full || !info) continue;
    if (info.size > most) {
      left.push({
        name: path,
        why: `it is ${megabytes(info.size)}, and the most that goes to ${REACH_LABEL[live.name]} is ${megabytes(most)}`,
      });
      continue;
    }
    try {
      await live.channel.sendFiles(person.chat, [
        ...(await picturesOf(full)),
        {
          bytes: await readFile(full),
          name: path.split("/").pop() ?? "file",
          // One past what the service draws still goes, as a file
          picture: viewKindOf(path) === "image" && info.size <= limits.picture,
        },
      ]);
    } catch (cause) {
      logger.warn(`reach ${live.name}: could not send ${path}`, cause);
      left.push({ name: path, why: reasonOf(cause) });
    }
  }
  if (!left.length) return;
  await live.channel
    .say(
      person.chat,
      [
        "Not sent — still on this computer:",
        ...left.map(({ name, why }) => `• ${name}: ${why}`),
      ].join("\n"),
    )
    .catch((cause) =>
      logger.warn(`reach ${live.name}: could not say so`, cause),
    );
  live.notes.push({
    text: `[Named in what went to their phone, and not sent: ${left.map(({ name, why }) => `${name} (${why})`).join("; ")}. They have been told.]`,
    said: false,
  });
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

/** When this server came up. What changed before it had the server before it. */
const UP_SINCE = Date.now() - process.uptime() * 1000;

/** One look for a burst: a working bot changes threads many times a second. */
function lookSoon(ms = 2_000) {
  state.looking ??= setTimeout(() => {
    state.looking = null;
    void lookForOpenWork().catch((cause) =>
      logger.error("reach: open work", cause),
    );
  }, ms);
}

/**
 * Open work — a question, or an ending nobody has seen — goes to the phone when the phone
 * is where it will be read. A thread started from a conversation here comes back to it,
 * whoever is watching; anything else comes only while no browser is (presence). Each item
 * is settled the first time it is looked at, so a browser that leaves later brings no
 * backlog with it, and a restart brings none either (UP_SINCE). Progress never goes: a
 * phone that buzzes for every step is one that gets muted.
 */
async function lookForOpenWork() {
  // A tab that was open comes back within the grace presence gives one; until then
  // nobody watching is only nobody yet, and a restart would send the phone what it stopped
  const unknown = UP_SINCE + BROWSER_GONE_MS - Date.now();
  if (unknown > 0) return lookSoon(unknown);
  const anyone = await whereTo();
  if (!anyone) return;
  const threads = await listInboxThreads();
  const open = openWork(threads).filter((item) => item.kind !== "progress");
  const keys = new Set(open.map((item) => item.key));
  // Nothing is kept about what stopped waiting. Both are held for the life of the
  // process (pinned above), so a question answered on the computer would leave
  // its key and its buttons behind on every job, for as long as the server runs.
  for (const key of state.told) if (!keys.has(key)) state.told.delete(key);
  for (const [data, choice] of state.choices)
    if (!keys.has(`question:${choice.question}`)) state.choices.delete(data);

  const fresh = open.filter((item) => !state.told.has(item.key));
  if (!fresh.length) return;
  const started = await startedHere();
  for (const item of fresh) {
    const thread = threads.find((one) => one.id === item.threadId);
    if (!thread) continue;
    state.told.add(item.key);
    const from = started.get(item.threadId);
    const person = from ? await readPerson(from.name) : null;
    if (from && person) await tell({ live: from, person }, item, thread);
    else if (
      !presence.watching &&
      toDate(thread.updatedAt).getTime() >= UP_SINCE
    )
      await tell(anyone, item, thread);
  }
}

/** The threads started from a conversation here, each with the service it was. */
async function startedHere(): Promise<Map<string, Live>> {
  const lives = [...state.live.values()];
  const jobs = await listCallJobs(lives.flatMap((live) => [...live.calls]));
  return new Map(
    jobs.flatMap((job) => {
      const live = lives.find((one) => one.calls.has(job.callId ?? ""));
      return live ? [[job.id, live] as const] : [];
    }),
  );
}

/**
 * One piece of open work, as the bot wrote it: whose it is and which thread, a line of
 * its own, then the words, its files after them. No turn of hers is spent on it — it is
 * already written — and she is left the fact, as she is when a question is answered on
 * screen. Delivered is seen: what reached their hands is not unread on the computer, and
 * that is what keeps it from being sent again.
 */
async function tell(
  to: { live: Live; person: ReachPerson },
  item: OpenWork,
  thread: Thread,
) {
  const { live, person } = to;
  // A question's own options answer the bot directly, without a turn of hers in between
  const question = thread.room.questions.find(
    (one) => `question:${one.id}` === item.key,
  );
  const buttons = (question?.options ?? []).map((option, at) => {
    const data = `${question?.id.slice(0, 40)}:${at}`;
    state.choices.set(data, {
      threadId: thread.id,
      bot: question?.bot ?? "",
      question: question?.id ?? "",
      answer: option,
    });
    return { text: option, data };
  });

  try {
    await sayAll(
      live,
      person,
      `${item.show.line} · ${item.show.name}\n\n${asChat(item.text) || "…"}`,
      buttons,
    );
  } catch (cause) {
    // Still open, so the next look tries again
    logger.warn(`reach ${live.name}: could not tell ${item.key}`, cause);
    state.told.delete(item.key);
    return;
  }
  await sendFiles(live, person, item.text);
  live.notes.push({
    // With the time, in the prompt's own clock: a fact that waited a night reads as just now otherwise
    text: `${item.line}\n[The user has had this on their phone, as ${item.show.bot} wrote it, since ${clockNow()}.]`,
    said: false,
  });
  if (item.kind === "ending") await markSeen([item.threadId]);
  else await acceptRoomRelays(item.relayIds);
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
    live.notes.push({
      text: `[The user answered ${choice.bot}'s question from their phone at ${clockNow()}: ${choice.answer}. It has reached ${choice.bot}.]`,
      said: false,
    });
  } catch (cause) {
    await live.channel.say(
      person.chat,
      isPublicError(cause) ? cause.message : "That answer did not get through.",
    );
  }
}
