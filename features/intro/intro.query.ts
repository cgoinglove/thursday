import { readConfig, writeConfig } from "@/features/config/config.query";

/**
 * Set the first time the intro is left, however it is left (Call, Look around, Skip all). Until
 * then it came back on every load before a first call, and every leave set the seed bots up
 * again, bringing back any deleted in between.
 */
const INTRO_PASSED_KEY = "INTRO_PASSED";

export async function hasPassedIntro(): Promise<boolean> {
  return (await readConfig(INTRO_PASSED_KEY)) === "on";
}

export async function markIntroPassed(): Promise<void> {
  await writeConfig(INTRO_PASSED_KEY, "on");
}
