"use client";

import {
  Aperture,
  KeyRound,
  ListChecks,
  LogIn,
  Monitor,
  Moon,
  Smartphone,
  Sun,
} from "lucide-react";
import dynamic from "next/dynamic";
import {
  type ComponentType,
  Fragment,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { BotBadge } from "@/features/bot/components/bot-badge";
import { BotsMark } from "@/features/bot/components/bot-mark";
import { ThreadBadge } from "@/features/bot/components/thread-badge";
import { ConfigBadge } from "@/features/config/components/config-badge";
import { ModelsBadge } from "@/features/config/components/models-badge";
import { McpBadge } from "@/features/connectors/components/mcp-badge";
import { McpMark } from "@/features/connectors/components/mcp-mark";
import { MemoryMark } from "@/features/memory/components/memory-mark";
import { RoutineMark } from "@/features/routine/components/routine-mark";
import { SkillsMark } from "@/features/skills/components/skills-mark";
import { ThursdayMark } from "@/features/thursday/components/thursday-mark";
import { WorkspaceMark } from "@/features/workspace/components/workspace-mark";
import { setTheme, useTheme } from "@/hooks/use-theme";
import { THEMES, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { type SettingSectionId, useSettingsStore } from "../settings.store";
import { InstallButton } from "./install-app";
import {
  SettingColumn,
  SettingPanesSkeleton,
  SettingSkeleton,
} from "./setting-ui";

/**
 * Sections load when opened, not with the app; each pulls its own renderers.
 * `shape` is the skeleton the section itself draws while its first read is in
 * flight, so the chunk and the read wait in one layout rather than two.
 */
const lazySection = (
  load: () => Promise<{ default: ComponentType }>,
  Shape: ComponentType = SettingSkeleton,
) => dynamic(load, { loading: () => <Shape /> });

const MemorySetting = lazySection(() =>
  import("@/features/memory/components/memory-setting").then((m) => ({
    default: m.MemorySetting,
  })),
);
const BotSetting = lazySection(
  () =>
    import("@/features/bot/components/bot-setting").then((m) => ({
      default: m.BotSetting,
    })),
  SettingPanesSkeleton,
);
const ThreadSetting = lazySection(() =>
  import("@/features/bot/components/thread-setting").then((m) => ({
    default: m.ThreadSetting,
  })),
);
const RoutineSetting = lazySection(() =>
  import("@/features/routine/components/routine-setting").then((m) => ({
    default: m.RoutineSetting,
  })),
);
const ModelsSetting = lazySection(() =>
  import("@/features/config/components/config-setting").then((m) => ({
    default: m.ModelsSetting,
  })),
);
const KeysSetting = lazySection(() =>
  import("@/features/config/components/config-setting").then((m) => ({
    default: m.KeysSetting,
  })),
);
const PhoneSetting = lazySection(() =>
  import("@/features/config/components/config-setting").then((m) => ({
    default: m.PhoneSetting,
  })),
);
const ThursdaySetting = lazySection(() =>
  import("@/features/thursday/components/thursday-setting").then((m) => ({
    default: m.ThursdaySetting,
  })),
);
const ArtifactSetting = lazySection(
  () =>
    import("@/features/artifact/components/artifact-setting").then((m) => ({
      default: m.ArtifactSetting,
    })),
  SettingPanesSkeleton,
);
const WorkspaceSetting = lazySection(
  () =>
    import("@/features/workspace/components/workspace-setting").then((m) => ({
      default: m.WorkspaceSetting,
    })),
  SettingPanesSkeleton,
);
const SkillsSetting = lazySection(() =>
  import("@/features/skills/components/skills-setting").then((m) => ({
    default: m.SkillsSetting,
  })),
);
const McpSetting = lazySection(() =>
  import("@/features/connectors/components/mcp-setting").then((m) => ({
    default: m.McpSetting,
  })),
);
const SignInsSetting = lazySection(() =>
  import("@/features/signins/components/signins-setting").then((m) => ({
    default: m.SignInsSetting,
  })),
);

/**
 * A section that is two screens of one subject, each whole as it was — its own scroll
 * area and rail — under a pair of tabs. It opens on the first.
 */
function Tabbed({
  tabs,
}: {
  tabs: readonly { label: string; Component: ComponentType }[];
}) {
  const [at, setAt] = useState(0);
  const Current = tabs[at].Component;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-8 pt-5">
        <SettingColumn>
          <Segmented
            aria-label="Screens of this section"
            options={tabs.map((tab, index) => ({
              value: String(index),
              label: tab.label,
            }))}
            value={String(at)}
            onChange={(value) => setAt(Number(value))}
          />
        </SettingColumn>
      </div>
      <div className="min-h-0 flex-1">
        <Current />
      </div>
    </div>
  );
}

/** What the bots finished is part of everything they wrote: one folder, seen two ways. */
const FILE_TABS = [
  { label: "Finished", Component: ArtifactSetting },
  { label: "All files", Component: WorkspaceSetting },
] as const;
const FilesSection = () => <Tabbed tabs={FILE_TABS} />;

/** Adding a section is one entry here plus an id in settings.store. */
const GROUPS = ["call", "work", "app"] as const;

type SettingGroup = (typeof GROUPS)[number];

export const SECTIONS: readonly {
  id: SettingSectionId;
  label: string;
  hint: string;
  group: SettingGroup;
  icon: ComponentType<{ className?: string }>;
  Component: ComponentType;
  /** Draws this section's live state beside its nav row; see `NavBadge`. */
  Badge?: ComponentType;
}[] = [
  {
    id: "thursday",
    label: "Thursday",
    group: "call",
    hint: "Her face, models, and how a call starts",
    icon: ThursdayMark,
    Component: ThursdaySetting,
  },
  {
    id: "memory",
    label: "Memory",
    group: "call",
    hint: "What the agent knows",
    icon: MemoryMark,
    Component: MemorySetting,
  },
  {
    id: "bot",
    label: "Bots",
    group: "work",
    hint: "Workers the agent delegates to",
    icon: BotsMark,
    Component: BotSetting,
    Badge: BotBadge,
  },
  {
    id: "threads",
    label: "Threads",
    group: "work",
    hint: "Work the bots were handed",
    icon: ListChecks,
    Component: ThreadSetting,
    Badge: ThreadBadge,
  },
  {
    id: "routines",
    label: "Routines",
    group: "work",
    hint: "Work that starts by itself, on a schedule",
    icon: RoutineMark,
    Component: RoutineSetting,
  },
  {
    id: "files",
    label: "Files",
    group: "work",
    hint: "What the bots finished, and everything else they wrote",
    icon: WorkspaceMark,
    Component: FilesSection,
  },
  {
    id: "skills",
    label: "Skills",
    group: "work",
    hint: "Instructions the bots load on demand",
    icon: SkillsMark,
    Component: SkillsSetting,
  },
  {
    id: "mcp",
    label: "Connectors",
    group: "work",
    hint: "Tools from MCP servers",
    icon: McpMark,
    Component: McpSetting,
    Badge: McpBadge,
  },
  {
    id: "signins",
    label: "Sign-ins",
    group: "work",
    hint: "The sites you signed in to, and the bots that may use each",
    icon: LogIn,
    Component: SignInsSetting,
  },
  {
    id: "models",
    label: "Models",
    group: "app",
    hint: "What bots think with, and what they draw, film and speak with",
    icon: Aperture,
    Component: ModelsSetting,
    Badge: ModelsBadge,
  },
  {
    id: "keys",
    label: "API keys",
    group: "app",
    hint: "The accounts the app runs on",
    icon: KeyRound,
    Component: KeysSetting,
    Badge: ConfigBadge,
  },
  {
    id: "phone",
    label: "Phone",
    group: "app",
    hint: "Write to Thursday from a chat app",
    icon: Smartphone,
    Component: PhoneSetting,
  },
];

const THEME_LABEL: Record<Theme, { label: string; icon: typeof Sun }> = {
  system: { label: "System", icon: Monitor },
  light: { label: "Light", icon: Sun },
  dark: { label: "Dark", icon: Moon },
};

function ThemePicker() {
  const theme = useTheme();
  return (
    <Segmented
      aria-label="Theme"
      className="w-full gap-0.5 *:flex-1 *:py-1.5"
      options={THEMES.map((option) => {
        const { label, icon: Icon } = THEME_LABEL[option];
        return {
          value: option,
          title: label,
          label: (
            <>
              <Icon className="size-3.5" />
              <span className="sr-only">{label}</span>
            </>
          ),
        };
      })}
      value={theme}
      onChange={setTheme}
    />
  );
}

/**
 * Moves the picked section by `step`, wrapping. Arrow keys inside the nav only:
 * elsewhere they scroll the list the user is reading.
 */
function stepSection(current: SettingSectionId, step: number) {
  const at = SECTIONS.findIndex((entry) => entry.id === current);
  const next = (at + step + SECTIONS.length) % SECTIONS.length;
  return SECTIONS[next].id;
}

/** The settings dialog. Open state and section live in settings.store so other screens can open a section. */
export function Settings({ children }: { children?: ReactElement }) {
  const open = useSettingsStore((state) => state.open);
  const sectionId = useSettingsStore((state) => state.section);
  const show = useSettingsStore((state) => state.show);
  const hide = useSettingsStore((state) => state.hide);
  const pick = useSettingsStore((state) => state.pick);
  const bodyRef = useRef<HTMLDivElement>(null);
  const current =
    SECTIONS.find((entry) => entry.id === sectionId) ?? SECTIONS[0];

  // Cmd+K reaches whichever filter the open section drew; Cmd+1..8 jump.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.key === "k") {
        const filter = bodyRef.current?.querySelector<HTMLInputElement>(
          "[data-setting-filter]",
        );
        if (!filter) return;
        event.preventDefault();
        filter.focus();
        filter.select();
        return;
      }
      const at = Number(event.key);
      if (Number.isInteger(at) && at >= 1 && at <= SECTIONS.length) {
        event.preventDefault();
        pick(SECTIONS[at - 1].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pick]);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? show() : hide())}>
      {children && <DialogTrigger render={children} />}
      {/* block, not grid: a popup portaled in here (the thread sheet and anything it opens) would take a row */}
      <DialogContent className="block h-[min(52rem,calc(100vh-3rem))] overflow-hidden p-0 sm:max-w-[min(80rem,calc(100vw-3rem))]">
        <DialogTitle className="sr-only">Settings</DialogTitle>

        <div className="flex h-full min-h-0">
          <nav
            aria-label="Settings sections"
            onKeyDown={(event) => {
              const step =
                event.key === "ArrowDown"
                  ? 1
                  : event.key === "ArrowUp"
                    ? -1
                    : 0;
              if (!step) return;
              event.preventDefault();
              const next = stepSection(sectionId, step);
              pick(next);
              event.currentTarget
                .querySelector<HTMLButtonElement>(`[data-section="${next}"]`)
                ?.focus();
            }}
            className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-border/60 bg-muted/30 p-3"
          >
            {GROUPS.map((group) => (
              <Fragment key={group}>
                <span className="px-3 pt-3 pb-1 font-mono text-[10px] text-muted-foreground/60">
                  {group}
                </span>
                {SECTIONS.filter((item) => item.group === group).map((item) => (
                  <Button
                    key={item.id}
                    data-section={item.id}
                    onClick={() => pick(item.id)}
                    variant={item.id === sectionId ? "secondary" : "ghost"}
                    className={cn(
                      "justify-start",
                      item.id === sectionId
                        ? "text-foreground bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]"
                        : "text-muted-foreground",
                    )}
                  >
                    <item.icon className={cn("mr-1")} />
                    <span className="truncate text-sm">{item.label}</span>
                    {item.Badge && (
                      <span className="ml-auto flex items-center">
                        <item.Badge />
                      </span>
                    )}
                  </Button>
                ))}
              </Fragment>
            ))}

            <div className="mt-auto flex flex-col gap-2 pt-3">
              <InstallButton />
              <div className="px-1">
                <ThemePicker />
              </div>
            </div>
          </nav>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="shrink-0 px-8 pt-10">
              {/* key remounts so the title animates in on section change */}
              <SettingColumn
                key={current.id}
                className="animate-in space-y-0.5 fade-in slide-in-from-bottom-1 duration-300"
              >
                <p className="truncate text-2xl font-semibold">
                  {current.label}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {current.hint}
                </p>
              </SettingColumn>
            </div>
            {/* The section fills what is left and draws its own scroll area and rail (setting-ui) */}
            <div ref={bodyRef} className="min-h-0 min-w-0 flex-1">
              <current.Component />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
