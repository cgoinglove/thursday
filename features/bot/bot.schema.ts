import z from "zod";
import { PAGE_SIZE } from "@/config";
import {
  type TextModelProviderId,
  textModelProviderSchema,
} from "@/features/ai/model.schema";
import { DateLikeSchema } from "@/lib/date-like";
import { COMMON_VALIDATE } from "@/lib/limits";
import { clip } from "@/lib/utils";
import { MARK_SHAPES, randomMarkColors } from "./mark.const";

/** How a bot's mark is drawn. Both fields are optional; the seed alone gives every bot a distinct face. */
export const botIconSchema = z.object({
  /** A hex colour, or MARK_SYSTEM to follow the theme. Stored so a chosen "system" differs from no choice. */
  color: z
    .string()
    .regex(/^(#[0-9a-fA-F]{6}|currentColor)$/, "Hex color")
    .optional(),
  shape: z.enum(MARK_SHAPES).optional(),
  /** Draw as an outline instead of a fill. */
  outline: z.boolean().optional(),
});

export const botSystemPromptSchema = z.string().max(COMMON_VALIDATE.prompt.max);

/** Face for a bot nobody drew. Random rather than name-derived so two bots made in one call differ at a glance. */
export function randomBotIcon(): BotIcon {
  return {
    color: randomMarkColors(1)[0],
    shape: MARK_SHAPES[Math.floor(Math.random() * MARK_SHAPES.length)],
  };
}

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

export const NO_TOKENS: TokenUsage = { input: 0, output: 0 };

export const BotSchema = z.object({
  name: z.string(),
  description: z.string(),
  systemPrompt: z.string().nullish(),
  icon: botIconSchema.nullish(),
  /** Set only when chosen; empty runs on the app default model. */
  provider: textModelProviderSchema.nullish(),
  model: z.string().nullish(),
  /** Switched off by the user: kept whole, shown to no model. */
  disabled: z.boolean(),
  createdAt: DateLikeSchema,
  tools: PinnedToolSchema.array().default([]),
  /** Sum over every job this bot ran; deleted jobs drop out. */
  tokens: TokenUsageSchema,
  /** When this bot's latest job last moved; null if it never ran. Carried here so the roster need not page through history. */
  lastJobAt: DateLikeSchema.nullish(),
  /** The bot's own notes, written by itself at report time. Shown, never edited; the user's only move is to clear them. */
  note: z.string().nullish(),
  noteAt: DateLikeSchema.nullish(),
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
};

/**
 * Worker that exists when no bot row does, so a fresh install can delegate.
 * Has no prompt: the base persona (ai/prompts/bot.prompt) says everything it needs.
 * No seed may reuse this name, or the row shadows the fallback.
 */
export const DEFAULT_BOT: JobBot = {
  name: "Jarvis",
  description: "Anything — this computer, a browser, the web, files, services",
  systemPrompt: null,
  icon: { color: "#14B8A6", shape: "squircle" },
  provider: null,
  model: null,
  disabled: false,
};

// A bot's own instructions (database bot_note, features/bot/bot.notes): the setting
// behind them. The lines themselves are per bot; whether any bot keeps them is not.

/** Config key (features/config config.query) the switch lives under. */
export const BOT_NOTES_KEY = "BOT_NOTES";

/**
 * On unless it was switched off, the other way round from the memory read-back:
 * a pass runs only when a job actually turned something up, and costs one small
 * call when it does — so a bot that never learns anything never spends.
 */
export const isBotNotesOn = (value: string | undefined) =>
  value?.trim() !== "off";

/**
 * `waiting`: the bot stopped on a question only the user can answer; the answer
 * resumes the same thread. `done` and `failed` can be resumed as well.
 */
export const TASK_STATUSES = ["running", "waiting", "done", "failed"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

/** One page of history (config PAGE_SIZE). */
export const TASK_HISTORY_PAGE = PAGE_SIZE;

/** The single option offered when a job out of budget asks whether to go on. Button text and spoken word alike. */
export const TASK_CONTINUE = "Continue";

/** True when the ask is a budget stop (only option is TASK_CONTINUE), not a real question. */
export const isBudgetAsk = (ask: { options: string[] } | null | undefined) => {
  const options = ask?.options ?? [];
  return options.length === 1 && options[0] === TASK_CONTINUE;
};

/** One piece of a tool result as the screen draws it. Full output stays in the server thread. */
export const ResultPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  /** data: or http(s) url usable in an <img>. */
  z.object({ type: z.literal("image"), src: z.string() }),
]);

export type ResultPart = z.infer<typeof ResultPartSchema>;

/** One thread line as the screen sees it. `bot` is null on the user side; `parent` is the ask_bot call it happened under. */
const LineBase = z.object({
  /** Row id plus part index; one message may hold several lines. */
  id: z.string(),
  seq: z.number(),
  bot: z.string().nullable(),
  parent: z.string().nullable(),
  at: DateLikeSchema,
});

export const TaskLineSchema = z.discriminatedUnion("kind", [
  /** What the user said (via Thursday): request, answer. */
  LineBase.extend({ kind: z.literal("user"), text: z.string() }),
  /** Bot text; the last one is the report. */
  LineBase.extend({ kind: z.literal("text"), text: z.string() }),
  /** Compaction summary (bot.run compact). The model resumes from here; the screen draws it as a divider. */
  LineBase.extend({ kind: z.literal("note"), text: z.string() }),
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
    /** A glance's worth; the rest is behind `queryKey.toolResult`. */
    results: ResultPartSchema.array(),
    /** Something was clipped. */
    more: z.boolean(),
  }),
  /**
  /** Bot to bot: `ask_bot` (`to` is the borrowed bot) or `ask_back` (`to` is the job's bot, `parent` set). Both answer as `ask-result`. */
  LineBase.extend({
    kind: z.literal("ask"),
    callId: z.string(),
    to: z.string(),
    text: z.string(),
  }),
  LineBase.extend({
    kind: z.literal("ask-result"),
    callId: z.string(),
    text: z.string(),
  }),
  /** Asked Thursday; she or the user through her answers. */
  LineBase.extend({
    kind: z.literal("waiting"),
    callId: z.string(),
    question: z.string(),
    /** Only real options. Buttons on screen, read aloud in the call. */
    options: z.string().array(),
  }),
]);

export type TaskLine = z.infer<typeof TaskLineSchema>;

/** One line of where a job is: the bot's last text plus the tool it reached for after. Stops at a user-side line. */
export function taskActivity(lines: TaskLine[], max = 120): string | null {
  let doing: string | null = null;
  for (let at = lines.length - 1; at >= 0; at--) {
    const line = lines[at];
    if (line.kind === "tool") {
      doing ??= `${line.name} ${line.note ?? line.input}`;
    } else if (line.kind === "text") {
      return clip(doing ? `${line.text} → ${doing}` : line.text, max);
    } else if (line.kind === "ask") {
      // ask_bot reads as "for"; ask_back (has parent) reads as a plain question
      return clip(
        line.parent
          ? `asked ${line.to}: ${line.text}`
          : `asked ${line.to} for: ${line.text}`,
        max,
      );
    } else if (line.kind === "user" || line.kind === "waiting") {
      break;
    }
  }
  return doing ? clip(doing, max) : null;
}

/** What a `waiting` task asks: question from the row's `outcome`, options from `pending`. */
export const TaskAskSchema = z.object({
  question: z.string(),
  options: z.string().array(),
});

export type TaskAsk = z.infer<typeof TaskAskSchema>;

/** Task as the screen and voice tools see it. */
export const TaskSchema = z.object({
  id: z.string(),
  bot: z.string(),
  label: z.string(),
  request: z.string(),
  status: z.enum(TASK_STATUSES),
  outcome: z.string().nullable(),
  /** Set only while `waiting`. */
  ask: TaskAskSchema.nullable(),
  /** Whether it has been relayed to Thursday. A highlight, not a filter. */
  reported: z.boolean(),
  /** Burned so far, across every segment including borrowed bots. */
  tokens: TokenUsageSchema,
  /** Context size the model read on the last step (not a sum) and the compaction threshold (BOT_RUN.compactAt). 0 means no step ran yet. */
  contextTokens: z.number(),
  contextBudget: z.number(),
  createdAt: DateLikeSchema,
  updatedAt: DateLikeSchema,
  /** Thread reduced for drawing; the model's messages stay on the server. */
  lines: TaskLineSchema.array(),
});

export type Task = z.infer<typeof TaskSchema>;
