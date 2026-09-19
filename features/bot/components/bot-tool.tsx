"use client";

import {
  Camera,
  Check,
  ChevronDown,
  ExternalLink,
  Eye,
  FilePen,
  FileText,
  Globe,
  KeyRound,
  ListChecks,
  Loader2,
  type LucideIcon,
  MessageSquare,
  PhoneOff,
  Send,
  Terminal,
  Wrench,
} from "lucide-react";
import { type ComponentType, type ReactNode, useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { ShinyText } from "@/components/ui/shiny-text";
import { hostOf, SiteIcon } from "@/components/ui/site-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { SourceChips, type SourcePage } from "@/components/ui/source-chips";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import type { ResultPart } from "@/features/bot/bot.schema";
import { imagePathsIn } from "@/features/bot/components/attachments";
import { McpMark } from "@/features/connectors/components/mcp-mark";
import { MemoryMark } from "@/features/memory/components/memory-mark";
import { SkillsMark } from "@/features/skills/components/skills-mark";
import { FileLink } from "@/features/workspace/components/file-view";
import { useServerRoute } from "@/lib/protocol/use-server-route";
import { cn } from "@/lib/utils";
import type { ToolUse } from "../thread.store";

/*
 * Tool calls rendered per tool: TOOL_VIEWS by name, GenericTool for the rest. Results
 * arrive as a glance (thread.query RESULT_LINES, each line clipped); "Everything"
 * fetches the whole output, and only once it is opened.
 */

type ToolProps = {
  tool: ToolUse;
  /** Half of the key for fetching the full result. */
  threadId?: string;
  /** Start folded to the title line. A running tool is always expanded regardless. */
  collapsed?: boolean;
};

const TOOL_VIEWS: Partial<Record<string, ComponentType<ToolProps>>> = {
  [TOOL_NAMES.web_search]: WebSearchTool,
  [TOOL_NAMES.bash]: ShellTool,
  [TOOL_NAMES.write_file]: FileTool,
};

/**
 * Icon per tool, for views with room for one glyph. A tool that belongs to a
 * domain draws that domain's own mark, so the pill and the nav never disagree.
 */
const TOOL_ICONS: Partial<Record<string, LucideIcon>> = {
  [TOOL_NAMES.web_search]: Globe,
  [TOOL_NAMES.bash]: Terminal,
  [TOOL_NAMES.write_file]: FilePen,
  [TOOL_NAMES.memory_recall]: MemoryMark,
  [TOOL_NAMES.memory_remember]: MemoryMark,
  [TOOL_NAMES.memory_forget]: MemoryMark,
  [TOOL_NAMES.memory_conversation]: MemoryMark,
  [TOOL_NAMES.load_skill]: SkillsMark,
  [TOOL_NAMES.tool_search]: McpMark,
  [TOOL_NAMES.tool_call]: McpMark,
  [TOOL_NAMES.thread_start]: Send,
  [TOOL_NAMES.thread_tell]: Send,
  [TOOL_NAMES.thread_answer]: Send,
  [TOOL_NAMES.thread_status]: ListChecks,
  [TOOL_NAMES.thread_cancel]: ListChecks,
  [TOOL_NAMES.thread_show]: ListChecks,
  [TOOL_NAMES.thread_seen]: ListChecks,
  [TOOL_NAMES.send_message]: MessageSquare,
  [TOOL_NAMES.look_at]: Eye,
  [TOOL_NAMES.sign_in_use]: KeyRound,
  [TOOL_NAMES.sign_in_keep]: KeyRound,
  [TOOL_NAMES.end_call]: PhoneOff,
};

export const toolIcon = (name: string): LucideIcon =>
  TOOL_ICONS[name] ?? Wrench;

/**
 * What a step did, read off the call alone: the glyph that says it, and what stands
 * beside it on its row — the site it opened, the pages a search read, the picture it
 * took, the file or program by name. A row that says `bash` six times says nothing;
 * this is only how a step is drawn, and a command it cannot place is a terminal line.
 */
type StepFace = {
  icon: LucideIcon;
  host?: string;
  pages?: SourcePage[];
  image?: string;
  target?: string;
};

/** Commands that look at files rather than do something to them. */
const READS = new Set([
  "cat",
  "sed",
  "head",
  "tail",
  "grep",
  "rg",
  "ls",
  "find",
  "wc",
  "awk",
  "jq",
]);

const nameOf = (path: string) => path.split("/").pop() ?? path;

/** A search's glance lines are `title — url`; the pages are read back out of them. */
function pagesOf(tool: ToolUse): SourcePage[] {
  return texts(tool.results).flatMap((line) => {
    const url = /https?:\/\/\S+/.exec(line)?.[0];
    if (!url) return [];
    const title = line.slice(0, line.indexOf(url)).replace(/[\s—-]+$/, "");
    return [{ url, ...(title ? { title } : {}) }];
  });
}

export function stepFace(tool: ToolUse): StepFace {
  const image = imagePathsIn(`${tool.path ?? ""} ${tool.input}`)[0];
  if (tool.name === TOOL_NAMES.web_search)
    return { icon: Globe, pages: pagesOf(tool) };
  if (tool.name === TOOL_NAMES.write_file)
    return { icon: FilePen, image, target: nameOf(tool.path ?? tool.input) };
  if (tool.name !== TOOL_NAMES.bash)
    return { icon: toolIcon(tool.name), image };

  // `cd somewhere &&` says where, not what
  const command = tool.input.replace(/^\s*cd\s+\S+\s*&&\s*/, "").trim();
  const [first = ""] = command.split(/\s+/);
  // The browser wherever it stands in the line — behind `npx`, an env assignment, a
  // chain — and its verb past any flags: a step that browsed reads as browsing
  const browsed = /(?:^|[\s;&|(])playwright-cli((?:\s+-\S+)*)\s+([a-z-]+)/.exec(
    command,
  );
  if (browsed) {
    if (browsed[2] === "screenshot") return { icon: Camera, image };
    const url = /https?:\/\/[^\s'"]+/.exec(command)?.[0];
    return { icon: Globe, host: (url && hostOf(url)) || undefined, image };
  }
  if (READS.has(first))
    return {
      icon: FileText,
      image,
      target: tool.path ? nameOf(tool.path) : undefined,
    };
  return { icon: Terminal, image, target: first || undefined };
}

/** A finished step as one tile of a folded run: its picture, its site, or its glyph. */
export function StepTile({
  tool,
  onOpen,
}: {
  tool: ToolUse;
  onOpen: () => void;
}) {
  const face = stepFace(tool);
  const [gone, setGone] = useState(false);
  const Icon = face.icon;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={tool.note ?? tool.input}
      aria-label={tool.note ?? tool.input}
      className="grid size-6 shrink-0 place-items-center overflow-hidden rounded-full bg-background text-muted-foreground outline-none transition-transform hover:scale-110 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {face.image && !gone ? (
        // biome-ignore lint/performance/noImgElement: local raw route, nothing to optimize
        <img
          src={queryKey.file(face.image)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setGone(true)}
          className="size-full object-cover"
        />
      ) : face.host ? (
        <SiteIcon
          host={face.host}
          className="size-3.5 rounded-full"
          fallback={<Icon className="size-3" />}
        />
      ) : (
        <Icon className="size-3" />
      )}
    </button>
  );
}

/** What stands beside a step's words: where it went, what it read, what it touched. */
function StepTarget({ face }: { face: StepFace }) {
  if (face.pages?.length) {
    const hosts = [
      ...new Set(face.pages.flatMap((page) => hostOf(page.url) ?? [])),
    ].slice(0, 3);
    return (
      <span className="flex shrink-0 items-center gap-1">
        {hosts.map((host) => (
          <SiteIcon key={host} host={host} />
        ))}
      </span>
    );
  }
  if (face.host)
    return (
      <span className="flex h-5 shrink-0 items-center gap-1.5 rounded-full bg-muted pr-2 pl-1 text-[11px] text-foreground/80">
        <SiteIcon host={face.host} />
        {face.host}
      </span>
    );
  if (face.target && !face.image)
    return (
      <span className="max-w-40 shrink truncate font-mono text-[10.5px] text-muted-foreground">
        {face.target}
      </span>
    );
  return null;
}

export function BotTool(props: ToolProps) {
  const View = TOOL_VIEWS[props.tool.name] ?? GenericTool;
  return <View {...props} />;
}

function WebSearchTool({ tool, threadId, collapsed }: ToolProps) {
  const pages = pagesOf(tool);
  // Lines that name no page (a provider's own summary) still read as lines
  const hits = pages.length ? [] : texts(tool.results);
  return (
    <Frame tool={tool} threadId={threadId} collapsed={collapsed}>
      <p className="px-3 pt-1 pb-1.5 text-[13px] leading-snug break-keep">
        “{tool.input}”
      </p>
      {pages.length > 0 && (
        <SourceChips sources={pages} className="px-3 pb-2" />
      )}
      {hits.length > 0 && (
        <ol className="space-y-0.5 px-3 pb-2">
          {hits.map((hit, at) => (
            <li
              key={`${at}-${hit}`}
              className="flex gap-2 text-[11.5px] leading-snug text-muted-foreground"
            >
              <span className="mt-1.25 size-1 shrink-0 rounded-full bg-muted-foreground/50" />
              <span className="truncate">{hit}</span>
            </li>
          ))}
        </ol>
      )}
    </Frame>
  );
}

function ShellTool({ tool, threadId, collapsed }: ToolProps) {
  const out = texts(tool.results);
  return (
    <Frame tool={tool} threadId={threadId} collapsed={collapsed}>
      <pre className="mx-3 overflow-x-auto rounded-lg bg-foreground/5 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed scrollbar-none dark:bg-black/25">
        <span className="text-muted-foreground/60">$ </span>
        {tool.input}
        {out.length > 0 && (
          <span className="block text-muted-foreground">{out.join("\n")}</span>
        )}
      </pre>
    </Frame>
  );
}

const OPEN_BUTTON =
  "flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground outline-none transition-colors hover:bg-background hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

/**
 * A file the bot read or wrote, with an Open link. Opens `tool.path`: `input` is folded
 * to one line, and a truncated path is a 404 (thread.query LINE_MAX).
 */
function FileTool({ tool, threadId, collapsed }: ToolProps) {
  const path = tool.path ?? tool.input;
  return (
    <Frame tool={tool} threadId={threadId} collapsed={collapsed}>
      <div className="flex items-center gap-2 px-3 pt-1 pb-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
          {tool.input}
        </span>
        <FileLink path={path} label={`Open ${path}`} className={OPEN_BUTTON}>
          <ExternalLink className="size-3" />
          Open
        </FileLink>
      </div>
      <Lines lines={texts(tool.results)} mono />
    </Frame>
  );
}

/** Anything without a view of its own, MCP tools included. */
function GenericTool({ tool, threadId, collapsed }: ToolProps) {
  return (
    <Frame tool={tool} threadId={threadId} collapsed={collapsed}>
      <p className="px-3 pt-1 pb-1.5 text-[12px] leading-snug break-keep">
        {tool.input}
      </p>
      <Lines lines={texts(tool.results)} />
    </Frame>
  );
}

/**
 * The shell every tool view sits in: a one-line step (what it did, its words, what it touched,
 * state) with the body below it. A running tool is always expanded; a finished one
 * that returned anything gets "Everything" at the bottom.
 */
function Frame({
  tool,
  threadId,
  collapsed = false,
  children,
}: ToolProps & { children: ReactNode }) {
  const running = tool.results === undefined;
  const face = stepFace(tool);
  const Did = face.icon;
  const [open, setOpen] = useState(!collapsed);
  const shown = open || running;
  // The glance is text only and clipped, so any output can be opened whole
  const whole =
    threadId && tool.callId && ((tool.results?.length ?? 0) > 0 || tool.more);

  return (
    <div
      className={cn(
        "@container w-full overflow-hidden rounded-xl transition-colors",
        shown ? "bg-background/80 dark:bg-white/4" : "hover:bg-foreground/4",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={shown}
        className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="grid size-5 shrink-0 place-items-center rounded-[7px] bg-foreground/8 text-muted-foreground">
          {running ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Did className="size-3" />
          )}
        </span>

        {tool.note ? (
          <>
            {running ? (
              <ShinyText
                text={tool.note}
                speed={2.4}
                className="min-w-0 flex-1 truncate text-[12px] leading-4 break-keep"
              />
            ) : (
              <span className="min-w-0 flex-1 truncate text-[12px] leading-4 break-keep">
                {tool.note}
              </span>
            )}
            {/* The raw call beside the label, only where there is room for both. */}
            <span className="hidden min-w-0 flex-1 truncate font-mono text-[11px] leading-4 text-muted-foreground/85 @lg:block">
              {tool.input}
            </span>
          </>
        ) : running ? (
          // No label from the model, so the raw call is the live line.
          <ShinyText
            text={tool.input}
            speed={2.4}
            className="min-w-0 flex-1 truncate font-mono text-[11px] leading-4"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] leading-4 text-foreground/80">
            {tool.input}
          </span>
        )}

        <StepShots paths={imagePathsIn(`${tool.path ?? ""} ${tool.input}`)} />
        <StepTarget face={face} />
        {!running && (
          <Check className="size-3 shrink-0 text-muted-foreground/50" />
        )}
        <ChevronDown
          className={cn(
            "size-3 shrink-0 text-muted-foreground/50 transition-transform",
            shown && "rotate-180",
          )}
        />
      </button>
      {shown && (
        <div className="pb-1.5 pl-[1.625rem]">
          {children}
          {whole && (
            <Everything threadId={threadId} callId={tool.callId as string} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Images the call itself names, tucked on its row: what a step drew or captured
 * shows without opening it. The file may not be there — a path in a command is
 * no promise — so one that does not load drops out rather than asking the server.
 */
function StepShots({ paths }: { paths: string[] }) {
  const [gone, setGone] = useState<string[]>([]);
  const shown = paths.filter((path) => !gone.includes(path)).slice(0, SHOTS);
  if (!shown.length) return null;

  return (
    <span className="flex shrink-0 items-center">
      {shown.map((path, at) => (
        // biome-ignore lint/performance/noImgElement: local raw route, nothing to optimize
        <img
          key={path}
          src={queryKey.file(path)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setGone((was) => [...was, path])}
          className={cn(
            "size-6 rounded-md bg-muted object-cover ring-2 ring-background",
            at > 0 && "-ml-1.5",
          )}
        />
      ))}
    </span>
  );
}

/** Thumbnails on one step row. Past three the row's own words lose their place. */
const SHOTS = 3;

/** The rest of a truncated result, fetched only when opened. */
function Everything({
  threadId,
  callId,
}: {
  threadId: string;
  callId: string;
}) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useServerRoute<ResultPart[]>(
    open ? queryKey.toolResult(threadId, callId) : null,
  );

  return (
    <div className="px-3 pb-1">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        className="flex items-center gap-1 rounded-md py-0.5 font-mono text-[10px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ChevronDown className={cn("size-3", open && "rotate-180")} />
        {open ? "Less" : "Everything"}
      </button>

      {open &&
        (isLoading || !data ? (
          <Skeleton className="mt-1.5 h-12 w-full rounded-lg" />
        ) : (
          <div className="mt-1.5 space-y-1.5">
            {images(data).map((shot, at) => (
              <Shot key={`${at}-${shot.length}`} src={shot} />
            ))}
            {texts(data).length > 0 && (
              <pre className="max-h-72 overflow-auto rounded-lg bg-foreground/5 px-2.5 py-2 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap dark:bg-black/25">
                {texts(data).join("\n")}
              </pre>
            )}
          </div>
        ))}
    </div>
  );
}

function Shot({ src }: { src: string }) {
  return (
    // biome-ignore lint/performance/noImgElement: tool screenshot, not an asset
    <img
      src={src}
      alt=""
      className="block w-full rounded-lg bg-muted object-contain"
    />
  );
}

function Lines({ lines, mono }: { lines: string[]; mono?: boolean }) {
  if (lines.length === 0) return null;
  return (
    <ul className="px-3 pb-1.5">
      {/* Position is the identity here: two results can read the same and
          the list only ever arrives whole. */}
      {lines.map((line, at) => (
        <li
          key={`${at}-${line}`}
          className={cn(
            "truncate text-[11px] leading-relaxed text-muted-foreground",
            mono && "font-mono",
          )}
        >
          {line}
        </li>
      ))}
    </ul>
  );
}

const texts = (parts?: ResultPart[]) =>
  parts?.flatMap((part) => (part.type === "text" ? [part.text] : [])) ?? [];

const images = (parts?: ResultPart[]) =>
  parts?.flatMap((part) => (part.type === "image" ? [part.src] : [])) ?? [];
