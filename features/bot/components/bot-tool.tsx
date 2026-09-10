"use client";

import {
  Check,
  ChevronDown,
  ExternalLink,
  FilePen,
  Flag,
  Globe,
  Image as ImageIcon,
  ListChecks,
  Loader2,
  type LucideIcon,
  MessageSquare,
  Search,
  Send,
  Terminal,
  Wrench,
} from "lucide-react";
import { type ComponentType, type ReactNode, useState } from "react";
import { queryKey } from "@/app/api/query-key";
import ShinyText from "@/components/ui/shiny-text";
import { Skeleton } from "@/components/ui/skeleton";
import type { ResultPart } from "@/features/bot/bot.schema";
import { McpMark } from "@/features/connectors/components/mcp-mark";
import { MemoryMark } from "@/features/memory/components/memory-mark";
import { SkillsMark } from "@/features/skills/components/skills-mark";
import { FileLink } from "@/features/workspace/components/file-view";
import { useServerRoute } from "@/lib/protocol/use-server-route";
import { cn } from "@/lib/utils";
import type { ToolUse } from "../task.store";

/*
 * Tool calls rendered per tool: TOOL_VIEWS by name, GenericTool for the rest. Results
 * arrive with only a few lines (bot.query RESULT_LINES); "Everything" fetches the rest on demand.
 */

type ToolProps = {
  tool: ToolUse;
  /** Half of the key for fetching the full result. */
  taskId?: string;
  /** Start folded to the title line. A running tool is always expanded regardless. */
  collapsed?: boolean;
};

export const TOOL_VIEWS: Record<string, ComponentType<ToolProps>> = {
  web_search: WebSearchTool,
  bash: ShellTool,
  fetch: (props) => <MonoTool icon={Globe} {...props} />,
  write_file: (props) => <FileTool icon={FilePen} {...props} />,
  generate_image: DrawnTool,
};

/**
 * Icon per tool, for views with room for one glyph. A tool that belongs to a
 * domain draws that domain's own mark, so the pill and the nav never disagree.
 */
const TOOL_ICONS: Record<string, LucideIcon> = {
  web_search: Search,
  bash: Terminal,
  fetch: Globe,
  write_file: FilePen,
  generate_image: ImageIcon,
  memory_recall: MemoryMark,
  memory_remember: MemoryMark,
  memory_forget: MemoryMark,
  memory_show: MemoryMark,
  load_skill: SkillsMark,
  tool_search: McpMark,
  tool_call: McpMark,
  delegate: Send,
  task: ListChecks,
  ask_bot: MessageSquare,
  ask_back: MessageSquare,
  ask_thursday: MessageSquare,
  answer: Flag,
};

export const toolIcon = (name: string): LucideIcon =>
  TOOL_ICONS[name] ?? Wrench;

export function BotTool(props: ToolProps) {
  const View = TOOL_VIEWS[props.tool.name] ?? GenericTool;
  return <View {...props} />;
}

function WebSearchTool({ tool, taskId, collapsed }: ToolProps) {
  const hits = texts(tool.results);
  return (
    <Frame tool={tool} taskId={taskId} icon={Search} collapsed={collapsed}>
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

function ShellTool({ tool, taskId, collapsed }: ToolProps) {
  const out = texts(tool.results);
  return (
    <Frame tool={tool} taskId={taskId} icon={Terminal} collapsed={collapsed}>
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

/** A path or url and what was read from it. */
function MonoTool({
  icon,
  tool,
  taskId,
  collapsed,
}: ToolProps & { icon: LucideIcon }) {
  return (
    <Frame tool={tool} taskId={taskId} icon={icon} collapsed={collapsed}>
      <p className="truncate px-3 pt-1 pb-1.5 font-mono text-[11px]">
        {tool.input}
      </p>
      <Lines lines={texts(tool.results)} mono />
    </Frame>
  );
}

const OPEN_BUTTON =
  "flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground outline-none transition-colors hover:bg-background hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

/**
 * A file the bot read or wrote, with an Open link. Opens `tool.path`: `input` is folded
 * to one line, and a truncated path is a 404 (task.query LINE_MAX).
 */
function FileTool({
  icon,
  tool,
  taskId,
  collapsed,
}: ToolProps & { icon: LucideIcon }) {
  const path = tool.path ?? tool.input;
  return (
    <Frame tool={tool} taskId={taskId} icon={icon} collapsed={collapsed}>
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

/** A generated image. The path is the first result line, not the input: the name is made while generating. */
function DrawnTool({ tool, taskId, collapsed }: ToolProps) {
  const [path] = texts(tool.results);
  return (
    <Frame tool={tool} taskId={taskId} icon={ImageIcon} collapsed={collapsed}>
      <p className="px-3 pt-1 text-[12px] leading-snug break-keep">
        {tool.input}
      </p>
      {path && (
        <div className="flex items-center gap-2 px-3 pt-1 pb-1.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
            {path}
          </span>
          <FileLink path={path} label={`Open ${path}`} className={OPEN_BUTTON}>
            <ExternalLink className="size-3" />
            Open
          </FileLink>
        </div>
      )}
    </Frame>
  );
}

/** Anything without a view of its own, MCP tools included. */
function GenericTool({ tool, taskId, collapsed }: ToolProps) {
  return (
    <Frame
      tool={tool}
      taskId={taskId}
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
 * state) with the body below it. A running tool is always expanded; a truncated
 * result gets "Everything" at the bottom.
 */
function Frame({
  tool,
  taskId,
  icon: Icon,
  collapsed = false,
  children,
}: ToolProps & { icon: LucideIcon; children: ReactNode }) {
  const running = tool.results === undefined;
  const [open, setOpen] = useState(!collapsed);
  const shown = open || running;
  const more = tool.more && taskId && tool.callId;

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
                color="var(--muted-foreground)"
                shineColor="var(--foreground)"
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
            color="var(--muted-foreground)"
            shineColor="var(--foreground)"
            className="min-w-0 flex-1 truncate font-mono text-[11px] leading-4"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] leading-4 text-foreground/80">
            {tool.input}
          </span>
        )}

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
          {more && (
            <Everything taskId={taskId} callId={tool.callId as string} />
          )}
        </div>
      )}
    </div>
  );
}

/** The rest of a truncated result, fetched only when opened. */
function Everything({ taskId, callId }: { taskId: string; callId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useServerRoute<ResultPart[]>(
    open ? queryKey.toolResult(taskId, callId) : null,
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
