import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, mock, test } from "node:test";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

// The real runner, DB, tools and prompts run against an empty temporary home.
const home = await mkdtemp(join(tmpdir(), "thursday-context-"));
process.env.THURSDAY_HOME = home;
process.env.THURSDAY_SKIP_BROWSER = "1";
process.env.THURSDAY_TOOL_PATH = join(home, "tools");
process.env.PATH = `${join(home, "tools")}:${process.env.PATH}`;
await mkdir(join(home, "tools"));
const browserCli = join(home, "tools", "playwright-cli");
await writeFile(
  browserCli,
  `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const root = process.env.THURSDAY_HOME;
if (process.argv[2] === "list") {
  const fixture = path.join(root, "browsers.json");
  console.log(fs.existsSync(fixture) ? fs.readFileSync(fixture, "utf8") : '{"browsers":[]}');
} else if (process.argv[2] === "close") {
  fs.appendFileSync(path.join(root, "closed.txt"), process.env.PLAYWRIGHT_CLI_SESSION + "\\n");
}
`,
);
await chmod(browserCli, 0o755);
const realModel = await import("../features/ai/model.ts");
const plans = new Map<string, ((prompt: string) => unknown[])[]>();
const replies = new Map<string, ((prompt: string) => string)[]>();
const inputs = new Map<string, string[]>();
const failures: unknown[] = [];
let nextId = 0;
const usage = {
  inputTokens: {
    total: 100,
    noCache: 100,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};
const models = new Map(
  ["Alpha", "Beta", "Gamma"].map((name) => [
    name,
    new MockLanguageModelV4({
      modelId: name,
      doStream: async ({ prompt }) => {
        const text = JSON.stringify(prompt);
        inputs.set(name, [...(inputs.get(name) ?? []), text]);
        const plan = plans.get(name)?.shift();
        assert.ok(plan, `Unexpected ${name} step`);
        let chunks: unknown[];
        try {
          chunks = plan(text);
        } catch (error) {
          failures.push(error);
          throw error;
        }
        return {
          stream: simulateReadableStream({
            initialDelayInMs: null,
            chunkDelayInMs: null,
            chunks: [
              ...chunks,
              {
                type: "finish",
                finishReason: {
                  unified: chunks.some((part: any) => part.type === "tool-call")
                    ? "tool-calls"
                    : "stop",
                  raw: undefined,
                },
                usage,
              },
            ] as any[],
          }),
        };
      },
      doGenerate: async ({ prompt }) => {
        const reply = replies.get(name)?.shift();
        assert.ok(reply, `Unexpected ${name} question or compaction`);
        let answer: string;
        try {
          answer = reply(JSON.stringify(prompt));
        } catch (error) {
          failures.push(error);
          throw error;
        }
        return {
          content: [{ type: "text", text: answer }],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        };
      },
    }),
  ]),
);
mock.module("../features/ai/model.ts", {
  namedExports: {
    ...realModel,
    getTextModel: async (ref: { model: string }) => ({
      ref,
      model: models.get(ref.model),
      searchTools: null,
    }),
    compactBudget: async () => 8000,
  },
});
mock.module("../lib/desktop-notify.ts", {
  namedExports: { desktopNotify: async () => {} },
});
const { database } = await import("../database/db.ts");
const { migrateDatabase } = await import("../database/migrate.ts");
const { botTable, threadMessageTable } = await import("../database/tables.ts");
const { startThread, answerThread, cancelThread } = await import(
  "../features/bot/bot.runner.ts"
);
const { findThread, findThreadView, upsertMessage, lastSeq } = await import(
  "../features/bot/thread.query.ts"
);
const { resumeTranscript } = await import("../features/bot/bot.run.ts");
const { botBrowserSession } = await import(
  "../features/workspace/workspace.ts"
);
const { TOOL_NAMES: T } = await import("../features/ai/tools/tool-name.ts");
const {
  listRoomWork,
  listParticipantTranscript,
  listRoomRelays,
  pauseRoom,
  ensureRoom,
  sendRoomMessage,
} = await import("../features/bot/room.query.ts");
const { presence } = await import("../app/api/events/app-event.server.ts");
const { eq } = await import("drizzle-orm");
await migrateDatabase();
Object.defineProperty(presence, "watching", { get: () => true });
for (const name of models.keys())
  await database.insert(botTable).values({
    name,
    description: `${name} test worker`,
    provider: "openai",
    model: name,
  });

const call = (name: string, input: unknown) => [
  {
    type: "tool-call",
    toolCallId: `test-${++nextId}`,
    toolName: name,
    input: JSON.stringify(input),
  },
];
const text = (value: string) => [
  { type: "text-start", id: "text" },
  { type: "text-delta", id: "text", delta: value },
  { type: "text-end", id: "text" },
];
const ask = (bot: string, request: string) =>
  call(T.send_message, {
    to: bot,
    text: request,
    kind: bot === "Thursday" ? "question" : "message",
  });
const waitFor = async (id: string, status: string) => {
  const until = Date.now() + 20_000;
  while (Date.now() < until) {
    const thread = await findThread(id);
    if (thread?.status === status) return thread;
    if (thread?.status === "failed")
      assert.fail(thread.outcome ?? "Thread failed");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Thread did not become ${status}`);
};
const rowsOf = (id: string) =>
  database
    .select()
    .from(threadMessageTable)
    .where(eq(threadMessageTable.threadId, id))
    .orderBy(threadMessageTable.seq);
afterEach(() => {
  assert.deepEqual(failures.splice(0), []);
});
after(async () => {
  await rm(home, { recursive: true, force: true });
});

test("thread overview keeps old open work and the inbox retains unread endings", async () => {
  const {
    insertThread,
    deleteThread,
    listThreadOverview,
    listInboxThreads,
    markSeen,
  } = await import("../features/bot/thread.query.ts");
  const { threadTable } = await import("../database/tables.ts");
  const { loadTools } = await import("../features/ai/load-tools.ts");
  const { needsThreadReply } = await import("../features/bot/bot.schema.ts");
  const ids: string[] = [];
  try {
    for (let index = 0; index < 14; index++) {
      const thread = await insertThread({
        bot: "Alpha",
        label: `Overview ${index}`,
        request: "Overview fixture",
        opening: "Overview fixture",
      });
      ids.push(thread.id);
      await database
        .update(threadTable)
        .set({
          status:
            index === 0
              ? "running"
              : index === 1
                ? "waiting"
                : index === 2
                  ? "failed"
                  : "done",
          seen: false,
          outcome: index > 1 ? `Result ${index}` : null,
          updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
        })
        .where(eq(threadTable.id, thread.id));
    }
    const overview = await listThreadOverview();
    assert.equal(overview.length, 10);
    assert.deepEqual(
      overview.map((thread) => thread.id),
      [ids[1], ids[0], ...ids.slice(6).reverse()],
    );
    const tools = await loadTools({ target: "thursday" });
    const result = (await tools[T.thread].execute!(
      { action: "status", thread: null },
      { toolCallId: "overview", messages: [], context: {} },
    )) as { threads: { id: string; status: string }[] };
    assert.deepEqual(
      result.threads.map((thread) => thread.id),
      overview.map((thread) => thread.id),
    );
    const inbox = await listInboxThreads();
    assert.equal(inbox.length, 14);
    assert.ok(
      inbox.some(
        (thread) => thread.id === ids[2] && thread.status === "failed",
      ),
    );
    await markSeen([ids[2]]);
    assert.ok(
      !(await listInboxThreads()).some((thread) => thread.id === ids[2]),
    );
    assert.ok(
      needsThreadReply({
        status: "running",
        room: {
          participants: [],
          questions: [{ id: "question", bot: "Beta", text: "Which address?" }],
          deliveries: [],
          relays: [],
        },
      }),
    );
    assert.equal(needsThreadReply({ status: "running" }), false);
  } finally {
    for (const id of ids) await deleteThread(id);
  }
});

test("natural turns send asynchronously and retain participant histories", async () => {
  plans.set("Alpha", [
    () =>
      call(T.bash, {
        command: "printf ALPHA_PRIVATE",
        description: "Read a private value.",
      }),
    () => ask("Beta", "Find the shared result"),
    () => text("I can work while Beta works."),
    (prompt) => {
      assert.ok(prompt.includes("BETA_SHARED"));
      assert.ok(!prompt.includes("BETA_PRIVATE"));
      return text("Final report");
    },
  ]);
  plans.set("Beta", [
    () =>
      call(T.bash, {
        command: "sleep 0.1; printf BETA_PRIVATE",
        description: "Read Beta's private value.",
      }),
    () => text("BETA_SHARED"),
  ]);
  const id = await startThread({
    bot: "Alpha",
    request: "Work together",
    label: "Room",
    from: "user",
  });
  await waitFor(id, "done");
  assert.equal((await findThread(id))?.outcome, "Final report");
  assert.equal(
    (await listRoomWork(id)).filter((row) => row.bot === "Beta").length,
    1,
  );
  assert.equal(inputs.get("Beta")?.length, 2);
  const own = JSON.stringify(await listParticipantTranscript(id, "Beta"));
  assert.ok(own.includes("BETA_PRIVATE"));
  assert.ok(!own.includes("ALPHA_PRIVATE"));
  assert.ok(
    !(await rowsOf(id)).some((row) =>
      JSON.stringify(row.content).includes('"toolName":"answer"'),
    ),
  );
  plans.set("Alpha", [
    () => ask("Beta", "Follow up"),
    () => text("Waiting for the follow-up."),
    () => text("Follow-up report"),
  ]);
  plans.set("Beta", [
    (prompt) => {
      assert.ok(prompt.includes("BETA_PRIVATE"));
      return text("Follow-up findings");
    },
  ]);
  await answerThread(id, "Continue the work");
  await waitFor(id, "done");
  assert.equal((await findThread(id))?.outcome, "Follow-up report");
});

test("a waiting participant answers a side question without an alternate model invocation", async () => {
  plans.set("Alpha", [
    () => ask("Beta", "Research"),
    () => text("Waiting."),
    (prompt) => {
      assert.ok(prompt.includes("Which format"));
      return text("Use a table.");
    },
    (prompt) => {
      assert.ok(prompt.includes("Research complete"));
      return text("Combined report");
    },
  ]);
  plans.set("Beta", [
    () => ask("Alpha", "Which format?"),
    () => text("Waiting for the format."),
    (prompt) => {
      assert.ok(prompt.includes("Use a table."));
      return text("Research complete");
    },
  ]);
  const id = await startThread({
    bot: "Alpha",
    request: "Choose the format and research",
    label: "Question",
    from: "user",
  });
  await waitFor(id, "done");
  assert.equal((await findThread(id))?.outcome, "Combined report");
  assert.equal((await listRoomWork(id)).length, 3);
});

test("silent turns remain resumable without a forced answer or retry loop", async () => {
  plans.set("Alpha", [() => []]);
  const id = await startThread({
    bot: "Alpha",
    request: "Wait quietly",
    label: "Quiet",
    from: "user",
  });
  await waitFor(id, "waiting");
  assert.match((await findThread(id))?.outcome ?? "", /idle/);
  plans.set("Alpha", [() => text("Resumed normally")]);
  await answerThread(id, "Continue");
  await waitFor(id, "done");
});

test("a question pauses the bot that asked, and words to that bot answer it", async () => {
  plans.set("Alpha", [
    () => ask("Beta", "Prepare the work"),
    () => text("Waiting for Beta."),
    () => text("Ready report"),
  ]);
  plans.set("Beta", [
    () =>
      call(T.send_message, {
        to: "Thursday",
        text: "Choose a destination.",
        kind: "question",
        options: ["Destination one", "Destination two"],
      }),
    (prompt) => {
      assert.ok(prompt.includes("Destination one"));
      assert.ok(prompt.includes("answers your question to the user"));
      return text("Prepared");
    },
  ]);
  const betaCalls = inputs.get("Beta")?.length ?? 0;
  const id = await startThread({
    bot: "Alpha",
    request: "Prepare",
    label: "User input",
    from: "user",
  });
  const stopped = await waitFor(id, "waiting");
  assert.equal(stopped.pending?.bot, "Beta");
  // The question ended Beta's turn: no second step before the answer
  assert.equal((inputs.get("Beta")?.length ?? 0) - betaCalls, 1);
  assert.deepEqual((await findThreadView(id))?.room?.questions[0].options, [
    "Destination one",
    "Destination two",
  ]);
  // A spoken answer names the bot, not the question
  const told = await answerThread(id, "Destination one", "thursday", "Beta");
  assert.equal(told?.answered?.bot, "Beta");
  await waitFor(id, "done");
  assert.equal((await findThread(id))?.outcome, "Ready report");
});

test("resume repairs only missing local tool results and preserves real ones", () => {
  const transcript: any[] = [
    {
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: "one", toolName: T.bash, input: {} },
        { type: "tool-call", toolCallId: "two", toolName: T.bash, input: {} },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "one",
          toolName: T.bash,
          output: { type: "text", value: "Recorded result" },
        },
      ],
    },
  ];
  const restored = resumeTranscript(transcript);
  const output = JSON.stringify(restored);
  assert.equal(output.match(/Recorded result/g)?.length, 1);
  assert.equal(output.match(/No result:/g)?.length, 1);
  assert.deepEqual(resumeTranscript(restored), restored);
});

test("same-bot requests serialize and committed sends deduplicate", async () => {
  const { insertThread } = await import("../features/bot/thread.query.ts");
  const { claimRoomWork, finishRoomWork, cancelRoom, consumeRoomInbox } =
    await import("../features/bot/room.query.ts");
  const thread = await insertThread({
    bot: "Alpha",
    request: "Queue",
    label: "Queue",
    opening: "Queue",
  });
  await ensureRoom(thread.id);
  const root = (await claimRoomWork(thread.id))!;
  const receipt = await sendRoomMessage(root, {
    id: "same-send",
    to: "Beta",
    text: "One",
  });
  assert.deepEqual(
    await sendRoomMessage(root, { id: "same-send", to: "Beta", text: "One" }),
    receipt,
  );
  await sendRoomMessage(root, { id: "second-send", to: "Beta", text: "Two" });
  const beta = (await claimRoomWork(thread.id))!;
  assert.equal(beta.bot, "Beta");
  assert.equal(await claimRoomWork(thread.id), null);
  await consumeRoomInbox(beta);
  await finishRoomWork(beta, "First result");
  const second = (await claimRoomWork(thread.id))!;
  assert.equal(second.bot, "Beta");
  assert.notEqual(beta.id, second.id);
  await cancelRoom(thread.id);
  await assert.rejects(
    sendRoomMessage(root, { id: "stale", to: "Gamma", text: "Too late" }),
    /no longer running/,
  );
  assert.equal((await listRoomWork(thread.id)).length, 3);
});

test("Step in is durable and reaches a running B before its next step", async () => {
  plans.set("Alpha", [
    () => ask("Beta", "Work for me"),
    () => text("Waiting."),
    () => text("Owner report"),
  ]);
  plans.set("Beta", [
    () =>
      call(T.bash, {
        command: "sleep 0.2; printf BEFORE_INTERJECTION",
        description: "Do current work.",
      }),
    (prompt) => {
      assert.ok(prompt.includes("Use the revised destination"));
      return text("Revised work");
    },
  ]);
  const id = await startThread({
    bot: "Alpha",
    request: "Work",
    label: "Step in",
    from: "user",
  });
  const until = Date.now() + 2000;
  while (
    !(await rowsOf(id)).some((row) =>
      JSON.stringify(row.content).includes("BEFORE_INTERJECTION"),
    )
  ) {
    assert.ok(Date.now() < until);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await answerThread(id, "Use the revised destination", "user", "Beta");
  await waitFor(id, "done");
  const view = (await findThreadView(id))!;
  assert.equal(
    view.room?.deliveries.find(
      (row) => row.text === "Use the revised destination",
    )?.delivered,
    true,
  );
  assert.ok(
    view.lines.some((line) => line.kind === "user" && line.to === "Beta"),
  );
  assert.equal(
    view.room?.relays.filter((row) => row.kind === "report").length,
    1,
  );
});

test("cancellation drains tools and preserves the participant on follow-up", async () => {
  plans.set("Alpha", [() => ask("Beta", "Long work"), () => text("Waiting.")]);
  plans.set("Beta", [
    () =>
      call(T.bash, {
        command: "sleep 5; printf TOO_LATE",
        description: "Wait in a cancellable process.",
      }),
  ]);
  const id = await startThread({
    bot: "Alpha",
    request: "Long work",
    label: "Cancel",
    from: "user",
  });
  const until = Date.now() + 2000;
  while (
    !(await rowsOf(id)).some((row) =>
      JSON.stringify(row.content).includes("TOO_LATE"),
    )
  ) {
    assert.ok(Date.now() < until);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await cancelThread(id);
  const rows = await rowsOf(id);
  assert.equal((await findThread(id))?.status, "failed");
  assert.ok(
    (await listRoomWork(id)).every(
      (row) => row.state === "done" || row.state === "cancelled",
    ),
  );
  plans.set("Alpha", [
    () => ask("Beta", "Pick up your saved work"),
    () => text("Waiting again."),
    () => text("Recovered report"),
  ]);
  plans.set("Beta", [
    (prompt) => {
      assert.ok(prompt.includes("TOO_LATE"));
      assert.ok(prompt.includes("Aborted"));
      return text("Checked current state and recovered");
    },
  ]);
  await answerThread(id, "Continue after cancellation");
  await waitFor(id, "done");
  assert.ok((await rowsOf(id)).length > rows.length);
  assert.equal(botBrowserSession(id, "Beta"), botBrowserSession(id, " beta "));
});

test("an old interrupted delegation resumes the original child history", async () => {
  const { insertThread } = await import("../features/bot/thread.query.ts");
  const thread = await insertThread({
    bot: "Alpha",
    request: "Old request",
    label: "Legacy",
    opening: "Original opening",
  });
  await upsertMessage(thread.id, 1, {
    bot: "Alpha",
    parent: null,
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId: "old-delegation",
        toolName: T.ask_bot,
        input: { bot: "Beta", request: "Keep working" },
      },
    ],
  });
  await upsertMessage(thread.id, 2, {
    bot: "Beta",
    parent: "old-delegation",
    role: "assistant",
    content: "LEGACY_BETA_PRIVATE",
  });
  await ensureRoom(thread.id);
  plans.set("Beta", [
    (prompt) => {
      assert.ok(prompt.includes("LEGACY_BETA_PRIVATE"));
      return text("Legacy work recovered");
    },
  ]);
  plans.set("Alpha", [
    (prompt) => {
      assert.ok(!prompt.includes("LEGACY_BETA_PRIVATE"));
      assert.ok(prompt.includes("Legacy work recovered"));
      return text("Legacy report");
    },
  ]);
  await pauseRoom(thread.id, "Server restarted.");
  await answerThread(thread.id, "Continue");
  await waitFor(thread.id, "done");
  assert.equal((await findThread(thread.id))?.outcome, "Legacy report");
});

test("compaction and an arriving message preserve the same inbox on resume", async () => {
  plans.set("Alpha", [() => text("Before compaction")]);
  const id = await startThread({
    bot: "Alpha",
    request: "Compact",
    label: "Compaction",
    from: "user",
  });
  await waitFor(id, "done");
  const work = (await listRoomWork(id))[0];
  await upsertMessage(id, (await lastSeq(id)) + 1, {
    bot: "Alpha",
    parent: work.id,
    role: "assistant",
    content: "old material ".repeat(5000),
  });
  replies.set("Alpha", [() => "Preserved private summary."]);
  plans.set("Alpha", [
    (prompt) => {
      assert.ok(prompt.includes("Preserved private summary"));
      return text("After compaction");
    },
  ]);
  await answerThread(id, "Continue the same work");
  await waitFor(id, "done");
  const history = JSON.stringify(await listParticipantTranscript(id, "Alpha"));
  assert.ok(history.includes("Preserved private summary"));
  assert.ok(history.includes("After compaction"));
});

test("interrupted provider operations and incomplete arguments are not invented as local tool results", () => {
  const restored = resumeTranscript([
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "remote",
          toolName: T.web_search,
          input: {},
          providerExecuted: true,
        },
        {
          type: "tool-call",
          toolCallId: "partial",
          toolName: T.bash,
          input: '{"command":',
        },
      ],
    },
  ]);
  assert.ok(!restored.some((message) => message.role === "tool"));
  const projection = JSON.stringify(restored);
  assert.ok(projection.includes("remote execution state is unknown"));
  assert.ok(projection.includes("argument stream was interrupted"));
  assert.deepEqual(resumeTranscript(restored), restored);
});

test("B keeps its history when C contacts it later in the same room", async () => {
  plans.set("Alpha", [
    () => ask("Beta", "First request"),
    () => text("Waiting for Beta"),
    () => ask("Gamma", "Ask Beta for the next part"),
    () => text("Waiting for Gamma"),
    (prompt) => {
      assert.ok(prompt.includes("Gamma shared result"));
      assert.ok(!prompt.includes("BETA_DESK_SECRET"));
      return text("Room complete");
    },
  ]);
  plans.set("Beta", [
    () =>
      call(T.bash, {
        command: "printf BETA_DESK_SECRET",
        description: "Read private work.",
      }),
    () => text("Beta first result"),
    (prompt) => {
      assert.ok(prompt.includes("BETA_DESK_SECRET"));
      assert.ok(prompt.includes("Gamma"));
      return text("Beta second result");
    },
  ]);
  plans.set("Gamma", [
    () => ask("Beta", "Next part"),
    () => text("Waiting for Beta"),
    (prompt) => {
      assert.ok(prompt.includes("Beta second result"));
      assert.ok(!prompt.includes("BETA_DESK_SECRET"));
      return text("Gamma shared result");
    },
  ]);
  const id = await startThread({
    bot: "Alpha",
    request: "Keep the same team",
    label: "Team",
    from: "user",
  });
  await waitFor(id, "done");
  assert.equal(
    (await listRoomWork(id)).filter((work) => work.bot === "Beta").length,
    2,
  );
  assert.equal((await findThreadView(id))?.room?.participants.length, 3);
});

test("a direct follow-up to an idle B still returns the room's final report through A", async () => {
  plans.set("Alpha", [
    () => ask("Beta", "First work"),
    () => text("Waiting"),
    () => text("First report"),
  ]);
  plans.set("Beta", [() => text("First work complete")]);
  const id = await startThread({
    bot: "Alpha",
    request: "First work",
    label: "Direct follow-up",
    from: "user",
  });
  await waitFor(id, "done");
  plans.set("Beta", [
    (prompt) => {
      assert.ok(prompt.includes("First work complete"));
      assert.ok(prompt.includes("Change the detail"));
      return text("The detail is changed");
    },
  ]);
  plans.set("Alpha", [
    (prompt) => {
      assert.ok(prompt.includes("The detail is changed"));
      return text("Updated coordinator report");
    },
  ]);
  await answerThread(id, "Change the detail", "user", "Beta");
  await waitFor(id, "done");
  assert.equal((await findThread(id))?.outcome, "Updated coordinator report");
  assert.ok(
    (await listRoomRelays())
      .filter((relay) => relay.threadId === id && relay.kind === "report")
      .every((relay) => relay.bot === "Alpha"),
  );
});

test("simultaneous questions keep their own reply routes", async () => {
  plans.set("Alpha", [
    () => [
      ...ask("Beta", "Check first decision"),
      ...ask("Gamma", "Check second decision"),
    ],
    () => text("Waiting for decisions"),
    () => text("First answer received"),
    () => text("Both decisions applied"),
  ]);
  plans.set("Beta", [
    () => ask("Thursday", "Which destination?"),
    (prompt) => {
      assert.ok(prompt.includes("Destination One"));
      assert.ok(!prompt.includes("Format Two"));
      return text("Destination applied");
    },
  ]);
  plans.set("Gamma", [
    () => ask("Thursday", "Which format?"),
    (prompt) => {
      assert.ok(prompt.includes("Format Two"));
      assert.ok(!prompt.includes("Destination One"));
      return text("Format applied");
    },
  ]);
  const id = await startThread({
    bot: "Alpha",
    request: "Ask independently",
    label: "Questions",
    from: "user",
  });
  await waitFor(id, "waiting");
  const questions = (await findThreadView(id))!.room!.questions;
  assert.equal(questions.length, 2);
  // Two open and none named: the call's tool answers with both, nothing delivered
  const { loadTools } = await import("../features/ai/load-tools.ts");
  const tools = await loadTools({ target: "thursday" });
  const unclear = await tools[T.thread].execute!(
    { action: "answer", thread: id, answer: "Unclear" },
    { toolCallId: "unclear", messages: [], context: {} },
  );
  assert.match(String(unclear), /Several questions are waiting/);
  assert.equal((await findThreadView(id))!.room!.questions.length, 2);
  await answerThread(
    id,
    "Destination One",
    "user",
    "Beta",
    questions.find((q) => q.bot === "Beta")!.id,
  );
  await waitFor(id, "waiting");
  assert.equal((await findThreadView(id))!.room!.questions.length, 1);
  await answerThread(
    id,
    "Format Two",
    "thursday",
    "Gamma",
    questions.find((q) => q.bot === "Gamma")!.id,
  );
  await waitFor(id, "done");
  assert.equal((await findThread(id))?.outcome, "Both decisions applied");
});

test("a bot waiting on the user holds other messages until the answer", async () => {
  plans.set("Alpha", [
    () => ask("Beta", "Prepare the draft"),
    () => text("Waiting for Beta."),
    (prompt) => {
      assert.ok(prompt.includes("Draft ready"));
      return text("Final report");
    },
  ]);
  plans.set("Beta", [
    () => [
      ...ask("Gamma", "Check the numbers"),
      ...ask("Thursday", "Which tone?"),
    ],
    (prompt) => {
      assert.ok(prompt.includes("Warm"));
      assert.ok(prompt.includes("Numbers are 42"));
      return text("Draft ready");
    },
  ]);
  plans.set("Gamma", [() => text("Numbers are 42")]);
  const betaCalls = inputs.get("Beta")?.length ?? 0;
  const id = await startThread({
    bot: "Alpha",
    request: "Draft with checked numbers",
    label: "Held inbox",
    from: "user",
  });
  await waitFor(id, "waiting");
  // Gamma's return arrived while Beta waited on the user; Beta has not run for it
  assert.equal((inputs.get("Beta")?.length ?? 0) - betaCalls, 1);
  const beta = (await listRoomWork(id)).filter((row) => row.bot === "Beta");
  assert.ok(
    beta.every((row) => row.state !== "queued" && row.state !== "running"),
  );
  // No job, no bot, no question named: the call's tool gives it to the only open question
  const { loadTools } = await import("../features/ai/load-tools.ts");
  const tools = await loadTools({ target: "thursday" });
  const told = (await tools[T.thread].execute!(
    { action: "answer", thread: null, answer: "Warm" },
    { toolCallId: "warm", messages: [], context: {} },
  )) as { answered?: { bot: string } };
  assert.equal(told.answered?.bot, "Beta");
  await waitFor(id, "done");
  assert.equal((inputs.get("Beta")?.length ?? 0) - betaCalls, 2);
  assert.equal((await findThread(id))?.outcome, "Final report");
});

test("a consumed inbox survives a crash before model execution and restart waits for a person", async () => {
  const { insertThread, deleteThread } = await import(
    "../features/bot/thread.query.ts"
  );
  const { claimRoomWork, consumeRoomInbox } = await import(
    "../features/bot/room.query.ts"
  );
  const { sweepThreads, resumeStoppedThreads } = await import(
    "../features/bot/bot.runner.ts"
  );
  const thread = await insertThread({
    bot: "Alpha",
    request: "Crash window",
    label: "Crash window",
    opening: "Crash opening",
  });
  await ensureRoom(thread.id);
  const root = (await claimRoomWork(thread.id))!;
  await sendRoomMessage(root, {
    id: "crash-message",
    to: "Beta",
    text: "Durable incoming message",
  });
  const beta = (await claimRoomWork(thread.id))!;
  await consumeRoomInbox(beta);
  await sweepThreads();
  await resumeStoppedThreads();
  assert.equal((await findThread(thread.id))?.status, "waiting");
  assert.ok(!(await findThread(thread.id))?.pending?.auto);
  plans.set("Beta", [
    (prompt) => {
      assert.equal(prompt.split("Durable incoming message").length - 1, 1);
      return text("Recovered delivery");
    },
  ]);
  plans.set("Alpha", [
    () => text("Awaiting recovery"),
    (prompt) => {
      assert.ok(prompt.includes("Recovered delivery"));
      return text("Crash recovered");
    },
  ]);
  await answerThread(thread.id, "Continue");
  await waitFor(thread.id, "done");
  await deleteThread(thread.id);
});

test("presence pauses automatically but a manually stopped room stays stopped", async () => {
  const { pauseThreads, resumeStoppedThreads } = await import(
    "../features/bot/bot.runner.ts"
  );
  plans.set("Alpha", [
    () =>
      call(T.bash, {
        command: "sleep 5; printf PRESENCE_BOUNDARY",
        description: "Wait for the presence boundary.",
      }),
  ]);
  const id = await startThread({
    bot: "Alpha",
    request: "Presence",
    label: "Presence",
    from: "user",
  });
  const until = Date.now() + 2000;
  while (
    !(await rowsOf(id)).some((row) =>
      JSON.stringify(row.content).includes("PRESENCE_BOUNDARY"),
    )
  ) {
    assert.ok(Date.now() < until);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await pauseThreads("The browser closed.", true);
  assert.equal((await findThread(id))?.pending?.auto, true);
  plans.set("Alpha", [
    (prompt) => {
      assert.ok(prompt.includes("PRESENCE_BOUNDARY"));
      return text("Presence recovered");
    },
  ]);
  await resumeStoppedThreads();
  await waitFor(id, "done");
});

test("a late inbox message queues another turn atomically with completion", async () => {
  const { insertThread, deleteThread } = await import(
    "../features/bot/thread.query.ts"
  );
  const { claimRoomWork, consumeRoomInbox, finishRoomWork, tellRoom } =
    await import("../features/bot/room.query.ts");
  const thread = await insertThread({
    bot: "Alpha",
    request: "Late input",
    label: "Late input",
    opening: "Opening",
  });
  await ensureRoom(thread.id);
  const run = (await claimRoomWork(thread.id))!;
  await consumeRoomInbox(run);
  await tellRoom(thread.id, "Arrived at completion", "The user");
  await finishRoomWork(run, "Earlier result");
  assert.equal((await findThread(thread.id))?.status, "running");
  const next = (await claimRoomWork(thread.id))!;
  assert.equal(next.id, run.id);
  assert.deepEqual(await consumeRoomInbox(next), [
    "The user, on screen: Arrived at completion",
  ]);
  await finishRoomWork(next, "Result after the message");
  assert.equal((await findThread(thread.id))?.status, "done");
  await deleteThread(thread.id);
});

test("provider adapters serialize interrupted tool history as complete exchanges", async () => {
  const { generateText, tool } = await import("ai");
  const { z } = await import("zod");
  const { createOpenAI } = await import("@ai-sdk/openai");
  const { createAnthropic } = await import("@ai-sdk/anthropic");
  const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
  const messages = resumeTranscript([
    { role: "user", content: "Inspect the existing file." },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "interrupted-call",
          toolName: T.bash,
          input: { command: "cat saved.txt" },
          providerOptions: { google: { thoughtSignature: "saved-signature" } },
        },
      ],
    },
    { role: "user", content: "Continue after the interruption." },
  ]);
  let captured: any;
  const fetch = async (_url: unknown, init: any) => {
    captured = JSON.parse(init.body);
    throw new Error("WIRE_CAPTURED");
  };
  const factories = [
    () => createOpenAI({ apiKey: "test-key", fetch }).responses("test-model"),
    () => createAnthropic({ apiKey: "test-key", fetch })("test-model"),
    () => createGoogleGenerativeAI({ apiKey: "test-key", fetch })("test-model"),
  ];
  for (const [index, factory] of factories.entries()) {
    captured = undefined;
    await assert.rejects(
      generateText({
        model: factory(),
        messages,
        maxRetries: 0,
        tools: {
          [T.bash]: tool({ inputSchema: z.object({ command: z.string() }) }),
        },
      }),
      /WIRE_CAPTURED/,
    );
    assert.ok(captured, "The adapter reaches the HTTP boundary");
    const body = JSON.stringify(captured);
    assert.ok(body.includes("No result: execution was interrupted"));
    if (index === 0) assert.ok(body.includes("function_call_output"));
    if (index === 1) assert.ok(body.includes("tool_result"));
    if (index === 2) {
      assert.ok(body.includes("functionResponse"));
      assert.ok(body.includes("saved-signature"));
    }
  }
});

test("the assembled participant prompt names its return route and exposes asynchronous collaboration", async () => {
  const { loadBotPrompt } = await import(
    "../features/ai/prompts/bot.prompt.ts"
  );
  const { sendMessageSpec } = await import("../features/ai/tools/bot.tool.ts");
  const prompt = await loadBotPrompt("Beta", "Use precise findings.", {
    owner: "Alpha",
    caller: "Gamma",
    messageId: "incoming-message",
  });
  assert.ok(prompt.text.includes("Gamma → Beta"));
  assert.ok(prompt.text.includes("Your final text goes back to Gamma"));
  assert.ok(
    prompt.text.includes("End your turn when you have nothing more to do now"),
  );
  for (const legacy of [T.ask_bot, T.ask_back, T.ask_thursday, "`answer`"])
    assert.ok(!prompt.text.includes(legacy));
  if (process.env.THURSDAY_TEST_SHOW_PROMPT)
    console.log(prompt.text, "\nTool:", sendMessageSpec.description);
});

test("a committed message recovers its real receipt after the tool result is lost", async () => {
  const { insertThread, deleteThread } = await import(
    "../features/bot/thread.query.ts"
  );
  const { claimRoomWork, listRoomReceipts } = await import(
    "../features/bot/room.query.ts"
  );
  const thread = await insertThread({
    bot: "Alpha",
    request: "Receipt",
    label: "Receipt",
    opening: "Opening",
  });
  await ensureRoom(thread.id);
  const run = (await claimRoomWork(thread.id))!;
  const receipt = await sendRoomMessage(run, {
    id: "lost-receipt",
    to: "Beta",
    text: "Already committed",
  });
  const history: import("ai").ModelMessage[] = [
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "lost-receipt",
          toolName: T.send_message,
          input: { to: "Beta", text: "Already committed" },
        },
      ],
    },
  ];
  const restored = resumeTranscript(
    history,
    await listRoomReceipts(thread.id, "Alpha", history),
  );
  assert.ok(JSON.stringify(restored).includes(receipt.messageId));
  assert.ok(!JSON.stringify(restored).includes("No result:"));
  assert.equal((await listRoomWork(thread.id)).length, 2);
  await deleteThread(thread.id);
});

test("a failed participant drains its peers before manual resume", async () => {
  plans.set("Alpha", [
    () => ask("Beta", "Work alongside me"),
    () =>
      call(T.bash, {
        command: "sleep 0.1",
        description: "Continue independent work.",
      }),
    () => [
      {
        type: "error",
        error: "Provider unavailable in this test (expected interruption)",
      },
    ],
  ]);
  plans.set("Beta", [
    () =>
      call(T.bash, {
        command: "sleep 5; printf PEER_INTERRUPTED",
        description: "Work until the room pauses.",
      }),
  ]);
  const id = await startThread({
    bot: "Alpha",
    request: "Pause the team coherently",
    label: "Failure",
    from: "user",
  });
  await waitFor(id, "waiting");
  plans.set("Beta", [
    (prompt) => {
      assert.ok(prompt.includes("Aborted"));
      return text("Peer resumed safely");
    },
  ]);
  plans.set("Alpha", [
    () => text("Waiting for resumed peer"),
    (prompt) => {
      assert.ok(prompt.includes("Peer resumed safely"));
      return text("Team recovered");
    },
  ]);
  await answerThread(id, "Continue");
  await waitFor(id, "done");
  assert.equal((await findThread(id))?.outcome, "Team recovered");
  assert.ok((await listRoomWork(id)).every((work) => work.state === "done"));
});

test("missing artifacts pause visibly and can be repaired with a natural follow-up", async () => {
  plans.set("Alpha", [() => text("Open artifacts/report-check.md")]);
  const id = await startThread({
    bot: "Alpha",
    request: "Create a report",
    label: "Report check",
    from: "user",
  });
  const paused = await waitFor(id, "waiting");
  assert.ok(paused.outcome?.includes("files that are not available"));
  plans.set("Alpha", [
    () =>
      call(T.write_file, {
        path: "artifacts/report-check.md",
        content: "# Verified report",
      }),
    () => text("Open artifacts/report-check.md"),
  ]);
  await answerThread(id, "Continue");
  await waitFor(id, "done");
});

test("compaction thresholds belong to the participant across different callers", async () => {
  const { insertThread, deleteThread } = await import(
    "../features/bot/thread.query.ts"
  );
  const { claimRoomWork, lowerRoomContextBudget, roomContextBudget } =
    await import("../features/bot/room.query.ts");
  const thread = await insertThread({
    bot: "Alpha",
    request: "Budget",
    label: "Budget",
    opening: "Opening",
  });
  await ensureRoom(thread.id);
  const root = (await claimRoomWork(thread.id))!;
  await sendRoomMessage(root, {
    id: "budget-message",
    to: "Beta",
    text: "Work within the accepted context",
  });
  const beta = (await claimRoomWork(thread.id))!;
  await lowerRoomContextBudget(beta, 12000);
  assert.equal(await roomContextBudget(thread.id, "Beta"), 12000);
  assert.equal(await roomContextBudget(thread.id, "Alpha"), undefined);
  await deleteThread(thread.id);
});

test("native provider data without a complete native message resumes as a truthful note", () => {
  const restored = resumeTranscript([
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "native-partial",
          toolName: T.web_search,
          input: {},
          providerExecuted: true,
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "native-partial",
          toolName: T.web_search,
          output: {
            type: "json",
            value: { finding: "Recorded provider finding" },
          },
        },
      ],
    },
  ]);
  assert.ok(!restored.some((row) => row.role === "tool"));
  assert.ok(JSON.stringify(restored).includes("Recorded provider finding"));
  assert.ok(
    JSON.stringify(restored).includes("native continuation was interrupted"),
  );
});

test("the coordinator can address Thursday using the original incoming message ID", async () => {
  const { insertThread, deleteThread } = await import(
    "../features/bot/thread.query.ts"
  );
  const { claimRoomWork } = await import("../features/bot/room.query.ts");
  const thread = await insertThread({
    bot: "Alpha",
    request: "Use the original conversation",
    label: "Thursday reply",
    opening: "Opening",
  });
  await ensureRoom(thread.id);
  const root = (await claimRoomWork(thread.id))!;
  const sent = await sendRoomMessage(root, {
    id: "reply-to-thursday",
    to: "Thursday",
    text: "Which destination should I use?",
    kind: "question",
    replyTo: root.id,
  });
  assert.equal(
    (await listRoomWork(thread.id)).find((work) => work.id === sent.messageId)
      ?.state,
    "external",
  );
  assert.equal(
    (await listRoomRelays()).find((relay) => relay.messageId === sent.messageId)
      ?.bot,
    "Alpha",
  );
  await deleteThread(thread.id);
});

test("Thursday updates do not create questions or prevent the final report", async () => {
  plans.set("Alpha", [
    () =>
      call(T.send_message, {
        to: "Thursday",
        text: "The first part is ready.",
      }),
    () =>
      call(T.send_message, {
        to: "Thursday",
        text: "The requested work is complete.",
        kind: "message",
      }),
    () => text("All work is complete."),
  ]);
  const id = await startThread({
    bot: "Alpha",
    request: "Send progress and finish",
    label: "Notifications",
    from: "user",
  });
  await waitFor(id, "done");
  const thread = (await findThreadView(id))!;
  assert.equal(thread.room!.questions.length, 0);
  assert.equal(thread.ask, null);
  assert.equal(thread.outcome, "All work is complete.");
  const messages = thread.lines.filter((line) => line.kind === "ask");
  assert.equal(messages.length, 2);
  for (const message of messages)
    assert.equal(message.kind === "ask" && message.question, false);
  const relays = (await listRoomRelays()).filter(
    (relay) => relay.threadId === id,
  );
  assert.deepEqual(
    relays.map((relay) => relay.kind),
    ["message", "message", "report"],
  );
  assert.ok(relays.every((relay) => relay.messageId === null));
});

test("answer drafts remain separate for two questions from the same bot", async () => {
  const { threadDrafts } = await import("../features/bot/thread.store.ts");
  threadDrafts.set("draft-room", "Alpha", "First answer", "first");
  threadDrafts.set("draft-room", "Alpha", "Second answer", "second");
  threadDrafts.set("draft-room", "Alpha", "A general message");
  threadDrafts.set("draft-room", "Alpha", "", "first");
  assert.equal(threadDrafts.get("draft-room", "Alpha", "first"), "");
  assert.equal(
    threadDrafts.get("draft-room", "Alpha", "second"),
    "Second answer",
  );
  assert.equal(threadDrafts.get("draft-room", "Alpha"), "A general message");
});
