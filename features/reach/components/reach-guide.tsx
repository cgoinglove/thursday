"use client";

import { Check, Copy } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { SiteIcon } from "@/components/ui/site-icon";
import {
  REACH_CHANNELS,
  REACH_LABEL,
  type ReachChannelName,
} from "../reach.schema";

/**
 * How to connect a chat app, step by step, above the fields the steps end in. Someone who has
 * never made a bot reads down the numbers; someone who has reads the bold words. The guide
 * (`guide/phone.md`) says the same to Thursday, manifest included.
 */

const SITE: Record<ReachChannelName, string> = {
  telegram: "telegram.org",
  discord: "discord.com",
  slack: "slack.com",
};

/** The Slack app with exactly the scopes slack.ts uses. Kept in step with guide/phone.md. */
const SLACK_MANIFEST = `display_information:
  name: Thursday
features:
  app_home:
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false
  bot_user:
    display_name: Thursday
oauth_config:
  scopes:
    bot: [chat:write, im:history, im:read, users:read, files:read, files:write]
settings:
  event_subscriptions:
    bot_events: [message.im]
  interactivity:
    is_enabled: true
  socket_mode_enabled: true
`;

const Link = ({ href, children }: { href: string; children: ReactNode }) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer"
    className="font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
  >
    {children}
  </a>
);
const B = ({ children }: { children: ReactNode }) => (
  <span className="font-medium text-foreground">{children}</span>
);

const STEPS: Record<ReachChannelName, ReactNode[]> = {
  telegram: [
    <>
      In Telegram, write to{" "}
      <Link href="https://t.me/BotFather">@BotFather</Link>, send <B>/newbot</B>{" "}
      and pick a name. It answers with a <B>token</B>.
    </>,
    <>
      Paste the token below, under <B>Telegram</B>.
    </>,
    <>
      From your phone, <B>write anything to your new bot</B>.
    </>,
    <>
      A question appears on this computer. Press <B>Allow</B>. Done — write to
      the bot and Thursday answers.
    </>,
  ],
  discord: [
    <>
      At{" "}
      <Link href="https://discord.com/developers/applications">
        discord.com/developers
      </Link>
      , make a <B>New Application</B>. On its <B>Bot</B> page press{" "}
      <B>Reset Token</B> and copy it.
    </>,
    <>
      Paste the token below, under <B>Discord</B>.
    </>,
    <>
      On the application's <B>OAuth2</B> page, make an invite link with the{" "}
      <B>bot</B> scope and add the bot to a server of your own. Discord only
      lets you write to a bot you share a server with.
    </>,
    <>
      <B>Send the bot a direct message</B> (not in the server), then press{" "}
      <B>Allow</B> on this computer.
    </>,
  ],
  slack: [
    <>
      At <Link href="https://api.slack.com/apps">api.slack.com/apps</Link>,{" "}
      <B>Create New App › From a manifest</B>, and paste the manifest (the
      button under these steps copies it).
    </>,
    <>
      <B>Basic Information › App-Level Tokens</B>: generate one with{" "}
      <B>connections:write</B>. It starts with xapp- — paste it below as the{" "}
      <B>app token</B>.
    </>,
    <>
      <B>Install App</B> to your workspace. The Bot User OAuth Token starts with
      xoxb- — paste it below as the <B>bot token</B>.
    </>,
    <>
      In Slack, open the app under <B>Apps</B>, write in its <B>Messages</B>{" "}
      tab, then press <B>Allow</B> on this computer.
    </>,
  ],
};

export function ReachGuide() {
  const [name, setName] = useState<ReachChannelName>("telegram");
  const [copied, setCopied] = useState(false);

  return (
    <section className="space-y-4 rounded-xl bg-muted/40 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-sm font-medium">
          Connect a chat app in four steps
        </p>
        <Segmented
          aria-label="Which chat app"
          value={name}
          onChange={setName}
          options={REACH_CHANNELS.map((one) => ({
            value: one,
            label: (
              <span className="flex items-center gap-1.5">
                <SiteIcon host={SITE[one]} className="size-3.5 rounded-[3px]" />
                {REACH_LABEL[one]}
              </span>
            ),
          }))}
        />
      </div>

      <ol className="space-y-2.5">
        {STEPS[name].map((step, at) => (
          // Steps never reorder: the index is the step
          <li key={at} className="flex gap-3 text-[13px] leading-relaxed">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-background font-mono text-[10.5px] text-muted-foreground ring-1 ring-border/60">
              {at + 1}
            </span>
            <span className="min-w-0 text-muted-foreground">{step}</span>
          </li>
        ))}
      </ol>

      {name === "slack" && (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void navigator.clipboard.writeText(SLACK_MANIFEST).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2_000);
            })
          }
        >
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy the manifest"}
        </Button>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        Only the one person you allow can write, and only direct messages are
        read. This computer has to be on with Thursday running; for bots to work
        while no tab is open, switch on <B>Work while the app is closed</B> in
        Settings › Bots.
      </p>
    </section>
  );
}
