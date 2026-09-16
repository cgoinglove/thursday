import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { LIVE_CALL } from "../config.ts";
import type {
  LiveActivity,
  LiveReasoning,
  LiveToolCall,
  LiveTurn,
} from "../lib/live/live.session.ts";

let wire: {
  on: {
    event(event: Record<string, unknown>): void;
    dropped(message: string): void;
  };
  negotiate(sdp: string): Promise<string>;
};
let sent: Record<string, unknown>[] = [];
let released = false;
mock.module("../lib/live/live.transport.ts", {
  namedExports: {
    createWebRtcTransport: (options: typeof wire) => {
      wire = options;
      return {
        connect: async () => {
          assert.equal(await wire.negotiate("offer"), "answer");
          wire.on.event({ type: "session.started" });
        },
        send: (event: Record<string, unknown>) => sent.push(event),
        close: () => {
          released = true;
        },
      };
    },
  },
});
const { appendChunks, createLiveSession } = await import(
  "../lib/live/live.session.ts"
);
const { acceptedEffort, createLiveCall } = await import(
  "../lib/live/live.server.ts"
);

const sessions: ReturnType<typeof createLiveSession>[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) {
    const closed = session.close();
    wire.on.event({
      type: "session.closed",
      reason: "close_requested",
      usage: { seconds: 1 },
    });
    await closed;
  }
  mock.restoreAll();
});

async function connect({
  runTool = async () => "ok",
}: {
  runTool?: (call: LiveToolCall) => Promise<string>;
} = {}) {
  sent = [];
  released = false;
  const levels = { input: 0, output: 0 };
  const turns: LiveTurn[] = [];
  const warnings: string[] = [];
  const failures: string[] = [];
  const activities: LiveActivity[] = [];
  const reasonings: LiveReasoning[] = [];
  const closes: { reason: string; seconds: number | null }[] = [];
  const session = createLiveSession({
    initialize: async (sdp) => {
      assert.equal(sdp, "offer");
      return "answer";
    },
    audio: {
      element: { muted: false } as HTMLAudioElement,
      listen() {},
      levels: () => levels,
    },
    on: {
      runTool,
      reasoning: (part) => reasonings.push(part),
      turn: (turn) => turns.push(turn),
      warn: (message) => warnings.push(message),
      failed: (message) => failures.push(message),
      activity: (activity) => activities.push(activity),
      finalized: (close) => closes.push(close),
    },
  });
  sessions.push(session);
  await session.connect();
  return {
    session,
    levels,
    turns,
    warnings,
    failures,
    activities,
    reasonings,
    closes,
  };
}

function nested(event: Record<string, unknown>) {
  wire.on.event({
    type: "response.event",
    delegation_id: "delegation-a",
    event,
  });
}
const functionCall = (call_id: string) =>
  nested({
    type: "response.output_item.done",
    item: {
      type: "function_call",
      id: `item-${call_id}`,
      call_id,
      name: "lookup",
      arguments: "{}",
    },
  });
const count = (type: string) =>
  sent.filter((event) => event.type === type).length;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("the backend waits for every function output and continues once, using the envelope's response", async () => {
  const pending = new Map<string, (value: string) => void>();
  const { activities } = await connect({
    runTool: (call) => new Promise((resolve) => pending.set(call.id, resolve)),
  });
  nested({ type: "response.created", response: { id: "r1" } });
  nested({ type: "response.function_call_arguments.done", arguments: "{}" });
  functionCall("a");
  functionCall("b");
  await tick();
  assert.equal(pending.size, 2);
  assert.equal(activities.at(-1)?.working, true);
  nested({ type: "response.completed", response: { id: "r1", output: [] } });
  pending.get("a")?.("first");
  await tick();
  assert.equal(count("response.item.create"), 1);
  assert.equal(count("response.create"), 0);
  pending.get("b")?.("second");
  await tick();
  assert.equal(count("response.item.create"), 2);
  assert.equal(count("response.create"), 1);
  // A repeated terminal snapshot and a repeated item run nothing twice
  nested({ type: "response.completed", response: { id: "r1" } });
  functionCall("a");
  await tick();
  assert.equal(count("response.create"), 1);
  assert.equal(count("response.item.create"), 2);
});

test("an incomplete response that asked for tools is continued once, and a second in a row only warns", async () => {
  const { warnings } = await connect();
  nested({ type: "response.created", response: { id: "r1" } });
  functionCall("a");
  nested({ type: "response.incomplete", response: { id: "r1" } });
  await tick();
  assert.equal(count("response.item.create"), 1);
  assert.equal(count("response.create"), 1);
  assert.equal(warnings.length, 0);
  // The continuation runs out again: its output still goes in, and nothing continues it
  nested({ type: "response.created", response: { id: "r2" } });
  functionCall("b");
  nested({ type: "response.incomplete", response: { id: "r2" } });
  await tick();
  assert.equal(count("response.item.create"), 2);
  assert.equal(count("response.create"), 1);
  assert.equal(warnings.length, 1);
  // A failed response is never continued
  nested({ type: "response.created", response: { id: "r3" } });
  functionCall("c");
  nested({ type: "response.failed", response: { id: "r3" } });
  await tick();
  assert.equal(count("response.item.create"), 3);
  assert.equal(count("response.create"), 1);
});

test("a finished reasoning summary part is reported once, whole, with its place in the call", async () => {
  const { reasonings } = await connect();
  nested({ type: "response.created", response: { id: "r1" } });
  const part = (event: Record<string, unknown>) =>
    nested({ item_id: "rs_1", output_index: 0, ...event });
  part({
    type: "response.reasoning_summary_text.delta",
    summary_index: 0,
    delta: "**Comparing",
  });
  part({
    type: "response.reasoning_summary_text.done",
    summary_index: 0,
    text: "**Comparing markets**\n\nRates first.",
  });
  part({
    type: "response.reasoning_summary_text.done",
    summary_index: 1,
    text: "**Handing over**",
  });
  await tick();
  assert.deepEqual(
    reasonings.map(({ id, text }) => [id, text]),
    [
      ["rs_1:0", "**Comparing markets**\n\nRates first."],
      ["rs_1:1", "**Handing over**"],
    ],
  );
  assert.ok(reasonings.every((part) => part.seq >= 0));
});

test("a function call cut off by the output cap is never run, and its response stops counting as work", async () => {
  let ran = 0;
  const { activities, turns } = await connect({
    runTool: async () => {
      ran += 1;
      return "ok";
    },
  });
  nested({ type: "response.created", response: { id: "r1" } });
  await tick();
  assert.equal(activities.at(-1)?.working, true);
  nested({
    type: "response.output_item.done",
    item: {
      type: "function_call",
      id: "item-cut",
      call_id: "cut",
      name: "delegate",
      arguments: '{"bot":"Analyst',
      status: "incomplete",
    },
  });
  // What Live sends instead of a terminal event for that response
  wire.on.event({
    type: "error",
    error: { message: "Responses handoff incomplete." },
  });
  await tick();
  assert.equal(ran, 0);
  assert.equal(turns.filter((turn) => turn.role === "tool").length, 0);
  assert.equal(count("response.item.create"), 0);
  assert.equal(count("response.create"), 0);
  assert.equal(activities.at(-1)?.working, false);
});

test("captions keep exact fragments through overlap and late delivery, and never show backend text", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { session, turns } = await connect();
  const fragment = (
    type: string,
    id: string,
    start: number,
    end: number,
    delta: string,
  ) =>
    wire.on.event({ type, event_id: id, start_ms: start, end_ms: end, delta });
  fragment("session.input_transcript.delta", "u1", 100, 200, "Please ");
  fragment("session.output_transcript.delta", "a1", 150, 250, "Sure.");
  fragment("session.input_transcript.delta", "u3", 400, 500, "it.");
  fragment("session.input_transcript.delta", "u2", 250, 350, "find ");
  fragment("session.input_transcript.delta", "u2", 250, 350, "find ");
  nested({ type: "response.output_text.delta", delta: "private backend text" });
  context.mock.timers.tick(LIVE_CALL.transcriptSaveMs);

  const saved = turns.filter((turn) => turn.done);
  assert.deepEqual(
    saved.map((turn) => turn.text),
    ["Please find it.", "Sure."],
  );
  assert.equal(saved[0].seq, 100);
  assert.equal(saved[1].seq, 150);
  assert.deepEqual(saved[0].fragments, [
    { start: 100, end: 200, text: "Please " },
    { start: 250, end: 350, text: "find " },
    { start: 400, end: 500, text: "it." },
  ]);

  // A fragment after the checkpoint revises the same group, originals included
  fragment("session.input_transcript.delta", "u4", 520, 600, " Now.");
  context.mock.timers.tick(LIVE_CALL.transcriptSaveMs);
  const revised = turns
    .filter((turn) => turn.done && turn.id === saved[0].id)
    .at(-1);
  assert.equal(revised?.text, "Please find it. Now.");
  assert.equal(revised?.fragments?.length, 4);
  assert.equal(
    turns.some((turn) => turn.text.includes("private backend text")),
    false,
  );

  const close = session.close();
  assert.equal(released, false);
  wire.on.event({
    type: "session.closed",
    reason: "close_requested",
    usage: { seconds: 12 },
  });
  await close;
  assert.equal(released, true);
});

test("closing never starts a late tool", async () => {
  let executed = 0;
  const { session, failures } = await connect({
    runTool: async () => {
      executed++;
      return "ok";
    },
  });
  const closing = session.close();
  nested({ type: "response.created", response: { id: "r" } });
  functionCall("late");
  wire.on.event({ type: "session.closed", reason: "close_requested" });
  await closing;
  assert.equal(executed, 0);
  assert.equal(failures.length, 0);
});

test("closing waits for session.closed and reports the reason and billed seconds", async () => {
  const { session, closes, failures } = await connect();
  const closing = session.close();
  assert.equal(sent.at(-1)?.type, "session.close");
  assert.equal(released, false);
  wire.on.event({
    type: "session.closed",
    reason: "close_requested",
    usage: { seconds: 42 },
  });
  await closing;
  assert.deepEqual(closes, [{ reason: "close_requested", seconds: 42 }]);
  assert.equal(failures.length, 0);
  assert.equal(released, true);
});

test("a session the provider closes fails the call and still reports usage", async () => {
  const { closes, failures } = await connect();
  wire.on.event({ type: "session.closed", reason: "idle_timeout" });
  assert.deepEqual(closes, [{ reason: "idle_timeout", seconds: null }]);
  assert.match(failures[0], /idle_timeout/);
  assert.equal(released, true);
});

test("a close with no confirmation times out, says so, and releases media", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { session, warnings, closes } = await connect();
  const closing = session.close();
  context.mock.timers.tick(LIVE_CALL.closeMs);
  await closing;
  assert.equal(released, true);
  assert.equal(closes.length, 0);
  assert.match(warnings[0], /final session usage/);
});

test("activity keeps reporting while she speaks, and names the tools while they run", async (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const pending: ((value: string) => void)[] = [];
  const { activities, levels } = await connect({
    runTool: () => new Promise((resolve) => pending.push(resolve)),
  });
  levels.output = 0.2;
  const before = activities.length;
  context.mock.timers.tick(100);
  context.mock.timers.tick(100);
  context.mock.timers.tick(100);
  assert.ok(
    activities.slice(before).filter((activity) => activity.speaking).length >=
      3,
  );

  nested({ type: "response.created", response: { id: "r1" } });
  functionCall("a");
  await tick();
  assert.equal(activities.at(-1)?.working, true);
  assert.deepEqual(activities.at(-1)?.tools, ["lookup"]);
  pending[0]("done");
  await tick();
});

test("updates go out one at a time by kind, settle on their own acknowledgement, and are never replayed", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { session, warnings } = await connect();
  const first = session.append("instructions", "Greet the user.");
  const second = session.append("commentary", "Scout found three flights.");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "session.instructions.append");
  assert.equal(sent[0].delegation_id, null);
  assert.equal(sent[0].content, "Greet the user.");

  context.mock.timers.tick(LIVE_CALL.appendMs);
  assert.equal(await first, false);
  assert.match(warnings[0], /delivery is unknown/);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].type, "session.commentary.append");

  // A late acknowledgement for the first sends nothing more
  wire.on.event({
    type: "session.instructions.appended",
    client_event_id: sent[0].event_id,
  });
  assert.equal(sent.length, 2);
  wire.on.event({
    type: "session.commentary.appended",
    client_event_id: sent[1].event_id,
  });
  assert.equal(await second, true);
  assert.equal(sent.length, 2);
});

test("a long update goes chunk by chunk, and a rejected chunk drops the rest of it", async () => {
  const { session, warnings } = await connect();
  const long = "word ".repeat(200);
  const whole = session.append("commentary", long);
  const parts: string[] = [];
  while (sent.length > parts.length) {
    const chunk = sent[parts.length];
    parts.push(String(chunk.content));
    wire.on.event({
      type: "session.commentary.appended",
      client_event_id: chunk.event_id,
    });
  }
  assert.equal(await whole, true);
  assert.ok(parts.length > 1);
  assert.equal(parts.join(""), long);

  const before = sent.length;
  const rejected = session.append("commentary", long);
  wire.on.event({
    type: "error",
    error: {
      message: "Update refused",
      client_event_id: sent[before].event_id,
    },
  });
  assert.equal(await rejected, false);
  assert.equal(sent.length, before + 1);
  assert.match(warnings.at(-1) ?? "", /Update refused/);

  const next = session.append(
    "thinking",
    "The user stopped a thread on screen.",
  );
  assert.equal(sent.at(-1)?.type, "session.thinking.append");
  wire.on.event({
    type: "session.thinking.appended",
    client_event_id: sent.at(-1)?.event_id,
  });
  assert.equal(await next, true);
});

test("update chunks stay within the byte bound for any script and keep words whole", () => {
  const encoder = new TextEncoder();
  const korean = "안녕하세요 오늘 일정은 세 가지입니다. ".repeat(40);
  const emoji = "🙂".repeat(300);
  const english = "The flight leaves at nine. ".repeat(60);
  for (const text of [korean, emoji, english]) {
    const chunks = appendChunks(text);
    assert.ok(chunks.length > 1);
    assert.equal(chunks.join(""), text);
    for (const chunk of chunks) assert.ok(encoder.encode(chunk).length <= 480);
  }
  for (const chunk of appendChunks(english).slice(0, -1)) {
    assert.match(chunk, /\s$/);
  }
  assert.deepEqual(appendChunks(""), []);
});

const backend = (overrides: Record<string, unknown> = {}) => ({
  model: "gpt-5.6-luna",
  instructions: "Tools only",
  tools: [
    {
      name: "lookup",
      description: "Look up an item",
      parameters: { type: "object" as const, properties: {} },
    },
  ],
  reasoningEffort: null,
  webSearch: false,
  ...overrides,
});

function captureFetch() {
  const requests: Record<string, any>[] = [];
  mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://api.openai.com/v1/live/sessions");
    requests.push(JSON.parse(init.body as string));
    return Response.json(
      {
        session: { id: "live-example" },
        transport: { type: "webrtc", sdp: "answer" },
      },
      { status: 201 },
    );
  });
  return requests;
}

test("startup sends voice and backend apart, seeds history, and keeps the key on the server", async () => {
  const requests = captureFetch();
  const input = [
    {
      type: "message" as const,
      role: "user" as const,
      content: [{ type: "input_text" as const, text: "Book the dentist." }] as [
        { type: "input_text"; text: string },
      ],
    },
  ];
  const connection = await createLiveCall({
    apiKey: "test-key",
    sdp: "offer",
    voice: "marin",
    instructions: "Conversation only",
    input,
    backend: backend(),
  });
  const [request] = requests;
  assert.equal(request.session.model, "gpt-live-1");
  assert.equal(request.session.instructions, "Conversation only");
  assert.deepEqual(request.session.input, input);
  assert.equal(request.session.audio.output.voice, "marin");
  assert.equal(request.session.store, false);
  assert.equal(request.session.delegation.type, "responses");
  const responses = request.session.delegation.responses;
  assert.equal(responses.model, "gpt-5.6-luna");
  assert.equal(responses.instructions, "Tools only");
  assert.equal(responses.tools.length, 1);
  assert.equal("strict" in responses.tools[0], false);
  // No effort chosen: none is sent, and the summary is kept with the call
  assert.deepEqual(responses.reasoning, { summary: "auto" });
  assert.equal(
    responses.tools.some(
      (tool: { type: string }) => tool.type === "web_search",
    ),
    false,
  );
  assert.equal(JSON.stringify(connection).includes("test-key"), false);
});

test("an effort and web search are sent only when chosen, and a summary unless reasoning is off", async () => {
  const requests = captureFetch();
  await createLiveCall({
    apiKey: "test-key",
    sdp: "offer",
    voice: "cedar",
    instructions: "Talk",
    input: [],
    backend: backend({
      model: "gpt-4.1",
      reasoningEffort: "low",
      webSearch: true,
    }),
  });
  const responses = requests[0].session.delegation.responses;
  assert.equal(responses.model, "gpt-4.1");
  assert.deepEqual(responses.reasoning, { effort: "low", summary: "auto" });
  assert.deepEqual(responses.tools.at(-1), { type: "web_search" });

  await createLiveCall({
    apiKey: "test-key",
    sdp: "offer",
    voice: "cedar",
    instructions: "Talk",
    input: [],
    backend: backend({ reasoningEffort: "none" }),
  });
  assert.deepEqual(requests[1].session.delegation.responses.reasoning, {
    effort: "none",
  });
});

test("a provider refusal reaches the caller unchanged", async () => {
  mock.method(globalThis, "fetch", async () =>
    Response.json(
      { error: { message: "This project cannot access gpt-live-1" } },
      { status: 403 },
    ),
  );
  await assert.rejects(
    createLiveCall({
      apiKey: "test",
      sdp: "offer",
      voice: "marin",
      instructions: "Talk",
      input: [],
      backend: backend(),
    }),
    /This project cannot access gpt-live-1/,
  );
});

test("an effort the backend model refuses is dropped before the call, and asked about once", async () => {
  const asked: string[] = [];
  mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://api.openai.com/v1/responses/input_tokens");
    const body = JSON.parse(init.body as string);
    asked.push(`${body.model} ${body.reasoning.effort}`);
    return body.model === "gpt-4.1"
      ? Response.json(
          {
            error: {
              message:
                "Unsupported parameter: 'reasoning.effort' is not supported with this model.",
              param: "reasoning.effort",
              code: "unsupported_parameter",
            },
          },
          { status: 400 },
        )
      : Response.json({ input_tokens: 7 });
  });
  const check = (model: string, effort: string | null) =>
    acceptedEffort({ apiKey: "test", model, effort });

  assert.equal(await check("gpt-4.1", "low"), null);
  assert.equal(await check("gpt-4.1", "low"), null);
  assert.equal(await check("gpt-5.6-luna", "low"), "low");
  assert.equal(await check("gpt-5.6-luna", "low"), "low");
  assert.equal(await check("gpt-4.1", null), null);
  assert.deepEqual(asked, ["gpt-4.1 low", "gpt-5.6-luna low"]);
});

test("any other answer keeps the effort and is asked again next call", async () => {
  let asked = 0;
  mock.method(globalThis, "fetch", async () => {
    asked += 1;
    return asked === 1
      ? Response.json(
          { error: { message: "Incorrect API key provided", param: null } },
          { status: 401 },
        )
      : Promise.reject(new TypeError("fetch failed"));
  });
  const check = () =>
    acceptedEffort({ apiKey: "test", model: "gpt-5.6-sol", effort: "high" });

  assert.equal(await check(), "high");
  assert.equal(await check(), "high");
  assert.equal(asked, 2);
});

test("stored settings keep OpenAI choices and the shared instruction, drop a Grok voice, and recover field by field", async () => {
  const { LIVE_DEFAULTS, migrateLiveSettings } = await import(
    "../features/ai/live.schema.ts"
  );
  const openai = migrateLiveSettings({
    model: {
      provider: "openai",
      voice: "cedar",
      model: "gpt-live-1",
      backendModel: "gpt-5.6-sol",
    },
    systemPrompt: "Call me Sam.",
    captionView: "sides",
  });
  assert.equal(openai.voice, "cedar");
  assert.equal(openai.backendModel, "gpt-5.6-sol");
  assert.equal(openai.voicePrompt, "Call me Sam.");
  assert.equal(openai.backendPrompt, "Call me Sam.");
  assert.equal(openai.captionView, "sides");
  assert.equal(openai.reasoningEffort, LIVE_DEFAULTS.reasoningEffort);
  assert.equal(openai.webSearch, false);
  assert.equal("model" in openai, false);
  assert.equal("systemPrompt" in openai, false);

  const grok = migrateLiveSettings({
    model: { provider: "xai", voice: "Ara", model: "grok-voice" },
  });
  assert.equal(grok.voice, LIVE_DEFAULTS.voice);
  assert.equal(grok.backendModel, LIVE_DEFAULTS.backendModel);

  const broken = migrateLiveSettings({
    voice: 42,
    backendModel: "gpt-4.1",
    reasoningEffort: "extreme",
    webSearch: true,
  });
  assert.equal(broken.voice, LIVE_DEFAULTS.voice);
  assert.equal(broken.backendModel, "gpt-4.1");
  assert.equal(broken.reasoningEffort, LIVE_DEFAULTS.reasoningEffort);
  assert.equal(broken.webSearch, true);

  // A stored choice survives a change of default: auto stays auto
  assert.equal(
    migrateLiveSettings({ reasoningEffort: null }).reasoningEffort,
    null,
  );

  assert.deepEqual(migrateLiveSettings(null), LIVE_DEFAULTS);
});

test("both call prompts open as one Thursday: the voice gets the delegation policy and memory, earlier calls behind a developer note ending on her words, and an opening on every call", async () => {
  let profileFacts = 200;
  const botMock = mock.module("../features/bot/bot.query.ts", {
    namedExports: {
      listJobBots: async () => [
        { name: "Scout", description: "Finds things out on the web" },
      ],
    },
  });
  const skillsMock = mock.module("../features/skills/skills.discover.ts", {
    namedExports: {
      loadSkills: async () => [
        { name: "browser", description: "Any browser.", path: "/browser" },
      ],
    },
  });
  const connectedMock = mock.module("../features/ai/tools/connected.ts", {
    namedExports: {
      listConnectedToolNames: async () => [
        { server: "studio", name: "generate_image" },
        { server: "github", name: "create_issue" },
      ],
    },
  });
  const workspaceMock = mock.module("../features/workspace/workspace.ts", {
    namedExports: { openWorkspace: async () => ({ cwd: "/workspace" }) },
  });
  const memoryMock = mock.module("../features/memory/memory.query.ts", {
    namedExports: {
      listAlwaysLoaded: async () => [
        { id: 1, path: "profile", text: "Prefer brief replies." },
      ],
      readNotes: async () => ({
        notes: [
          {
            path: "profile",
            facts: Array.from({ length: profileFacts }, (_, index) => ({
              id: index + 1,
              text: index === 0 ? "Prefer brief replies." : `Fact ${index}`,
            })),
          },
        ],
      }),
      listNoteIndex: async () => [
        {
          path: "people/sam",
          description: "Their brother",
          aliases: ["Sam"],
          factCount: 2,
          lastSeenAt: new Date(),
        },
      ],
    },
  });
  const callMock = mock.module("../features/thursday/thursday.query.ts", {
    namedExports: {
      listRecentTurns: async () => [
        {
          callId: "c1",
          startedAt: new Date("2026-09-13T10:00:00Z"),
          turns: [
            { role: "user", tool: null, text: "Book the dentist.", seq: 1 },
            { role: "tool", tool: "delegate", text: '{"bot":"Scout"}', seq: 2 },
            { role: "assistant", tool: null, text: "Scout has it.", seq: 3 },
            // The call ended on the user's words: they must not reach the next call as a waiting turn
            { role: "user", tool: null, text: "Hang up.", seq: 4 },
            { role: "tool", tool: "end_call", text: "{}", seq: 5 },
          ],
        },
      ],
      readCallSkillsOn: async () => false,
    },
  });
  const threadMock = mock.module("../features/bot/thread.query.ts", {
    namedExports: { listCallJobs: async () => [] },
  });
  try {
    const { loadLivePrompt } = await import(
      "../features/ai/prompts/live.prompt.ts"
    );
    const { loadThursdayPrompt } = await import(
      "../features/ai/prompts/thursday.prompt.ts"
    );
    const on = await loadLivePrompt({
      voicePrompt: "Use a calm voice.",
      webSearch: false,
      locale: "ko-KR",
    });
    assert.match(on.text, /modeled on Friday, the AI in \*Iron Man\*/);
    assert.match(on.text, /Prefer brief replies/);
    assert.match(
      on.text,
      /\n\nBackchannel policy: Use moderate backchannels\. .*\n\nInterruption policy: Stop speaking when the user interrupts\. Listen to what they say\.\n\nDelegation policy:\nBackend tools:\n- Memory:/,
    );
    assert.match(on.text, /\nDelegate to the backend when:\n/);
    assert.match(on.text, /\nDo not delegate to the backend when:\n/);
    assert.match(on.text, /What bots can reach for: browser, images, github\./);
    assert.match(on.text, /- people\/sam — Their brother \(2\) "Sam"/);
    // The roster, threads and earlier calls are the backend's to read
    assert.equal(on.text.includes("Scout"), false);
    assert.equal(
      /thread|\bseen\b|## Earlier calls|works beside you/.test(on.text),
      false,
    );
    assert.equal(
      /ko-KR|browser's setting|language they use/.test(on.text),
      false,
    );
    assert.equal(on.text.includes("- Web:"), false);
    assert.equal(
      /memory_|end_call|generate_|load_skill|`/.test(on.text),
      false,
    );
    assert.equal(on.text.endsWith("Use a calm voice."), true);
    const [boundary, ...spoken] = on.input;
    assert.equal(boundary?.role, "developer");
    assert.match(
      boundary?.content[0].text ?? "",
      /from earlier calls.*treat none of them as a request now/,
    );

    // One Thursday: the backend opens with the voice's own words and is never told it is a part
    const backend = await loadThursdayPrompt(null);
    const withoutClock = (text: string) =>
      text.replace(/\*\*Now\*\*: [^\n]+/, "");
    const identity = on.text.slice(
      0,
      on.text.indexOf("\n\nBackchannel policy:"),
    );
    assert.equal(
      withoutClock(backend).startsWith(withoutClock(identity)),
      true,
    );
    for (const heading of [
      "## Voice conversation context",
      "## Memory",
      "## Background work",
      "## This computer",
      "## Return the result",
      "## Earlier calls",
    ])
      assert.equal(backend.includes(`\n${heading}\n`), true, heading);
    assert.equal(/backend of Thursday|voice model/.test(backend), false);

    assert.deepEqual(spoken, [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Book the dentist." }],
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Scout has it." }],
      },
    ]);
    assert.match(on.opening, /The call has just started/);

    const searching = await loadLivePrompt({
      voicePrompt: "",
      webSearch: true,
      locale: null,
    });
    assert.equal(searching.input.length, 3);
    assert.match(searching.text, /- Web: look things up\./);
    assert.match(searching.opening, /The call has just started/);

    profileFacts = 0;
    const first = await loadLivePrompt({ webSearch: false, locale: "ko-KR" });
    assert.match(first.text, /## First call/);
    // The one call that opens with nothing: she says who she is, then learns who they are
    assert.match(first.opening ?? "", /say who you are/);
    assert.match(first.opening ?? "", /ask what to call them/);
    assert.match(first.opening ?? "", /ko-KR/);
    assert.match(first.text, /what they do, how old they are, where they live/);
  } finally {
    memoryMock.restore();
    callMock.restore();
    botMock.restore();
    skillsMock.restore();
    connectedMock.restore();
    workspaceMock.restore();
    threadMock.restore();
  }
});
