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
/** Telegram turns the token away, as it does one revoked in BotFather. */
let turnedAway = false;
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
  if (method === "getMe")
    return turnedAway
      ? new Response(
          JSON.stringify({
            ok: false,
            error_code: 401,
            description: "Unauthorized",
          }),
          { status: 401 },
        )
      : // A Telegram token opens with its bot's id, the same under every token it is given
        answer({
          id: Number(url.split("/bot")[1].split(":")[0]),
          username: "test_bot",
        });
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
/** A message as the phone shows it: Telegram draws its HTML, and the words are what is left. */
const shown = (text: unknown) =>
  String(text)
    .replace(/<[^>]+>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
const saidTo = (chat: number) =>
  sent
    .filter(
      (one) =>
        one.method === "sendMessage" && one.body.chat_id === String(chat),
    )
    .map((one) => shown(one.body.text));

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

/** The code the screen shows beside whoever asks, from the status the screen reads. */
const askingCode = async () =>
  (await reach.readReachStatus()).channels[0].asking?.code ?? "";

test("someone who is not let in is asked about on screen with a code their phone is sent, and nothing is answered", async () => {
  inbox.push(message(7, "hello"));
  await until(() => saidTo(7).length === 1, "they are told where to be let in");
  const [status] = (await reach.readReachStatus()).channels;
  assert.equal(status.name, "telegram");
  assert.equal(status.bot, "@test_bot");
  assert.equal(status.allowed, null);
  const code = status.asking?.code ?? "";
  assert.match(code, /^\d{4}$/);
  assert.deepEqual(status.asking, {
    chat: "7",
    name: "Sam",
    handle: null,
    said: "hello",
    code,
  });
  // The phone reads the same code the screen shows
  assert.equal(
    saidTo(7)[0],
    `Almost there. Thursday is asking on your computer whether to let you in. Press Allow there only if it shows ${code}, and she answers what you wrote.`,
  );

  // Writing again changes nothing and is not answered yet: one ask, one code, the first words
  inbox.push(message(7, "hello?"));
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(saidTo(7).length, 1, "nothing more is said while they wait");
  assert.equal(
    (await reach.readReachStatus()).channels[0].asking?.said,
    "hello",
  );

  // Someone else is kept waiting, and told what the one asking can do about them
  inbox.push(message(8, "me too", "Pat"));
  await until(() => saidTo(8).length === 1, "the second is told to wait");
  assert.match(saidTo(8)[0], /already waiting.*press Not them/);
  assert.equal((await reach.readReachStatus()).channels[0].asking?.chat, "7");
  assert.equal(turns.length, 0);
});

test("once allowed with the code shown, what they wrote while waiting is answered, and what follows is one conversation", async () => {
  const code = await askingCode();
  // A dialog left from another ask carries another code, and lets nobody in
  await reach.allowReach("telegram", "7", code === "0000" ? "1111" : "0000");
  assert.equal((await reach.readReachStatus()).channels[0].allowed, null);

  const before = saidTo(7).length;
  await reach.allowReach("telegram", "7", code);
  assert.deepEqual((await reach.readReachStatus()).channels[0].allowed, {
    chat: "7",
    name: "Sam",
  });
  assert.equal(
    saidTo(7)[before],
    "You are in. Thursday answers what you wrote.",
  );
  // All of it was written before she could answer: one turn, in the order it was written
  await until(() => turns.length === 1, "what they wrote gets its turn");
  assert.equal(turns[0].words, "hello\nhello?");
  assert.equal(turns[0].said, "hello\nhello?");
  await until(() => saidTo(7).at(-1) === "Heard: hello\nhello?", "her answer");

  inbox.push(message(7, "what is on today?"));
  await until(() => turns.length === 2, "her backend is asked");
  const { words, said, carried } = turns[1];
  assert.deepEqual(
    { words, said, carried },
    { words: "what is on today?", said: "what is on today?", carried: 3 },
  );
  await until(
    () => saidTo(7).at(-1) === "Heard: what is on today?",
    "her answer goes back",
  );

  inbox.push(message(7, "and tomorrow?"));
  await until(() => turns.length === 3, "the next turn");
  assert.equal(turns[2].carried, 5, "the conversation so far goes with it");
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
  assert.equal(turns.length, 4);
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
/** A look at the inbox runs a moment after the event (reach looks once for a burst, REACH.lookMs). */
const looked = () =>
  new Promise((resolve) => setTimeout(resolve, REACH.lookMs + 300));

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
            options: ["Rates", "Travel"],
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
    shown(lastSaid().body.text),
    "Insta asks · Today's post\n\nWhich topic?",
    "whose it is and which thread, then the words",
  );
  // Drawn in Telegram's own marks, the bot's bold kept
  assert.equal(lastSaid().body.parse_mode, "HTML");
  assert.match(String(lastSaid().body.text), /Which <b>topic<\/b>\?/);

  const keyboard = (
    lastSaid().body.reply_markup as {
      inline_keyboard: { text: string; callback_data: string }[][];
    }
  ).inline_keyboard;
  assert.deepEqual(
    keyboard.map((row) => row[0].text),
    ["Rates", "Travel"],
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
  assert.deepEqual(answered[0], ["thread-1", "Travel", "user", "Insta"]);

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
      /answered Insta's question from their phone at \d{4}-\d{2}-\d{2} .*: Travel/.test(
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
    shown(lastSaid().body.text),
    "Insta finished · First post\n\nPosted\n\n• Post: the carousel\n• Six slides, 4:5\n\nNothing else was changed.",
  );
  // The link is one the phone opens, under its own words
  assert.match(
    String(lastSaid().body.text),
    /<b>Post:<\/b> <a href="https:\/\/example\.com\/p\/1">the carousel<\/a>/,
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
  const was = REACH.idleMs;
  REACH.idleMs = 0;
  refuse = true;
  inbox.push(message(7, "hello again"));
  await until(
    () => saidTo(7).at(-1) === "The provider said no.",
    "the refusal reaches them as it was said",
  );
  await until(() => ended.includes(`call-${calls}`), "and its call is closed");
  REACH.idleMs = was;
});

test("a conversation is kept while work it started is still running", async () => {
  inbox.push(message(7, "start the post"));
  await until(() => saidTo(7).at(-1) === "Heard: start the post", "answered");
  const line = calls;
  jobs = [{ id: "thread-3", callId: `call-${line}`, status: "running" }];
  const was = REACH.idleMs;
  REACH.idleMs = 0;
  inbox.push(message(7, "anything yet?"));
  await until(() => saidTo(7).at(-1) === "Heard: anything yet?", "answered");
  assert.equal(calls, line, "the same call: her turn ended, the work has not");

  jobs = [{ id: "thread-3", callId: `call-${line}`, status: "done" }];
  inbox.push(message(7, "and now?"));
  await until(() => saidTo(7).at(-1) === "Heard: and now?", "answered");
  assert.equal(calls, line + 1, "quiet with nothing running: a new call");
  REACH.idleMs = was;
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
    shown(lastSaid().body.text),
    "Insta finished · From the phone\n\nDone here.",
  );
});

test("a question the screen was left holding goes to the phone once the last browser closes", async () => {
  threads = [
    thread("thread-6", {
      label: "From the screen too",
      status: "waiting",
      room: {
        relays: [],
        questions: [
          { id: "q-6", bot: "Insta", text: "Which one?", options: ["A", "B"] },
        ],
      },
    }),
    // What finished while the screen watched stays the screen's
    thread("thread-4", { label: "From the screen", outcome: "Done there." }),
  ];
  const count = sent.length;
  appEvents.emit({ type: "threads" });
  await looked();
  assert.equal(sent.length, count, "while it is watched, the screen has it");

  // The last tab goes; past the grace a reload is given, the bot's question is the phone's
  presence.track(0);
  const asked = () =>
    sent
      .slice(count)
      .some(
        (one) =>
          one.method === "sendMessage" &&
          String(one.body.text).startsWith("Insta asks · From the screen too"),
      );
  for (let tries = 0; tries < 1_500 && !asked(); tries++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(asked(), "the question reaches the phone");
  assert.ok(
    !sent
      .slice(count)
      .some((one) => String(one.body.text).includes("From the screen\n")),
    "and what finished does not",
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

test("a file that does not come through is said at once, and what was written with it still reaches her", async () => {
  const from = sent.length;
  inbox.push({
    update_id: updateId++,
    message: {
      message_id: updateId,
      from: { id: 7, first_name: "Sam" },
      chat: { id: 7, type: "private" },
      caption: "what does this say?",
      document: {
        file_id: "big",
        file_name: "scan.pdf",
        file_size: 25 * 1024 * 1024,
      },
    },
  });
  await until(
    () => turns.at(-1)?.words === "what does this say?",
    "her turn still comes",
  );
  // Said before her turn starts, and so ahead of anything she answers
  const toSam = sent
    .slice(from)
    .filter((one) => one.method === "sendMessage")
    .map((one) => String(one.body.text));
  assert.equal(
    toSam[0],
    "scan.pdf did not come through: it is 25 MB, and the most taken from Telegram is 20 MB.",
  );
  assert.ok(
    sent.slice(from).every((one) => one.method !== "getFile"),
    "past Telegram's limit it is not even asked for",
  );
  assert.ok(
    turns
      .at(-1)
      ?.messages.some((one) =>
        /lost on the way: scan\.pdf .*They have been told/.test(
          String(one.content),
        ),
      ),
    "and she knows it is not there",
  );
});

const jarvis = async () => {
  const { WORKSPACE } = await import("../features/workspace/workspace.ts");
  const folder = join(WORKSPACE, "artifacts", "Jarvis");
  await mkdir(folder, { recursive: true });
  return folder;
};
const notSent = (from: number) =>
  sent
    .slice(from)
    .map((one) => String(one.body.text ?? ""))
    .find((text) => text.startsWith("Not sent"));

test("past the files one answer carries, the newest go and the chat names the rest", async () => {
  const folder = await jarvis();
  const names = ["one.txt", "two.txt", "three.txt", "four.txt"];
  for (const [at, name] of names.entries()) {
    await writeFile(join(folder, name), name);
    await utimes(join(folder, name), 2_000 + at, 2_000 + at);
  }
  const from = sent.length;
  inbox.push(
    message(7, names.map((name) => `artifacts/Jarvis/${name}`).join(" and ")),
  );
  await until(() => Boolean(notSent(from)), "the chat says what stayed");
  assert.deepEqual(
    sent
      .slice(from)
      .filter((one) => one.method === "sendDocument")
      .map((one) => one.body.document),
    ["two.txt", "three.txt", "four.txt"],
  );
  assert.equal(
    notSent(from),
    "Not sent — still on this computer:\n• artifacts/Jarvis/one.txt: only 3 files go with one answer",
  );
});

test("a file past what goes to the service stays, and a picture past what it draws goes as a file", async () => {
  const folder = await jarvis();
  const was = REACH.fileBytes;
  REACH.fileBytes = 12 * 1024 * 1024;
  await writeFile(join(folder, "film.mp4"), new Uint8Array(13 * 1024 * 1024));
  await writeFile(join(folder, "poster.png"), new Uint8Array(11 * 1024 * 1024));
  const from = sent.length;
  inbox.push(
    message(7, "artifacts/Jarvis/film.mp4 artifacts/Jarvis/poster.png"),
  );
  await until(() => Boolean(notSent(from)), "the chat says what stayed");
  REACH.fileBytes = was;
  assert.equal(
    notSent(from),
    "Not sent — still on this computer:\n• artifacts/Jarvis/film.mp4: it is 13 MB, and the most that goes to Telegram is 12 MB",
  );
  const poster = sent
    .slice(from)
    .filter((one) => /^send(Photo|Document)$/.test(one.method))
    .map((one) => one.method);
  assert.deepEqual(
    poster,
    ["sendDocument"],
    "Telegram draws photos up to 10 MB",
  );
});

test("a token the service turns away stops that service, names its key, and says what to do", async () => {
  turnedAway = true;
  await writeConfig(TELEGRAM_TOKEN_KEY, "456:revoked-token");
  await reach.startReach("telegram");
  let [status] = (await reach.readReachStatus()).channels;
  for (let tries = 0; tries < 200 && !status.refused; tries++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    [status] = (await reach.readReachStatus()).channels;
  }
  turnedAway = false;
  assert.equal(status.refused, TELEGRAM_TOKEN_KEY);
  assert.equal(
    status.problem,
    "Telegram said “Unauthorized”: this token was revoked or mistyped. Get it again from @BotFather and paste it here.",
  );
  assert.equal(status.bot, null);
});

test("a token given again for the same bot keeps whoever is let in, and another bot's starts with nobody", async () => {
  const { readConfig } = await import("../features/config/config.query.ts");
  const { reachPersonKey } = await import("../features/reach/reach.schema.ts");
  /** The service once its bot has answered: who is let in is settled by then. */
  const connected = async () => {
    for (let tries = 0; tries < 200; tries++) {
      const [status] = (await reach.readReachStatus()).channels;
      if (status.bot) return status;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return assert.fail("the bot never answered");
  };

  // Revoked and given again: the same bot, so Sam stays let in
  await writeConfig(TELEGRAM_TOKEN_KEY, "123:given-again");
  await reach.startReach("telegram");
  assert.deepEqual((await connected()).allowed, { chat: "7", name: "Sam" });

  // Another bot: its chats are other people's, and nobody is let in to it yet
  await writeConfig(TELEGRAM_TOKEN_KEY, "789:another-bot");
  await reach.startReach("telegram");
  assert.equal((await connected()).allowed, null);

  // A record kept before the app noted bots is this bot's when the app starts with its token
  await writeConfig(
    reachPersonKey("telegram"),
    JSON.stringify({ chat: "7", name: "Sam" }),
  );
  await reach.startReach();
  assert.deepEqual((await connected()).allowed, { chat: "7", name: "Sam" });
  assert.equal(
    await readConfig(reachPersonKey("telegram")),
    JSON.stringify({ chat: "7", name: "Sam", bot: "789" }),
  );
});
