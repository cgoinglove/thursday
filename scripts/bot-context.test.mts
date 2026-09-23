import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, mock, test } from "node:test";
import { APICallError, simulateReadableStream } from "ai";
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
const { startThread, answerThread, askCompact, cancelThread } = await import(
  "../features/bot/bot.runner.ts"
);
const { findThread, findThreadView, upsertMessage, lastSeq } = await import(
  "../features/bot/thread.query.ts"
);
const { resumeTranscript } = await import("../features/bot/bot.run.ts");
const { asWords } = await import("../features/ai/words.ts");
const { botBrowserSession } = await import(
  "../features/workspace/workspace.ts"
);
const { TOOL_NAMES: T } = await import("../features/ai/tools/tool-name.ts");
const {
  listRoomWork,
  listParticipantTranscript,
  listRoomRelays,
  sendRoomMessage,
} = await import("../features/bot/room.query.ts");
const { presence } = await import("../app/api/events/app-event.server.ts");
const { BOT_RUN } = await import("../config.ts");
// The retry after a break waits in real time; the tests only need its order
BOT_RUN.retryMs = 1;
const { eq } = await import("drizzle-orm");
await migrateDatabase();
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
    why: "the test's reason",
    kind: bot === "Thursday" ? "question" : "message",
  });
const waitFor = async (id: string, status: string) => {
  const until = Date.now() + 20_000;
  while (Date.now() < until) {
    const thread = await findThread(id);
    if (thread?.status === status) return thread;
    if (thread?.status === "cancelled")
      assert.fail(`Thread was cancelled before it became ${status}`);
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
  const { threadRelayTable, threadTable } = await import(
    "../database/tables.ts"
  );
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
                  ? "cancelled"
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
    const result = (await tools[T.thread_status].execute!(
      { thread: "all" },
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
        (thread) => thread.id === ids[2] && thread.status === "cancelled",
      ),
    );
    await markSeen([ids[2]]);
    assert.ok(
      !(await listInboxThreads()).some((thread) => thread.id === ids[2]),
    );
    // A stop is read by whoever made it and still holds its place among the latest endings
    await database
      .update(threadTable)
      .set({ updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 30)) })
      .where(eq(threadTable.id, ids[2]));
    assert.ok(
      (await listInboxThreads()).some(
        (thread) => thread.id === ids[2] && thread.status === "cancelled",
      ),
    );
    // A report no call relayed holds its ending in the inbox; reading it settles that too
    await database.insert(threadRelayTable).values({
      key: `report:${ids[3]}:0`,
      threadId: ids[3],
      bot: "Alpha",
      text: "Result 3",
      kind: "report",
    });
    assert.ok(
      (await listInboxThreads()).some((thread) => thread.id === ids[3]),
    );
    await markSeen([ids[3]]);
    assert.ok(
      !(await listInboxThreads()).some((thread) => thread.id === ids[3]),
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
    assert.equal(
      needsThreadReply({
        status: "running",
        room: { participants: [], questions: [], deliveries: [], relays: [] },
      }),
      false,
    );
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

test("a question back to the caller is the turn's last words, and the answer is a new call", async () => {
  plans.set("Alpha", [
    () => ask("Beta", "Research"),
    () => text("Waiting."),
    (prompt) => {
      assert.ok(prompt.includes("Which format?"));
      return ask("Beta", "Use a table.");
    },
    () => text("Waiting for the research."),
    (prompt) => {
      assert.ok(prompt.includes("Research complete"));
      return text("Combined report");
    },
  ]);
  plans.set("Beta", [
    () => text("Which format?"),
    (prompt) => {
      // The same desk: what it asked is still in front of it
      assert.ok(prompt.includes("Which format?"));
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

test("a message to the one being answered is refused, and the last words reach them once", async () => {
  plans.set("Alpha", [
    () => ask("Beta", "Research"),
    () => text("Waiting."),
    (prompt) => {
      assert.ok(prompt.includes("The findings, in full"));
      return text("Report built on the findings");
    },
  ]);
  plans.set("Beta", [
    () => ask("Alpha", "The findings, sent as a message"),
    (prompt) => {
      assert.ok(prompt.includes("Alpha is who you are answering"));
      return text("The findings, in full");
    },
  ]);
  const before = inputs.get("Alpha")?.length ?? 0;
  const id = await startThread({
    bot: "Alpha",
    request: "Research and report",
    label: "Upward",
    from: "user",
  });
  await waitFor(id, "done");
  // No exchange opened the other way, so nothing came back after the report
  assert.equal((await findThread(id))?.outcome, "Report built on the findings");
  const rows = await listRoomWork(id);
  assert.equal(rows.length, 2);
  assert.ok(!rows.some((row) => row.bot === "Alpha" && row.caller === "Beta"));
  // Alpha ran three steps in all: nothing woke it a second time
  assert.equal((inputs.get("Alpha")?.length ?? 0) - before, 3);
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
        why: "the test's reason",
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

test("Continue offered as a choice answers the question rather than resuming a stop", async () => {
  plans.set("Alpha", [
    () =>
      call(T.send_message, {
        to: "Thursday",
        text: "Keep going with the long version?",
        why: "the test's reason",
        kind: "question",
        options: ["Continue", "Stop here"],
      }),
    (prompt) => {
      assert.ok(prompt.includes("answers your question to the user"));
      return text("Went on with the long version");
    },
  ]);
  const id = await startThread({
    bot: "Alpha",
    request: "Choose",
    label: "Continue as a choice",
    from: "user",
  });
  const asking = await waitFor(id, "waiting");
  assert.ok(asking.pending?.messageId);
  const told = await answerThread(id, "Continue");
  assert.equal(told?.answered?.bot, "Alpha");
  assert.equal(
    (await waitFor(id, "done")).outcome,
    "Went on with the long version",
  );
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

test("words to a bot already on a call join it, and committed sends deduplicate", async () => {
  const { insertThread } = await import("../features/bot/thread.query.ts");
  const { claimRoomWork, finishRoomWork, cancelRoom, consumeRoomInbox } =
    await import("../features/bot/room.query.ts");
  const thread = await insertThread({
    bot: "Alpha",
    request: "Queue",
    label: "Queue",
    opening: "Queue",
  });
  const root = (await claimRoomWork(thread.id))!;
  const receipt = await sendRoomMessage(root, {
    id: "same-send",
    to: "Beta",
    text: "One",
    why: "the test's reason",
  });
  assert.deepEqual(
    await sendRoomMessage(root, {
      id: "same-send",
      to: "Beta",
      text: "One",
      why: "the test\'s reason",
    }),
    receipt,
  );
  // Beta is already on a call from Alpha: more words join it rather than queue a second one
  const more = await sendRoomMessage(root, {
    id: "second-send",
    to: "Beta",
    text: "Two",
    why: "the test's reason",
  });
  assert.match(String(more.note), /already working for you/);
  const beta = (await claimRoomWork(thread.id))!;
  assert.equal(beta.bot, "Beta");
  assert.equal(await claimRoomWork(thread.id), null);
  assert.deepEqual(await consumeRoomInbox(beta), [
    "Alpha:\n\nOne",
    "Alpha:\n\nTwo",
  ]);
  // Words that arrive while it runs are read before its next step
  await sendRoomMessage(root, {
    id: "third-send",
    to: "Beta",
    text: "Three",
    why: "the test\'s reason",
  });
  assert.deepEqual(await consumeRoomInbox(beta), ["Alpha:\n\nThree"]);
  await finishRoomWork(beta, "One result");
  assert.equal(await claimRoomWork(thread.id), null);
  // Once it has answered, the next words are a new call
  await sendRoomMessage(root, {
    id: "fourth-send",
    to: "Beta",
    text: "Four",
    why: "the test\'s reason",
  });
  const again = (await claimRoomWork(thread.id))!;
  assert.equal(again.bot, "Beta");
  assert.notEqual(beta.id, again.id);
  await cancelRoom(thread.id);
  await assert.rejects(
    sendRoomMessage(root, {
      id: "stale",
      to: "Gamma",
      text: "Too late",
      why: "the test\'s reason",
    }),
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
  assert.equal((await findThread(id))?.status, "cancelled");
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

test("a desk asked to summarize itself does so at its next step, once, however small it is", async () => {
  plans.set("Alpha", [() => text("First answer")]);
  const id = await startThread({
    bot: "Alpha",
    request: "Small job",
    label: "Asked to compact",
    from: "user",
  });
  await waitFor(id, "done");

  askCompact(id, "Alpha");
  replies.set("Alpha", [() => "Summary the user asked for."]);
  plans.set("Alpha", [
    (prompt) => {
      assert.ok(prompt.includes("Summary the user asked for"));
      return text("Second answer");
    },
  ]);
  await answerThread(id, "Go on");
  await waitFor(id, "done");

  // Met once: the turn after runs on what is there, with no summary asked of the model
  plans.set("Alpha", [() => text("Third answer")]);
  await answerThread(id, "And again");
  await waitFor(id, "done");
  const history = JSON.stringify(await listParticipantTranscript(id, "Alpha"));
  assert.ok(history.includes("Third answer"));
  assert.equal(history.split("Summary the user asked for").length - 1, 1);
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

test("a transcript as its words alone carries no thought and no tool, so nothing can be sent unpaired", async () => {
  const step = (n: number): any[] => [
    {
      role: "assistant",
      content: [
        {
          type: "reasoning",
          text: "",
          providerOptions: {
            openai: { itemId: `rs_${n}`, reasoningEncryptedContent: "enc" },
          },
        },
        {
          type: "tool-call",
          toolCallId: `call_${n}`,
          toolName: T.bash,
          input: { command: `step ${n}` },
          providerOptions: { openai: { itemId: `fc_${n}` } },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: `call_${n}`,
          toolName: T.bash,
          output: { type: "text", value: "x".repeat(2_000) },
        },
      ],
    },
  ];
  const words = asWords(
    [
      { role: "user", content: "The job" },
      ...[1, 2, 3].flatMap(step),
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Where it got to.",
            providerOptions: { openai: { itemId: "msg_1" } },
          },
        ],
      },
    ],
    (name, input) => `${name}: ${(input as { command: string }).command}`,
  );
  // What each step did and what was said, the steps of one reply as one plain message
  assert.deepEqual(words, [
    { role: "user", content: "The job" },
    {
      role: "assistant",
      content: [
        ...[1, 2, 3].map((n) => `${T.bash}: step ${n}`),
        "Where it got to.",
      ].join("\n"),
    },
  ]);

  // What a provider is sent: no thought, no call, no id to be found without its pair
  const { createOpenAI } = await import("@ai-sdk/openai");
  const { generateText } = await import("ai");
  let sent: { type?: string; id?: string }[] = [];
  const openai = createOpenAI({
    apiKey: "sk-test",
    fetch: async (_url, init) => {
      sent = JSON.parse(String(init?.body)).input;
      throw new Error("Captured, not sent");
    },
  });
  await generateText({
    model: openai.responses("gpt-5.6-luna"),
    messages: words,
    maxRetries: 0,
  }).catch(() => {});
  assert.equal(sent.length, 2);
  assert.ok(
    sent.every((item) => !item.type?.startsWith("reasoning") && !item.id),
  );
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
  // Two open and no bot named: words to the thread are refused with both, nothing delivered
  const { loadTools } = await import("../features/ai/load-tools.ts");
  const tools = await loadTools({ target: "thursday" });
  const unclear = await tools[T.thread_tell].execute!(
    { thread: id, words: "Unclear" },
    { toolCallId: "unclear", messages: [], context: {} },
  );
  assert.match(String(unclear), /Several questions are waiting/);
  // An answer names who asked; a bot that asked nothing is answered with who did
  const wrong = await tools[T.thread_answer].execute!(
    { thread: id, bot: "Alpha", answer: "Unclear" },
    { toolCallId: "wrong", messages: [], context: {} },
  );
  assert.match(String(wrong), /is not asking anything/);
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
  // The call answers by thread and the bot that asked; the question itself is found here
  const { loadTools } = await import("../features/ai/load-tools.ts");
  const tools = await loadTools({ target: "thursday" });
  const told = (await tools[T.thread_answer].execute!(
    { thread: id, bot: "Beta", answer: "Warm" },
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
  const { sweepThreads } = await import("../features/bot/bot.runner.ts");
  const thread = await insertThread({
    bot: "Alpha",
    request: "Crash window",
    label: "Crash window",
    opening: "Crash opening",
  });
  const root = (await claimRoomWork(thread.id))!;
  await sendRoomMessage(root, {
    id: "crash-message",
    to: "Beta",
    text: "Durable incoming message",
    why: "the test's reason",
  });
  const beta = (await claimRoomWork(thread.id))!;
  await consumeRoomInbox(beta);
  await sweepThreads();
  assert.equal((await findThread(thread.id))?.status, "waiting");
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

test("work runs with no browser on the stream, and a stop of the app's waits for a person", async () => {
  // Every test here runs unwatched: a phone, a routine and a server kept up from login
  // all start work with no tab open
  assert.equal(presence.watching, false);
  const { pauseThreads } = await import("../features/bot/bot.runner.ts");
  plans.set("Alpha", [
    () =>
      call(T.bash, {
        command: "sleep 5; printf UNWATCHED_BOUNDARY",
        description: "Wait for the boundary.",
      }),
  ]);
  const id = await startThread({
    bot: "Alpha",
    request: "Unwatched",
    label: "Unwatched",
    from: "user",
  });
  const until = Date.now() + 2000;
  while (
    !(await rowsOf(id)).some((row) =>
      JSON.stringify(row.content).includes("UNWATCHED_BOUNDARY"),
    )
  ) {
    assert.ok(Date.now() < until);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  // The server going down is the one thing that parks it, and only a person picks it up
  await pauseThreads("The server was shut down while this was running.");
  assert.equal((await findThread(id))?.status, "waiting");
  plans.set("Alpha", [
    (prompt) => {
      assert.ok(prompt.includes("UNWATCHED_BOUNDARY"));
      return text("Picked back up");
    },
  ]);
  await answerThread(id, "Continue");
  assert.equal((await waitFor(id, "done")).outcome, "Picked back up");
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
    thread: null,
    owner: "Alpha",
    caller: "Gamma",
  });
  assert.ok(prompt.text.includes("Gamma → Beta"));
  assert.ok(prompt.text.includes("Your final text goes back to Gamma"));
  assert.ok(prompt.text.includes("Your final text is your answer to Gamma"));
  assert.ok(!prompt.text.includes("Message ID"));
  assert.ok(!("replyTo" in sendMessageSpec.parameters.shape));
  assert.ok(
    prompt.text.includes("End your turn when you have nothing more to do now"),
  );
  if (process.env.THURSDAY_TEST_SHOW_PROMPT)
    console.log(prompt.text, "\nTool:", sendMessageSpec.description);
});

test("a bot's prompt lists its other threads with its own last words, never the thread it is in", async () => {
  // Rows written in one second tie on `updatedAt`; a list long enough holds them all
  const { BOT_WORK } = await import("../config.ts");
  const { reads, recent } = BOT_WORK;
  BOT_WORK.reads = 1;
  BOT_WORK.recent = 50;
  const { insertThread, deleteThread, updateThread } = await import(
    "../features/bot/thread.query.ts"
  );
  const { claimRoomWork, finishRoomWork } = await import(
    "../features/bot/room.query.ts"
  );
  const { loadBotPrompt } = await import(
    "../features/ai/prompts/bot.prompt.ts"
  );
  const earlier = await insertThread({
    bot: "Alpha",
    request: "Compare the plans",
    label: "Plan comparison",
    opening: "Opening",
  });
  const root = (await claimRoomWork(earlier.id))!;
  await sendRoomMessage(root, {
    id: "other-threads-call",
    to: "Beta",
    text: "Price the three plans",
    why: "the test's reason",
  });
  const beta = (await claimRoomWork(earlier.id))!;
  await finishRoomWork(
    beta,
    "Three plans priced.\n\nThe table is at artifacts/Beta/plans.md.",
  );
  await updateThread(earlier.id, { status: "done" });
  const current = await insertThread({
    bot: "Beta",
    request: "Something new",
    label: "Current job",
    opening: "Opening",
  });

  // A long ending of its own: the line keeps its start and the file it names, and carries an id
  const long = await insertThread({
    bot: "Beta",
    request: "Write the long report on the three plans.",
    label: "Long report",
    opening: "Opening",
  });
  const words = `${"The report covers pricing, limits and support for all three plans in turn. ".repeat(3)}It is at artifacts/Beta/report.md.`;
  await finishRoomWork((await claimRoomWork(long.id))!, words);
  await updateThread(long.id, { status: "done" });

  const seat = {
    thread: current.id,
    owner: "Beta",
    caller: "Thursday",
    messageId: null,
  };
  const prompt = await loadBotPrompt("Beta", null, seat);
  assert.ok(prompt.text.includes("## Your other threads"));
  assert.ok(prompt.text.includes(`- "Plan comparison" — Alpha's — ended`));
  assert.ok(prompt.text.includes("Three plans priced. The table is at"));
  assert.ok(prompt.text.includes("`artifacts/Beta/plans.md`"));
  assert.ok(!prompt.text.includes('"Current job"'));
  const handle = long.id.slice(0, 6);
  assert.ok(
    prompt.text.includes(`- [${handle}] "Long report" — yours — ended`),
  );
  assert.ok(!prompt.text.includes(words), "the line is cut");
  assert.ok(prompt.text.includes("`artifacts/Beta/report.md`"));
  assert.ok(
    prompt.text.includes(`\`${T.thread_recall}\` opens that one whole`),
  );
  if (process.env.THURSDAY_TEST_SHOW_PROMPT)
    console.log(
      prompt.text.slice(
        prompt.text.indexOf("## Your other threads"),
        prompt.text.indexOf("## Bots"),
      ),
    );

  // The tool opens a cut line whole, once a turn, and only so many of them
  const { createThreadRecallTool } = await import(
    "../features/ai/tools/bot.tool.ts"
  );
  const held = await createThreadRecallTool("Beta", current.id);
  // A ToolSet erases its input type; what is under test is the call itself
  type Recall = (
    input: { id: string },
    options: { toolCallId: string; messages: [] },
  ) => Promise<unknown>;
  const run = (tools: import("ai").ToolSet) => (id: string) =>
    (tools[T.thread_recall].execute as unknown as Recall)(
      { id },
      { toolCallId: id, messages: [] },
    );
  const open = run(held);
  assert.match(
    String(await open("nothing")),
    /No thread "nothing" on your list/,
  );
  assert.equal(
    await open("Plan comparison"),
    "Its line already shows all of it.",
  );
  const whole = String(await open(`[${handle}]`));
  assert.ok(whole.includes("You were asked: Write the long report"));
  assert.ok(whole.includes(words));
  assert.equal(await open(handle), "Already opened above, this turn.");
  const second = await insertThread({
    bot: "Beta",
    request: "Another long one.",
    label: "Second report",
    opening: "Opening",
  });
  await finishRoomWork((await claimRoomWork(second.id))!, words);
  await updateThread(second.id, { status: "done" });
  const again = await createThreadRecallTool("Beta", current.id);
  const reopen = run(again);
  await reopen(handle);
  assert.match(
    String(await reopen(second.id.slice(0, 6))),
    /1 threads are open already this turn/,
  );
  BOT_WORK.reads = reads;
  BOT_WORK.recent = recent;

  // Nothing cut, nothing to open: a bot whose lines all fit is handed no tool
  await deleteThread(long.id);
  await deleteThread(second.id);
  const { listBotWork } = await import("../features/bot/thread.query.ts");
  const left = await listBotWork("Beta", current.id);
  const anyCut = [...left.open, ...left.recent].some((line) => line.cut);
  assert.equal(
    T.thread_recall in (await createThreadRecallTool("Beta", current.id)),
    anyCut,
  );

  await deleteThread(earlier.id);
  await deleteThread(current.id);
});

test("a routine's next start is the next listed day at its time, and an interval counts from now", async () => {
  const { nextRun, scheduleText } = await import(
    "../features/routine/routine.schema.ts"
  );
  // 2026-09-18 is a Friday
  const friday = new Date(2026, 8, 18, 10, 0, 0);
  const weekdays = {
    kind: "daily" as const,
    time: "09:00",
    days: [1, 2, 3, 4, 5],
  };
  assert.deepEqual(nextRun(weekdays, friday), new Date(2026, 8, 21, 9, 0, 0));
  assert.deepEqual(
    nextRun({ ...weekdays, time: "18:30" }, friday),
    new Date(2026, 8, 18, 18, 30, 0),
  );
  assert.deepEqual(
    nextRun({ kind: "daily", time: "10:00", days: [5] }, friday),
    new Date(2026, 8, 25, 10, 0, 0),
    "the same minute is not after it",
  );
  assert.deepEqual(
    nextRun({ kind: "every", hours: 6 }, friday),
    new Date(2026, 8, 18, 16, 0, 0),
  );
  assert.equal(scheduleText(weekdays), "Daily 09:00 · Mon–Fri");
  assert.equal(
    scheduleText({ kind: "daily", time: "09:00", days: [1, 2, 3, 4, 5, 6, 7] }),
    "Daily 09:00",
  );
  assert.equal(
    scheduleText({ kind: "daily", time: "10:00", days: [1] }),
    "Mon 10:00",
  );
  assert.equal(
    scheduleText({ kind: "daily", time: "08:00", days: [1, 3, 5] }),
    "Daily 08:00 · Mon Wed Fri",
  );
  assert.equal(scheduleText({ kind: "every", hours: 1 }), "Every hour");
});

test("the call makes, reads and removes a routine", async () => {
  const { createRoutineTools } = await import(
    "../features/ai/tools/routine.tool.ts"
  );
  type Run = (
    input: Record<string, unknown>,
    options: { toolCallId: string; messages: [] },
  ) => Promise<unknown>;
  const routine = (input: Record<string, unknown>) =>
    (createRoutineTools()[T.routine].execute as unknown as Run)(input, {
      toolCallId: "routine",
      messages: [],
    });
  const job = { bot: "alpha", label: "Note check", request: "Do the check." };

  assert.match(
    String(await routine({ action: "create", ...job })),
    /Say when it starts/,
  );
  assert.match(
    String(
      await routine({ action: "create", ...job, time: "09:00", everyHours: 6 }),
    ),
    /Give one of `at`, `time` or `everyHours`/,
  );
  assert.match(
    String(
      await routine({ action: "create", ...job, bot: "Nobody", time: "09:00" }),
    ),
    /There is no bot called "Nobody"/,
  );

  const held = (await routine({
    action: "create",
    ...job,
    time: "09:00",
    days: [1, 2, 3, 4, 5],
  })) as { id: string; when: string; bot: string; note: string };
  assert.equal(held.bot, "Alpha");
  assert.equal(held.when, "Daily 09:00 · Mon–Fri");
  // A time is a promise kept whether or not anyone has the app open
  assert.ok(!held.note.includes("only while the app is open"));

  const listed = (await routine({ action: "list" })) as {
    routines: { id: string; enabled: boolean }[];
  };
  assert.ok(listed.routines.some((one) => one.id === held.id && one.enabled));
  const off = (await routine({
    action: "change",
    routine: "note check",
    enabled: false,
    everyHours: 6,
  })) as { enabled: boolean; when: string };
  assert.deepEqual([off.enabled, off.when], [false, "Every 6 hours"]);
  assert.match(
    String(await routine({ action: "delete", routine: held.id })),
    /starts no more/,
  );
});

test("a routine opens one thread when it is due, skips while its last run is open, and waits for its bot", async () => {
  const { routineTable } = await import("../database/tables.ts");
  const { createRoutine, deleteRoutine, findRoutine } = await import(
    "../features/routine/routine.query.ts"
  );
  const { startDueRoutines, runRoutineNow } = await import(
    "../features/routine/routine.clock.ts"
  );
  const { deleteThread } = await import("../features/bot/thread.query.ts");
  const routine = await createRoutine({
    bot: "alpha",
    label: "Morning check",
    request: "Check what came in since the last run.",
    schedule: { kind: "every", hours: 1 },
  });
  assert.equal(routine.bot, "Alpha", "the bot's own spelling is kept");
  const due = () =>
    database
      .update(routineTable)
      .set({ nextRunAt: new Date(Date.now() - 60_000) })
      .where(eq(routineTable.id, routine.id));
  const runs = async () => (await findRoutine(routine.id))!.runs;

  // Not due yet: nothing opens
  await startDueRoutines();
  assert.equal((await runs()).length, 0);

  // Due, and two looks at once open one thread between them
  await due();
  plans.set("Alpha", [
    (prompt) => {
      assert.ok(prompt.includes("A routine the user set up hands you"));
      assert.ok(prompt.includes("Every hour"));
      assert.ok(prompt.includes("This is its first run."));
      return text("Nothing new since yesterday.");
    },
  ]);
  await Promise.all([startDueRoutines(), startDueRoutines()]);
  assert.equal((await runs()).length, 1);
  const first = (await runs())[0];
  await waitFor(first.id, "done");
  assert.equal((await findThreadView(first.id))?.routineId, routine.id);
  assert.ok(
    (await findRoutine(routine.id))!.nextRunAt > new Date(),
    "moved on to its next time",
  );

  // The next run is told how the last one ended, and stands in for its unread ending
  await due();
  plans.set("Alpha", [
    (prompt) => {
      assert.ok(prompt.includes("Its last run ended"));
      assert.ok(prompt.includes("Nothing new since yesterday."));
      return ask("Thursday", "Which folder do the drafts go in?");
    },
  ]);
  await startDueRoutines();
  const second = (await runs())[0];
  assert.notEqual(second.id, first.id);
  await waitFor(second.id, "waiting");
  assert.equal((await findThread(first.id))?.seen, true);

  // A run still open is never stacked on: the time is skipped, by the clock and by hand
  await due();
  await startDueRoutines();
  assert.equal((await runs()).length, 2);
  assert.ok((await findRoutine(routine.id))!.nextRunAt > new Date());
  await assert.rejects(runRoutineNow(routine.id), /still open/);

  // A bot that cannot take a job holds the routine where it is, and it starts once the bot is back
  await cancelThread(second.id);
  await database
    .update(botTable)
    .set({ disabled: true })
    .where(eq(botTable.name, "Alpha"));
  await due();
  await startDueRoutines();
  assert.equal((await runs()).length, 2);
  assert.ok((await findRoutine(routine.id))!.nextRunAt < new Date(), "held");
  await database
    .update(botTable)
    .set({ disabled: false })
    .where(eq(botTable.name, "Alpha"));
  plans.set("Alpha", [() => text("Two new messages.")]);
  await startDueRoutines();
  const third = (await runs())[0];
  assert.equal((await runs()).length, 3);
  await waitFor(third.id, "done");

  await deleteRoutine(routine.id);
  assert.equal((await findThread(third.id))?.routineId, routine.id);
  for (const run of [first, second, third]) await deleteThread(run.id);
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
  const run = (await claimRoomWork(thread.id))!;
  const receipt = await sendRoomMessage(run, {
    id: "lost-receipt",
    to: "Beta",
    text: "Already committed",
    why: "the test's reason",
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
    () => [
      {
        type: "error",
        error:
          "Provider still unavailable on the retry (expected interruption)",
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

test("a provider failure streamed as its parsed body pauses in the provider's words", async () => {
  const { roomContextBudget } = await import("../features/bot/room.query.ts");
  // A streamed body with no `message` string reaches the run as the object it was
  // parsed into: the sdk wraps only bodies it can read words from.
  const unavailable = { error: { code: 503, type: "upstream_unavailable" } };
  const tooLong = "This model's maximum context length is 128000 tokens.";
  const broken = () => [{ type: "error", error: unavailable }];
  plans.set("Alpha", [broken, broken]);
  const id = await startThread({
    bot: "Alpha",
    request: "Fail with a provider body",
    label: "Provider body",
    from: "user",
  });
  const paused = await waitFor(id, "waiting");
  assert.equal(paused.outcome, JSON.stringify(unavailable));
  // One note before the retry, one where the room paused
  const rows = await rowsOf(id);
  const notes = rows.filter((row) => row.note);
  assert.equal(notes.length, 2);
  assert.equal(notes.at(-1)?.seq, rows.at(-1)?.seq);
  for (const note of notes)
    assert.ok(String(note.content).startsWith(`${paused.outcome} Resume`));
  assert.ok(
    (await listRoomRelays()).some(
      (relay) => relay.threadId === id && relay.text === paused.outcome,
    ),
  );
  assert.equal(await roomContextBudget(id, "Alpha"), undefined);

  // Read as an overflow: the retry compacts earlier instead of pausing
  plans.set("Alpha", [
    () => [{ type: "error", error: { error: tooLong } }],
    () => text("Recovered after the retry"),
  ]);
  await answerThread(id, "Continue");
  assert.equal(
    (await waitFor(id, "done")).outcome,
    "Recovered after the retry",
  );
  assert.ok(await roomContextBudget(id, "Alpha"));
});

test("a provider's refusal waits for a person at once; a break is tried once more on its own", async () => {
  const refused = new APICallError({
    message: "Invalid API key",
    url: "https://provider.test/v1",
    requestBodyValues: {},
    statusCode: 401,
    isRetryable: false,
  });
  plans.set("Alpha", [() => [{ type: "error", error: refused }]]);
  const id = await startThread({
    bot: "Alpha",
    request: "Fail with a refusal",
    label: "Refusal",
    from: "user",
  });
  const paused = await waitFor(id, "waiting");
  assert.equal(paused.outcome, "Invalid API key (401)");
  const notes = async () => (await rowsOf(id)).filter((row) => row.note).length;
  assert.equal(await notes(), 1);

  plans.set("Alpha", [
    () => [{ type: "error", error: "The stream broke in this test" }],
    () => text("Finished on the retry"),
  ]);
  await answerThread(id, "Continue");
  assert.equal((await waitFor(id, "done")).outcome, "Finished on the retry");
  assert.equal(await notes(), 2);
  // Resuming settles the stop it picked up from, and the retry is not an
  // interruption the call hears of
  assert.equal(
    (await listRoomRelays()).filter(
      (relay) => relay.threadId === id && relay.kind === "interrupted",
    ).length,
    0,
  );
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
  const root = (await claimRoomWork(thread.id))!;
  await sendRoomMessage(root, {
    id: "budget-message",
    to: "Beta",
    text: "Work within the accepted context",
    why: "the test's reason",
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

test("a question to Thursday waits on the user and names who asked", async () => {
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
  const root = (await claimRoomWork(thread.id))!;
  const sent = await sendRoomMessage(root, {
    id: "reply-to-thursday",
    to: "Thursday",
    text: "Which destination should I use?",
    why: "the test's reason",
    kind: "question",
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
        why: "the test's reason",
      }),
    () =>
      call(T.send_message, {
        to: "Thursday",
        text: "The requested work is complete.",
        why: "the test's reason",
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

test("a bot that loads a skill is shown the files that ship with it", async () => {
  plans.set("Alpha", [
    () => call(T.load_skill, { name: "skill-creator" }),
    (prompt) => {
      // The list is how a bot learns which script a skill's text points at
      assert.ok(prompt.includes("scripts/validate.mjs"));
      return text("Loaded.");
    },
  ]);
  const id = await startThread({
    bot: "Alpha",
    request: "Write this down as a skill",
    label: "Skill",
    from: "user",
  });
  await waitFor(id, "done");
  const parts = (await rowsOf(id)).flatMap((row): any[] =>
    Array.isArray(row.content) ? row.content : [],
  );
  const loaded = parts.find(
    (part) => part.type === "tool-result" && part.toolName === T.load_skill,
  );
  // Each as the path that opens it, not a name to be joined to the directory
  const { skillDirectory, files } = loaded.output.value;
  assert.deepEqual(
    files,
    ["LICENSE.txt", "SKILL.md", "scripts/validate.mjs"].map(
      (file) => `${skillDirectory}/${file}`,
    ),
  );
});
