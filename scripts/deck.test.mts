import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import type { ZodType } from "zod";

// The workspace is found from the data folder as the modules load: keep it off anyone's own
const home = await mkdtemp(join(tmpdir(), "thursday-deck-"));
process.env.THURSDAY_HOME = home;
after(() => rm(home, { recursive: true, force: true }));

const { createDeckTools } = await import("../features/ai/tools/deck.tool.ts");
const { TOOL_NAMES } = await import("../features/ai/tools/tool-name.ts");
const { openWorkspace, WORKSPACE } = await import(
  "../features/workspace/workspace.ts"
);

/** What the shots step answers in place of a browser, which a test has none of. */
let shots = { exitCode: 0, stdout: '{"pictures":[],"cut":[]}', stderr: "" };
const sandbox = { ...(await openWorkspace()), exec: async () => shots };
const tool = createDeckTools(sandbox, "Tester", {}, false)[
  TOOL_NAMES.make_deck
];
const schema = tool.inputSchema as ZodType;
const make = async (input: unknown) =>
  (tool.execute as (input: unknown, options: unknown) => Promise<unknown>)(
    schema.parse(input),
    { toolCallId: "t", messages: [] },
  );

const slides = [
  { layout: "cover", title: "Heat pumps took the market" },
  {
    layout: "cards",
    title: "Three forces",
    cards: [{ title: "Subsidies" }, { title: "Gas prices" }],
  },
];
const file = (name: string) =>
  join(WORKSPACE, "artifacts", "Tester", name, `${name}.html`);
/** The deck a file holds, as the page reads it. */
const held = async (path: string) =>
  JSON.parse(
    /<script type="application\/json" data-deck(?:="")?>([\s\S]*?)<\/script>/.exec(
      await readFile(path, "utf8"),
    )?.[1] ?? "null",
  );
const revisionIn = (said: unknown) =>
  /revision ([0-9a-f]{12})/.exec(String(said))?.[1] ?? "";

test("a deck is refused by its schema before anything is written", () => {
  const five = Array.from({ length: 5 }, (_, i) => ({ title: `Card ${i}` }));
  for (const bad of [
    { layout: "cards", title: "Too many", cards: five },
    { layout: "poster", title: "No such layout" },
    { layout: "number", value: "a figure far too long" },
  ])
    assert.equal(
      schema.safeParse({ deck: "d", title: "D", slides: [bad] }).success,
      false,
      JSON.stringify(bad),
    );
});

test("a new deck is its frame and its slides as data, with a revision to change it by", async () => {
  const said = await make({ deck: "Q3 review", title: "Q3", slides });
  const path = file("Q3-review");
  assert.ok(existsSync(path));
  assert.equal(
    String(said).split("\n")[0],
    "artifacts/Tester/Q3-review/Q3-review.html",
  );
  assert.match(
    String(said),
    /2 slides, revision [0-9a-f]{12}\. Every slide fits/,
  );
  const html = await readFile(path, "utf8");
  assert.match(html, /<title>Q3<\/title>/);
  assert.match(html, /<meta name="generator" content="Thursday">/);
  assert.deepEqual((await held(path)).slides.length, 2);
});

test("a change lands only with the revision it was made on", async () => {
  const first = await make({
    deck: "plan",
    title: "Plan",
    theme: "sea",
    slides,
  });
  const revision = revisionIn(first);

  // Without the revision, the deck comes back as it stands and nothing is written
  const blind = (await make({ deck: "plan", title: "Other", slides })) as {
    revision: string;
    current: { title: string };
    note: string;
  };
  assert.equal(blind.revision, revision);
  assert.equal(blind.current.title, "Plan");
  assert.match(blind.note, /already a deck/);
  assert.equal((await held(file("plan"))).title, "Plan");

  // With it, the change is written, and a palette left unsaid is the deck's own
  const second = await make({
    deck: "plan",
    title: "Plan, again",
    revision,
    slides,
  });
  assert.notEqual(revisionIn(second), revision);
  const now = await held(file("plan"));
  assert.equal(now.title, "Plan, again");
  assert.equal(now.theme, "sea");

  // The first revision is stale now
  const stale = (await make({
    deck: "plan",
    title: "Late",
    revision,
    slides,
  })) as {
    note: string;
  };
  assert.match(stale.note, /changed since that revision/);
});

test("a deck the app kept after an edit is still read as a deck", async () => {
  await make({ deck: "kept", title: "Kept", slides });
  const path = file("kept");
  // A browser writes the page back with its own spelling of the data's tag
  const html = await readFile(path, "utf8");
  for (const tag of ['data-deck="">', "data-deck>"]) {
    await writeFile(path, html.replace(/data-deck(="")?>/, tag));
    const said = (await make({ deck: "kept", title: "Again", slides })) as {
      current: { title: string };
    };
    assert.equal(said.current.title, "Kept", tag);
  }
});

test("a page that holds no deck is never written over", async () => {
  const page = file("notes");
  await mkdir(join(page, ".."), { recursive: true });
  await writeFile(
    page,
    '<!doctype html><meta name="revision" content="aaaaaaaaaaaa"><p>A page</p>',
  );
  const said = await make({
    deck: "notes",
    title: "N",
    revision: "aaaaaaaaaaaa",
    slides,
  });
  assert.match(String(said), /not a deck made of slides/);
  assert.match(await readFile(page, "utf8"), /<p>A page<\/p>/);
});

test("pictures are copied beside the deck, and never under a name a slide's picture takes", async () => {
  const pics = join(WORKSPACE, "scratch", "pics");
  await mkdir(pics, { recursive: true });
  await writeFile(join(pics, "photo.png"), "png");
  await writeFile(join(pics, "slide-01.png"), "png");
  const said = await make({
    deck: "pictures",
    title: "Pictures",
    slides: [
      {
        layout: "image",
        title: "A",
        image: "scratch/pics/photo.png",
        alt: "a",
      },
      {
        layout: "image",
        title: "B",
        image: "scratch/pics/slide-01.png",
        alt: "b",
      },
    ],
  });
  const dir = join(WORKSPACE, "artifacts", "Tester", "pictures");
  assert.ok(existsSync(join(dir, "photo.png")));
  assert.ok(existsSync(join(dir, "picture-slide-01.png")));
  const deck = await held(join(dir, "pictures.html"));
  assert.deepEqual(
    deck.slides.map((slide: { image: string }) => slide.image),
    ["photo.png", "picture-slide-01.png"],
  );

  // Handed back, the deck names them beside it, and the names still reach them
  const again = await make({
    deck: "pictures",
    title: "Pictures",
    revision: revisionIn(said),
    slides: deck.slides,
  });
  assert.match(String(again), /Every slide fits/);

  const missing = await make({
    deck: "missing",
    title: "M",
    slides: [{ layout: "image", title: "A", image: "nowhere.png", alt: "a" }],
  });
  assert.match(String(missing), /no file at nowhere\.png/);
});

test("a table's short rows are filled out and a long one is refused", async () => {
  const table = (rows: string[][]) => ({
    deck: "table",
    title: "T",
    slides: [{ layout: "table", title: "T", columns: ["", "A", "B"], rows }],
  });
  const long = await make(table([["x", "1", "2", "3"]]));
  assert.match(String(long), /row 1 has 4 cells, and there are 3 columns/);
  await make(table([["x", "1"]]));
  assert.deepEqual((await held(file("table"))).slides[0].rows, [
    ["x", "1", ""],
  ]);
});

test("what a slide says stays data inside the page", async () => {
  await make({
    deck: "escape",
    title: "</script><script>alert(1)</script>",
    slides: [{ layout: "statement", title: "<!-- a comment --></script>" }],
  });
  const html = await readFile(file("escape"), "utf8");
  assert.doesNotMatch(html, /<script>alert/);
  const deck = await held(file("escape"));
  assert.equal(deck.slides[0].title, "<!-- a comment --></script>");
});

test("slides that do not fit are named back, and a deck without its pictures says so", async () => {
  shots = { exitCode: 0, stdout: '{"pictures":[],"cut":[2,5]}', stderr: "" };
  const cut = await make({ deck: "cut", title: "C", slides });
  assert.match(String(cut), /Slides 2 and 5 do not fit/);

  shots = { exitCode: 1, stdout: "", stderr: "no browser here" };
  const blind = await make({ deck: "blind", title: "B", slides });
  assert.match(String(blind), /could not be made \(no browser here\)/);
  shots = { exitCode: 0, stdout: '{"pictures":[],"cut":[]}', stderr: "" };
});

test("a path in the bot's own folder where no deck is yet makes a new one there", async () => {
  const said = await make({
    deck: "artifacts/Tester/q4 plan",
    title: "Q4",
    slides,
  });
  assert.equal(
    String(said).split("\n")[0],
    "artifacts/Tester/q4-plan/q4-plan.html",
  );
  assert.ok(existsSync(file("q4-plan")));
  const nested = await make({
    deck: "artifacts/Tester/decks/intro.html",
    title: "I",
    slides,
  });
  assert.equal(
    String(nested).split("\n")[0],
    "artifacts/Tester/decks/intro/intro.html",
  );
  const theirs = await make({
    deck: "artifacts/Other/theirs",
    title: "T",
    slides,
  });
  assert.match(
    String(theirs),
    /There is no deck at artifacts\/Other\/theirs\. A new deck is made in your own folder/,
  );
  assert.ok(!existsSync(join(WORKSPACE, "artifacts", "Other")));
});

test("every slide on one picture comes back, and reaches a model that sees pictures", async () => {
  const sheet = join(WORKSPACE, "artifacts", "Tester", "sheet", "slides.png");
  shots = {
    exitCode: 0,
    stdout: JSON.stringify({
      pictures: [join(dirname(sheet), "slide-01.png")],
      sheet,
      cut: [],
    }),
    stderr: "",
  };
  const said = String(await make({ deck: "sheet", title: "S", slides }));
  const [, picture, line] = said.split("\n");
  assert.equal(picture, "artifacts/Tester/sheet/slides.png");
  assert.match(line, /slides\.png holds every slide, numbered/);

  // One pixel stands in for the picture the renderer draws
  await writeFile(
    sheet,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  const answer = { toolCallId: "t", input: undefined as never, output: said };
  const seeing = createDeckTools(sandbox, "Tester", {}, true)[
    TOOL_NAMES.make_deck
  ];
  assert.equal((await seeing.toModelOutput?.(answer))?.type, "content");
  assert.deepEqual(await tool.toModelOutput?.(answer), {
    type: "text",
    value: said,
  });
  shots = { exitCode: 0, stdout: '{"pictures":[],"cut":[]}', stderr: "" };
});
