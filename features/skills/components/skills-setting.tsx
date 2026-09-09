"use client";

import {
  AppWindow,
  BookMarked,
  ChevronLeft,
  ChevronRight,
  File,
  FileText,
  Folder,
  Globe,
  type LucideIcon,
  MousePointer2,
  Plus,
  Search,
  SquarePen,
  Trash2,
  Upload,
} from "lucide-react";
import { type DragEvent, useRef, useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/ui/markdown";
import { notify } from "@/components/ui/notify";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PATHS, PROMPT_CROWDED } from "@/config";
import {
  SettingDialogContent,
  SettingError,
  SettingFilter,
  SettingGroup,
  SettingItems,
  SettingNote,
  SettingRailNote,
  SettingScreen,
  SettingSkeleton,
  SettingToolbar,
} from "@/features/settings/components/setting-ui";
import {
  createSkillAction,
  deleteSkillAction,
  setSkillDisabledAction,
  uploadSkillAction,
} from "@/features/skills/skills.action";
import type {
  SkillEntry,
  SkillNode,
  SkillSource,
  SkillSummary,
} from "@/features/skills/skills.schema";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { cn, formatBytes } from "@/lib/utils";

/** Marks for the skills that ship with the app; custom skills get the generic mark. */
const SKILL_MARKS: Record<string, LucideIcon> = {
  browser: Globe,
  computer: AppWindow,
  "find-skills": Search,
  "interactive-page": MousePointer2,
  "skill-creator": SquarePen,
};

const markOf = (skill: SkillSummary) =>
  (skill.source === "default" && SKILL_MARKS[skill.dir]) || BookMarked;

export function SkillsSetting() {
  const [filter, setFilter] = useState("");
  const { data, isLoading, error } = useServerRoute<SkillSummary[]>(
    queryKey.skills,
  );
  const skills = data ?? [];

  if (isLoading) return <SettingSkeleton rows={4} />;
  if (error) return <SettingError message={error.message} />;

  const needle = filter.trim().toLowerCase();
  const match = (skill: SkillSummary) =>
    !needle ||
    `${skill.name} ${skill.description}`.toLowerCase().includes(needle);
  const shown = skills.filter(match);
  const on = skills.filter((skill) => !skill.disabled).length;

  return (
    <SettingScreen
      footer={
        <SettingRailNote>
          {skills.filter((skill) => skill.source === "default").length} shipped
          · {skills.filter((skill) => skill.source === "custom").length}{" "}
          installed
        </SettingRailNote>
      }
    >
      <SettingToolbar count={`${on} on · ${skills.length - on} off`}>
        <SettingFilter
          value={filter}
          onChange={setFilter}
          placeholder="Filter skills"
        />
      </SettingToolbar>

      <SettingGroup
        label="Custom"
        hint="yours — added here · wins a name clash"
      >
        <SettingItems addRow={{ label: "Add skill", onClick: openSkillCreate }}>
          {shown
            .filter((skill) => skill.source === "custom")
            .map((skill) => (
              <SkillRow key={`custom/${skill.dir}`} skill={skill} />
            ))}
        </SettingItems>
      </SettingGroup>

      <SettingGroup
        label="Default"
        hint="ships with the app · switch off, can't edit or delete"
      >
        <SettingItems>
          {shown
            .filter((skill) => skill.source === "default")
            .map((skill) => (
              <SkillRow key={`default/${skill.dir}`} skill={skill} />
            ))}
        </SettingItems>
      </SettingGroup>

      {on > PROMPT_CROWDED.skills && (
        <SettingNote>
          {on} skills are on. Each is a line in every prompt a bot reads, and
          one more to look past when it picks.
        </SettingNote>
      )}
    </SettingScreen>
  );
}

function SkillRow({ skill }: { skill: SkillSummary }) {
  const [remove, removing] = useServerAction(deleteSkillAction, {
    onOk: () => revalidate(queryKey.skills),
  });
  const [toggle] = useServerAction(setSkillDisabledAction, {
    onOk: () => revalidate(queryKey.skills),
  });

  const confirmRemove = async () => {
    const confirmed = await notify.confirm({
      title: `Delete ${skill.name}?`,
      description: "Every file in this skill is deleted for good.",
      okText: "Delete",
      destructive: true,
    });
    if (confirmed) remove(skill.dir);
  };

  const Mark = markOf(skill);

  return (
    <div className="group flex items-center transition-colors hover:bg-muted/50">
      <button
        type="button"
        onClick={() => openSkillBrowser(skill)}
        className="flex min-w-0 flex-1 items-center gap-3 py-4 pl-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground",
            skill.disabled && "opacity-45",
          )}
        >
          <Mark className="size-4" />
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 space-y-0.5",
            skill.disabled && "opacity-45",
          )}
        >
          <span className="block truncate text-sm font-medium">
            {skill.name}
          </span>
          <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {skill.description}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/60 group-hover:text-foreground" />
      </button>

      {/* The delete slot stays as a spacer so the switch lines up across groups */}
      <div className="mr-4 ml-5 flex w-18 shrink-0 items-center justify-end gap-3">
        <Switch
          checked={!skill.disabled}
          onCheckedChange={(on) => toggle(skill.source, skill.dir, !on)}
          aria-label={`${skill.name} on or off`}
          className="shrink-0"
        />
        {skill.source === "custom" ? (
          <Button
            size="icon-sm"
            variant="ghost"
            loading={removing}
            onClick={confirmRemove}
            className="shrink-0 text-muted-foreground"
          >
            <Trash2 />
          </Button>
        ) : (
          <span className="size-7 shrink-0" />
        )}
      </div>
    </div>
  );
}

function openSkillBrowser(skill: SkillSummary) {
  return notify.component({
    className: "sm:max-w-4xl",
    renderer: () => <SkillBrowser skill={skill} />,
  });
}

/** Folder list on the left, the picked file on the right; both paths are skill-relative. */
function SkillBrowser({ skill }: { skill: SkillSummary }) {
  const [dir, setDir] = useState("");
  const [file, setFile] = useState<string | null>("SKILL.md");

  const openEntry = (entry: SkillEntry) => {
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.kind === "dir") setDir(path);
    else setFile(path);
  };

  return (
    <SettingDialogContent
      title={skill.name}
      description={<PathBar skill={skill} path={file ?? dir} />}
    >
      <div className="flex h-[36rem] divide-x divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-background">
        <div className="flex w-44 shrink-0 flex-col overflow-y-auto bg-muted/20 py-1">
          {dir && (
            <button
              type="button"
              onClick={() => setDir(dir.split("/").slice(0, -1).join("/"))}
              className="mx-1 mb-1 flex items-center gap-1 rounded-md px-2 py-1 text-left font-mono text-[11px] text-muted-foreground outline-none hover:bg-muted/50 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
            >
              <ChevronLeft className="size-3 shrink-0" />
              <span className="truncate">{dir.split("/").pop()}</span>
            </button>
          )}
          <DirList
            source={skill.source}
            dir={skill.dir}
            path={dir}
            current={file}
            onPick={openEntry}
          />
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto">
          {file ? (
            <FileView source={skill.source} dir={skill.dir} path={file} />
          ) : (
            <p className="p-6 text-sm text-muted-foreground/60">Pick a file</p>
          )}
        </div>
      </div>
    </SettingDialogContent>
  );
}

function PathBar({
  skill,
  path,
}: {
  skill: SkillSummary | null;
  path: string;
}) {
  if (!skill) {
    return (
      <span className="truncate font-mono text-[11px] text-muted-foreground/60">
        Pick a skill
      </span>
    );
  }
  const parts = [skill.name, ...path.split("/").filter(Boolean)];
  return (
    <span className="flex min-w-0 items-center gap-1 font-mono text-[11px] text-muted-foreground">
      {parts.map((part, i) => (
        <span key={`${i}-${part}`} className="flex min-w-0 items-center gap-1">
          {i > 0 && <ChevronRight className="size-3 shrink-0 opacity-50" />}
          <span
            className={cn(
              "truncate",
              i === parts.length - 1 && "text-foreground",
            )}
          >
            {part}
          </span>
        </span>
      ))}
    </span>
  );
}

function Row({
  icon,
  label,
  active,
  hasChildren,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  hasChildren?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "mx-1 flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
        active
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
    >
      <span className="shrink-0 text-muted-foreground/70 [&>svg]:size-3">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hasChildren && (
        <ChevronRight className="size-3 shrink-0 text-muted-foreground/50" />
      )}
    </button>
  );
}

function DirList({
  source,
  dir,
  path,
  current,
  onPick,
}: {
  source: SkillSource;
  dir: string;
  path: string;
  /** The open file, skill-relative; highlighted when inside this folder. */
  current: string | null;
  onPick: (entry: SkillEntry) => void;
}) {
  const { data, isLoading, error } = useServerRoute<SkillNode>(
    queryKey.skillNode(source, dir, path),
  );

  if (error) {
    return (
      <p className="p-3 font-mono text-xs text-destructive">{error.message}</p>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="space-y-2 p-2">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-4/5" />
      </div>
    );
  }
  if (data.kind !== "dir") return null;

  return (
    <>
      {data.entries.map((entry) => (
        <Row
          key={entry.name}
          icon={
            entry.kind === "dir" ? (
              <Folder />
            ) : entry.name.endsWith(".md") ? (
              <FileText />
            ) : (
              <File />
            )
          }
          label={entry.name}
          hasChildren={entry.kind === "dir"}
          active={(path ? `${path}/${entry.name}` : entry.name) === current}
          onClick={() => onPick(entry)}
        />
      ))}
      {data.entries.length === 0 && (
        <p className="p-3 text-xs text-muted-foreground/60">Empty folder</p>
      )}
    </>
  );
}

/** Front matter is shown as a block, not markdown: `---` would read as a setext heading underline. */
function SkillMarkdown({ content }: { content: string }) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(content);
  const head = front?.[1].trim();
  const body = front ? content.slice(front[0].length) : content;

  return (
    // min-w-0: wide tables and long code lines scroll inside their box
    <div className="min-w-0">
      {head && (
        <pre className="border-b border-border/60 bg-muted/20 px-5 py-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {head}
        </pre>
      )}
      <div className="px-5 py-4 text-sm leading-relaxed">
        <Markdown>{body}</Markdown>
      </div>
    </div>
  );
}

function FileView({
  source,
  dir,
  path,
}: {
  source: SkillSource;
  dir: string;
  path: string;
}) {
  const { data, isLoading, error } = useServerRoute<SkillNode>(
    queryKey.skillNode(source, dir, path),
  );

  if (error) {
    return (
      <p className="p-4 font-mono text-xs text-destructive">{error.message}</p>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="space-y-3 p-5">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    );
  }
  if (data.kind !== "file") return null;

  const name = path.split("/").pop() ?? "";
  return (
    <div>
      {/* z-20: streamdown's code copy bar and table head stick at z-10 */}
      <div className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-border/60 bg-background/90 px-5 py-2 font-mono text-[11px] text-muted-foreground backdrop-blur">
        <span className="truncate">{name}</span>
        <span className="shrink-0">{formatBytes(data.size)}</span>
      </div>
      {data.content === null ? (
        <p className="px-5 py-4 text-sm text-muted-foreground/60">
          Not a text file — the agent can still read it from disk.
        </p>
      ) : name.toLowerCase().endsWith(".md") ? (
        <SkillMarkdown content={data.content} />
      ) : (
        <pre className="overflow-x-auto px-5 py-4 font-mono text-[13px] leading-relaxed whitespace-pre text-foreground/90">
          {data.content}
        </pre>
      )}
    </div>
  );
}

/** Add a skill: type one in, or drop a file. */
export function openSkillCreate() {
  return notify.component({
    className: "sm:max-w-lg",
    renderer: ({ close }) => <SkillCreate onDone={close} />,
  });
}

function SkillCreate({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"write" | "upload">("write");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const done = {
    errorMessage: false as const,
    onOk: () => {
      revalidate(queryKey.skills);
      onDone();
    },
  };
  const [create, creating, , createError] = useServerAction(
    createSkillAction,
    done,
  );
  const [upload, uploading, , uploadError] = useServerAction(
    uploadSkillAction,
    done,
  );
  const busy = creating || uploading;
  const error = mode === "write" ? createError : uploadError;

  const canSubmit =
    !busy &&
    (mode === "write"
      ? name.trim() && description.trim() && content.trim()
      : file !== null);

  const submit = async () => {
    if (!canSubmit) return;
    if (mode === "write") {
      create({ name: name.trim(), description: description.trim(), content });
      return;
    }
    if (!file) return;
    upload({ fileName: file.name, base64: await toBase64(file) });
  };

  const acceptFile = (list: FileList | null) => {
    const next = list?.[0] ?? null;
    if (next) setFile(next);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    acceptFile(event.dataTransfer.files);
  };

  return (
    <SettingDialogContent
      title="New skill"
      description="Instructions the agent loads by name when a task calls for them."
      footer={
        <>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} loading={busy} onClick={submit}>
            {!busy && (mode === "write" ? <Plus /> : <Upload />)}
            {mode === "write" ? "Create" : "Upload"}
          </Button>
        </>
      }
    >
      <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
        <TabsList className="w-full">
          <TabsTrigger value="write">Write</TabsTrigger>
          <TabsTrigger value="upload">Upload</TabsTrigger>
        </TabsList>

        <TabsContent value="write" className="space-y-5 pt-4">
          <Field>
            <FieldLabel htmlFor="skill-name">Name</FieldLabel>
            <FieldContent>
              <Input
                id="skill-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="deploy-checklist"
                spellCheck={false}
                autoFocus
              />
              <p className="font-mono text-[11px] text-muted-foreground">
                {PATHS.skills.custom}/{name.trim() || "…"}/SKILL.md
              </p>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="skill-description">Description</FieldLabel>
            <FieldContent>
              <Input
                id="skill-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="When to use it — this is how the agent decides to load it"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="skill-content">Content</FieldLabel>
            <Textarea
              id="skill-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Markdown. The steps, the rules, the examples."
              className="min-h-40 resize-none font-mono text-xs"
            />
          </Field>
        </TabsContent>

        <TabsContent value="upload" className="space-y-4 pt-4">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
            className={cn(
              "flex w-full flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
              over
                ? "border-foreground/60 bg-muted/60"
                : "border-border hover:bg-muted/40",
            )}
          >
            <Upload className="size-5 text-muted-foreground" />
            {file ? (
              <span className="text-sm">
                {file.name}
                <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                  {formatBytes(file.size)}
                </span>
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">
                Drop a file here, or click to choose
              </span>
            )}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".md,.zip,.skill"
            className="hidden"
            onChange={(e) => acceptFile(e.target.files)}
          />

          <div className="space-y-1 text-xs text-muted-foreground">
            <p className="font-medium text-foreground/80">File requirements</p>
            <p>
              A <span className="font-mono">.md</span> file needs a YAML block
              with the skill's name and description.
            </p>
            <p>
              A <span className="font-mono">.zip</span> or{" "}
              <span className="font-mono">.skill</span> archive needs a SKILL.md
              inside — the rest of its folder comes along.
            </p>
          </div>
        </TabsContent>
      </Tabs>

      {error && <p className="font-mono text-xs text-destructive">{error}</p>}
    </SettingDialogContent>
  );
}

/** Server action args travel as JSON, so the file goes as text. */
function toBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
