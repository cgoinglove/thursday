import type { Locale } from "@/lib/locale";
import {
  type AiDict,
  type BotDict,
  type ConfigDict,
  en,
  type FilesDict,
  type McpDict,
  type MemoryDict,
  type ReachDict,
  type ReachSeg,
  type ReachStep,
  type RoutineDict,
  type SettingsDict,
  type SigninsDict,
  type SkillsDict,
  type ThreadsDict,
  type ThursdayDict,
  type WorkspaceDict,
} from "./en";
import { tr } from "./tr";

const DICTS: Record<Locale, SettingsDict> = { en, tr };

export function settingsDictOf(locale: Locale): SettingsDict {
  return DICTS[locale];
}

export type {
  AiDict,
  BotDict,
  ConfigDict,
  FilesDict,
  McpDict,
  MemoryDict,
  ReachDict,
  ReachSeg,
  ReachStep,
  RoutineDict,
  SettingsDict,
  SigninsDict,
  SkillsDict,
  ThreadsDict,
  ThursdayDict,
  WorkspaceDict,
};
