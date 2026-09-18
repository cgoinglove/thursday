import z from "zod";
import {
  type TextModelProviderId,
  textModelProviderSchema,
} from "@/features/ai/model.schema";
import { DateLikeSchema } from "@/lib/date-like";
import { COMMON_VALIDATE } from "@/lib/limits";
import { clip } from "@/lib/utils";
import { MARK_PAINT_IDS, MARK_SHAPES, randomMarkFills } from "./mark.const";
import { ROOM_THURSDAY, RoomViewSchema } from "./room.schema";

/** How a bot's mark is drawn. Every field is optional; the seed alone gives every bot a distinct face. */
export const botIconSchema = z.object({
  /** A hex colour, or MARK_SYSTEM to follow the theme. Stored so a chosen "system" differs from no choice. */
  color: z
    .string()
    .regex(/^(#[0-9a-fA-F]{6}|currentColor)$/, "Hex color")
    .optional(),
  shape: z.enum(MARK_SHAPES).optional(),
  /** Draw as an outline instead of a fill. */
  outline: z.boolean().optional(),
  /** A paint (MARK_PAINTS) worn in place of the colour; the colour stays for when it comes off. */
  paint: z.enum(MARK_PAINT_IDS).optional(),
});

export const botSystemPromptSchema = z.string().max(COMMON_VALIDATE.prompt.max);

/**
 * Faces for bots nobody drew, distinct from one another: the whole vocabulary is
 * rolled, shape and paints included, so a face the app hands out and a face
 * somebody picked are drawn from the same range. Random rather than name-derived
 * so two bots made in one call differ at a glance.
 */
export function randomBotIcons(count: number): BotIcon[] {
  return randomMarkFills(count).map((fill) => ({
    ...fill,
    shape: MARK_SHAPES[Math.floor(Math.random() * MARK_SHAPES.length)],
  }));
}

export const randomBotIcon = (): BotIcon => randomBotIcons(1)[0];

/** Pinned MCP tools skip the in-call tool search. 10 is a prompt-size budget, not a DB limit. */
export const MAX_PINNED_TOOLS = 10;

/** Pinned tool as the screen sees it. */
export const PinnedToolSchema = z.object({
  id: z.number(),
  name: z.string(),
  serverName: z.string(),
});

/**
 * The name is the identity; there is no id. Whitespace collapses to single
 * spaces because the name travels through speech and transcripts.
 */
export const botNameSchema = z
  .string()
  .trim()
  .transform((name) => name.replace(/\s+/g, " "))
  .refine(
    (name) => name.toLowerCase() !== ROOM_THURSDAY.toLowerCase(),
    "Thursday is reserved for the voice assistant.",
  )
  .pipe(
    z.string().min(1, "A name is required").max(COMMON_VALIDATE.name.max),
    // .regex(/^\p{L}+(?: \p{L}+)*$/u, "Letters and single spaces only"),
  );

/** Tokens burned. Input and output stay apart because output costs about ten times more. */
export const TokenUsageSchema = z.object({
  input: z.number(),
  output: z.number(),
});

export type TokenUsage = z.infer<typeof TokenUsageSchema>;

/** A budget under this leaves no room for the opening message, so it is refused rather than stored. */
export const COMPACT_AT_MIN = 8_000;

export const BotSchema = z.object({
  name: z.string(),
  description: z.string(),
  systemPrompt: z.string().nullish(),
  icon: botIconSchema.nullish(),
  /** Set only when chosen; empty runs on the app default model. */
  provider: textModelProviderSchema.nullish(),
  model: z.string().nullish(),
  /** Where this bot's runs compact; empty derives it from the model's own window. */
  compactAt: z.number().nullish(),
  /** Switched off by the user: kept whole, shown to no model. */
  disabled: z.boolean(),
  createdAt: DateLikeSchema,
  tools: PinnedToolSchema.array().default([]),
  /** Sum over every job this bot ran; deleted jobs drop out. */
  tokens: TokenUsageSchema,
  /** When this bot's latest job last moved; null if it never ran. Carried here so the roster need not page through history. */
  lastJobAt: DateLikeSchema.nullish(),
});

export const BotFormSchema = z.object({
  name: botNameSchema,
  description: z
    .string()
    .trim()
    .min(1, "Say what this bot is for")
    .max(COMMON_VALIDATE.description.max),
  systemPrompt: botSystemPromptSchema.optional(),
  icon: botIconSchema.optional(),
  /** Unset by default (runs on the app default). A half pick is emptied, see `pickedModel`. */
  provider: textModelProviderSchema.nullish(),
  model: z.string().trim().max(80).nullish(),
  /** Empty derives it from the model; a number overrides. Below the floor a run cannot start. */
  compactAt: z.coerce
    .number()
    .int()
    .min(COMPACT_AT_MIN, `At least ${COMPACT_AT_MIN / 1000}k`)
    .nullish(),
  disabled: z.boolean().optional(),
  toolIds: z.number().int().array().max(MAX_PINNED_TOOLS).default([]),
});

/**
 * Treats a half pick (provider or model alone) as no model. A function, not a
 * schema transform, because `BotFormSchema.partial()` is used elsewhere. Called
 * once at the write in bot.query.
 */
export const pickedModel = <T extends { provider?: unknown; model?: unknown }>(
  form: T,
): T & { provider: TextModelProviderId | null; model: string | null } => {
  const provider = (form.provider ?? null) as TextModelProviderId | null;
  const model = typeof form.model === "string" ? form.model.trim() : null;
  return provider && model
    ? { ...form, provider, model }
    : { ...form, provider: null, model: null };
};

export type BotIcon = z.infer<typeof botIconSchema>;
export type PinnedTool = z.infer<typeof PinnedToolSchema>;
export type Bot = z.infer<typeof BotSchema>;
export type BotForm = z.infer<typeof BotFormSchema>;

/** A bot as a job sees it. Not the row: DEFAULT_BOT has none, and pinned tools are reached through the prompt. */
export type JobBot = {
  name: string;
  description: string;
  systemPrompt: string | null;
  icon: BotIcon | null;
  /** null means whatever key is configured; only the default bot. */
  provider: TextModelProviderId | null;
  model: string | null;
  /** Carried so a run that already has this bot can say so; `listJobBots` never returns a disabled one. */
  disabled: boolean;
  /** Where its runs compact; null derives it from the model (ai/model compactBudget). */
  compactAt: number | null;
};

/**
 * Worker that exists when no bot row does, so a fresh install can delegate.
 * Has no prompt: the base persona (ai/prompts/bot.prompt) says everything it needs.
 * The Jarvis seed takes the same name on purpose (bot.seed): installed, its row
 * stands in for the fallback.
 */
export const DEFAULT_BOT: JobBot = {
  name: "Jarvis",
  description: "Anything — this computer, a browser, the web, files, services",
  systemPrompt: null,
  icon: { color: "#14B8A6", shape: "squircle" },
  provider: null,
  model: null,
  disabled: false,
  compactAt: null,
};

// A bot's own memory (features/bot/bot.memory): the setting behind it. The files
// are per bot; whether any bot is shown its own is not.

/** Config key (features/config config.query) the switch lives under. */
export const BOT_MEMORY_KEY = "BOT_MEMORY";

/** On unless it was switched off. Off, no prompt lists a bot's memory; the files stay. */
export const isBotMemoryOn = (value: string | undefined) =>
  value?.trim() !== "off";

// What happens to running work once every tab is gone (app/api/events presence,
// config BROWSER_GONE_MS). A server-side setting, not a browser's: it decides what
// the server does when no browser is there to hold one.

/** Config key (features/config config.query) the switch lives under. */
export const KEEP_WORKING_KEY = "KEEP_WORKING";

/**
 * Off unless it was switched on, so closing the last tab still stops running jobs and
 * opening one again picks them back up. On, they run until the server itself stops, and
 * a job that ends or asks with nobody there sends a desktop notification and waits.
 */
export const isKeepWorkingOn = (value: string | undefined) =>
  value?.trim() === "on";

/** One file of a bot's own memory (bot.memory), as its prompt lists it and its page draws it. */
export const BotMemoryFileSchema = z.object({
  file: z.string(),
  /** Workspace-relative, for reading or deleting it the way Workspace does. */
  path: z.string(),
  /** The line it is listed by; empty for a file with nothing in it. */
  line: z.string(),
  at: DateLikeSchema,
  bytes: z.number(),
});
export type BotMemoryFile = z.infer<typeof BotMemoryFileSchema>;

export type BotMemory = {
  /** Workspace-relative: `bots/<name>/memory`. */
  folder: string;
  /** Newest first, as many as the reader asked for. */
  entries: BotMemoryFile[];
  /** Every file in the folder, listed or not. */
  total: number;
};

/**
 * What a thread opened by a routine is told about it (features/routine): which one, when
 * it starts, and how its last run ended, so "since last time" means something.
 */
export type ThreadRoutine = {
  id: string;
  /** "Daily 09:00 · Mon–Fri" (routine.schema scheduleText). */
  when: string;
  last: { at: Date; said: string } | null;
};

/** One of a bot's other threads, as its own prompt lists it (thread.query listBotWork). */
export type BotWorkLine = {
  /** The thread. Its first characters are the handle a cut line shows (`workHandle`). */
  id: string;
  /** The exchange `said` ended; what the bot was asked there hangs off it (thread.query readBotAsk). */
  workId: string | null;
  label: string;
  /** Who coordinates that thread: the bot itself, or the one it was called in by. */
  owner: string;
  status: ThreadStatus;
  /** Waiting on the user's answer rather than on Continue. */
  asking: boolean;
  updatedAt: Date;
  /** The bot's own last ending there; null when it has ended no turn in words. */
  said: string | null;
  /** `said` runs past what a line carries (config BOT_WORK.said), so there is more to open. */
  cut: boolean;
};

/** How a thread is named on a line and to the tool that opens it: enough of its id to tell ten apart. */
export const workHandle = (id: string) => id.slice(0, 6);

/**
 * `waiting`: a bot asked the user something, or the app stopped the work; the
 * answer resumes the same thread. `cancelled`: the user stopped it. A model that
 * breaks pauses the job as `waiting` rather than ending it, so nothing ends as a
 * failure. `done` and `cancelled` can be picked back up with a follow-up.
 */
export const THREAD_STATUSES = [
  "running",
  "waiting",
  "done",
  "cancelled",
] as const;

export type ThreadStatus = (typeof THREAD_STATUSES)[number];

/** The single option offered when the app stopped a job and asks whether to go on. Button text and spoken word alike. */
export const THREAD_CONTINUE = "Continue";

/**
 * Who a person's words to a job came from (bot.runner answerThread). Thursday
 * passing something on from a call and the user typing on screen reach a bot
 * down one pipe, so the words carry it in front of them.
 */
export type ThreadSpeaker = "thursday" | "user";

const SPEAKER_TAGS: Record<ThreadSpeaker, string> = {
  thursday: "Thursday, on the call:",
  user: "The user, on screen:",
};

export const tagSpeaker = (from: ThreadSpeaker, text: string): string =>
  `${SPEAKER_TAGS[from]} ${text}`;

/** The words without their tag, as the screen draws a person's line (thread.query linesOf). */
export const untagSpeaker = (text: string): string => {
  for (const tag of Object.values(SPEAKER_TAGS)) {
    if (text.startsWith(`${tag} `)) return text.slice(tag.length + 1);
  }
  return text;
};

/**
 * What a waiting thread waits on: a bot's question (`messageId`, the asker `bot`)
 * or a stop the app made, which offers only Continue. `auto` is a stop the app
 * picks back up by itself (browser absence).
 */
export type ThreadPending = {
  options: string[];
  auto?: boolean;
  messageId?: string;
  bot?: string;
};

/**
 * True when the app stopped the job (step cap, closed browser, restart, idle room)
 * rather than a bot asking something. Why it stopped is in the outcome text; every
 * list calls it waiting on you, because the answer is the same click. A question
 * carries its message id, so a bot offering Continue as a choice is still asking.
 */
export const isAppStop = (
  ask: { options: string[]; messageId?: string } | null | undefined,
) => {
  const options = ask?.options ?? [];
  return (
    !ask?.messageId && options.length === 1 && options[0] === THREAD_CONTINUE
  );
};

/** One piece of a tool result as the screen draws it. Full output stays in the stored messages. */
export const ResultPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  /** data: or http(s) url usable in an <img>. */
  z.object({ type: z.literal("image"), src: z.string() }),
]);

export type ResultPart = z.infer<typeof ResultPartSchema>;

/** One thread line as the screen sees it. `bot` is null on the user side; `parent` is the exchange (thread_work) it was written under. */
const LineBase = z.object({
  /** Row id plus part index; one message may hold several lines. */
  id: z.string(),
  seq: z.number(),
  bot: z.string().nullable(),
  parent: z.string().nullable(),
  to: z.string().nullish(),
  at: DateLikeSchema,
});

export const ThreadLineSchema = z.discriminatedUnion("kind", [
  /** What the user said (via Thursday): request, answer. */
  LineBase.extend({ kind: z.literal("user"), text: z.string() }),
  /** Bot text; the last one is the answer. */
  LineBase.extend({ kind: z.literal("text"), text: z.string() }),
  /** Compaction summary (bot.run compact). The model resumes from here; the screen draws it as a divider. */
  LineBase.extend({ kind: z.literal("note"), text: z.string() }),
  /** Why the app stopped the run (room.query pauseRoom, or a break the runner retries), without what the resumed run is told to check. */
  LineBase.extend({ kind: z.literal("stop"), text: z.string() }),
  LineBase.extend({
    kind: z.literal("tool"),
    callId: z.string(),
    name: z.string(),
    /** Argument worth showing (query, command, path), clipped to one line. */
    input: z.string(),
    /** Model-written label (bash `description`). */
    note: z.string().nullish(),
    /** Unclipped path a file tool received; the screen's "Open" uses it because `input` may be truncated. */
    path: z.string().nullish(),
  }),
  LineBase.extend({
    kind: z.literal("tool-result"),
    callId: z.string(),
    name: z.string(),
    /** A glance: a few text lines, each clipped. The whole output is behind `queryKey.toolResult`. */
    results: ResultPartSchema.array(),
    /** The output holds more than the glance: more lines, a clipped line, or an image. */
    more: z.boolean(),
  }),
  /** A message sent to another participant or to Thursday (send_message); `question` asks the user. */
  LineBase.extend({
    kind: z.literal("ask"),
    callId: z.string(),
    to: z.string(),
    text: z.string(),
    question: z.boolean().optional(),
  }),
]);

export type ThreadLine = z.infer<typeof ThreadLineSchema>;

/** One line of where a job is: the bot's last text plus the tool it reached for after. Stops at a user-side line. */
export function threadActivity(lines: ThreadLine[], max = 120): string | null {
  let doing: string | null = null;
  for (let at = lines.length - 1; at >= 0; at--) {
    const line = lines[at];
    if (line.kind === "tool") {
      doing ??= `${line.name} ${line.note ?? line.input}`;
    } else if (line.kind === "text") {
      return clip(doing ? `${line.text} → ${doing}` : line.text, max);
    } else if (line.kind === "ask") {
      return clip(`asked ${line.to}: ${line.text}`, max);
    } else if (line.kind === "user") {
      break;
    }
  }
  return doing ? clip(doing, max) : null;
}

/**
 * What a `waiting` thread asks: question from the row's `outcome`, options from
 * `pending`. `auto` is a stop the app picks back up by itself (ThreadPending), so
 * nobody is told about it and nobody is rung for it.
 */
export const ThreadAskSchema = z.object({
  question: z.string(),
  messageId: z.string().optional(),
  bot: z.string().optional(),
  options: z.string().array(),
  auto: z.boolean(),
});

export type ThreadAsk = z.infer<typeof ThreadAskSchema>;

/** Thread as the screen and voice tools see it. */
export const ThreadSchema = z.object({
  id: z.string(),
  bot: z.string(),
  label: z.string(),
  request: z.string(),
  status: z.enum(THREAD_STATUSES),
  outcome: z.string().nullable(),
  /** Set only while `waiting`. */
  ask: ThreadAskSchema.nullable(),
  /**
   * Whether the user has had the ending: they opened the thread, or Thursday marked
   * it once she had told them (`thread` `seen`). A cancel is seen by whoever
   * cancelled. A highlight and a count, never a filter.
   */
  seen: z.boolean(),
  /** The routine that opened it (features/routine); null for a job a person or a bot started. */
  routineId: z.string().nullable(),
  /** Burned so far, across every participant. */
  tokens: TokenUsageSchema,
  /** Context size the model read on the last step (not a sum) and the compaction threshold (BOT_RUN.compactAt). 0 means no step ran yet. */
  contextTokens: z.number(),
  contextBudget: z.number(),
  createdAt: DateLikeSchema,
  updatedAt: DateLikeSchema,
  /** Lines to draw; the model's messages stay on the server. */
  lines: ThreadLineSchema.array(),
  room: RoomViewSchema,
});

export type Thread = z.infer<typeof ThreadSchema>;

/** A participant can ask the user while other participants keep working. */
export const needsThreadReply = (thread: {
  status: string;
  room: Thread["room"];
}) => thread.status === "waiting" || thread.room.questions.length > 0;
