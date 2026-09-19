"use server";

import { z } from "zod";
import { serverAction } from "@/lib/protocol/server-action";
import { allowReach, declineReach, forgetReach } from "./reach";
import { REACH_CHANNELS } from "./reach.schema";

const Name = z.enum(REACH_CHANNELS);

/** The user let in whoever is asking to write through that service. */
export const allowReachAction = serverAction(
  async (name: unknown, chat: unknown) => {
    await allowReach(Name.parse(name), z.string().min(1).parse(chat));
  },
);

export const declineReachAction = serverAction(async (name: unknown) => {
  declineReach(Name.parse(name));
});

/** Nobody may write through that service any more. */
export const forgetReachAction = serverAction(async (name: unknown) => {
  await forgetReach(Name.parse(name));
});
