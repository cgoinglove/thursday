"use server";

import { z } from "zod";
import { serverAction } from "@/lib/protocol/server-action";
import { allowReach, declineReach, forgetReach } from "./reach";

/** The user let in whoever is asking to write from a phone. */
export const allowReachAction = serverAction(async (chat: unknown) => {
  await allowReach(z.string().min(1).parse(chat));
});

export const declineReachAction = serverAction(async () => {
  declineReach();
});

/** Nobody may write from the phone any more. */
export const forgetReachAction = serverAction(async () => {
  await forgetReach();
});
