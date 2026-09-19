"use server";

import { z } from "zod";
import { serverAction } from "@/lib/protocol/server-action";
import { removeSignIn, setSignInBot } from "./signins.query";

const Site = z.string().trim().min(1);

/** The user lets a bot borrow a sign-in, or takes that back. */
export const setSignInBotAction = serverAction(
  async (site: unknown, bot: unknown, on: unknown) => {
    await setSignInBot(
      Site.parse(site),
      z.string().min(1).parse(bot),
      z.boolean().parse(on),
    );
  },
);

export const removeSignInAction = serverAction(async (site: unknown) => {
  await removeSignIn(Site.parse(site));
});
