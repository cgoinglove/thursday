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
import { notify } from "@/components/ui/notify";
import { Segmented } from "@/components/ui/segmented";
import { BotBadge } from "@/features/bot/components/bot-badge";
import { BotsMark } from "@/features/bot/components/bot-mark";
import { ThreadBadge } from "@/features/bot/components/thread-badge";
import { ConfigBadge } from "@/features/config/components/config-badge";
import { ModelsBadge } from "@/features/config/components/models-badge";
import { McpBadge } from "@/features/connectors/components/mcp-badge";
import { McpMark } from "@/features/connectors/components/mcp-mark";
import { MemoryMark } from "@/features/memory/components/memory-mark";
import { ReachBadge } from "@/features/reach/components/reach-badge";
import { RoutineMark } from "@/features/routine/components/routine-mark";
import { SkillsMark } from "@/features/skills/components/skills-mark";
import { ThursdayMark } from "@/features/thursday/components/thursday-mark";
import { WorkspaceMark } from "@/features/workspace/components/workspace-mark";
import { setLocale, useLocale } from "@/hooks/use-locale";
import { setTheme, useTheme } from "@/hooks/use-theme";
import { LOCALE_LABEL, LOCALES, type Locale } from "@/lib/locale";
import { THEMES } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { settingsDictOf } from "@/messages";
import { type SettingSectionId, useSettingsStore } from "../settings.store";
import { CommunityLinks } from "./community-links";
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
  const locale = useLocale();
  const dict = settingsDictOf(locale);
  const [at, setAt] = useState(0);
  const Current = tabs[at].Component;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-8 pt-5">
        <SettingColumn>
          <Segmented
            view
            aria-label={dict.tabbedLabel}
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
function useFileTabs() {
  const locale = useLocale();
  const dict = settingsDictOf(locale);
  return [
    { label: dict.fileTabs.finished, Component: ArtifactSetting },
    { label: dict.fileTabs.allFiles, Component: WorkspaceSetting },
  ] as const;
}
function FilesSection() {
  const tabs = useFileTabs();
  return <Tabbed tabs={tabs} />;
}

/** Adding a section is one entry here plus an id in settings.store. */
const GROUPS = ["call", "work", "app"] as const;

/** The small mono word over each group in the nav, the community links' included. */
const GROUP_LABEL =
  "px-3 pt-3 pb-1 font-mono text-[10px] text-muted-foreground/60";

type SettingGroup = (typeof GROUPS)[number];

export const SECTIONS: readonly {
  id: SettingSectionId;
  group: SettingGroup;
  icon: ComponentType<{ className?: string }>;
  Component: ComponentType;
  /** Draws this section's live state beside its nav row; see `NavBadge`. */
  Badge?: ComponentType;
}[] = [
  {
    id: "thursday",
    group: "call",
    icon: ThursdayMark,
    Component: ThursdaySetting,
  },
  {
    id: "memory",
    group: "call",
    icon: MemoryMark,
    Component: MemorySetting,
  },
  {
    id: "bot",
    group: "work",
    icon: BotsMark,
    Component: BotSetting,
    Badge: BotBadge,
  },
  {
    id: "threads",
    group: "work",
    icon: ListChecks,
    Component: ThreadSetting,
    Badge: ThreadBadge,
  },
  {
    id: "routines",
    group: "work",
    icon: RoutineMark,
    Component: RoutineSetting,
  },
  {
    id: "files",
    group: "work",
    icon: WorkspaceMark,
    Component: FilesSection,
  },
  {
    id: "skills",
    group: "work",
    icon: SkillsMark,
    Component: SkillsSetting,
  },
  {
    id: "mcp",
    group: "work",
    icon: McpMark,
    Component: McpSetting,
    Badge: McpBadge,
  },
  {
    id: "signins",
    group: "work",
    icon: LogIn,
    Component: SignInsSetting,
  },
  {
    id: "models",
    group: "app",
    icon: Aperture,
    Component: ModelsSetting,
    Badge: ModelsBadge,
  },
  {
    id: "keys",
    group: "app",
    icon: KeyRound,
    Component: KeysSetting,
    Badge: ConfigBadge,
  },
  {
    id: "phone",
    group: "app",
    icon: Smartphone,
    Component: PhoneSetting,
    Badge: ReachBadge,
  },
];

function ThemePicker() {
  const theme = useTheme();
  const locale = useLocale();
  const dict = settingsDictOf(locale);
  const icons = { system: Monitor, light: Sun, dark: Moon } as const;
  return (
    <Segmented
      aria-label={dict.themeLabel}
      className="w-full gap-0.5 *:flex-1 *:py-1.5"
      options={THEMES.map((option) => {
        const Icon = icons[option];
        const label = dict.themes[option];
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

function LanguagePicker() {
  const locale = useLocale();
  const dict = settingsDictOf(locale);
  return (
    <Segmented
      aria-label={dict.languageLabel}
      className="w-full gap-0.5 *:flex-1 *:py-1.5"
      options={(LOCALES as readonly Locale[]).map((option) => ({
        value: option,
        title: `${LOCALE_LABEL[option]} — ${dict.languageHint}`,
        label: <span className="text-xs">{LOCALE_LABEL[option]}</span>,
      }))}
      value={locale}
      onChange={setLocale}
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
  /**
   * Words a section holds and has not kept are asked about before it goes (settings.store).
   * Read when asked, not at render: the Cmd+1..9 listener keeps the first render's closure,
   * from before a sheet registered what it holds.
   */
  const leaving = async (then: () => void) => {
    const unsaved = useSettingsStore.getState().unsaved;
    if (unsaved?.() && !(await notify.discard())) return;
    then();
  };
  const bodyRef = useRef<HTMLDivElement>(null);
  const locale = useLocale();
  const dict = settingsDictOf(locale);
  const current =
    SECTIONS.find((entry) => entry.id === sectionId) ?? SECTIONS[0];

  // Cmd+K reaches whichever filter the open section drew; Cmd+1..9 jump to the
  // first nine sections in the nav, since a key is one digit.
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
        void leaving(() => pick(SECTIONS[at - 1].id));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pick]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? show() : void leaving(hide))}
    >
      {children && <DialogTrigger render={children} />}
      {/* block, not grid: a popup portaled in here (the thread sheet and anything it opens) would take a row */}
      <DialogContent className="block h-[min(52rem,calc(100vh-3rem))] overflow-hidden p-0 sm:max-w-[min(80rem,calc(100vw-3rem))]">
        <DialogTitle className="sr-only">{dict.dialogTitle}</DialogTitle>

        <div className="flex h-full min-h-0">
          {/* scrolls in a short window, where its foot would otherwise be cut off under the dialog's edge */}
          <nav
            aria-label={dict.navLabel}
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
              void leaving(() => pick(next));
              event.currentTarget
                .querySelector<HTMLButtonElement>(`[data-section="${next}"]`)
                ?.focus();
            }}
            className="flex w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border/60 bg-muted/30 p-3"
          >
            {GROUPS.map((group) => (
              <Fragment key={group}>
                <span className={GROUP_LABEL}>{dict.groups[group]}</span>
                {SECTIONS.filter((item) => item.group === group).map((item) => (
                  <Button
                    key={item.id}
                    data-section={item.id}
                    onClick={() => void leaving(() => pick(item.id))}
                    variant={item.id === sectionId ? "secondary" : "ghost"}
                    className={cn(
                      "justify-start",
                      item.id === sectionId
                        ? "text-foreground bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]"
                        : "text-muted-foreground",
                    )}
                  >
                    <item.icon className={cn("mr-1")} />
                    <span className="truncate text-sm">
                      {dict.sections[item.id].label}
                    </span>
                    {item.Badge && (
                      <span className="ml-auto flex items-center">
                        <item.Badge />
                      </span>
                    )}
                  </Button>
                ))}
              </Fragment>
            ))}

            {/* a group of its own, in the nav's grammar, so the foot keeps Install alone */}
            <span className={GROUP_LABEL}>{dict.groups.community}</span>
            <CommunityLinks />

            <div className="mt-auto flex flex-col gap-2 pt-3">
              <InstallButton />
              <div className="px-1" title={dict.languageHint}>
                <LanguagePicker />
              </div>
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
                  {dict.sections[current.id].label}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {dict.sections[current.id].hint}
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
