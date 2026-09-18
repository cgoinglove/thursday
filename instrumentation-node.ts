export async function boot() {
  const { APP_DIR, APP_NAME, DATA_DIR, DB_FILE_NAME, WORKSPACE_KEEP } =
    await import("@/config");
  const { logger } = await import("@/lib/logger");

  // Nothing can run on a database this build cannot migrate, and nothing can
  // remove it while this process holds it: say why, then exit with the code
  // both starters answer by offering to remove it (bin/database.mjs).
  const { migrateDatabase } = await import("@/database/migrate");
  await migrateDatabase().catch((cause) => {
    const path = DB_FILE_NAME.replace(/^file:/, "");
    logger.error(`Cannot migrate ${path}`);
    console.error(
      `  ${cause instanceof Error ? cause.message : cause}\n` +
        "  Removing it starts over with an empty one. API keys, bots, connectors, calls, threads and memory go with it; the workspace and skills stay.\n" +
        `  rm "${path}" "${path}-wal" "${path}-shm"\n`,
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
  const { sweepCalls } = await import("@/features/thursday/thursday.query");
  await sweepCalls();

  // Browser absence pauses work automatically unless the user asked for it to go on
  // (bot.schema KEEP_WORKING_KEY). Restart and failure always require manual resume.
  const { presence } = await import("@/app/api/events/app-event.server");
  const { pauseThreads, resumeStoppedThreads } = await import(
    "@/features/bot/bot.runner"
  );
  const { readKeepWorkingOn } = await import("@/features/bot/bot.query");
  presence.onGone(() => {
    void (async () => {
      // The user's call (Settings › Bots): work either waits for them or runs on
      if (await readKeepWorkingOn()) {
        logger.info("browser gone — work goes on");
      } else {
        logger.info("browser gone — stopping what was running");
        await pauseThreads("The browser closed while this was running.", true);
      }
      // The line is gone with the tab either way
      await sweepCalls();
    })().catch((cause) => logger.error("browser gone", cause));
  });
  presence.onBack(() => {
    void resumeStoppedThreads().catch((cause) =>
      logger.error("resume threads", cause),
    );
  });

  // The launcher forwards shutdown signals so pending work records its manual resume boundary.
  if (process.env.NEXT_MANUAL_SIG_HANDLE) {
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
        ).catch((cause) => logger.error("pause threads", cause));
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
