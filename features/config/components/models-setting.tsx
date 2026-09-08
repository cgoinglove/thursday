"use client";

import { ConfigGroups } from "./config-setting";

/** Which model each studio kind runs on; the "models" half of the config catalogue. */
export function ModelsSetting() {
  return <ConfigGroups section="models" />;
}
