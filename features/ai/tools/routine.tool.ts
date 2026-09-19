import { tool } from "ai";
import * as z from "zod";
import { ROUTINE } from "@/config";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { listJobBots, readKeepWorkingOn } from "@/features/bot/bot.query";
import {
  createRoutine,
  deleteRoutine,
  listRoutines,
  resolveRoutine,
  updateRoutine,
} from "@/features/routine/routine.query";
import {
  type Routine,
  RoutineInputSchema,
  type RoutineSchedule,
  RoutineScheduleSchema,
  scheduleText,
} from "@/features/routine/routine.schema";
import { toDate, whenOf } from "@/lib/date-like";
import { isPublicError } from "@/lib/public-error";
import { clip } from "@/lib/utils";

const routineSpec = {
  description: `Routines: work that starts by itself, each one a bot, the work and a time. List them, make one, change one, or delete one. Every start opens a thread like one started by hand; its result reaches the conversation the same way. At most ${ROUTINE.max} exist.`,
  parameters: z.object({
    action: z.enum(["list", "create", "change", "delete"]),
    routine: z
      .string()
      .nullish()
      .describe("With change or delete: the routine, by its name or ID."),
    bot: z
      .string()
      .nullish()
      .describe(
        "With create: a name from the bot list. With change: a new bot.",
      ),
    label: z
      .string()
      .nullish()
      .describe(
        "With create: two or three words naming it, in the user's language. It names every thread the routine opens, on screen and out loud.",
      ),
    request: z
      .string()
      .nullish()
      .describe(
        "With create: the whole of the work, handed to the bot as written every time it starts. Nobody is there then to fill in what is missing, so everything it needs goes here, in the user's own language and words. Their request, never your reading of it.",
      ),
    time: z
      .string()
      .nullish()
      .describe(
        'Starts at this time of day, 24-hour "HH:MM" in the user\'s own time, on `days`. Give this or `everyHours`, never both.',
      ),
    days: z
      .array(z.number().int().min(1).max(7))
      .nullish()
      .describe(
        "With `time`: the days it starts, 1 Monday to 7 Sunday. Omit for every day.",
      ),
    everyHours: z
      .number()
      .int()
      .nullish()
      .describe(
        `Starts again this many hours after it last started, ${ROUTINE.minHours} at least. Give this or \`time\`, never both.`,
      ),
    enabled: z
      .boolean()
      .nullish()
      .describe(
        "With change: false switches it off without deleting it, true back on.",
      ),
  }),
};

type Args = z.infer<typeof routineSpec.parameters>;

/** The schedule the arguments spell, none when they say nothing about time, or the line that says what is wrong. */
function scheduleOf(args: Args): RoutineSchedule | string | null {
  if (args.time && args.everyHours)
    return "Give `time` or `everyHours`, not both.";
  const spelled = args.time
    ? {
        kind: "daily",
        time: args.time,
        days: args.days?.length ? args.days : [1, 2, 3, 4, 5, 6, 7],
      }
    : args.everyHours
      ? { kind: "every", hours: args.everyHours }
      : null;
  if (!spelled) return null;
  const parsed = RoutineScheduleSchema.safeParse(spelled);
  return parsed.success ? parsed.data : parsed.error.issues[0].message;
}

/** A routine as a model reads it: no ids but its own, and how its last run ended in a line. */
function told(routine: Routine) {
  const last = routine.runs[0];
  return {
    id: routine.id,
    label: routine.label,
    bot: routine.bot,
    when: scheduleText(routine.schedule),
    enabled: routine.enabled,
    ...(routine.enabled ? { next: whenOf(toDate(routine.nextRunAt)) } : {}),
    request: clip(routine.request, 300),
    ...(last
      ? {
          lastRun: {
            thread: last.id,
            status: last.status,
            at: whenOf(toDate(last.updatedAt)),
            ...(last.outcome ? { outcome: clip(last.outcome, 200) } : {}),
          },
        }
      : {}),
  };
}

/** A refusal the domain raised is one line the model can act on; anything else is a bug and stays thrown. */
const refusal = (cause: unknown): string => {
  if (isPublicError(cause)) return cause.message;
  throw cause;
};

async function noSuchRoutine(ref: string | null | undefined): Promise<string> {
  const names = (await listRoutines()).map((one) => `"${one.label}"`);
  if (!names.length) return "There are no routines yet.";
  return ref
    ? `There is no single routine called "${ref}". The routines are: ${names.join(", ")}. Call again with one of those, or its ID.`
    : `Name the routine. The routines are: ${names.join(", ")}.`;
}

/** The call's hand on routines. A bot holds none: what starts by itself is the user's to set up. */
export function createRoutineTools() {
  return {
    [TOOL_NAMES.routine]: tool({
      description: routineSpec.description,
      inputSchema: routineSpec.parameters,
      execute: async (args: Args) => {
        if (args.action === "list")
          return { routines: (await listRoutines()).map(told) };

        const schedule = scheduleOf(args);
        if (typeof schedule === "string") return schedule;

        if (args.action === "create") {
          if (!schedule)
            return "Say when it starts: `time` (with `days`), or `everyHours`.";
          const input = RoutineInputSchema.safeParse({
            bot: args.bot ?? "",
            label: args.label ?? "",
            request: args.request ?? "",
            schedule,
          });
          if (!input.success)
            return `${input.error.issues[0].message}. Nothing was made — call again with bot, label, request and when.`;
          const names = (await listJobBots()).map((one) => one.name);
          if (
            !names.some(
              (name) => name.toLowerCase() === input.data.bot.toLowerCase(),
            )
          )
            return `There is no bot called "${input.data.bot}". The bots are: ${names.join(", ")}. Nothing was made — call again with one of those.`;
          const made = await createRoutine(input.data).catch(refusal);
          if (typeof made === "string") return made;
          // True as it is made, and the user's to change: a time they were promised can pass unkept
          const held = (await readKeepWorkingOn())
            ? ""
            : " As things are set, it starts only while the app is open in a tab: a time that passes with it closed starts once when it is opened again. Settings › Routines has the switch that lets work go on with the app closed.";
          return {
            ...told(made),
            note: `${made.bot} starts "${made.label}" by itself, ${scheduleText(made.schedule)}, first ${whenOf(toDate(made.nextRunAt))}. Each start is a thread of its own, and its result reaches the conversation like any thread's.${held}`,
          };
        }

        const one = args.routine ? await resolveRoutine(args.routine) : null;
        if (!one) return await noSuchRoutine(args.routine);

        if (args.action === "delete") {
          await deleteRoutine(one.id);
          return `"${one.label}" is deleted and starts no more. The threads it already opened stay.`;
        }

        const patch = {
          ...(args.bot ? { bot: args.bot } : {}),
          ...(args.label?.trim() ? { label: args.label.trim() } : {}),
          ...(args.request?.trim() ? { request: args.request.trim() } : {}),
          ...(schedule ? { schedule } : {}),
          ...(typeof args.enabled === "boolean"
            ? { enabled: args.enabled }
            : {}),
        };
        if (!Object.keys(patch).length)
          return "Nothing to change was given: bot, label, request, when, or enabled.";
        const changed = await updateRoutine(one.id, patch).catch(refusal);
        if (typeof changed === "string") return changed;
        return changed ? told(changed) : await noSuchRoutine(args.routine);
      },
    }),
  };
}
