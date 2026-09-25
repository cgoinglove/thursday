export async function boot() {
  const { APP_DIR, APP_NAME, DATA_DIR, DB_PATH, HISTORY_KEEP, WORKSPACE_KEEP } =
    await import("@/config");
  const { logger } = await import("@/lib/logger");

  // Nothing can run on a database this build cannot migrate, and nothing can
  // remove it while this process holds it: say why, then exit with the code
  // both starters answer by offering to set it aside (bin/database.mjs).
  const { migrateDatabase } = await import("@/database/migrate");
  await migrateDatabase().catch((cause) => {
    logger.error(`Cannot migrate ${DB_PATH}`);
    console.error(
      `  ${cause instanceof Error ? cause.message : cause}\n` +
        "  Starting over gives an empty one. API keys, bots, connectors, calls, threads and memory go with it; the workspace and skills stay.\n" +
        `  The old ${DB_PATH} is moved aside as .corrupt-<time> rather than removed, so a file damaged by a crash or a full disk can still be opened.\n`,
    );
    process.exit(65);
  });

  // The two notes about the user must exist before any prompt lists them.
  const { ensureRootNotes } = await import("@/features/memory/memory.query");
  await ensureRootNotes();

  // Before a call can ask for it (features/ai/guide).
  const { installGuide } = await import("@/features/ai/guide");
  await installGuide().catch((cause) => logger.error("install guide", cause));

  // Threads left `running` by the previous process are not running now.
  const { sweepJobFiles, sweepThreads } = await import(
    "@/features/bot/bot.runner"
  );
  await sweepThreads();

  // And a job an older build left ended while its room still held an open question is over:
  // it owed every count an answer no list could show (thread.query closeEndedQuestions).
  const { closeEndedQuestions } = await import("@/features/bot/thread.query");
  await closeEndedQuestions()
    .then(({ closed, cleared }) => {
      if (closed || cleared)
        logger.info(`closed ${closed} question(s) on ${cleared} ended job(s)`);
    })
    .catch((cause) => logger.error("close ended questions", cause));

  // What jobs left behind is cleared by age (config WORKSPACE_KEEP): once now,
  // then on a timer. Housekeeping rather than work, so no browser is needed.
  // After sweepThreads, so a job the last process left running counts as waiting.
  const sweepFiles = () =>
    void sweepJobFiles().catch((cause) =>
      logger.error("sweep job files", cause),
    );
  sweepFiles();
  setInterval(sweepFiles, WORKSPACE_KEEP.sweepEveryMs).unref();

  // Same for calls: an open call row from a vanished tab would route finished
  // jobs to a listener that is not there (bot.runner).
  const { deleteEndedCalls, sweepCalls } = await import(
    "@/features/thursday/thursday.query"
  );
  await sweepCalls();

  // And what the app kept of its own use goes by age as well (config HISTORY_KEEP):
  // an ended call with its turns, a job that is over with its messages. After
  // sweepThreads and sweepCalls, so nothing the last process left open is counted
  // as finished. A job's results are not in these rows — they are in `artifacts/`.
  const { removeFinishedThreads } = await import("@/features/bot/bot.runner");
  const sweepHistory = () =>
    void (async () => {
      const before = new Date(Date.now() - HISTORY_KEEP.forMs);
      const calls = await deleteEndedCalls(before);
      const jobs = await removeFinishedThreads(before);
      if (calls || jobs)
        logger.info(`cleared ${calls} old call(s) and ${jobs} old job(s)`);
    })().catch((cause) => logger.error("sweep history", cause));
  sweepHistory();
  setInterval(sweepHistory, HISTORY_KEEP.sweepEveryMs).unref();

  // Work runs for as long as the server does, watched or not: a phone, a routine and a
  // server kept up from login all start it with no browser open. What a tab alone held goes
  // with the tab — its calls — and a conversation the server holds for a phone stays (reach).
  const { presence } = await import("@/app/api/events/app-event.server");
  const { pauseThreads } = await import("@/features/bot/bot.runner");
  const { heldCalls } = await import("@/features/reach/reach");
  presence.onGone(() => {
    void sweepCalls(heldCalls()).catch((cause) =>
      logger.error("browser gone", cause),
    );
  });

  // Routines start themselves from here on; a start is a thread, so everything above holds for it
  const { startRoutineClock } = await import(
    "@/features/routine/routine.clock"
  );
  startRoutineClock();

  // Sessions bots kept among their own files move to where the app keeps them
  const { adoptKeptSessions } = await import(
    "@/features/signins/signins.query"
  );
  await adoptKeptSessions().catch((cause) =>
    logger.error("adopt kept sessions", cause),
  );

  // Someone writing from a phone is answered from here on, when a bot token is set
  const { startReach } = await import("@/features/reach/reach");
  void startReach().catch((cause) => logger.error("start reach", cause));

  // The launcher forwards shutdown signals so pending work records its manual resume boundary.
  if (process.env.NEXT_MANUAL_SIG_HANDLE) {
    const { checkpoint } = await import("@/database/db");
    let stopping = false;
    for (const [signal, code] of [
      ["SIGINT", 130],
      ["SIGTERM", 143],
    ] as const) {
      process.on(signal, () => {
        if (stopping) return;
        stopping = true;
        logger.info(`${signal} — parking what was running`);
        const parked = pauseThreads(
          "The server was shut down while this was running.",
        )
          .catch((cause) => logger.error("pause threads", cause))
          // Nothing writes after this, so the write-ahead log can be folded back
          // in: from here the database is one file to copy (guide/setup).
          .then(() => checkpoint())
          .catch((cause) => logger.error("checkpoint", cause));
        // The launcher kills the server four seconds after passing a stop on
        const late = new Promise((resolve) => setTimeout(resolve, 3_000));
        void Promise.race([parked, late]).finally(() => process.exit(code));
      });
    }
  }

  // The two roots are the first thing to check when a fresh clone reads the
  // wrong database or cannot find its skills (config APP_DIR / DATA_DIR)
  logger.info(`${APP_NAME} is up — app ${APP_DIR}, data ${DATA_DIR}`);

  // Not awaited: the app is usable without it, and a first run is on the intro
  // screen for about as long as the download takes.
  const { ensureBrowser } = await import("@/features/workspace/workspace");
  void ensureBrowser().catch((cause) => logger.debug("browser fetch", cause));
}
