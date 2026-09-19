import { readFile, stat } from "node:fs/promises";
import type { ModelMessage } from "ai";
import { appEvents } from "@/app/api/events/app-event.server";
import { REACH } from "@/config";
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
import { ThursdaySettingsSchema } from "@/features/thursday/thursday.schema";
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
  REACH_PERSON_KEY,
  type ReachPerson,
  type ReachStatus,
  TELEGRAM_TOKEN_KEY,
} from "./reach.schema";
import {
  createTelegram,
  type Telegram,
  type TelegramMessage,
  TelegramRefusal,
  type TelegramUpdate,
} from "./telegram";

/**
 * Thursday from a phone. The server asks a chat service for what was written to the user's
 * own bot — nothing is opened to the outside — and answers with the backend a call in
 * writing runs (thursday.text): same prompt, memory, tools and rows, so it is a call like
 * any other, held here instead of by a page. One person may write, and the screen is where
 * they are let in: someone who can write to her can, through her, run things on this
 * computer. Open work that the computer has not told goes to the phone as a turn of the
 * same conversation, so an answer written back lands where she can route it, and a
 * question's options go as buttons that answer the bot directly.
 *
 * Her settings are the browser's (thursday.store), which the server cannot read: a
 * conversation from the phone runs on the defaults.
 */

/** The conversation with the phone, for as long as it is kept going (REACH.idleMs). */
type Line = {
  callId: string;
  standing: string | null;
  messages: ModelMessage[];
  lastAt: number;
};

/** A button under a question: which bot's question it answers, and with what. */
type Choice = {
  threadId: string;
  bot: string;
  question: string;
  answer: string;
};

type State = {
  stop: AbortController | null;
  telegram: Telegram | null;
  bot: string | null;
  problem: string | null;
  asking: ReachPerson | null;
  line: Line | null;
  /** One turn at a time: a second message waits for the first to be answered. */
  turn: Promise<void>;
  /** Open work already put to the phone, by item key (open-work). */
  told: Set<string>;
  /** Open work waiting out REACH.notifyAfterMs, by item key. */
  due: Map<string, ReturnType<typeof setTimeout>>;
  choices: Map<string, Choice>;
  listening: (() => void) | null;
  /** A look at the inbox already on its way: a working bot changes threads many times a second. */
  looking: ReturnType<typeof setTimeout> | null;
};

// Pinned, as the event bus is: a dev reload evaluates this module again, and a second
// poll on one token is refused by the service
const pinned = globalThis as { __reach?: State };
const state: State = (pinned.__reach ??= {
  stop: null,
  telegram: null,
  bot: null,
  problem: null,
  asking: null,
  line: null,
  turn: Promise.resolve(),
  told: new Set(),
  due: new Map(),
  choices: new Map(),
  listening: null,
  looking: null,
});

const changed = () => appEvents.emit({ type: "reach" });

async function readPerson(): Promise<ReachPerson | null> {
  const kept = await readConfig(REACH_PERSON_KEY);
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
    bot: state.bot,
    allowed: await readPerson(),
    asking: state.asking,
    problem: state.problem,
  };
}

/**
 * Starts listening with the token that is set, or stops when none is. Called at boot and
 * whenever the token changes (config.action): a new token is a new bot, so whoever was let
 * in to the old one is not carried over.
 */
export async function startReach(fresh = false): Promise<void> {
  state.stop?.abort();
  state.stop = null;
  state.telegram = null;
  state.bot = null;
  state.problem = null;
  state.asking = null;
  if (fresh) {
    await removeConfig(REACH_PERSON_KEY);
    await hangUp();
  }

  const token = await readConfig(TELEGRAM_TOKEN_KEY);
  if (!token) return changed();

  const stop = new AbortController();
  state.stop = stop;
  state.telegram = createTelegram(token);
  state.listening ??= appEvents.subscribe((event) => {
    if (event.type !== "threads" || state.looking) return;
    state.looking = setTimeout(() => {
      state.looking = null;
      void lookForOpenWork().catch((cause) =>
        logger.error("reach: open work", cause),
      );
    }, 2_000);
  });
  void listen(state.telegram, stop.signal);
}

async function listen(telegram: Telegram, signal: AbortSignal) {
  try {
    const me = await telegram.me(signal);
    state.bot = me.username ? `@${me.username}` : (me.first_name ?? "the bot");
    changed();
  } catch (cause) {
    if (signal.aborted) return;
    // A token the service turns away is the user's to fix; asking again would not change it
    state.problem = cause instanceof Error ? cause.message : String(cause);
    logger.warn(`reach: ${state.problem}`);
    return changed();
  }

  let offset = 0;
  while (!signal.aborted) {
    try {
      for (const update of await telegram.updates(offset, signal)) {
        offset = update.update_id + 1;
        void take(telegram, update).catch((cause) =>
          logger.error("reach: an update", cause),
        );
      }
      if (state.problem) {
        state.problem = null;
        changed();
      }
    } catch (cause) {
      if (signal.aborted) return;
      if (cause instanceof TelegramRefusal && cause.status === 401) {
        state.problem = cause.message;
        return changed();
      }
      // No network, the service down, a second listener on the token: said, and tried again
      const why = cause instanceof Error ? cause.message : String(cause);
      if (state.problem !== why) {
        state.problem = why;
        changed();
      }
      await new Promise((resolve) => setTimeout(resolve, REACH.retryMs));
    }
  }
}

async function take(telegram: Telegram, update: TelegramUpdate) {
  const pressed = update.callback_query;
  if (pressed) {
    await telegram.pressed(pressed.id);
    const person = await readPerson();
    if (!person || String(pressed.from.id) !== person.chat) return;
    return choose(telegram, person, pressed.data ?? "", pressed.message);
  }

  const message = update.message;
  // Her answers are one person's; a group is many, and whoever is in it could write
  if (!message?.from || message.chat.type !== "private") return;
  const chat = String(message.chat.id);
  const person = await readPerson();

  if (person?.chat !== chat) {
    if (person) {
      await telegram.say(chat, "This Thursday already answers someone else.");
      return;
    }
    state.asking = { chat, name: telegram.nameOf(message.from) };
    changed();
    await telegram.say(
      chat,
      "Almost there. Open Thursday on your computer and press Allow, then write again.",
    );
    return;
  }

  const words = await wordsOf(telegram, message);
  if (words === null) {
    await telegram.say(
      chat,
      "I can read words, pictures and files here — not voice or video yet. Write it instead.",
    );
    return;
  }
  if (words) write(telegram, person, words, words);
}

/** What a message says, with the files it brought kept in the workspace and named by path, as the write line names them. */
async function wordsOf(
  telegram: Telegram,
  message: TelegramMessage,
): Promise<string | null> {
  const said = (message.text ?? message.caption ?? "").trim();
  const photo = message.photo?.at(-1);
  const sent = message.document
    ? {
        id: message.document.file_id,
        name: message.document.file_name ?? "file",
        type: message.document.mime_type,
      }
    : photo
      ? { id: photo.file_id, name: `photo-${message.message_id}`, type: "" }
      : null;
  if (!sent)
    return (
      said || (message.voice || message.audio || message.video ? null : "")
    );

  const file = await telegram.fetchFile(sent.id, sent.name, sent.type);
  const [path] = await keepGivenFiles([file]);
  return [said, path].filter(Boolean).join("\n");
}

/** Lets in whoever is asking. The screen's Allow (reach.action). */
export async function allowReach(chat: string): Promise<void> {
  const asking = state.asking;
  if (!asking || asking.chat !== chat) return;
  await writeConfig(REACH_PERSON_KEY, JSON.stringify(asking));
  state.asking = null;
  changed();
  await state.telegram
    ?.say(chat, "You are in. Write here and Thursday answers.")
    .catch((cause) => logger.warn("reach: could not say so", cause));
}

/** Turns away whoever is asking; they may ask again. */
export function declineReach(): void {
  state.asking = null;
  changed();
}

/** Nobody may write from the phone any more; the bot stays, so the next to write asks to be let in. */
export async function forgetReach(): Promise<void> {
  await removeConfig(REACH_PERSON_KEY);
  await hangUp();
  changed();
}

/** Ends the conversation as a call. */
async function hangUp() {
  const line = state.line;
  state.line = null;
  for (const timer of state.due.values()) clearTimeout(timer);
  state.due.clear();
  state.choices.clear();
  if (line) await endCall(line.callId).catch(() => {});
}

/**
 * One turn, after whatever turn is running. `said` is what the person wrote, kept as their
 * turn; null when `words` is open work put in for a bot, which is no turn of theirs.
 */
function write(
  telegram: Telegram,
  person: ReachPerson,
  words: string,
  said: string | null,
  buttons?: { text: string; data: string }[],
): Promise<boolean> {
  const done = state.turn.then(() =>
    answer(telegram, person, words, said, buttons),
  );
  state.turn = done.then(
    () => {},
    () => {},
  );
  return done;
}

async function answer(
  telegram: Telegram,
  person: ReachPerson,
  words: string,
  said: string | null,
  buttons?: { text: string; data: string }[],
): Promise<boolean> {
  // "typing…" lasts a few seconds on the service's side, so it is said again while she works
  void telegram.typing(person.chat);
  const typing = setInterval(() => void telegram.typing(person.chat), 4_000);
  try {
    const settings = ThursdaySettingsSchema.parse({});
    // Quiet for long enough, or closed under it (the tab went, the server restarted): the
    // next words open a new call, which reads the last one back under Earlier calls
    const kept = state.line;
    const stale =
      !kept ||
      Date.now() - kept.lastAt > REACH.idleMs ||
      !(await isCallOpen(kept.callId));
    if (stale) {
      await hangUp();
      state.line = {
        ...(await openTextCall(settings)),
        messages: [],
        lastAt: 0,
      };
    }
    const line = state.line as Line;
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
      await telegram.say(
        person.chat,
        part,
        at === parts.length - 1 ? buttons : undefined,
      );
    await sendFiles(telegram, person, result.text);
    return true;
  } catch (cause) {
    // What a provider refused is the user's to act on, so it reaches them as it was said
    const why = isPublicError(cause)
      ? cause.message
      : modelErrorToString(cause);
    logger.warn(`reach: ${why}`);
    await telegram.say(person.chat, why).catch(() => {});
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
async function sendFiles(
  telegram: Telegram,
  person: ReachPerson,
  text: string,
) {
  const paths = (await filesOnDisk(pathsIn(text), null)).slice(-REACH.files);
  for (const path of paths) {
    const full = await insideWorkspace(path);
    const info = full ? await stat(full).catch(() => null) : null;
    if (!full || !info || info.size > REACH.fileBytes) continue;
    await telegram
      .sendFile(
        person.chat,
        await readFile(full),
        path.split("/").pop() ?? "file",
        viewKindOf(path) === "image",
      )
      .catch((cause) => logger.warn(`reach: could not send ${path}`, cause));
  }
}

/**
 * Open work goes to the phone once the computer has had its chance (REACH.notifyAfterMs):
 * a question, or an ending nobody has seen. Progress does not — a phone that buzzes for
 * every step is one that gets muted.
 */
async function lookForOpenWork() {
  if (!state.telegram || !(await readPerson())) return;
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
  const telegram = state.telegram;
  const person = await readPerson();
  if (!telegram || !person || state.told.has(key)) return;

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
  const told = await write(telegram, person, item.line, null, buttons);
  // Hers to tell again if it never got there; accepted as on a page once it did
  if (told) await acceptRoomRelays(item.relayIds);
  else state.told.delete(key);
}

async function choose(
  telegram: Telegram,
  person: ReachPerson,
  data: string,
  under?: TelegramMessage,
) {
  const choice = state.choices.get(data);
  if (!choice) {
    await telegram.say(
      person.chat,
      "That question is no longer open here. Write your answer instead.",
    );
    return;
  }
  for (const [key, one] of state.choices)
    if (one.question === choice.question) state.choices.delete(key);
  try {
    await answerThread(choice.threadId, choice.answer, "user", choice.bot);
    if (under?.text)
      await telegram.settle(
        person.chat,
        under.message_id,
        `${under.text}\n\n→ ${choice.answer}`,
      );
    // She is told, as she is when a question is answered on screen: a fact, not a turn
    state.line?.messages.push({
      role: "user",
      content: `[The user answered ${choice.bot}'s question from their phone: ${choice.answer}. It has reached ${choice.bot}.]`,
    });
  } catch (cause) {
    await telegram.say(
      person.chat,
      isPublicError(cause) ? cause.message : "That answer did not get through.",
    );
  }
}
