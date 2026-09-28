import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, mock, test } from "node:test";
import { APICallError, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

// A spoken call on the GPT subscription's line, with the provider's side a script: the call
// the plan is asked to open, the voice's hand-overs run as her backend a step at a time, what
// the page is told in the key's own words, and the wire as the Codex CLI speaks it.
const home = await mkdtemp(join(tmpdir(), "thursday-live-plan-"));
process.env.THURSDAY_HOME = home;
process.env.THURSDAY_SKIP_BROWSER = "1";

/** What each step of her backend was sent, and the script each answers with. */
const prompts: string[] = [];
const steps: (() => Record<string, unknown>[])[] = [];
const usage = {
  inputTokens: {
    total: 100,
    noCache: 100,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};
const model = new MockLanguageModelV4({
  doStream: async ({ prompt }) => {
    prompts.push(JSON.stringify(prompt));
    const next = steps.shift();
    assert.ok(next, "Unexpected step");
    const content = next();
    return {
      stream: simulateReadableStream({
        initialDelayInMs: null,
        chunkDelayInMs: null,
        chunks: [
          ...content.flatMap((part) =>
            part.type === "text"
              ? [
                  { type: "text-start", id: "text" },
                  { type: "text-delta", id: "text", delta: part.text },
                  { type: "text-end", id: "text" },
                ]
              : [part],
          ),
          {
            type: "finish",
            finishReason: {
              unified: content.some((part) => part.type === "tool-call")
                ? "tool-calls"
                : "stop",
              raw: undefined,
            },
            usage,
          },
        ] as never[],
      }),
    };
  },
});

const realModel = await import("../features/ai/model.ts");
mock.module("../features/ai/model.ts", {
  namedExports: {
    ...realModel,
    getTextModel: async (ref: { provider?: string; model?: string }) => {
      assert.equal(ref.provider, "chatgpt", "her backend runs on the plan");
      return { ref, model, searchTools: null };
    },
  },
});

/** What the plan was asked to open, and the line the app joined. */
const opened: { sdp: string; session: Record<string, unknown> }[] = [];
const realChatgpt = await import("../features/ai/chatgpt.ts");
mock.module("../features/ai/chatgpt.ts", {
  namedExports: {
    ...realChatgpt,
    openPlanCall: async (input: {
      sdp: string;
      session: Record<string, unknown>;
    }) => {
      opened.push(input);
      return { sdp: "answer", callId: "rtc_test", headers: { a: "b" } };
    },
  },
});

type Said = { text: string; channel: string; delegation?: string };
/** The line as the fake wire holds it: what the app put into the voice, and how to speak from its side. */
let wire: {
  said: Said[];
  closed: number;
  hear(event: Record<string, unknown>): void;
  drop(code: number): void;
};
const realPlan = await import("../lib/live/live.plan.ts");
mock.module("../lib/live/live.plan.ts", {
  namedExports: {
    ...realPlan,
    joinPlanLine: async (options: {
      callId: string;
      on: {
        event(event: unknown): void;
        closed(code: number, reason: string): void;
      };
    }) => {
      assert.equal(options.callId, "rtc_test");
      const said: Said[] = [];
      wire = {
        said,
        closed: 0,
        // A frame as the socket carries it, read as the real wire reads it
        hear: (event) => {
          const read = realPlan.readPlanEvent(event);
          if (read) options.on.event(read);
        },
        drop: (code) => options.on.closed(code, ""),
      };
      return {
        say: (text: string, channel: string) => {
          said.push({ text, channel });
          return true;
        },
        answer: (delegation: string, text: string, channel: string) => {
          said.push({ text, channel, delegation });
          return true;
        },
        close: () => {
          wire.closed += 1;
        },
      };
    },
  },
});
const realLive = await import("../lib/live/live.server.ts");
mock.module("../lib/live/live.server.ts", {
  // Asked of the provider over the network; nothing here depends on the answer
  namedExports: { ...realLive, acceptedReasoning: async () => null },
});

const { migrateDatabase } = await import("../database/migrate.ts");
await migrateDatabase();
const { LiveSettingsSchema, liveLineOf } = await import(
  "../features/ai/live.schema.ts"
);
const { TOOL_NAMES } = await import("../features/ai/tools/tool-name.ts");
const { loadLivePrompt } = await import(
  "../features/ai/prompts/live.prompt.ts"
);
const { followPlanLine, openPlanLine, tellPlanLine } = await import(
  "../features/thursday/thursday.plan.ts"
);

after(async () => {
  await rm(home, { recursive: true, force: true });
});

type WireEvent = { type: string } & Record<string, unknown>;

/** Opens a line and follows it as the page does: every event it is told, and a way to wait for one. */
async function openLine(callId: string) {
  const handshake = await openPlanLine({
    sdp: "offer",
    voice: { instructions: "the voice's prompt", voice: "cove" },
    settings: LiveSettingsSchema.parse({}),
    backendPrompt: "the backend's prompt",
    opened: { webSearch: false, readSkills: false },
    insertRow: async () => callId,
  });
  const leave = new AbortController();
  const response = followPlanLine(callId, leave.signal);
  const events: WireEvent[] = [];
  const reader = response.body?.getReader();
  assert.ok(reader);
  const decoder = new TextDecoder();
  let buffer = "";
  void (async () => {
    for (;;) {
      const { done, value } = await reader.read().catch(() => ({
        done: true as const,
        value: undefined,
      }));
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks)
        for (const line of block.split("\n"))
          if (line.startsWith("data: ")) events.push(JSON.parse(line.slice(6)));
    }
  })();
  /** The next event of a type, at or after `from`, as the page would read it. */
  const next = async (
    type: string,
    match: (event: WireEvent) => boolean = () => true,
  ) => {
    for (let waited = 0; waited < 2_000; waited += 5) {
      const found = events.find((event) => {
        if (event.type === type) return match(event);
        const nested = event.event as WireEvent | undefined;
        return (
          event.type === "response.event" &&
          nested?.type === type &&
          match(nested)
        );
      });
      if (found) return found;
      await new Promise((settle) => setTimeout(settle, 5));
    }
    assert.fail(`No ${type} came`);
  };
  return { handshake, events, next, leave };
}

test("a line opens on the plan's own voice, handing its work to the client", async () => {
  const line = await openLine("call-open");
  assert.deepEqual(line.handshake, { callId: "call-open", sdp: "answer" });
  assert.deepEqual(opened.at(-1), {
    sdp: "offer",
    session: {
      model: "gpt-live-1-codex",
      instructions: "the voice's prompt",
      audio: { output: { voice: "cove" } },
      delegation: { type: "client" },
    },
  });
  await line.next("session.started");
  line.leave.abort();
});

test("a hand-over runs her backend on the plan a step at a time, the page runs her calls, and her answer goes back to the voice", async () => {
  const line = await openLine("call-work");
  steps.push(
    () => [
      {
        type: "tool-call",
        toolCallId: "call_1",
        toolName: TOOL_NAMES.thread_status,
        input: JSON.stringify({ thread: "all" }),
      },
    ],
    () => [{ type: "text", text: "Nothing is running." }],
  );

  // Their words as the voice's side transcribes them, then its hand-over
  wire.hear({
    type: "input_transcript.added",
    item: { text: "Is <anything> " },
  });
  wire.hear({ type: "input_transcript.added", item: { text: "running?" } });
  wire.hear({
    type: "turn.done",
    turn: { role: "user", transcript: "Is <anything> running?" },
  });
  wire.hear({
    type: "delegation.created",
    item: {
      type: "delegation",
      target: "client",
      id: "del_1",
      content: [{ type: "input_text", text: "Check what is running" }],
    },
  });

  // The page hears their words as the key's wire says them
  const heard = await line.next("session.input_transcript.delta");
  assert.equal(heard.delta, "Is <anything> ");
  assert.equal(typeof heard.start_ms, "number");

  // The first step asks for a tool: the page is handed the call, not its result
  const created = await line.next("response.created");
  const call = await line.next(
    "response.output_item.done",
    (event) => (event.item as WireEvent).type === "function_call",
  );
  const item = (call.event as WireEvent).item as WireEvent;
  assert.equal(item.name, TOOL_NAMES.thread_status);
  assert.equal(item.call_id, "call_1");
  assert.deepEqual(JSON.parse(String(item.arguments)), { thread: "all" });
  assert.equal(call.delegation_id, "del_1");
  await line.next("response.completed");
  assert.match(prompts.at(-1) ?? "", /<realtime_delegation>/);
  assert.match(prompts.at(-1) ?? "", /<input>Check what is running<\/input>/);
  assert.match(
    prompts.at(-1) ?? "",
    /<transcript_delta>user: Is &lt;anything&gt; running\?<\/transcript_delta>/,
  );

  // The page answers the call and asks for the next response, as it does on a key's call
  tellPlanLine("call-work", [
    {
      type: "response.item.create",
      item: {
        type: "function_call_output",
        call_id: "call_1",
        output: "No jobs.",
      },
    },
    { type: "response.create" },
  ]);
  await line.next(
    "response.created",
    (event) =>
      (event.response as { id: string }).id !==
      ((created.event as WireEvent).response as { id: string }).id,
  );
  for (let waited = 0; waited < 2_000 && !wire.said.length; waited += 5)
    await new Promise((settle) => setTimeout(settle, 5));
  assert.deepEqual(wire.said, [
    { text: "Nothing is running.", channel: "speakable", delegation: "del_1" },
  ]);
  assert.match(prompts.at(-1) ?? "", /No jobs\./);
  assert.equal(steps.length, 0);
  line.leave.abort();
});

test("what the page puts in goes into the voice's context on the channel its kind asks for, and is acknowledged", async () => {
  const line = await openLine("call-say");
  tellPlanLine("call-say", [
    {
      type: "session.commentary.append",
      event_id: "e-1",
      delegation_id: null,
      content: "Jarvis finished the report.",
    },
    {
      type: "session.thinking.append",
      event_id: "e-2",
      delegation_id: null,
      content: "They opened the report.",
    },
    {
      type: "session.instructions.append",
      event_id: "e-3",
      delegation_id: null,
      content: "Speak first: greet them.",
    },
  ]);
  assert.deepEqual(wire.said, [
    { text: "Jarvis finished the report.", channel: "speakable" },
    { text: "They opened the report.", channel: "commentary" },
    { text: "Speak first: greet them.", channel: "speakable" },
  ]);
  await line.next(
    "session.commentary.appended",
    (event) => event.client_event_id === "e-1",
  );
  await line.next(
    "session.thinking.appended",
    (event) => event.client_event_id === "e-2",
  );
  await line.next(
    "session.instructions.appended",
    (event) => event.client_event_id === "e-3",
  );
  line.leave.abort();
});

test("a step that fails tells the page and the voice in the provider's words", async () => {
  const line = await openLine("call-fail");
  steps.push(() => {
    throw new APICallError({
      message: "GPT Subscription usage limit reached on the plus plan.",
      url: "https://chatgpt.com/backend-api/codex/responses",
      requestBodyValues: {},
      statusCode: 402,
      isRetryable: false,
    });
  });
  wire.hear({
    type: "delegation.created",
    item: {
      type: "delegation",
      target: "client",
      id: "del_2",
      content: [{ type: "input_text", text: "Search the news" }],
    },
  });
  const failed = await line.next("response.failed");
  assert.match(
    JSON.stringify(failed),
    /GPT Subscription usage limit reached on the plus plan/,
  );
  for (let waited = 0; waited < 2_000 && !wire.said.length; waited += 5)
    await new Promise((settle) => setTimeout(settle, 5));
  assert.equal(wire.said[0]?.delegation, "del_2");
  assert.match(
    wire.said[0]?.text ?? "",
    /^That failed: GPT Subscription usage limit reached/,
  );
  line.leave.abort();
});

test("the line closes when the page asks, when the page leaves, and when the voice's side hangs up", async () => {
  const asked = await openLine("call-close");
  tellPlanLine("call-close", [{ type: "session.close" }]);
  const closed = await asked.next("session.closed");
  assert.equal(closed.reason, "close_requested");
  assert.equal(wire.closed, 1);
  asked.leave.abort();
  assert.throws(
    () => tellPlanLine("call-close", [{ type: "response.create" }]),
    /not open/,
  );

  const left = await openLine("call-left");
  left.leave.abort();
  for (let waited = 0; waited < 2_000 && !wire.closed; waited += 5)
    await new Promise((settle) => setTimeout(settle, 5));
  assert.equal(
    wire.closed,
    1,
    "the media was the page's: its call goes with it",
  );

  const hung = await openLine("call-hung");
  wire.drop(1000);
  const ended = await hung.next("session.closed");
  assert.equal(ended.reason, "remote_hangup");
  hung.leave.abort();
});

test("a call opens on the line picked while it is set up, else the plan when signed in on one with calls, else the key", () => {
  const set =
    (...keys: string[]) =>
    (key: string) =>
      keys.includes(key);
  assert.equal(
    liveLineOf(null, set("CHATGPT_SIGN_IN", "OPENAI_API_KEY"), "plus"),
    "chatgpt",
  );
  assert.equal(
    liveLineOf("openai", set("CHATGPT_SIGN_IN", "OPENAI_API_KEY"), "plus"),
    "openai",
  );
  assert.equal(liveLineOf("openai", set("CHATGPT_SIGN_IN"), "pro"), "chatgpt");
  assert.equal(liveLineOf(null, set("OPENAI_API_KEY"), null), "openai");
  assert.equal(liveLineOf(null, set(), null), null);
  // A plan the token does not name is let through: the call says what the plan answered
  assert.equal(liveLineOf(null, set("CHATGPT_SIGN_IN"), null), "chatgpt");
  // Free has no spoken calls: a key opens one instead, picked or not, and alone it is none
  assert.equal(
    liveLineOf("chatgpt", set("CHATGPT_SIGN_IN", "OPENAI_API_KEY"), "free"),
    "openai",
  );
  assert.equal(liveLineOf(null, set("CHATGPT_SIGN_IN"), "free"), null);
});

test("a sign-in makes her callable on a plan with calls, and on Free only beside a key", async () => {
  const { isCallable } = await import("../features/config/config.query.ts");
  const signIn = (plan: string | null) =>
    JSON.stringify({
      access: "a",
      refresh: "r",
      expires: Date.now() + 3_600_000,
      accountId: "acct",
      plan,
    });
  const key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "";
  try {
    process.env.CHATGPT_SIGN_IN = signIn("plus");
    assert.equal(await isCallable(), true);
    process.env.CHATGPT_SIGN_IN = signIn(null);
    assert.equal(await isCallable(), true);
    process.env.CHATGPT_SIGN_IN = signIn("free");
    assert.equal(await isCallable(), false);
    process.env.OPENAI_API_KEY = "sk-test-0123456789";
    assert.equal(await isCallable(), true);
  } finally {
    delete process.env.CHATGPT_SIGN_IN;
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
  }
});

test("the plan's voice is told which channel is hers to say and which is background", async () => {
  const plan = await loadLivePrompt({ plan: true });
  const key = await loadLivePrompt({});
  assert.match(plan.text, /speakable channel is yours to say/);
  assert.match(plan.text, /commentary channel is silent background/);
  assert.doesNotMatch(key.text, /speakable channel/);
});

test("the wire reads the voice's side as the Codex CLI does, and ignores what is not for this client", () => {
  const read = realPlan.readPlanEvent;
  assert.deepEqual(read({ type: "session.started", session: { id: "s" } }), {
    type: "started",
  });
  assert.deepEqual(
    read({ type: "output_transcript.added", item: { text: "Hi" } }),
    {
      type: "heard",
      role: "assistant",
      text: "Hi",
    },
  );
  assert.deepEqual(
    read({ type: "turn.done", turn: { role: "user", transcript: "Hello" } }),
    {
      type: "turn",
      role: "user",
      text: "Hello",
    },
  );
  assert.deepEqual(
    read({
      type: "delegation.created",
      item: {
        type: "delegation",
        target: "client",
        id: "del_x",
        content: [
          { type: "input_text", text: "Book " },
          { type: "input_text", text: "a table" },
        ],
      },
    }),
    { type: "delegated", id: "del_x", text: "Book a table" },
  );
  assert.equal(
    read({
      type: "delegation.created",
      item: { type: "delegation", target: "server", id: "d" },
    }),
    null,
  );
  assert.deepEqual(read({ type: "error", error: { message: "No access" } }), {
    type: "error",
    message: "No access",
  });
  assert.equal(read({ type: "output_audio.delta", audio: "…" }), null);
});

test("the wire joins a call by its id with the sign-in's headers, and speaks in appends Codex's size", async () => {
  const sockets: {
    url: string;
    headers: Record<string, string>;
    sent: Record<string, unknown>[];
    closed: number[];
    fire(type: string, data?: Record<string, unknown>): void;
  }[] = [];
  const Real = globalThis.WebSocket;
  class FakeSocket {
    static OPEN = 1;
    readyState = 0;
    listeners = new Map<string, ((event: Record<string, unknown>) => void)[]>();
    constructor(url: string, init: { headers: Record<string, string> }) {
      const self = this;
      sockets.push({
        url,
        headers: init.headers,
        sent: [],
        closed: [],
        fire(type, data = {}) {
          if (type === "open") self.readyState = 1;
          for (const listener of self.listeners.get(type) ?? []) listener(data);
        },
      });
    }
    addEventListener(
      type: string,
      listener: (event: Record<string, unknown>) => void,
    ) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    send(data: string) {
      sockets.at(-1)?.sent.push(JSON.parse(data));
    }
    close(code: number) {
      sockets.at(-1)?.closed.push(code);
    }
  }
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  try {
    await assert.rejects(
      realPlan.joinPlanLine({
        callId: "../x",
        headers: {},
        on: { event() {}, closed() {} },
      }),
      /Not a call id/,
    );
    const events: unknown[] = [];
    const closes: number[] = [];
    const joining = realPlan.joinPlanLine({
      callId: "rtc_abc",
      headers: { authorization: "Bearer t", "chatgpt-account-id": "acct" },
      on: {
        event: (event) => events.push(event),
        closed: (code) => closes.push(code),
      },
    });
    const socket = sockets.at(-1);
    assert.ok(socket);
    assert.equal(socket.url, "wss://api.openai.com/v1/live/rtc_abc");
    assert.deepEqual(socket.headers, {
      authorization: "Bearer t",
      "chatgpt-account-id": "acct",
    });
    socket.fire("open");
    const line = await joining;

    assert.ok(line.say("Hello there.", "speakable"));
    assert.ok(line.answer("del_1", "x".repeat(700), "speakable"));
    assert.deepEqual(socket.sent[0], {
      type: "session.context.append",
      channel: "speakable",
      content: [{ type: "input_text", text: "Hello there." }],
    });
    const answered = socket.sent.slice(1);
    assert.equal(answered.length, 2, "a long answer goes in pieces");
    for (const piece of answered) {
      assert.equal(piece.type, "delegation.context.append");
      assert.equal(piece.delegation_item_id, "del_1");
      const [part] = piece.content as { text: string }[];
      assert.ok(Buffer.byteLength(part.text) <= 500);
    }

    socket.fire("message", {
      data: JSON.stringify({
        type: "input_transcript.added",
        item: { text: "yes" },
      }),
    });
    assert.deepEqual(events, [{ type: "heard", role: "user", text: "yes" }]);

    line.close();
    assert.deepEqual(socket.sent.at(-1), { type: "session.close" });
    assert.deepEqual(socket.closed, [1000]);
    socket.fire("close", { code: 1000, reason: "" });
    assert.deepEqual(closes, [1000]);
  } finally {
    globalThis.WebSocket = Real;
  }
});

test("a call on the plan is opened the way the Codex CLI's /voice opens one", async () => {
  const payload = Buffer.from(
    JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + 3600,
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct",
        chatgpt_plan_type: "plus",
      },
    }),
  ).toString("base64url");
  process.env.CHATGPT_SIGN_IN = JSON.stringify({
    access: `x.${payload}.y`,
    refresh: "r",
    expires: Date.now() + 3_600_000,
    accountId: "acct",
    plan: "plus",
  });
  const sent: { url: string; headers: Headers; body: unknown }[] = [];
  let answer = () =>
    new Response("v=answer\r\n", {
      headers: { location: "/v1/live/rtc_core_test" },
    });
  const fetching = mock.method(
    globalThis,
    "fetch",
    async (url: string, init: RequestInit) => {
      sent.push({
        url: String(url),
        headers: new Headers(init.headers),
        body: JSON.parse(String(init.body)),
      });
      return answer();
    },
  );
  try {
    const session = {
      model: "gpt-live-1-codex",
      delegation: { type: "client" },
    };
    const call = await realChatgpt.openPlanCall({
      sdp: "v=offer\r\n",
      session,
    });
    assert.equal(call.sdp, "v=answer\r\n");
    assert.equal(call.callId, "rtc_core_test");
    const [request] = sent;
    // codex-rs core tests/suite/realtime_conversation.rs
    // conversation_webrtc_frameless_chatgpt_sends_codex_headers_to_backend
    assert.equal(
      request.url,
      "https://chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas",
    );
    assert.equal(request.headers.get("openai-alpha"), "quicksilver=v2");
    assert.equal(request.headers.get("authorization"), `Bearer x.${payload}.y`);
    assert.equal(request.headers.get("chatgpt-account-id"), "acct");
    assert.equal(request.headers.get("originator"), "thursday");
    for (const id of ["session-id", "thread-id", "x-session-id"])
      assert.ok(request.headers.get(id), id);
    assert.deepEqual(request.body, { sdp: "v=offer\r\n", session });
    // The line is joined with the same headers
    assert.equal(call.headers["openai-alpha"], "quicksilver=v2");
    assert.equal(call.headers["chatgpt-account-id"], "acct");

    // No Location: the session header names it
    answer = () =>
      new Response("v=answer\r\n", {
        headers: { "openai-session-id": "rtc_other" },
      });
    assert.equal(
      (await realChatgpt.openPlanCall({ sdp: "o", session })).callId,
      "rtc_other",
    );

    // A refusal is the plan's own words
    answer = () =>
      Response.json(
        { detail: "Voice is not included in your plan." },
        { status: 403 },
      );
    await assert.rejects(
      realChatgpt.openPlanCall({ sdp: "o", session }),
      /Voice is not included in your plan\./,
    );
  } finally {
    fetching.mock.restore();
    delete process.env.CHATGPT_SIGN_IN;
  }
});
