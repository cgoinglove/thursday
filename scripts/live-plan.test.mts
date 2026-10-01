import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, mock, type TestContext, test } from "node:test";
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
const { TEXT_CALL } = await import("../config.ts");
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

test("a picture put down before a hand-over is in her next step before the hand-over, as the user's, with its path, after the fact that names it", async () => {
  const line = await openLine("call-picture");
  steps.push(() => [{ type: "text", text: "A lighthouse at sunset." }]);
  // What the page sends as the file lands: the fact for the backend, then the picture itself
  tellPlanLine("call-picture", [
    {
      type: "response.item.create",
      item: {
        type: "message",
        role: "developer",
        content: [
          {
            type: "input_text",
            text: "The user put a file down on screen, kept on this computer at inbox/photo.png.",
          },
        ],
      },
    },
    {
      type: "response.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "inbox/photo.png, as an image:" },
          {
            type: "input_image",
            image_url: "data:image/png;base64,iVBORw0KGgo=",
          },
        ],
      },
    },
  ]);
  wire.hear({
    type: "delegation.created",
    item: {
      type: "delegation",
      target: "client",
      id: "del_picture",
      content: [{ type: "input_text", text: "What is in the picture?" }],
    },
  });
  await line.next("response.completed");
  const prompt = prompts.at(-1) ?? "";
  const handed = prompt.indexOf("What is in the picture?");
  const fact = prompt.indexOf("put a file down on screen");
  const named = prompt.indexOf("inbox/photo.png, as an image:");
  const picture = prompt.indexOf('"type":"file"', named);
  // Put down before the voice handed over, so read before its words: after them, a picture
  // put down a while ago read as sent with the words
  assert.ok(fact >= 0 && fact < named, "the fact, then the picture it names");
  assert.ok(picture > named, "the picture itself, after its path");
  assert.ok(picture < handed, "what was put down, then the hand-over");
  assert.match(prompt.slice(picture), /image\/png/);
  for (let waited = 0; waited < 2_000 && !wire.said.length; waited += 5)
    await new Promise((settle) => setTimeout(settle, 5));
  assert.deepEqual(wire.said.at(-1), {
    text: "A lighthouse at sunset.",
    channel: "speakable",
    delegation: "del_picture",
  });
  line.leave.abort();
});

test("a run the page asks for with no call out runs her backend on what it put down, and what she makes of it goes into the voice to say", async () => {
  const line = await openLine("call-shown");
  steps.push(() => [{ type: "text", text: "A cat, drawn in red." }]);
  const before = wire.said.length;
  tellPlanLine("call-shown", [
    {
      type: "response.item.create",
      item: {
        type: "message",
        role: "developer",
        content: [
          {
            type: "input_text",
            text: "The user drew a picture on screen and showed it to you, kept on this computer at inbox/drawing.png.",
          },
        ],
      },
    },
    {
      type: "response.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "inbox/drawing.png, as an image:" },
          {
            type: "input_image",
            image_url: "data:image/png;base64,iVBORw0KGgo=",
          },
        ],
      },
    },
    { type: "response.create" },
  ]);
  // The page hears it as any response of her backend's, bound to no hand-over
  const created = await line.next("response.created");
  assert.equal(created.delegation_id, null);
  await line.next("response.completed");
  const prompt = prompts.at(-1) ?? "";
  assert.ok(
    prompt.indexOf("showed it to you") <
      prompt.indexOf("inbox/drawing.png, as an image:"),
    "the fact, then the picture",
  );
  assert.doesNotMatch(prompt, /<realtime_delegation>/);
  for (
    let waited = 0;
    waited < 2_000 && wire.said.length === before;
    waited += 5
  )
    await new Promise((settle) => setTimeout(settle, 5));
  assert.deepEqual(wire.said.slice(before), [
    { text: "A cat, drawn in red.", channel: "speakable" },
  ]);
  assert.equal(steps.length, 0);
  line.leave.abort();
});

/** What the page sends as a drawing is shown: the fact for her backend, then the picture. */
const shown = (path: string) => [
  {
    type: "response.item.create",
    item: {
      type: "message",
      role: "developer",
      content: [
        {
          type: "input_text",
          text: `The user drew a picture on screen and showed it to you, kept on this computer at ${path}.`,
        },
      ],
    },
  },
  {
    type: "response.item.create",
    item: {
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: `${path}, as an image:` },
        {
          type: "input_image",
          image_url: "data:image/png;base64,iVBORw0KGgo=",
        },
      ],
    },
  },
];

/** Until the voice has been given `count` things, or two seconds. */
async function saidBy(count: number) {
  for (let waited = 0; waited < 2_000 && wire.said.length < count; waited += 5)
    await new Promise((settle) => setTimeout(settle, 5));
}

test("a run carries what was said as the drawing was shown, and one whose drawing a hand-over already took runs nothing", async () => {
  const line = await openLine("call-said");
  const before = wire.said.length;
  steps.push(() => [{ type: "text", text: "It is busy, yes." }]);
  wire.hear({
    type: "turn.done",
    turn: { role: "user", transcript: "Is this logo too busy?" },
  });
  tellPlanLine("call-said", [
    ...shown("inbox/logo.png"),
    { type: "response.create" },
  ]);
  await saidBy(before + 1);
  const prompt = prompts.at(-1) ?? "";
  const said = prompt.indexOf("Is this logo too busy?");
  assert.ok(said >= 0, "what was said goes in with the run");
  assert.ok(said < prompt.indexOf("inbox/logo.png, as an image:"));
  // The voice hands over as the next drawing is shown: the hand-over takes it, and the run the
  // page asked for after it finds nothing left to answer
  steps.push(() => [{ type: "text", text: "A second logo, simpler." }]);
  tellPlanLine("call-said", shown("inbox/logo-2.png"));
  wire.hear({
    type: "delegation.created",
    item: {
      type: "delegation",
      target: "client",
      id: "del_said",
      content: [{ type: "input_text", text: "And this one?" }],
    },
  });
  tellPlanLine("call-said", [{ type: "response.create" }]);
  await saidBy(before + 2);
  await new Promise((settle) => setTimeout(settle, 50));
  assert.deepEqual(wire.said.slice(before), [
    { text: "It is busy, yes.", channel: "speakable" },
    {
      text: "A second logo, simpler.",
      channel: "speakable",
      delegation: "del_said",
    },
  ]);
  assert.equal(steps.length, 0);
  line.leave.abort();
});

test("a run asked while her calls are out, before their outputs, is not taken for going on, and what was put down goes in after their results", async () => {
  const line = await openLine("call-out");
  const before = wire.said.length;
  steps.push(
    () => [
      {
        type: "tool-call",
        toolCallId: "call_out",
        toolName: TOOL_NAMES.thread_status,
        input: JSON.stringify({ thread: "all" }),
      },
    ],
    () => [{ type: "text", text: "Nothing runs, and a nice drawing." }],
  );
  wire.hear({
    type: "delegation.created",
    item: {
      type: "delegation",
      target: "client",
      id: "del_out",
      content: [{ type: "input_text", text: "Is anything running?" }],
    },
  });
  await line.next("response.completed");
  const asked = prompts.length;
  // From a page that had not heard of the step: a run, not the step going on
  tellPlanLine("call-out", [
    ...shown("inbox/drawing.png"),
    { type: "response.create" },
  ]);
  await new Promise((settle) => setTimeout(settle, 50));
  assert.equal(prompts.length, asked, "nothing went on before the outputs");
  tellPlanLine("call-out", [
    {
      type: "response.item.create",
      item: {
        type: "function_call_output",
        call_id: "call_out",
        output: "No jobs.",
      },
    },
    { type: "response.create" },
  ]);
  await saidBy(before + 1);
  const prompt = prompts.at(-1) ?? "";
  const result = prompt.indexOf("No jobs.");
  const fact = prompt.indexOf("showed it to you");
  const named = prompt.indexOf("inbox/drawing.png, as an image:");
  assert.ok(result >= 0 && result < fact, "the call's result, then the fact");
  assert.ok(fact < named, "the fact, then the picture");
  await new Promise((settle) => setTimeout(settle, 50));
  assert.deepEqual(wire.said.slice(before), [
    {
      text: "Nothing runs, and a nice drawing.",
      channel: "speakable",
      delegation: "del_out",
    },
  ]);
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

/** The calls the page was handed, by id, as the events of her backend's responses word them. */
const handedCalls = (events: WireEvent[]) =>
  events.flatMap((event) => {
    const nested = event.event as WireEvent | undefined;
    const item = nested?.item as WireEvent | undefined;
    return event.type === "response.event" &&
      nested?.type === "response.output_item.done" &&
      item?.type === "function_call"
      ? [String(item.call_id)]
      : [];
  });

/** What a request to her backend carried as the result of a call, as the model is handed it. */
const resultsOf = (prompt: string, callId: string) =>
  (
    JSON.parse(prompt) as {
      role: string;
      content: {
        type: string;
        toolCallId?: string;
        output?: { type: string };
      }[];
    }[]
  )
    .filter((message) => message.role === "tool")
    .flatMap((message) => message.content)
    .filter(
      (part) => part.type === "tool-result" && part.toolCallId === callId,
    );

/** A hand-over of the voice, as the wire carries it. */
const handOver = (id: string, text: string) =>
  wire.hear({
    type: "delegation.created",
    item: {
      type: "delegation",
      target: "client",
      id,
      content: [{ type: "input_text", text }],
    },
  });

/**
 * A line the test leaves when it ends, however it ends, dropping the steps it did not run: a
 * failed check then fails that test, where a line left open keeps the whole run from ending.
 */
async function openLineFor(t: TestContext, callId: string) {
  const line = await openLine(callId);
  t.after(() => {
    steps.splice(0);
    line.leave.abort();
  });
  return line;
}

test("a call to a tool she lacks is not handed to the page: the error the sdk answered it with is its one result, and she goes on to answer", async (t) => {
  const line = await openLineFor(t, "call-lacks");
  const before = wire.said.length;
  const asked = prompts.length;
  steps.push(
    () => [
      {
        type: "tool-call",
        toolCallId: "call_lacks",
        toolName: "no_such_tool",
        input: JSON.stringify({}),
      },
    ],
    () => [{ type: "text", text: "I have no way to do that." }],
  );
  handOver("del_lacks", "Do the thing");
  await saidBy(before + 1);
  await new Promise((settle) => setTimeout(settle, 50));

  // Her second step was sent the error for it as its one result: the page never ran the call
  assert.equal(prompts.length, asked + 2);
  const results = resultsOf(prompts.at(-1) ?? "", "call_lacks");
  assert.equal(results.length, 1, "one result for one call");
  assert.match(results[0]?.output?.type ?? "", /^error/);
  assert.deepEqual(handedCalls(line.events), []);
  // The page still hears her first step end, so it is not left waiting on a response
  assert.deepEqual(
    line.events
      .filter((event) => event.type === "response.event")
      .map((event) => (event.event as WireEvent).type),
    [
      "response.created",
      "response.completed",
      "response.created",
      "response.completed",
    ],
  );
  assert.deepEqual(wire.said.slice(before), [
    {
      text: "I have no way to do that.",
      channel: "speakable",
      delegation: "del_lacks",
    },
  ]);
  assert.equal(steps.length, 0);
});

test("a known tool called with input that does not fit it is answered the same way, and the call she makes next goes to the page", async (t) => {
  const line = await openLineFor(t, "call-misfit");
  const before = wire.said.length;
  const asked = prompts.length;
  steps.push(
    () => [
      {
        type: "tool-call",
        toolCallId: "call_misfit",
        toolName: TOOL_NAMES.thread_status,
        input: JSON.stringify({}),
      },
    ],
    () => [
      {
        type: "tool-call",
        toolCallId: "call_fixed",
        toolName: TOOL_NAMES.thread_status,
        input: JSON.stringify({ thread: "all" }),
      },
    ],
    () => [{ type: "text", text: "Nothing is running." }],
  );
  handOver("del_misfit", "Is anything running?");
  const call = await line.next(
    "response.output_item.done",
    (event) => (event.item as WireEvent).type === "function_call",
  );
  const step = call.event as WireEvent;
  assert.equal((step.item as WireEvent).call_id, "call_fixed");
  await line.next(
    "response.completed",
    (event) => (event.response as { id: string }).id === step.response_id,
  );
  tellPlanLine("call-misfit", [
    {
      type: "response.item.create",
      item: {
        type: "function_call_output",
        call_id: "call_fixed",
        output: "No jobs.",
      },
    },
    { type: "response.create" },
  ]);
  await saidBy(before + 1);

  // Each call has one result: the sdk's error for the first, the page's output for the second
  assert.equal(prompts.length, asked + 3);
  const prompt = prompts.at(-1) ?? "";
  assert.equal(resultsOf(prompt, "call_misfit").length, 1);
  assert.match(
    resultsOf(prompt, "call_misfit")[0]?.output?.type ?? "",
    /^error/,
  );
  assert.equal(resultsOf(prompt, "call_fixed").length, 1);
  assert.match(prompt, /No jobs\./);
  assert.deepEqual(handedCalls(line.events), ["call_fixed"]);
  assert.deepEqual(wire.said.slice(before), [
    {
      text: "Nothing is running.",
      channel: "speakable",
      delegation: "del_misfit",
    },
  ]);
  assert.equal(steps.length, 0);
});

test("of one step's calls the page is handed those the sdk could take, and going on waits for their outputs alone", async (t) => {
  const line = await openLineFor(t, "call-both");
  const before = wire.said.length;
  steps.push(
    () => [
      {
        type: "tool-call",
        toolCallId: "call_gone",
        toolName: "no_such_tool",
        input: JSON.stringify({}),
      },
      {
        type: "tool-call",
        toolCallId: "call_kept",
        toolName: TOOL_NAMES.thread_status,
        input: JSON.stringify({ thread: "all" }),
      },
    ],
    () => [{ type: "text", text: "Nothing is running." }],
  );
  handOver("del_both", "Is anything running?");
  await line.next("response.completed");
  assert.deepEqual(handedCalls(line.events), ["call_kept"]);
  // Were the call the sdk answered counted among those the page runs, going on would wait for its output for good
  tellPlanLine("call-both", [
    {
      type: "response.item.create",
      item: {
        type: "function_call_output",
        call_id: "call_kept",
        output: "No jobs.",
      },
    },
    { type: "response.create" },
  ]);
  await saidBy(before + 1);
  const prompt = prompts.at(-1) ?? "";
  assert.equal(resultsOf(prompt, "call_gone").length, 1);
  assert.equal(resultsOf(prompt, "call_kept").length, 1);
  assert.deepEqual(wire.said.slice(before), [
    {
      text: "Nothing is running.",
      channel: "speakable",
      delegation: "del_both",
    },
  ]);
  assert.equal(steps.length, 0);
});

test("a drawing shown while her call is answered by the sdk is in her next step, after that answer", async (t) => {
  await openLineFor(t, "call-given");
  const before = wire.said.length;
  steps.push(
    () => {
      // Shown as her step runs, before it ends
      tellPlanLine("call-given", shown("inbox/drawing.png"));
      return [
        {
          type: "tool-call",
          toolCallId: "call_given",
          toolName: "no_such_tool",
          input: JSON.stringify({}),
        },
      ];
    },
    () => [{ type: "text", text: "A nice drawing." }],
  );
  handOver("del_given", "Do the thing");
  await saidBy(before + 1);
  const prompt = prompts.at(-1) ?? "";
  const result = prompt.indexOf("tool-result");
  const fact = prompt.indexOf("showed it to you");
  const named = prompt.indexOf("inbox/drawing.png, as an image:");
  assert.ok(result >= 0 && result < fact, "her call's answer, then the fact");
  assert.ok(fact < named, "the fact, then the picture");
  assert.deepEqual(wire.said.slice(before), [
    {
      text: "A nice drawing.",
      channel: "speakable",
      delegation: "del_given",
    },
  ]);
  assert.equal(steps.length, 0);
});

test("a backend that keeps calling what she lacks stops at the steps one answer may take, and the voice is told it failed", async (t) => {
  const line = await openLineFor(t, "call-endless");
  const asked = prompts.length;
  for (let call = 0; call <= TEXT_CALL.maxSteps; call += 1)
    steps.push(() => [
      {
        type: "tool-call",
        toolCallId: `call_endless_${call}`,
        toolName: "no_such_tool",
        input: JSON.stringify({}),
      },
    ]);
  handOver("del_endless", "Do the thing");
  for (
    let waited = 0;
    waited < 2_000 && prompts.length < asked + TEXT_CALL.maxSteps;
    waited += 5
  )
    await new Promise((settle) => setTimeout(settle, 5));
  await new Promise((settle) => setTimeout(settle, 50));
  assert.equal(prompts.length, asked + TEXT_CALL.maxSteps);
  assert.equal(steps.length, 1, "the step past the bound never ran");
  assert.deepEqual(handedCalls(line.events), []);
  // Out of steps with no answer, the hand-over is answered with that, not left waiting
  for (let waited = 0; waited < 2_000 && !wire.said.length; waited += 5)
    await new Promise((settle) => setTimeout(settle, 5));
  assert.equal(wire.said.length, 1);
  assert.equal(wire.said[0]?.delegation, "del_endless");
  assert.match(wire.said[0]?.text ?? "", /^That failed: it ran out of steps/);
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

test("a plan changed after sign-in is kept from the usage read, so calls follow the plan the badge shows", async () => {
  const { isCallable, writeConfig, removeConfig } = await import(
    "../features/config/config.query.ts"
  );
  const key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "";
  await writeConfig(
    "CHATGPT_SIGN_IN",
    JSON.stringify({
      access: "a",
      refresh: "r",
      expires: Date.now() + 3_600_000,
      accountId: "acct",
      plan: "free",
    }),
  );
  let planType = "plus";
  const fetching = mock.method(globalThis, "fetch", async () =>
    Response.json({
      plan_type: planType,
      rate_limit: {
        primary_window: { used_percent: 12, reset_after_seconds: 60 },
      },
    }),
  );
  try {
    assert.equal(await isCallable(), false);
    // Upgraded to Plus after signing in: the token still says Free, the usage read does not
    const usage = await realChatgpt.readChatGptUsage();
    assert.equal(usage && "plan" in usage ? usage.plan : null, "plus");
    assert.equal(await realChatgpt.readChatGptPlan(), "plus");
    assert.equal(await isCallable(), true);
    // The same plan again writes nothing; moved back to Free, it is kept as that
    await realChatgpt.readChatGptUsage();
    planType = "free";
    await realChatgpt.readChatGptUsage();
    assert.equal(await realChatgpt.readChatGptPlan(), "free");
    assert.equal(await isCallable(), false);

    // A sign-in given in the environment wins over the row: nothing is written for it
    process.env.CHATGPT_SIGN_IN = JSON.stringify({
      access: "a",
      refresh: "r",
      expires: Date.now() + 3_600_000,
      accountId: "acct",
      plan: "free",
    });
    planType = "pro";
    await realChatgpt.readChatGptUsage();
    delete process.env.CHATGPT_SIGN_IN;
    assert.equal(await realChatgpt.readChatGptPlan(), "free");
  } finally {
    fetching.mock.restore();
    delete process.env.CHATGPT_SIGN_IN;
    await removeConfig("CHATGPT_SIGN_IN");
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

test("a join the voice's side refuses says why, from the close that follows the error", async () => {
  const { isPublicError } = await import("../lib/public-error.ts");
  const fired: ((type: string, data?: Record<string, unknown>) => void)[] = [];
  const Real = globalThis.WebSocket;
  class Refused {
    static OPEN = 1;
    readyState = 0;
    listeners = new Map<string, ((event: Record<string, unknown>) => void)[]>();
    constructor() {
      fired.push((type, data = {}) => {
        for (const listener of this.listeners.get(type) ?? []) listener(data);
      });
    }
    addEventListener(
      type: string,
      listener: (event: Record<string, unknown>) => void,
    ) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    send() {}
    close() {}
  }
  globalThis.WebSocket = Refused as unknown as typeof WebSocket;
  try {
    const joining = realPlan.joinPlanLine({
      callId: "rtc_refused",
      headers: {},
      on: { event() {}, closed() {} },
    });
    const fire = fired.at(-1);
    assert.ok(fire);
    // The error comes first and says nothing; the close behind it carries the reason
    fire("error");
    fire("close", { code: 1008, reason: "Instructions too long" });
    await assert.rejects(joining, (error: unknown) => {
      assert.ok(
        isPublicError(error),
        "the page is told the reason, not masked",
      );
      assert.match(
        (error as Error).message,
        /refused its line \(1008: Instructions too long\)/,
      );
      return true;
    });
  } finally {
    globalThis.WebSocket = Real;
  }
});
