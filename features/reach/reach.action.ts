"use server";

import { z } from "zod";
import { serverAction } from "@/lib/protocol/server-action";
import { allowReach, declineReach, forgetReach } from "./reach";
import { REACH_CHANNELS } from "./reach.schema";

const Name = z.enum(REACH_CHANNELS);
/** Who is being asked about, as the screen was shown them: the conversation and its code. */
const Ask = z.object({ chat: z.string().min(1), code: z.string().min(1) });

/** The user let in whoever is asking to write through that service. */
export const allowReachAction = serverAction(
  async (name: unknown, ask: unknown) => {
    const { chat, code } = Ask.parse(ask);
    await allowReach(Name.parse(name), chat, code);
  },
);

export const declineReachAction = serverAction(
  async (name: unknown, ask: unknown) => {
    const { chat, code } = Ask.parse(ask);
    declineReach(Name.parse(name), chat, code);
  },
);

/** Nobody may write through that service any more. */
export const forgetReachAction = serverAction(async (name: unknown) => {
  await forgetReach(Name.parse(name));
});
