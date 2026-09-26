"use server";

import { serverAction } from "@/lib/protocol/server-action";
import { markIntroPassed } from "./intro.query";

export const passIntroAction = serverAction(async () => {
  await markIntroPassed();
});
