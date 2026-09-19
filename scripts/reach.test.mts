import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, mock, test } from "node:test";

// Reach against a Telegram that is only a `fetch` stub, with her answers and the inbox
// stubbed too: who is let in, what goes where, and what a button does. No network, no model.
const home = await mkdtemp(join(tmpdir(), "thursday-reach-"));
process.env.THURSDAY_HOME = home;

type Sent = { method: string; body: Record<string, unknown> };
const sent: Sent[] = [];
/** Updates waiting to be handed to the next `getUpdates`. */
const inbox: unknown[] = [];
let updateId = 1;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (!url.startsWith("https://api.telegram.org/")) return realFetch(input, init);
  const method = url.split("/").pop() ?? "";
  const body =
    typeof init?.body === "string"
      ? (JSON.parse(init.body) as Record<string, unknown>)
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

const turns: { words: string; said: string | null; carried: number }[] = [];
mock.module("../features/thursday/thursday.text.ts", {
  namedExports: {
    openTextCall: async () => ({ callId: "call-1", standing: null }),
    answerInWriting: async (input: {
      messages: { content: unknown }[];
      said: string | null;
    }) => {
      const words = String(input.messages.at(-1)?.content);
      turns.push({ words, said: input.said, carried: input.messages.length });
      return {
        text: `**Heard:** ${words}`,
        did: [],
        messages: [...input.messages, { role: "assistant", content: "ok" }],
      };
    },
  },
});
mock.module("../features/thursday/thursday.query.ts", {
  namedExports: { endCall: async () => true, isCallOpen: async () => true },
});
let threads: unknown[] = [];
mock.module("../features/bot/thread.query.ts", {
  namedExports: { listInboxThreads: async () => threads },
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
REACH.notifyAfterMs = 20;
const { migrateDatabase } = await import("../database/migrate.ts");
await migrateDatabase();
const { writeConfig } = await import("../features/config/config.query.ts");
const { TELEGRAM_TOKEN_KEY } = await import(
  "../features/reach/reach.schema.ts"
);
const { appEvents } = await import("../app/api/events/app-event.server.ts");
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
    .filter((one) => one.method === "sendMessage" && one.body.chat_id === String(chat))
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
  const status = await reach.readReachStatus();
  assert.equal(status.bot, "@test_bot");
  assert.deepEqual(status.asking, { chat: "7", name: "Sam" });
  assert.equal(status.allowed, null);
  assert.equal(turns.length, 0);
});

test("once allowed, what they write is a turn of one conversation", async () => {
  await reach.allowReach("7");
  assert.deepEqual((await reach.readReachStatus()).allowed, {
    chat: "7",
    name: "Sam",
  });
  await until(() => saidTo(7).length === 2, "they are told they are in");

  inbox.push(message(7, "what is on today?"));
  await until(() => turns.length === 1, "her backend is asked");
  assert.deepEqual(turns[0], {
    words: "what is on today?",
    said: "what is on today?",
    carried: 1,
  });
  await until(() => saidTo(7).length === 3, "her answer goes back");
  // Markdown is for a screen; a chat gets the words
  assert.equal(saidTo(7)[2], "Heard: what is on today?");

  inbox.push(message(7, "and tomorrow?"));
  await until(() => turns.length === 2, "the next turn");
  assert.equal(turns[1].carried, 3, "the conversation so far goes with it");
});

test("nobody else is answered once one person is in", async () => {
  inbox.push(message(9, "let me in", "Mallory"));
  await until(() => saidTo(9).length === 1, "they are turned away");
  assert.match(saidTo(9)[0], /already answers someone else/);
  assert.equal((await reach.readReachStatus()).asking, null);
  assert.equal(turns.length, 2);
});

test("a bot's question goes to the phone after the computer's chance, and a button answers the bot", async () => {
  threads = [
    {
      id: "thread-1",
      label: "Today's post",
      bot: "Insta",
      status: "waiting",
      seen: false,
      updatedAt: new Date().toISOString(),
      outcome: null,
      ask: null,
      room: {
        relays: [{ id: 41, messageId: "q-1", bot: "Insta", kind: "question", text: "Which topic?" }],
        questions: [
          { id: "q-1", bot: "Insta", text: "Which topic?", options: ["Rates", "Isudo"] },
        ],
      },
    },
  ];
  appEvents.emit({ type: "threads" });
  await until(() => turns.length === 3, "it is put to her as a turn that is not the user's");
  assert.equal(turns[2].said, null);
  assert.match(turns[2].words, /Insta → Thursday, thread "Today's post"/);
  await until(() => accepted.length === 1, "its relay rows are accepted once told");
  assert.deepEqual(accepted[0], [41]);

  const asked = sent.findLast((one) => one.method === "sendMessage");
  const keyboard = (
    asked?.body.reply_markup as {
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
      message: { message_id: 5, chat: { id: 7, type: "private" }, text: "Insta asks" },
      data: keyboard[1][0].callback_data,
    },
  });
  await until(() => answered.length === 1, "the bot is answered");
  assert.deepEqual(answered[0], ["thread-1", "Isudo", "user", "Insta"]);

  // Told once: the same question coming round again is not news
  appEvents.emit({ type: "threads" });
  await new Promise((resolve) => setTimeout(resolve, 2_300));
  assert.equal(turns.length, 3);
});
