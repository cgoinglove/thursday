import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, mock, test } from "node:test";

// Reach against a Telegram that is only a `fetch` stub, with her answers and the inbox
// stubbed too: who is let in, what goes where, what joins a turn, what is carried into the
// next, and what a button does. No network, no model.
const home = await mkdtemp(join(tmpdir(), "thursday-reach-"));
process.env.THURSDAY_HOME = home;
// Up for long enough that a browser would have come back: who is watching is known
process.uptime = () => 3_600;

type Sent = { method: string; body: Record<string, unknown> };
const sent: Sent[] = [];
/** Updates waiting to be handed to the next `getUpdates`. */
const inbox: unknown[] = [];
let updateId = 1;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (!url.startsWith("https://api.telegram.org/"))
    return realFetch(input, init);
  const method = url.split("/").pop() ?? "";
  // A form is kept as its fields, a file by its name
  const body =
    typeof init?.body === "string"
      ? (JSON.parse(init.body) as Record<string, unknown>)
      : init?.body instanceof FormData
        ? Object.fromEntries(
            [...init.body].map(([key, value]) => [
              key,
              typeof value === "string" ? value : value.name,
            ]),
          )
        : {};
  const answer = (result: unknown) =>
    new Response(JSON.stringify({ ok: true, result }));
  if (method === "getMe") return answer({ username: "test_bot" });
  if (method === "getUpdates") {
    // A short wait in place of the long poll, so the loop neither spins nor holds the test
    await new Promise((resolve) => setTimeout(resolve, 5));
    return answer(inbox.splice(0));
  }
  sent.push({ method, body });
  return answer({ message_id: sent.length, chat: { id: 1, type: "private" } });
}) as typeof fetch;

type Message = { role: string; content: unknown };
type Turn = {
  words: string;
  said: string | null;
  carried: number;
  messages: Message[];
  /** What joined the turn at its step boundary. */
  joined: string[];
};
const turns: Turn[] = [];
/** A turn waits here before its step boundary, and here again after it. */
const gate: { before: Promise<void> | null; after: Promise<void> | null } = {
  before: null,
  after: null,
};
/** The next turn breaks, as a provider's refusal would. */
let refuse = false;
/** What the next turn makes, in place of one word. */
let made: Message[] | null = null;
/** What the next turn did, as the call screen words it. */
let did: string[] = [];
let calls = 0;
mock.module("../features/thursday/thursday.text.ts", {
  namedExports: {
    openTextCall: async () => ({ callId: `call-${++calls}`, standing: null }),
    answerInWriting: async (input: {
      messages: Message[];
      said: string | null;
      notes?: () => { text: string; said: boolean }[];
    }) => {
      const turn: Turn = {
        words: String(input.messages.at(-1)?.content),
        said: input.said,
        carried: input.messages.length,
        messages: input.messages,
        joined: [],
      };
      turns.push(turn);
      if (refuse) {
        refuse = false;
        throw new Error("The provider said no.");
      }
      await gate.before;
      // A step boundary: what arrived meanwhile joins the turn
      turn.joined = (input.notes?.() ?? []).map((note) => note.text);
      await gate.after;
      const mine = made ?? [{ role: "assistant", content: "ok" }];
      made = null;
      return {
        text: `**Heard:** ${turn.words}`,
        did: did.splice(0),
        messages: [
          ...input.messages,
          ...turn.joined.map((text) => ({ role: "user", content: text })),
          ...mine,
        ],
      };
    },
  },
});
// Drawing a page takes a browser; two pictures stand in for what it draws
mock.module("../features/reach/pictures.ts", {
  namedExports: {
    picturesOf: async (full: string) =>
      full.endsWith(".html")
        ? [1, 2].map((n) => ({
            bytes: new Uint8Array([n]),
            name: `report-0${n}.png`,
            picture: true,
          }))
        : [],
  },
});
const ended: string[] = [];
mock.module("../features/thursday/thursday.query.ts", {
  namedExports: {
    endCall: async (id: string) => void ended.push(id),
    isCallOpen: async (id: string) => !ended.includes(id),
  },
});
let threads: unknown[] = [];
let jobs: { id: string; callId: string; status: string }[] = [];
const seen: string[][] = [];
mock.module("../features/bot/thread.query.ts", {
  namedExports: {
    listInboxThreads: async () => threads,
    listCallJobs: async (ids: string[]) =>
      jobs.filter((job) => ids.includes(job.callId)),
    markSeen: async (ids: string[]) => void seen.push(ids),
  },
});
const answered: unknown[][] = [];
mock.module("../features/bot/bot.runner.ts", {
  namedExports: {
    answerThread: async (...args: unknown[]) => void answered.push(args),
  },
});
const accepted: number[][] = [];
mock.module("../features/bot/room.query.ts", {
  namedExports: {
    acceptRoomRelays: async (ids: number[]) => void accepted.push(ids),
  },
});

const { REACH } = await import("../config.ts");
const { migrateDatabase } = await import("../database/migrate.ts");
await migrateDatabase();
const { writeConfig } = await import("../features/config/config.query.ts");
const { TELEGRAM_TOKEN_KEY } = await import(
  "../features/reach/reach.schema.ts"
);
const { appEvents, presence } = await import(
  "../app/api/events/app-event.server.ts"
);
const reach = await import("../features/reach/reach.ts");

const message = (chat: number, text: string, name = "Sam") => ({
  update_id: updateId++,
  message: {
    message_id: updateId,
    from: { id: chat, first_name: name },
    chat: { id: chat, type: "private" },
    text,
  },
});
const until = async (what: () => boolean, label: string) => {
  for (let tries = 0; tries < 400 && !what(); tries++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(what(), label);
};
const saidTo = (chat: number) =>
  sent
    .filter(
      (one) =>
        one.method === "sendMessage" && one.body.chat_id === String(chat),
    )
    .map((one) => String(one.body.text));

await writeConfig(TELEGRAM_TOKEN_KEY, "123:test-token");
await reach.startReach();

after(async () => {
  await writeConfig(TELEGRAM_TOKEN_KEY, "");
  await reach.startReach().catch(() => {});
  globalThis.fetch = realFetch;
  await rm(home, { recursive: true, force: true });
  // The poll loop and the database handle would hold the process open
  setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref();
});

test("someone who is not let in is asked about on screen, and nothing is answered", async () => {
  inbox.push(message(7, "hello"));
  await until(() => saidTo(7).length === 1, "they are told where to be let in");
  assert.match(saidTo(7)[0], /press Allow/);
  const [status] = (await reach.readReachStatus()).channels;
  assert.equal(status.name, "telegram");
  assert.equal(status.bot, "@test_bot");
  assert.deepEqual(status.asking, { chat: "7", name: "Sam" });
  assert.equal(status.allowed, null);
  assert.equal(turns.length, 0);
});

test("once allowed, what they write is a turn of one conversation", async () => {
  await reach.allowReach("telegram", "7");
  assert.deepEqual((await reach.readReachStatus()).channels[0].allowed, {
    chat: "7",
    name: "Sam",
  });
  await until(() => saidTo(7).length === 2, "they are told they are in");

  inbox.push(message(7, "what is on today?"));
  await until(() => turns.length === 1, "her backend is asked");
  const { words, said, carried } = turns[0];
  assert.deepEqual(
    { words, said, carried },
    { words: "what is on today?", said: "what is on today?", carried: 1 },
  );
  await until(() => saidTo(7).length === 3, "her answer goes back");
  // Markdown is for a screen; a chat gets the words
  assert.equal(saidTo(7)[2], "Heard: what is on today?");

  inbox.push(message(7, "and tomorrow?"));
  await until(() => turns.length === 2, "the next turn");
  assert.equal(turns[1].carried, 3, "the conversation so far goes with it");
});

test("what she did goes under what she said, each thing once", async () => {
  did = ["Noting that down", "Checking on work", "Noting that down"];
  inbox.push(message(7, "call me Sam"));
  await until(
    () => saidTo(7).at(-1)?.startsWith("Heard: call me Sam") ?? false,
    "her answer",
  );
  assert.equal(
    saidTo(7).at(-1),
    "Heard: call me Sam\n\n— Noting that down · Checking on work",
  );
});

test("nobody else is answered once one person is in", async () => {
  inbox.push(message(9, "let me in", "Mallory"));
  await until(() => saidTo(9).length === 1, "they are turned away");
  assert.match(saidTo(9)[0], /already answers someone else/);
  assert.equal((await reach.readReachStatus()).channels[0].asking, null);
  assert.equal(turns.length, 3);
});

const thread = (
  id: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  label: "Today's post",
  bot: "Insta",
  status: "done",
  seen: false,
  updatedAt: new Date().toISOString(),
  outcome: null,
  ask: null,
  room: { relays: [], questions: [] },
  ...over,
});
const lastSaid = () =>
  sent.findLast((one) => one.method === "sendMessage") as Sent;
/** A look at the inbox runs a moment after the event (reach looks once for a burst). */
const looked = () => new Promise((resolve) => setTimeout(resolve, 2_300));

test("a bot's question goes to the phone as the bot wrote it, and a button answers the bot", async () => {
  threads = [
    thread("thread-1", {
      status: "waiting",
      room: {
        relays: [
          {
            id: 41,
            messageId: "q-1",
            bot: "Insta",
            kind: "question",
            text: "Which topic?",
          },
        ],
        questions: [
          {
            id: "q-1",
            bot: "Insta",
            text: "Which **topic**?",
            options: ["Rates", "Isudo"],
          },
        ],
      },
    }),
  ];
  const before = turns.length;
  appEvents.emit({ type: "threads" });
  await until(() => accepted.length === 1, "its relay rows are accepted");
  assert.deepEqual(accepted[0], [41]);
  assert.equal(
    turns.length,
    before,
    "no turn of hers is spent saying it again",
  );
  assert.equal(
    lastSaid().body.text,
    "Insta asks · Today's post\n\nWhich topic?",
    "whose it is and which thread, then the words without their marks",
  );

  const keyboard = (
    lastSaid().body.reply_markup as {
      inline_keyboard: { text: string; callback_data: string }[][];
    }
  ).inline_keyboard;
  assert.deepEqual(
    keyboard.map((row) => row[0].text),
    ["Rates", "Isudo"],
  );

  inbox.push({
    update_id: updateId++,
    callback_query: {
      id: "press-1",
      from: { id: 7, first_name: "Sam" },
      message: {
        message_id: 5,
        chat: { id: 7, type: "private" },
        text: "Insta asks",
      },
      data: keyboard[1][0].callback_data,
    },
  });
  await until(() => answered.length === 1, "the bot is answered");
  assert.deepEqual(answered[0], ["thread-1", "Isudo", "user", "Insta"]);

  // Told once: the same question coming round again is not news
  const count = sent.length;
  appEvents.emit({ type: "threads" });
  await looked();
  assert.equal(sent.length, count);
});

test("she is left the fact, and reads it ahead of what is written next", async () => {
  inbox.push(message(7, "which one did I pick?"));
  await until(() => turns.at(-1)?.words === "which one did I pick?", "a turn");
  const read = turns.at(-1)?.messages.map((one) => String(one.content)) ?? [];
  assert.ok(
    read.some((text) =>
      /Insta → Thursday, thread "Today's post".*question[\s\S]*The user has had this on their phone, as Insta wrote it, since \d{4}-\d{2}-\d{2} /.test(
        text,
      ),
    ),
    "what went to the phone",
  );
  assert.ok(
    read.some((text) =>
      /answered Insta's question from their phone at \d{4}-\d{2}-\d{2} .*: Isudo/.test(
        text,
      ),
    ),
    "and what the button answered",
  );
  assert.equal(read.at(-1), "which one did I pick?");
});

test("an ending keeps its lines, takes its link along, and is seen once delivered", async () => {
  threads = [
    thread("thread-2", {
      label: "First post",
      outcome:
        "## Posted\n\n- **Post:** [the carousel](https://example.com/p/1)\n- Six slides, `4:5`\n\nNothing else was changed.",
    }),
  ];
  const before = turns.length;
  appEvents.emit({ type: "threads" });
  await until(() => seen.length === 1, "delivered is seen");
  assert.deepEqual(seen[0], ["thread-2"]);
  assert.equal(turns.length, before);
  assert.equal(
    lastSaid().body.text,
    "Insta finished · First post\n\nPosted\n\n• Post: the carousel https://example.com/p/1\n• Six slides, 4:5\n\nNothing else was changed.",
  );
});

test("what ended before this server came up is not news", async () => {
  threads = [
    thread("thread-old", {
      label: "Yesterday",
      outcome: "Done long ago.",
      updatedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    }),
  ];
  const count = sent.length;
  appEvents.emit({ type: "threads" });
  await looked();
  assert.equal(sent.length, count);
});

test("what they write while she works joins that turn, and what comes too late gets the next", async () => {
  let open = () => {};
  gate.before = new Promise<void>((resolve) => {
    open = resolve;
  });
  let close = () => {};
  gate.after = new Promise<void>((resolve) => {
    close = resolve;
  });
  const before = turns.length;
  inbox.push(message(7, "check the credit"));
  await until(() => turns.length === before + 1, "her turn starts");
  inbox.push(message(7, "the OpenAI one"));
  // Long enough for the poll to hand it over while the turn is held
  await new Promise((resolve) => setTimeout(resolve, 60));
  open();
  await until(() => turns[before].joined.length === 1, "it joined the turn");
  assert.deepEqual(turns[before].joined, ["the OpenAI one"]);

  inbox.push(message(7, "thanks"));
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(turns.length, before + 1, "one turn at a time");
  gate.before = gate.after = null;
  close();
  await until(() => turns.length === before + 2, "the late words get a turn");
  assert.equal(turns[before + 1].words, "thanks");
  assert.equal(turns[before + 1].said, "thanks");
});

test("an older turn is carried as words alone, and the one just answered whole", async () => {
  made = [
    {
      role: "assistant",
      content: [
        { type: "reasoning", text: "thinking" },
        {
          type: "tool-call",
          toolCallId: "t-1",
          toolName: "thread_status",
          input: { thread: "First post" },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "t-1",
          toolName: "thread_status",
          output: { type: "json", value: { threads: "x".repeat(5_000) } },
        },
      ],
    },
    {
      role: "assistant",
      content: [
        {
          type: "text",
          text: `It is done. ${"y".repeat(2_000)}`,
          providerOptions: { openai: { itemId: "msg_1" } },
        },
      ],
    },
  ];
  inbox.push(message(7, "how is the post?"));
  await until(() => turns.at(-1)?.words === "how is the post?", "a turn");
  await until(() => made === null, "answered");

  inbox.push(message(7, "and the slides?"));
  await until(() => turns.at(-1)?.words === "and the slides?", "the follow-up");
  const follow = turns.at(-1)?.messages ?? [];
  assert.ok(
    follow.some((one) => one.role === "tool"),
    "a follow-up still reads what she just found",
  );
  await until(() => saidTo(7).at(-1) === "Heard: and the slides?", "answered");

  inbox.push(message(7, "ok"));
  await until(() => turns.at(-1)?.words === "ok", "the turn after");
  const later = turns.at(-1)?.messages ?? [];
  assert.ok(!later.some((one) => one.role === "tool"), "no tool results");
  assert.ok(
    later.every((one) => typeof one.content === "string"),
    "plain messages: no thought, no tool call, no item id",
  );
  // One reply is one message: what she did, then what she said, cut and marked
  const old = String(
    later.find((one) => String(one.content).includes("It is done."))?.content,
  );
  const [did, said] = old.split("\n");
  assert.ok(did.length > 0 && !did.includes("It is done."), "what she did");
  assert.equal(said.length, REACH.oldChars + 1);
  assert.ok(said.endsWith("…"));
});

test("past its size the conversation is cut deep, from where they speak", async () => {
  made = Array.from({ length: 60 }, (_, at) => ({
    role: at % 2 ? "assistant" : "user",
    content: `line ${at}`,
  }));
  made.push({ role: "assistant", content: "ok" });
  inbox.push(message(7, "a long day"));
  await until(() => made === null, "answered");
  await until(() => saidTo(7).at(-1) === "Heard: a long day", "and sent");
  inbox.push(message(7, "still there?"));
  await until(() => turns.at(-1)?.words === "still there?", "the next turn");
  const kept = (turns.at(-1)?.messages ?? []).slice(0, -1);
  assert.ok(kept.length <= REACH.trimTo, `${kept.length} kept`);
  assert.equal(kept[0].role, "user");
});

test("a conversation that never had a turn is not left open", async () => {
  // The line is given up first, so the refused turn is a new conversation's first
  REACH.idleMs = 0;
  refuse = true;
  inbox.push(message(7, "hello again"));
  await until(
    () => saidTo(7).at(-1) === "The provider said no.",
    "the refusal reaches them as it was said",
  );
  await until(() => ended.includes(`call-${calls}`), "and its call is closed");
  REACH.idleMs = 10 * 60_000;
});

test("a conversation is kept while work it started is still running", async () => {
  inbox.push(message(7, "start the post"));
  await until(() => saidTo(7).at(-1) === "Heard: start the post", "answered");
  const line = calls;
  jobs = [{ id: "thread-3", callId: `call-${line}`, status: "running" }];
  REACH.idleMs = 0;
  inbox.push(message(7, "anything yet?"));
  await until(() => saidTo(7).at(-1) === "Heard: anything yet?", "answered");
  assert.equal(calls, line, "the same call: her turn ended, the work has not");

  jobs = [{ id: "thread-3", callId: `call-${line}`, status: "done" }];
  inbox.push(message(7, "and now?"));
  await until(() => saidTo(7).at(-1) === "Heard: and now?", "answered");
  assert.equal(calls, line + 1, "quiet with nothing running: a new call");
  REACH.idleMs = 10 * 60_000;
});

test("with a browser watching, only what was started from here comes to the phone", async () => {
  presence.track(1);
  jobs = [{ id: "thread-5", callId: `call-${calls}`, status: "done" }];
  threads = [
    thread("thread-4", { label: "From the screen", outcome: "Done there." }),
    thread("thread-5", { label: "From the phone", outcome: "Done here." }),
  ];
  const count = seen.length;
  appEvents.emit({ type: "threads" });
  await until(() => seen.length === count + 1, "one is delivered");
  await looked();
  assert.deepEqual(seen.slice(count), [["thread-5"]]);
  assert.equal(
    lastSaid().body.text,
    "Insta finished · From the phone\n\nDone here.",
  );
});

test("a page she names goes with pictures of it, and any other file as itself", async () => {
  const { WORKSPACE } = await import("../features/workspace/workspace.ts");
  const folder = join(WORKSPACE, "artifacts", "Jarvis");
  await mkdir(folder, { recursive: true });
  // Her answer's files go oldest first
  for (const [at, name] of ["report.html", "notes.txt"].entries()) {
    await writeFile(join(folder, name), name);
    await utimes(join(folder, name), 1_000 + at, 1_000 + at);
  }
  const from = sent.length;
  inbox.push(
    message(7, "artifacts/Jarvis/report.html and artifacts/Jarvis/notes.txt"),
  );
  await until(
    () => sent.slice(from).some((one) => one.body.document === "notes.txt"),
    "the files go",
  );
  const files = sent
    .slice(from)
    .filter((one) => /^send(MediaGroup|Photo|Document)$/.test(one.method))
    .map((one) => ({
      method: one.method,
      files: Object.entries(one.body)
        .filter(([key]) => /^(p\d+|photo|document)$/.test(key))
        .map(([, name]) => name),
    }));
  assert.deepEqual(files, [
    { method: "sendMediaGroup", files: ["report-01.png", "report-02.png"] },
    { method: "sendDocument", files: ["report.html"] },
    { method: "sendDocument", files: ["notes.txt"] },
  ]);
});
