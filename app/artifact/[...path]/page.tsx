import { open, readFile, stat } from "node:fs/promises";
import { notFound } from "next/navigation";
import { decodePath, queryKey } from "@/app/api/query-key";
import { WORKSPACE_VIEW } from "@/config";
import { FileBody } from "@/features/workspace/components/file-view";
import { viewKindOf } from "@/features/workspace/file-kind";
import { insideWorkspace } from "@/features/workspace/workspace";

/**
 * Viewer for one workspace file. Text kinds render here; html and pdf go in an
 * iframe so their styles and sibling files resolve through /api/file.
 */

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ path: string[] }> };

const relOf = async (params: Params["params"]) =>
  decodePath((await params).path);

export async function generateMetadata({ params }: Params) {
  const rel = await relOf(params);
  return { title: rel.split("/").pop() ?? rel };
}

export default async function ArtifactPage({ params }: Params) {
  const rel = await relOf(params);
  const full = await insideWorkspace(rel);
  if (!full) notFound();

  const kind = viewKindOf(rel);

  return (
    <main className="min-h-screen bg-background">
      <header className="flex h-10 items-center gap-2 border-b border-border/60 px-4">
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted-foreground">
          {rel}
        </span>
        <a
          href={queryKey.file(rel)}
          download
          className="shrink-0 font-mono text-[11px] text-muted-foreground hover:text-foreground"
        >
          Download
        </a>
      </header>

      {kind === "frame" ? (
        // No sandbox: the html is local and just written by the bot; sandboxing
        // only breaks its forms, fonts and scripts.
        <iframe
          title={rel}
          src={queryKey.file(rel)}
          allow="clipboard-read; clipboard-write; fullscreen; autoplay"
          className="h-[calc(100vh-2.5rem)] w-full bg-white"
        />
      ) : kind === "image" ? (
        // biome-ignore lint/performance/noImgElement: local raw route, nothing to optimize
        <img
          src={queryKey.file(rel)}
          alt={rel}
          className="mx-auto max-w-full p-6"
        />
      ) : kind === "audio" ? (
        // The browser plays it; /api/file answers Range, so seeking works.
        <audio
          controls
          src={queryKey.file(rel)}
          className="mx-auto mt-10 w-full max-w-xl px-6"
        >
          <track kind="captions" />
        </audio>
      ) : kind === "video" ? (
        <video
          controls
          src={queryKey.file(rel)}
          className="mx-auto max-h-[calc(100vh-2.5rem)] max-w-full p-6"
        >
          <track kind="captions" />
        </video>
      ) : kind === "none" ? (
        <p className="p-6 font-mono text-xs text-muted-foreground">
          Nothing here knows how to draw this file — download it above.
        </p>
      ) : (
        <Loaded full={full} kind={kind} />
      )}
    </main>
  );
}

/** Reads text kinds on the server so the page needs one round trip. */
async function Loaded({
  full,
  kind,
}: {
  full: string;
  kind: ReturnType<typeof viewKindOf>;
}) {
  const info = await stat(full).catch(() => null);
  if (!info?.isFile()) notFound();

  // The text goes into the RSC payload whole, so a huge file would freeze the
  // tab; past the cap only the head is sent and FileBody says so.
  const over = info.size > WORKSPACE_VIEW.textMax;
  const content = over
    ? await readHead(full, WORKSPACE_VIEW.textMax)
    : await readFile(full, "utf-8").catch(() => null);
  if (content === null) notFound();

  return (
    // 5xl: reports are half tables and code, which scroll inside their boxes at reading width.
    <div className="mx-auto max-w-5xl">
      <FileBody
        kind={kind}
        content={content}
        truncated={over ? info.size : null}
        where="page"
      />
    </div>
  );
}

/** First `limit` bytes; the last, partial line is dropped. */
async function readHead(full: string, limit: number) {
  const handle = await open(full).catch(() => null);
  if (!handle) return null;
  try {
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    const text = buffer.subarray(0, bytesRead).toString("utf-8");
    const lastBreak = text.lastIndexOf("\n");
    return lastBreak > 0 ? text.slice(0, lastBreak) : text;
  } finally {
    await handle.close();
  }
}
