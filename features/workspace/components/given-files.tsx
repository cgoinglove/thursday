"use client";

import { Loader2, X } from "lucide-react";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "@/components/ui/toast";
import { GIVEN_FILES } from "@/config";
import { FileThumb } from "@/features/workspace/components/file-thumb";
import { giveFilesAction } from "@/features/workspace/workspace.action";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { cn } from "@/lib/utils";

/**
 * Files the user hands over with a message: the write line and a thread's reply both
 * take them this way. A file is kept in the workspace the moment it arrives
 * (giveFilesAction), so what waits beside the words is a path, and the message carries
 * it as one: a path in the words is how a bot is handed a file and how the room draws it.
 */

export type GivenFile = {
  key: string;
  name: string;
  bytes: number;
  /** Workspace-relative once it is kept; null while it is on its way. */
  path: string | null;
  /** A few words beside its size, from whoever took it (the write line on a call). */
  note?: string;
};

/**
 * Where the files wait when that is not the box itself: a thread's reply is drawn again
 * under another key as its recipient, question or pause changes, and what waits beside its
 * words is kept with them (thread.store `threadDrafts.files`).
 */
export type FilesHeld = {
  read(): GivenFile[];
  write(files: GivenFile[]): void;
  subscribe(listener: () => void): () => void;
};

const NO_FILES: GivenFile[] = [];
const noFiles = () => NO_FILES;
const never = () => () => {};

/**
 * Whether a file is small enough to send, said in the server's own words when it is not
 * (giveFilesAction). Checked before the upload: one past the limit went the whole way only
 * to be refused, and a body past the proxy's limit came back as a minified React error.
 */
function fits(file: File): boolean {
  if (file.size <= GIVEN_FILES.maxBytes) return true;
  toast.add({
    type: "error",
    title: `${file.name} is larger than ${Math.round(GIVEN_FILES.maxBytes / 1024 / 1024)} MB.`,
  });
  return false;
}

export function useGivenFiles(options?: {
  /** The files just kept, by path. What it answers is drawn beside each one's size. */
  onKept?: (paths: string[]) => string | undefined;
  /** Holds the files in place of this box, so they outlive it. */
  held?: FilesHeld;
}) {
  const onKept = useRef(options?.onKept);
  onKept.current = options?.onKept;
  const held = options?.held;
  const [own, setOwn] = useState<GivenFile[]>([]);
  const kept = useSyncExternalStore(
    held?.subscribe ?? never,
    held?.read ?? noFiles,
    noFiles,
  );
  const files = held ? kept : own;
  /** One that arrives after its box is gone still lands where the files are held. */
  const setFiles = useCallback(
    (change: (all: GivenFile[]) => GivenFile[]) => {
      if (held) held.write(change(held.read()));
      else setOwn(change);
    },
    [held],
  );
  const [give] = useServerAction(giveFilesAction);

  /** Keeps what fits beside the files already here; resolves to the paths it kept. */
  const take = useCallback(
    async (list: File[]): Promise<string[]> => {
      const fitting = list.filter(fits);
      const room = GIVEN_FILES.perMessage - files.length;
      if (fitting.length > room)
        toast.add({
          type: "error",
          title: `At most ${GIVEN_FILES.perMessage} files at a time.`,
        });
      const taken = fitting.slice(0, Math.max(0, room));
      if (!taken.length) return [];
      const batch: GivenFile[] = taken.map((file) => ({
        key: crypto.randomUUID(),
        name: file.name,
        bytes: file.size,
        path: null,
      }));
      setFiles((all) => [...all, ...batch]);
      const form = new FormData();
      for (const file of taken) form.append("file", file);
      try {
        const paths = await give(form);
        const note = onKept.current?.(paths);
        setFiles((all) =>
          all.map((one) => {
            const at = batch.findIndex((mine) => mine.key === one.key);
            return at < 0 ? one : { ...one, path: paths[at] ?? null, note };
          }),
        );
        return paths;
      } catch {
        // the hook has already said why; what did not arrive does not wait here
        setFiles((all) =>
          all.filter((one) => !batch.some((mine) => mine.key === one.key)),
        );
        return [];
      }
    },
    [files.length, give, setFiles],
  );

  /**
   * Keeps one file in the workspace without holding it here, for what goes on its own (a
   * drawing shown on a spoken call, write-line). Resolves to its path; null when it was not
   * kept, and the hook has already said why.
   */
  const keepApart = useCallback(
    async (file: File): Promise<string | null> => {
      if (!fits(file)) return null;
      const form = new FormData();
      form.append("file", file);
      try {
        return (await give(form))[0] ?? null;
      } catch {
        return null;
      }
    },
    [give],
  );

  return {
    files,
    take,
    keepApart,
    remove: (key: string) =>
      setFiles((all) => all.filter((one) => one.key !== key)),
    clear: () => setFiles(() => []),
    /** Some file is still on its way: a message sent now would leave it behind. */
    arriving: files.some((file) => file.path === null),
    /** The workspace paths of the files kept, in the order they were put down. */
    paths: files.flatMap((file) => file.path ?? []),
    /** The words with every kept file's path under them. */
    withPaths: (words: string) =>
      [words.trim(), ...files.flatMap((file) => file.path ?? [])]
        .filter(Boolean)
        .join("\n"),
  };
}

/** The files waiting beside the words, each with its own face once it is kept. */
export function GivenFiles({
  files,
  onRemove,
  dense = false,
  children,
  className,
}: {
  files: GivenFile[];
  onRemove: (key: string) => void;
  /** The thread reply's size rather than the write line's. */
  dense?: boolean;
  /** After the files: the write line's slot for one being dragged in. */
  children?: React.ReactNode;
  className?: string;
}) {
  const face = dense ? "size-8 rounded-lg" : "size-10 rounded-[9px]";
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {files.map((file) => (
        <span
          key={file.key}
          className={cn(
            "flex max-w-64 items-center bg-muted/70",
            dense
              ? "h-10.5 gap-2 rounded-xl py-1 pr-1.5 pl-1"
              : "h-13 gap-2.5 rounded-[14px] py-1.5 pr-2 pl-1.5",
          )}
        >
          {file.path ? (
            <FileThumb
              path={file.path}
              bytes={file.bytes}
              className={cn(
                "shrink-0 overflow-hidden ring-1 ring-foreground/6",
                face,
              )}
            />
          ) : (
            <span
              className={cn(
                "grid shrink-0 place-items-center bg-background text-muted-foreground ring-1 ring-foreground/6",
                face,
              )}
            >
              <Loader2 className="size-3.5 animate-spin" />
            </span>
          )}
          <span className="flex min-w-0 flex-col">
            <span
              className={cn(
                "truncate",
                dense ? "text-xs leading-4" : "text-[12.5px] leading-4.5",
              )}
            >
              {file.name}
            </span>
            <span className="font-mono text-[10px] leading-3.5 text-muted-foreground">
              {sizeOf(file.bytes)}
              {file.note && ` · ${file.note}`}
            </span>
          </span>
          <button
            type="button"
            aria-label={`Take ${file.name} out`}
            onClick={() => onRemove(file.key)}
            className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <X className="size-3.5" />
          </button>
        </span>
      ))}
      {children}
    </div>
  );
}

/**
 * Where a drop on the window goes. A thread open in the room takes what is dropped on
 * the room; everywhere else, and with no thread open, it is the write line's.
 */
let claimed: ((files: File[]) => void) | null = null;

export const roomDrop = {
  /** The open thread's reply asks for drops on the room; the answer releases them. */
  claim(take: (files: File[]) => void) {
    claimed = take;
    return () => {
      if (claimed === take) claimed = null;
    };
  },
  /** Hands the files to the open thread when the drop landed on the room. */
  offer(target: EventTarget | null, files: File[]): boolean {
    if (!claimed || !(target as HTMLElement | null)?.closest?.("[data-room]"))
      return false;
    claimed(files);
    return true;
  },
};

const sizeOf = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
