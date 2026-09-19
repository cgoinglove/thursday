"use client";

import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { setSignInBotAction } from "../signins.action";
import type { SignIn } from "../signins.schema";

/**
 * In a bot's question, when that bot has asked the app for a sign-in it may not use yet
 * (signins.query `asking`): the one tap that lets it, which also answers the question.
 * Letting a bot in is the user's act on screen — no words to a bot do it.
 */
export function SignInAsk({
  bot,
  onAllowed,
}: {
  bot: string;
  /** Answers the question once the bot is let in; false when the answer did not go. */
  onAllowed: (words: string) => Promise<boolean>;
}) {
  const { data } = useServerRoute<SignIn[]>(queryKey.signIns);
  const [allow, allowing] = useServerAction(setSignInBotAction, {
    onOk: () => revalidate(queryKey.signIns),
  });
  const wanted = (data ?? []).filter((signIn) => signIn.asking.includes(bot));
  if (!wanted.length) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {wanted.map((signIn) => (
        <Button
          key={signIn.site}
          type="button"
          size="sm"
          loading={allowing}
          onClick={() =>
            void allow(signIn.site, bot, true)
              .then(() =>
                onAllowed(`Yes — you may use my ${signIn.site} sign-in.`),
              )
              .catch(() => {})
          }
        >
          Let {bot} use {signIn.site} ({signIn.account})
        </Button>
      ))}
    </div>
  );
}
