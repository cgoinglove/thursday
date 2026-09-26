import { stat } from "node:fs/promises";
import { PATHS } from "@/config";
import { botOfArtifact } from "@/features/artifact/artifact.query";
import { pathsIn } from "@/features/workspace/file-kind";
import { botFolderName, insideWorkspace } from "@/features/workspace/workspace";
import { isPublicError, publicError } from "@/lib/public-error";
import { errorToString } from "@/lib/utils";
import { findJobBot } from "./bot.query";
import { resolveModel } from "./bot.run";
import { answerThread } from "./bot.runner";
import { type FileThread, isAppStop } from "./bot.schema";
import { listReportsNaming, listRoomWork } from "./room.query";
import { findThread } from "./thread.query";

/**
 * A note about a file, sent to the thread that made it: the way to ask for a change to a page
 * a bot wrote, or to go on from it, from where the file is open rather than from the room.
 * Which thread is the one the file was opened from, when the screen knows it (a finished card,
 * a message in the room); otherwise the latest whose coordinator reported the file, or another
 * file of its set, since a report stays for as long as its thread does. Everything that would
 * stop the note from being acted on is found before it is sent, and said, rather than after the
 * thread was taken up.
 */

/** Which thread, and whether a note could reach a bot in it. `path` is workspace-relative. */
export async function readFileThread(
  path: string,
  from: string | null = null,
): Promise<FileThread> {
  const full = await insideWorkspace(path);
  const file = full ? await stat(full).catch(() => null) : null;
  if (!file?.isFile()) return { state: "gone" };

  const thread = await threadOf(path, from);
  if (!thread) {
    return {
      state: "none",
      bot: await botOfArtifact(path),
      // The screen names a thread it opened the file from: one nobody has now was deleted since
      threadDeleted: from !== null,
    };
  }
  const ref = { id: thread.id, label: thread.label, bot: thread.bot };

  if (
    thread.status === "waiting" &&
    thread.pending &&
    !isAppStop(thread.pending)
  ) {
    return {
      state: "asking",
      thread: ref,
      bot: thread.pending.bot ?? thread.bot,
      question: thread.outcome ?? "",
    };
  }

  // The bot that made it, when it is one of this thread's; the coordinator otherwise, and when
  // the maker is gone the coordinator still holds the thread and can take it on
  const folder = path.split("/")[1]?.toLowerCase();
  const desks = [
    ...new Set((await listRoomWork(thread.id)).map((row) => row.bot)),
  ];
  const maker = desks.find(
    (bot) => bot !== thread.bot && botFolderName(bot).toLowerCase() === folder,
  );
  const to =
    (maker && (await findJobBot(maker))) ?? (await findJobBot(thread.bot));
  if (!to) {
    return {
      state: "refused",
      thread: ref,
      reason: "deleted",
      why: `${maker ?? thread.bot} was deleted, so nobody in this thread can take it up.`,
    };
  }
  try {
    // Re-read whenever a thread moves or a file changes: a check, not a run, so it logs nothing
    await resolveModel(to, { quiet: true });
  } catch (cause) {
    if (!isPublicError(cause)) throw cause;
    return {
      state: "refused",
      thread: ref,
      reason: "model",
      why: errorToString(cause),
    };
  }

  return {
    state: "open",
    thread: ref,
    status: thread.status,
    to: to.name,
    coordinator: thread.bot,
    paused:
      thread.status === "waiting" && isAppStop(thread.pending)
        ? thread.outcome
        : null,
  };
}

/** What the bot reads: the note under the file it is about, so it never has to guess which. */
export const aboutFile = (path: string, note: string) =>
  `About \`${path}\`:\n\n${note.trim()}`;

/** Sends the note, as the user, to whoever `readFileThread` names. */
export async function tellFileThread(
  path: string,
  note: string,
  from: string | null = null,
): Promise<{ id: string; label: string; to: string }> {
  const found = await readFileThread(path, from);
  if (found.state === "gone") publicError("This file is no longer on disk.");
  if (found.state === "none")
    publicError(
      `${found.threadDeleted ? "This file's thread was deleted." : "No thread's report names this file."} Hand it to a bot as a new job.`,
    );
  if (found.state === "asking")
    publicError(
      `${found.bot} is waiting on your answer to a question. Answer it in the thread first.`,
    );
  if (found.state === "refused") publicError(found.why);
  await answerThread(found.thread.id, aboutFile(path, note), "user", found.to);
  return { id: found.thread.id, label: found.thread.label, to: found.to };
}

/**
 * The thread the screen opened the file from, else the latest whose report named it, else the
 * latest that named another file of its set: one entry on a bot's shelf, a file or a folder of
 * several, is one piece of work (features/artifact), and a report names the files worth opening
 * rather than every picture a skill drew beside them. A report naming only a folder names no file
 * (`pathsIn` reads files) and finds nothing here, as it puts nothing on the finished card either:
 * the bot is asked to name each file (bot.prompt).
 */
async function threadOf(path: string, from: string | null) {
  if (from) return findThread(from);
  const set = setOf(path);
  const reports = await listReportsNaming(set ?? path);
  const latest = async (named: (one: string) => boolean) => {
    for (const report of reports) {
      if (!pathsIn(report.text).some(named)) continue;
      const thread = await findThread(report.threadId);
      if (thread) return thread;
    }
    return null;
  };
  return (
    (await latest((one) => one === path)) ??
    (set ? await latest((one) => one.startsWith(`${set}/`)) : null)
  );
}

/** The folder on a bot's shelf a file sits in, when it sits in one: `artifacts/<bot>/<set>`. */
function setOf(path: string): string | null {
  const [root, bot, set, ...inside] = path.split("/");
  return root === PATHS.artifacts && bot && set && inside.length
    ? `${root}/${bot}/${set}`
    : null;
}
