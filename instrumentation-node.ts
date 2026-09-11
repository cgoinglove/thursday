export async function boot() {
  const { APP_DIR, APP_NAME, DATA_DIR, WORKSPACE_KEEP } = await import(
    "@/config"
  );
  const { logger } = await import("@/lib/logger");

  const { migrateDatabase } = await import("@/database/migrate");
  await migrateDatabase();

  // The two notes about the user must exist before any prompt lists them.
  const { ensureRootNotes } = await import("@/features/memory/memory.query");
  await ensureRootNotes();

  // Tasks left `running` by the previous process are not running now.
  const { sweepJobFiles, sweepTasks } = await import(
    "@/features/bot/bot.runner"
  );
  await sweepTasks();

  // What jobs left behind is cleared by age (config WORKSPACE_KEEP): once now,
  // then on a timer. Housekeeping rather than work, so no browser is needed.
  // After sweepTasks, so a job the last process left running counts as waiting.
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

  // With no browser on the app nothing runs: jobs stop and wait, and a call
  // left open closes. When one is back, what the app stopped — a restart, a
  // closed browser, a model call that failed for a moment — picks itself back
  // up (bot.runner parkTask); what a bot or a person stopped waits for a person.
  const { presence } = await import("@/app/api/events/app-event.server");
  const { pauseTasks, resumeStoppedTasks } = await import(
    "@/features/bot/bot.runner"
  );
  presence.onGone(() => {
    logger.info("browser gone — stopping what was running");
    void pauseTasks("The browser closed while this was running.").catch(
      (cause) => logger.error("pause tasks", cause),
    );
    void sweepCalls().catch((cause) => logger.error("sweep calls", cause));
  });
  presence.onBack(() => {
    void resumeStoppedTasks().catch((cause) =>
      logger.error("resume tasks", cause),
    );
  });

  // A stop sent to `thursday` parks what is running before the process goes,
  // so the next start picks it back up instead of finding it cut off. The
  // launcher hands the signal over (bin/thursday.mjs NEXT_MANUAL_SIG_HANDLE);
  // `next dev` never does, and a restart there is found at boot (sweepTasks).
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
        const parked = pauseTasks(
          "The server was shut down while this was running.",
        ).catch((cause) => logger.error("pause tasks", cause));
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
