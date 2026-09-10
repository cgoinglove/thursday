export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { APP_DIR, APP_NAME, DATA_DIR } = await import("@/config");
  const { logger } = await import("@/lib/logger");

  const { migrateDatabase } = await import("@/database/migrate");
  await migrateDatabase();

  // The two notes about the user must exist before any prompt lists them.
  const { ensureRootNotes } = await import("@/features/memory/memory.query");
  await ensureRootNotes();

  // Tasks left `running` by the previous process are not running now.
  const { sweepTasks } = await import("@/features/bot/bot.runner");
  await sweepTasks();

  // Same for calls: an open call row from a vanished tab would route finished
  // jobs to a listener that is not there (bot.runner).
  const { sweepCalls } = await import("@/features/thursday/thursday.query");
  await sweepCalls();

  // With no browser on the app nothing runs: jobs stop and wait, and a call
  // left open closes. Nothing resumes by itself — a job waits to be picked up
  // by hand (bot.runner pauseTasks).
  const { presence } = await import("@/app/api/events/app-event.server");
  const { pauseTasks } = await import("@/features/bot/bot.runner");
  presence.onGone(() => {
    logger.info("browser gone — stopping what was running");
    void pauseTasks("The browser closed while this was running.").catch(
      (cause) => logger.error("pause tasks", cause),
    );
    void sweepCalls().catch((cause) => logger.error("sweep calls", cause));
  });

  // The two roots are the first thing to check when a fresh clone reads the
  // wrong database or cannot find its skills (config APP_DIR / DATA_DIR)
  logger.info(`${APP_NAME} is up — app ${APP_DIR}, data ${DATA_DIR}`);

  // Not awaited: the app is usable without it, and a first run is on the intro
  // screen for about as long as the download takes.
  const { ensureBrowser } = await import("@/features/workspace/workspace");
  void ensureBrowser().catch((cause) => logger.debug("browser fetch", cause));
}
