"use client";

import {
  Check,
  ChevronDown,
  ExternalLink,
  FilePen,
  Globe,
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
import { Skeleton } from "@/components/ui/skeleton";
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
  [TOOL_NAMES.write_file]: (props) => <FileTool icon={FilePen} {...props} />,
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
  [TOOL_NAMES.delegate]: Send,
  [TOOL_NAMES.thread]: ListChecks,
  [TOOL_NAMES.send_message]: MessageSquare,
  [TOOL_NAMES.end_call]: PhoneOff,
};

export const toolIcon = (name: string): LucideIcon =>
  TOOL_ICONS[name] ?? Wrench;

export function BotTool(props: ToolProps) {
  const View = TOOL_VIEWS[props.tool.name] ?? GenericTool;
  return <View {...props} />;
}

function WebSearchTool({ tool, threadId, collapsed }: ToolProps) {
  const hits = texts(tool.results);
  return (
    <Frame tool={tool} threadId={threadId} icon={Globe} collapsed={collapsed}>
      <p className="px-3 pt-1 pb-1.5 text-[13px] leading-snug break-keep">
        “{tool.input}”
      </p>
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
    <Frame
      tool={tool}
      threadId={threadId}
      icon={Terminal}
      collapsed={collapsed}
    >
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
function FileTool({
  icon,
  tool,
  threadId,
  collapsed,
}: ToolProps & { icon: LucideIcon }) {
  const path = tool.path ?? tool.input;
  return (
    <Frame tool={tool} threadId={threadId} icon={icon} collapsed={collapsed}>
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
    <Frame
      tool={tool}
      threadId={threadId}
      icon={toolIcon(tool.name)}
      collapsed={collapsed}
    >
      <p className="px-3 pt-1 pb-1.5 text-[12px] leading-snug break-keep">
        {tool.input}
      </p>
      <Lines lines={texts(tool.results)} />
    </Frame>
  );
}

/**
 * The shell every tool view sits in: a one-line step (icon, label, call, tool name,
 * state) with the body below it. A running tool is always expanded; a finished one
 * that returned anything gets "Everything" at the bottom.
 */
function Frame({
  tool,
  threadId,
  icon: Icon,
  collapsed = false,
  children,
}: ToolProps & { icon: LucideIcon; children: ReactNode }) {
  const running = tool.results === undefined;
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
            <Icon className="size-3" />
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

        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
          {tool.name}
        </span>
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
            "size-5 rounded-[5px] bg-muted object-cover ring-2 ring-background",
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
