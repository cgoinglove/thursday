import assert from "node:assert/strict";
import { after, test } from "node:test";

// Discord and Slack against a socket and a `fetch` that are only stubs: what each says to
// the service on connecting, what it hands over, what it leaves alone. No network.

type Frame = Record<string, unknown>;
class FakeSocket extends EventTarget {
  static OPEN = 1;
  static last: FakeSocket;
  readyState = 1;
  sent: Frame[] = [];
  constructor(readonly url: string) {
    super();
    FakeSocket.last = this;
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as Frame);
  }
  close(code = 1000) {
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event("close"), { code, reason: "" }));
  }
  /** A frame from the service. */
  receive(frame: Frame) {
    this.dispatchEvent(
      Object.assign(new Event("message"), { data: JSON.stringify(frame) }),
    );
  }
}
const realSocket = globalThis.WebSocket;
const realFetch = globalThis.fetch;
globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;

const calls: { url: string; body: unknown }[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  calls.push({
    url,
    body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
  });
  if (url.endsWith("/auth.test"))
    return Response.json({ ok: true, user: "thursday" });
  if (url.endsWith("/apps.connections.open"))
    return Response.json({ ok: true, url: "wss://slack.test/socket" });
  if (url.endsWith("/users.info"))
    return Response.json({ ok: true, user: { real_name: "Sam" } });
  return Response.json({ ok: true, id: "m1" });
}) as typeof fetch;

after(() => {
  globalThis.WebSocket = realSocket;
  globalThis.fetch = realFetch;
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const { createDiscord } = await import("../features/reach/discord.ts");
const { createSlack } = await import("../features/reach/slack.ts");
const { ChannelRefusal } = await import("../features/reach/channel.ts");

test("discord identifies after hello, hands over a direct message, leaves a server's alone, and acknowledges a press", async () => {
  const stop = new AbortController();
  const got: unknown[] = [];
  let bot = "";
  let link: string | null = null;
  const listening = createDiscord("bot-token").listen(
    {
      ready: (name, where) => {
        bot = name;
        link = where;
      },
      incoming: (one) => got.push(one),
    },
    stop.signal,
  );
  await tick();
  const socket = FakeSocket.last;
  socket.receive({
    op: 10,
    d: { heartbeat_interval: 60_000 },
    s: null,
    t: null,
  });
  const identify = socket.sent.find((frame) => frame.op === 2) as {
    d: { token: string; intents: number };
  };
  assert.equal(identify.d.token, "bot-token");
  assert.equal(identify.d.intents, 1 << 12, "direct messages only");

  socket.receive({
    op: 0,
    t: "READY",
    s: 1,
    d: { user: { id: "b", username: "thursday" }, application: { id: "app1" } },
  });
  assert.equal(bot, "thursday");
  // The invite is the step nothing else can do for the user: Discord delivers a direct
  // message only to a bot you share a server with, and READY names the application
  assert.equal(
    link,
    "https://discord.com/oauth2/authorize?client_id=app1&scope=bot&permissions=0",
  );

  const author = { id: "u1", username: "sam", global_name: "Sam" };
  socket.receive({
    op: 0,
    t: "MESSAGE_CREATE",
    s: 2,
    d: { id: "1", channel_id: "dm1", author, content: " hello " },
  });
  socket.receive({
    op: 0,
    t: "MESSAGE_CREATE",
    s: 3,
    d: {
      id: "2",
      channel_id: "c9",
      guild_id: "g1",
      author,
      content: "in a server",
    },
  });
  socket.receive({
    op: 0,
    t: "MESSAGE_CREATE",
    s: 4,
    d: {
      id: "3",
      channel_id: "dm1",
      author: { ...author, bot: true },
      content: "a bot",
    },
  });
  assert.deepEqual(
    got.map((one) => ({ ...(one as object), files: undefined })),
    [
      {
        kind: "message",
        chat: "dm1",
        name: "Sam",
        words: "hello",
        files: undefined,
        unreadable: false,
      },
    ],
  );

  socket.receive({
    op: 0,
    t: "INTERACTION_CREATE",
    s: 5,
    d: {
      id: "i1",
      token: "tok",
      type: 3,
      channel_id: "dm1",
      data: { custom_id: "q-1:0" },
      message: { id: "m7", content: "Which?" },
    },
  });
  await tick();
  assert.deepEqual(got[1], {
    kind: "press",
    chat: "dm1",
    data: "q-1:0",
    under: { id: "m7", text: "Which?" },
  });
  assert.ok(
    calls.some((call) => call.url.endsWith("/interactions/i1/tok/callback")),
    "the press is acknowledged",
  );

  // Discord saying the token is wrong is the user's to fix, not something to try again
  socket.close(4004);
  await assert.rejects(listening, ChannelRefusal);
});

test("slack acknowledges every envelope and hands over only the direct conversation", async () => {
  const stop = new AbortController();
  const got: unknown[] = [];
  let bot = "";
  const listening = createSlack("xapp-1", "xoxb-1").listen(
    { ready: (name) => (bot = name), incoming: (one) => got.push(one) },
    stop.signal,
  );
  await tick();
  await tick();
  assert.equal(bot, "@thursday");
  const socket = FakeSocket.last;
  assert.equal(socket.url, "wss://slack.test/socket");

  const event = (extra: Frame) => ({
    type: "events_api",
    envelope_id: `e${socket.sent.length}`,
    payload: {
      event: {
        type: "message",
        user: "U1",
        text: "hi",
        channel: "D1",
        channel_type: "im",
        ...extra,
      },
    },
  });
  socket.receive(event({}));
  socket.receive(event({ channel_type: "channel", channel: "C1" }));
  socket.receive(event({ bot_id: "B1" }));
  socket.receive(event({ subtype: "message_changed" }));
  await tick();
  assert.equal(socket.sent.length, 4, "each envelope is acknowledged");
  assert.deepEqual(
    got.map((one) => ({ ...(one as object), files: undefined })),
    [
      {
        kind: "message",
        chat: "D1",
        name: "Sam",
        words: "hi",
        files: undefined,
        unreadable: false,
      },
    ],
  );

  socket.receive({
    type: "interactive",
    envelope_id: "e9",
    payload: {
      type: "block_actions",
      channel: { id: "D1" },
      message: { ts: "17.1", text: "Which?" },
      actions: [{ value: "q-1:1" }],
    },
  });
  await tick();
  assert.deepEqual(got[1], {
    kind: "press",
    chat: "D1",
    data: "q-1:1",
    under: { id: "17.1", text: "Which?" },
  });

  stop.abort();
  await listening;
});
