import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative } from "node:path";
import { promisify } from "node:util";
import { type ToolSet, tool } from "ai";
import z from "zod";
import { APP_DIR, DECK, PATHS } from "@/config";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { viewKindOf } from "@/features/workspace/file-kind";
import {
  botArtifacts,
  insideWorkspace,
  WORKSPACE,
} from "@/features/workspace/workspace";
import type { Sandbox } from "@/lib/sandbox";

/**
 * A slide deck as typed slides: the model fills a layout's fields, and the app draws them
 * (skills/deck). Nothing about how a slide looks is the model's to get wrong — sizes,
 * colours, where a heading sits, what happens to words that do not fit — so a deck comes
 * out right from any model that can fill a schema. The file holds the deck as data and
 * draws itself from it, and a change sends the whole deck again, checked against the
 * revision the file names so a change never lands on a deck its writer has not seen.
 *
 * The character caps are sized for the drawing in skills/deck/deck.css: what fits a slide
 * at full size. Past them the type would shrink too far, and a slide would be a page.
 */

const SCRIPT = join(APP_DIR, PATHS.skills.default, "deck", "deck.mjs");

const THEMES = ["forest", "sea", "clay", "ink"] as const;

/** Text on a slide, at most `max` characters. */
const words = (max: number) => z.string().trim().max(max);

const footer = words(100)
  .nullish()
  .describe("A source or a date along the foot of the slide.");
const notes = words(1500)
  .nullish()
  .describe("What the presenter says over it, as speech. Never shown.");

const cover = z.object({
  layout: z.literal("cover"),
  title: words(110).describe("The deck's subject, as its title."),
  eyebrow: words(40).nullish().describe("A word or two above the title."),
  subtitle: words(180).nullish().describe("One line under the title."),
  footer,
  notes,
});

const statement = z.object({
  layout: z.literal("statement"),
  title: words(120).describe("The one claim, as a sentence."),
  subtitle: words(140).nullish().describe("One line under it."),
  notes,
});

const cards = z.object({
  layout: z.literal("cards"),
  title: words(90).describe("The point the cards make together."),
  cards: z
    .array(
      z.object({
        title: words(60).describe("Its point."),
        text: words(160).nullish().describe("One line under it."),
      }),
    )
    .min(2)
    .max(4)
    .describe("Two to four, side by side and numbered."),
  footer,
  notes,
});

const number = z.object({
  layout: z.literal("number"),
  value: words(10).describe(
    "The figure as it reads: 1.4M, 62%, £2,900. Only one you were given.",
  ),
  label: words(80).nullish().describe("What it counts, above it."),
  subtitle: words(160)
    .nullish()
    .describe("What it means or is compared with, under it."),
  footer,
  notes,
});

const table = z.object({
  layout: z.literal("table"),
  title: words(90).describe("What the comparison shows."),
  columns: z
    .array(words(40))
    .min(2)
    .max(5)
    .describe(
      "The header row. The first column names the rows; its header may be blank.",
    ),
  rows: z
    .array(z.array(words(60)))
    .min(1)
    .max(6)
    .describe("Up to six, a cell for each column."),
  stress: z
    .number()
    .int()
    .min(0)
    .max(4)
    .nullish()
    .describe(
      "Which column, counted from 0, to set in the accent: the one the slide argues for.",
    ),
  footer,
  notes,
});

const quote = z.object({
  layout: z.literal("quote"),
  quote: words(280).describe(
    "Someone's own words, exactly as you were given them. Never made up.",
  ),
  who: words(60).describe("Who said it."),
  role: words(80).nullish().describe("Their role, place or date."),
  notes,
});

const image = z.object({
  layout: z.literal("image"),
  title: words(90).describe("The heading beside the picture."),
  subtitle: words(280).nullish().describe("A line or two under it."),
  image: words(500).describe(
    "Workspace path of a png, jpg, webp, gif or svg. It is copied beside the deck.",
  ),
  alt: words(160).describe("What it shows, for someone who cannot see it."),
  fit: z
    .enum(["fill", "whole"])
    .nullish()
    .describe(
      "fill crops a photo to its box; whole shows a chart or screenshot uncropped. Null for fill.",
    ),
  footer,
  notes,
});

const close = z.object({
  layout: z.literal("close"),
  title: words(120).describe(
    "The sentence to repeat to someone who was not there.",
  ),
  steps: z
    .array(
      z.object({
        label: words(24).describe("A word or two: Next, Owner, By."),
        text: words(120).describe("What it is."),
      }),
    )
    .max(3)
    .nullish()
    .describe("Up to three next steps."),
  notes,
});

const slide = z.discriminatedUnion("layout", [
  cover,
  statement,
  cards,
  number,
  table,
  quote,
  image,
  close,
]);
type Slide = z.infer<typeof slide>;

const deckSchema = z.object({
  deck: words(300).describe(
    "A name for a new deck, or the name or workspace path of one to change. A deck another bot made is reached by its path.",
  ),
  title: words(90).describe("The deck's title, shown in its head."),
  theme: z
    .enum(THEMES)
    .nullish()
    .describe(
      "forest (deep green on paper, serif headings), sea (blue, sans), clay (terracotta on warm paper, serif) or ink (gold on near-black, sans). Null keeps the deck's own; a new one starts in forest.",
    ),
  revision: z
    .string()
    .nullish()
    .describe(
      "What the last call on this deck answered with. Null for a new deck.",
    ),
  slides: z
    .array(slide)
    .min(1)
    .max(DECK.slides)
    .describe(
      "Every slide in order: the whole deck, each time. Someone who reads only the titles follows the argument; one idea a slide.",
    ),
});

/** A deck name as one path segment: what the model called it, with anything else made a dash. */
const NAME = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,79}$/u;
const nameOf = (said: string) =>
  said
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^[-_]+|-+$/g, "")
    .slice(0, 80);

/** A picture the renderer leaves beside a deck, which a picture copied there must not replace. */
const SHOT = /^slide-\d+\.png$/i;

/** A reason the call made nothing, as the one line the model reads. */
class Refusal extends Error {}

/** The deck file a call names, relative to the workspace, or the line that says why there is none. */
async function deckFile(said: string, bot: string): Promise<string> {
  const path = said.includes("/") || said.endsWith(".html");
  if (!path) {
    const name = nameOf(said);
    if (!NAME.test(name))
      throw new Refusal(
        `"${said}" is not a deck name: use letters, numbers, - and _.`,
      );
    return `${botArtifacts(bot)}/${name}/${name}.html`;
  }
  const full = await insideWorkspace(said);
  if (!full)
    throw new Refusal(
      `${said} is outside the workspace. Give a deck's path in it.`,
    );
  const info = await stat(full).catch(() => null);
  const file = info?.isDirectory()
    ? join(full, `${basename(full)}.html`)
    : full;
  if (!(await stat(file).catch(() => null))?.isFile())
    throw new Refusal(
      `There is no deck at ${said}. A path reaches a deck that exists; give a name for a new one.`,
    );
  // What insideWorkspace answers is the real path, so it is read against the real workspace
  return relative(await realpath(WORKSPACE).catch(() => WORKSPACE), file);
}

/**
 * The slides as the file will hold them: a table's short rows filled out, and every
 * picture copied beside the deck under the name its slide shows it by.
 */
async function prepare(
  slides: Slide[],
  sandbox: Sandbox,
  dir: string,
): Promise<Slide[]> {
  const taken = new Map<string, string>();
  const out: Slide[] = [];
  for (const [at, one] of slides.entries()) {
    if (one.layout === "table") {
      const long = one.rows.findIndex((row) => row.length > one.columns.length);
      if (long !== -1)
        throw new Refusal(
          `Slide ${at + 1}: row ${long + 1} has ${one.rows[long].length} cells, and there are ${one.columns.length} columns.`,
        );
      out.push({
        ...one,
        rows: one.rows.map((row) => one.columns.map((_, i) => row[i] ?? "")),
      });
      continue;
    }
    if (one.layout !== "image") {
      out.push(one);
      continue;
    }
    const folder = sandbox.resolve(dir);
    // A bare name is one beside the deck: how the deck names its pictures when it is handed back
    const beside = join(folder, one.image);
    const source =
      !one.image.includes("/") && (await stat(beside).catch(() => null))
        ? beside
        : sandbox.resolve(one.image);
    if (viewKindOf(source) !== "image")
      throw new Refusal(
        `Slide ${at + 1}: ${one.image} is not a picture. Give a png, jpg, webp, gif or svg.`,
      );
    if (!(await stat(source).catch(() => null))?.isFile())
      throw new Refusal(
        `Slide ${at + 1}: there is no file at ${one.image}. Give its path from the workspace root, as \`ls\` shows it.`,
      );
    let name = taken.get(source);
    if (!name) {
      name =
        dirname(source) === folder
          ? basename(source)
          : free(basename(source), new Set(taken.values()));
      taken.set(source, name);
      if (dirname(source) !== folder) {
        await mkdir(folder, { recursive: true });
        await copyFile(source, join(folder, name));
      }
    }
    out.push({ ...one, image: name });
  }
  return out;
}

/** `name`, or a variant of it no other picture in this deck has and no slide's picture will take. */
function free(name: string, used: Set<string>): string {
  const ext = extname(name);
  const stem = basename(name, ext);
  const base = SHOT.test(name) ? `picture-${stem}` : stem;
  let candidate = `${base}${ext}`;
  for (let n = 2; used.has(candidate); n++) candidate = `${base}-${n}${ext}`;
  return candidate;
}

const run = promisify(execFile);

type Put =
  | { revision: string }
  | { changed: true; revision: string; deck: unknown };

/** The deck into its file (skills/deck/deck.mjs put), unless the file names another revision. */
async function put(
  file: string,
  deck: { title: string; theme: string | null; slides: Slide[] },
  revision: string,
  bot: string,
): Promise<Put> {
  const dir = await mkdtemp(join(tmpdir(), "thursday-deck-"));
  try {
    const json = join(dir, "deck.json");
    await writeFile(json, JSON.stringify(deck));
    const args = [SCRIPT, "put", join(WORKSPACE, file), json];
    if (revision) args.push("--revision", revision);
    // Not the job's shell: nothing here runs what a model typed, and its answer is read
    // whole, where the shell folds a long one
    const done = await run(process.execPath, args, {
      env: {
        NODE_ENV: process.env.NODE_ENV,
        PATH: process.env.PATH ?? "",
        THURSDAY_BOT: bot,
      },
      maxBuffer: 16 * 1024 * 1024,
    }).catch((failed: { code?: number; stdout?: string; stderr?: string }) => {
      if (failed.code === 3 && failed.stdout) return { stdout: failed.stdout };
      throw new Refusal(
        failed.stderr?.trim().split("\n").at(-1) ||
          "The deck could not be written.",
      );
    });
    return JSON.parse(done.stdout.trim().split("\n").at(-1) ?? "") as Put;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Every slide as a picture beside the deck (deck.mjs shots), and the slides that came out too big. */
async function shoot(
  sandbox: Sandbox,
  file: string,
  env: Record<string, string>,
  signal: AbortSignal | undefined,
): Promise<{ pictures: string[]; cut: number[] } | { failed: string }> {
  // The file goes in as a variable, never spelled into the command: its name is a model's choice
  const done = await sandbox.exec(`node "$DECK_SCRIPT" shots "$DECK_FILE"`, {
    env: { ...env, DECK_SCRIPT: SCRIPT, DECK_FILE: join(WORKSPACE, file) },
    timeoutMs: DECK.shotsMs,
    signal,
  });
  if (done.exitCode !== 0)
    return {
      failed: done.stderr.trim().split("\n").at(-1) || "no pictures were made",
    };
  const got = JSON.parse(done.stdout.trim().split("\n").at(-1) ?? "{}") as {
    pictures: string[];
    cut: number[];
  };
  return {
    pictures: got.pictures.map((one) => relative(WORKSPACE, one)),
    cut: got.cut,
  };
}

const listed = (numbers: number[]) =>
  numbers.length === 1
    ? `Slide ${numbers[0]} does`
    : `Slides ${numbers.slice(0, -1).join(", ")} and ${numbers.at(-1)} do`;

/**
 * @param env The job's shell as a bot's scripts see it (workspace.ts jobShellEnv, botShellEnv):
 *   the pictures are drawn in a browser of the job's session, apart from the one on screen.
 */
export const createDeckTools = (
  sandbox: Sandbox,
  bot: string,
  env: Record<string, string>,
): ToolSet => ({
  [TOOL_NAMES.make_deck]: tool({
    description:
      "Make a slide deck, or change one: each slide a layout whose fields you fill, drawn and fitted by the app into one HTML file that opens offline, presents full screen and prints a slide a page, with a picture of every slide beside it.",
    inputSchema: deckSchema,
    execute: async (input, { abortSignal }) => {
      try {
        const file = await deckFile(input.deck, bot);
        const slides = await prepare(input.slides, sandbox, dirname(file));
        const written = await put(
          file,
          { title: input.title, theme: input.theme ?? null, slides },
          input.revision?.trim() ?? "",
          bot,
        );
        if ("changed" in written) {
          if (!written.deck)
            return `${file} is not a deck made of slides, so it cannot be changed here. Give the deck another name.`;
          const why = input.revision?.trim()
            ? `${file} has changed since that revision — edited in the app, or by another job`
            : `there is already a deck at ${file}`;
          return {
            deck: file,
            revision: written.revision,
            note: `Nothing was written: ${why}. This is the deck as it stands. To change it, make your change on these slides and call \`${TOOL_NAMES.make_deck}\` again with revision ${written.revision} and the whole deck; for a deck of its own, give a new name.`,
            current: written.deck,
          };
        }

        const count = `${slides.length} slide${slides.length === 1 ? "" : "s"}, revision ${written.revision}`;
        const shots = await shoot(sandbox, file, env, abortSignal);
        if ("failed" in shots)
          return `${file}\n${count}. The pictures of its slides could not be made (${shots.failed}), so nothing checked that every slide fits. Hand back the deck's path.`;
        const again = `call \`${TOOL_NAMES.make_deck}\` again with revision ${written.revision} and the whole deck`;
        return [
          file,
          // The first picture on its own line: the thread row shows it (bot-tool picturesOf)
          shots.pictures[0] ?? "",
          shots.cut.length
            ? `${count}. ${listed(shots.cut)} not fit even with the type at its smallest: say less there, then ${again}.`
            : `${count}. Every slide fits. Its pictures are beside it, slide-01.png on. Hand back the deck's path; to change it, ${again}.`,
        ]
          .filter(Boolean)
          .join("\n");
      } catch (cause) {
        if (cause instanceof Refusal) return cause.message;
        throw cause;
      }
    },
  }),
});
