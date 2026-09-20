"use client";

import {
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  KeyRound,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { encode } from "uqr";
import { useAppEvent } from "@/app/api/events/app-event.client";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShinyText } from "@/components/ui/shiny-text";
import { SiteIcon } from "@/components/ui/site-icon";
import {
  removeConfigAction,
  setConfigAction,
} from "@/features/config/config.action";
import { type ConfigStatus, isConfigSet } from "@/features/config/config.const";
import {
  SettingItems,
  SettingNote,
} from "@/features/settings/components/setting-ui";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { cn, WAITING_INK } from "@/lib/utils";
import { forgetReachAction } from "../reach.action";
import {
  DISCORD_TOKEN_KEY,
  REACH_CHANNELS,
  REACH_KEYS,
  REACH_LABEL,
  type ReachChannelName,
  type ReachChannelStatus,
  type ReachStatus,
  SLACK_APP_TOKEN_KEY,
  SLACK_BOT_TOKEN_KEY,
  TELEGRAM_TOKEN_KEY,
} from "../reach.schema";

/**
 * Settings › Phone, whole: one row per chat app, the one being connected open on its steps.
 * The steps are the state — each is done, waiting on the user, or not yet — so nothing says
 * twice where the user has got to, and a service that needs nothing is a single line. The
 * server knows only three things about a service (its keys, whether it connected, who is let
 * in); `stepStates` turns those into the steps' faces. The guide (`guide/phone.md`) tells
 * Thursday the same, manifest included.
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

/** What a step holds besides its words: the one thing to do in it. */
type Slot =
  | { open: string; label: string }
  | { key: string; looks: string }
  | { manifest: true }
  /** The step the phone answers, where a link to the bot can be scanned. */
  | { reach: true };

type Step = { body: ReactNode; slot?: Slot };

const STEPS: Record<ReachChannelName, Step[]> = {
  telegram: [
    {
      body: (
        <>
          In Telegram, write to <B>@BotFather</B>, send <B>/newbot</B> and pick
          a name. It answers with a <B>token</B>.
        </>
      ),
      slot: { open: "https://t.me/BotFather", label: "Open @BotFather" },
    },
    {
      body: <>Paste the token here.</>,
      slot: { key: TELEGRAM_TOKEN_KEY, looks: "123456789:AAE…" },
    },
    {
      body: <>From your phone, write anything to your bot.</>,
      slot: { reach: true },
    },
    {
      body: (
        <>
          A question appears on this computer. Press <B>Allow</B>.
        </>
      ),
    },
  ],
  discord: [
    {
      body: (
        <>
          At <B>discord.com/developers</B>, make a <B>New Application</B>. On
          its <B>Bot</B> page press <B>Reset Token</B> and copy it.
        </>
      ),
      slot: {
        open: "https://discord.com/developers/applications",
        label: "Open discord.com/developers",
      },
    },
    {
      body: <>Paste the token here.</>,
      slot: { key: DISCORD_TOKEN_KEY, looks: "MTE…" },
    },
    {
      body: (
        <>
          On the application's <B>OAuth2</B> page, make an invite link with the{" "}
          <B>bot</B> scope and add the bot to a server of your own. Discord only
          lets you write to a bot you share a server with.
        </>
      ),
    },
    {
      body: (
        <>
          <B>Send the bot a direct message</B> (not in the server), then press{" "}
          <B>Allow</B> here.
        </>
      ),
      slot: { reach: true },
    },
  ],
  slack: [
    {
      body: (
        <>
          At <Link href="https://api.slack.com/apps">api.slack.com/apps</Link>,{" "}
          <B>Create New App › From a manifest</B>, and paste the manifest.
        </>
      ),
      slot: { manifest: true },
    },
    {
      body: (
        <>
          <B>Basic Information › App-Level Tokens</B>: generate one with{" "}
          <B>connections:write</B>. It starts with xapp-.
        </>
      ),
      slot: { key: SLACK_APP_TOKEN_KEY, looks: "xapp-…" },
    },
    {
      body: (
        <>
          <B>Install App</B> to your workspace. The Bot User OAuth Token starts
          with xoxb-.
        </>
      ),
      slot: { key: SLACK_BOT_TOKEN_KEY, looks: "xoxb-…" },
    },
    {
      body: (
        <>
          In Slack, open the app under <B>Apps</B> and write in its{" "}
          <B>Messages</B> tab, then press <B>Allow</B> here.
        </>
      ),
      slot: { reach: true },
    },
  ],
};

/** How a step is drawn. `flat` is a step the app cannot see the end of — it happens elsewhere. */
type StepState = "flat" | "now" | "done" | "later";

/**
 * The steps' faces from the only facts the server has. Before every key is in, the first
 * empty field is what waits on the user and what follows it is not yet; once they are all in,
 * everything up to the last field is behind them and what follows waits on the phone.
 */
function stepStates(
  steps: Step[],
  isSet: (key: string) => boolean,
  connected: boolean,
): StepState[] {
  const keyAt = steps.map((step) =>
    step.slot && "key" in step.slot ? step.slot.key : null,
  );
  const firstEmpty = keyAt.findIndex((key) => key && !isSet(key));
  const lastKey = keyAt.reduce((last, key, at) => (key ? at : last), -1);
  return steps.map((_, at) => {
    const key = keyAt[at];
    if (key) return isSet(key) ? "done" : at === firstEmpty ? "now" : "later";
    // A step with no field of its own is read from the fields around it: one before the
    // first empty field still has to be done, one after it is not yet
    if (firstEmpty >= 0) return at < firstEmpty ? "flat" : "later";
    // Every field is in: the rest happens on the phone, and the app only learns of it
    // when someone writes, so those steps wait on the user rather than on us
    return at < lastKey ? "done" : connected ? "now" : "flat";
  });
}

/** A link the phone can take a picture of instead of being typed; only Telegram names one. */
function reachLink(channel: ReachChannelStatus | null): string | null {
  if (!channel || channel.name !== "telegram") return null;
  const bot = channel.bot?.startsWith("@") ? channel.bot.slice(1) : null;
  return bot ? `https://t.me/${bot}` : null;
}

export function ReachGuide() {
  const config = useServerRoute<ConfigStatus[]>(queryKey.config);
  const reach = useServerRoute<ReachStatus>(queryKey.reach);
  useAppEvent({ reach: () => void revalidate(queryKey.reach) });

  const isSet = (key: string) => isConfigSet(config.data, key);
  const statusOf = (name: ReachChannelName) =>
    reach.data?.channels.find((one) => one.name === name) ?? null;
  const keyed = (name: ReachChannelName) => REACH_KEYS[name].every(isSet);
  const letIn = (name: ReachChannelName) => Boolean(statusOf(name)?.allowed);

  // The app opens on what is unfinished: a service part-way through, else the first one
  // when nobody is let in anywhere. With one working and nothing half-done, none opens.
  const started = REACH_CHANNELS.find((name) => keyed(name) && !letIn(name));
  const none = !REACH_CHANNELS.some(letIn);
  const [open, setOpen] = useState<ReachChannelName | null>(
    started ?? (none ? REACH_CHANNELS[0] : null),
  );

  return (
    <div className="space-y-2">
      <SettingItems>
        {REACH_CHANNELS.map((name) => (
          <Channel
            key={name}
            name={name}
            status={statusOf(name)}
            tokensIn={REACH_KEYS[name].filter(isSet).length}
            isSet={isSet}
            open={open === name}
            onOpen={() => setOpen(open === name ? null : name)}
          />
        ))}
      </SettingItems>
      <SettingNote>
        Only the one person you allow can write, and only direct messages are
        read. For bots to work while no tab is open, switch on Work while the
        app is closed in Settings › Bots.
      </SettingNote>
    </div>
  );
}

function Channel({
  name,
  status,
  tokensIn,
  isSet,
  open,
  onOpen,
}: {
  name: ReachChannelName;
  status: ReachChannelStatus | null;
  /** How many of this service's tokens are in; Slack takes two. */
  tokensIn: number;
  isSet: (key: string) => boolean;
  open: boolean;
  onOpen: () => void;
}) {
  const steps = STEPS[name];
  const states = stepStates(steps, isSet, Boolean(status?.bot));
  const link = reachLink(status);

  return (
    <div>
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <SiteIcon
          host={SITE[name]}
          className="size-4 rounded-[4px]"
          fallback={<KeyRound className="size-4 text-muted-foreground" />}
        />
        <span className="text-sm font-medium">{REACH_LABEL[name]}</span>
        <span className="min-w-0 flex-1 truncate">
          <ChannelWords
            status={status}
            tokensIn={tokensIn}
            tokens={REACH_KEYS[name].length}
          />
        </span>
        <ChevronRight
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {open && (
        <div className="px-4 pt-1 pb-4">
          <ol className="space-y-3">
            {steps.map((step, at) => (
              // Steps never reorder: the index is the step
              <Row
                key={at}
                n={at + 1}
                step={step}
                state={states[at]}
                set={
                  step.slot && "key" in step.slot ? isSet(step.slot.key) : false
                }
                status={status}
                link={link}
                last={at === steps.length - 1}
              />
            ))}
          </ol>
          {status?.allowed && <LetGo name={name} who={status.allowed.name} />}
        </div>
      )}
    </div>
  );
}

/** What the row says about a service when it is shut: never an instruction, only where it is. */
function ChannelWords({
  status,
  tokensIn,
  tokens,
}: {
  status: ReachChannelStatus | null;
  tokensIn: number;
  tokens: number;
}) {
  const small = "text-xs";
  if (tokensIn < tokens)
    return (
      <span className={cn(small, "text-muted-foreground")}>
        {tokensIn ? `${tokensIn} of ${tokens} tokens in` : "Not set"}
      </span>
    );
  if (status?.allowed)
    return (
      <span className={cn(small, "text-muted-foreground")}>
        Listening as {status.bot}. {status.allowed.name} is let in.
      </span>
    );
  if (status?.problem && !status.bot)
    return (
      <span className={cn(small, "text-destructive")}>{status.problem}</span>
    );
  if (!status?.bot)
    return (
      <ShinyText text="Connecting…" className={cn(small, "align-middle")} />
    );
  return (
    <ShinyText
      text={`Listening as ${status.bot} — waiting for your first message`}
      tone="waiting"
      className={cn(small, "align-middle")}
    />
  );
}

function Row({
  n,
  step,
  state,
  set,
  status,
  link,
  last,
}: {
  n: number;
  step: Step;
  state: StepState;
  /** Key steps only: whether the token is already stored. */
  set: boolean;
  status: ReachChannelStatus | null;
  link: string | null;
  last: boolean;
}) {
  return (
    <li className="flex gap-3 text-[13px] leading-relaxed">
      <Bullet n={n} state={state} />
      <div className="min-w-0 flex-1 space-y-2.5">
        {/* A step behind or ahead dims whole: the words it emphasises dim with it */}
        <p
          className={cn(
            state === "done" || state === "later"
              ? "text-muted-foreground/60 **:text-inherit"
              : "text-muted-foreground",
          )}
        >
          {step.body}
        </p>
        <Doing
          slot={step.slot}
          state={state}
          set={set}
          status={status}
          link={link}
          last={last}
        />
      </div>
    </li>
  );
}

function Bullet({ n, state }: { n: number; state: StepState }) {
  if (state === "done")
    return (
      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-foreground text-background">
        <Check className="size-3" />
      </span>
    );
  return (
    <span
      className={cn(
        "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-background font-mono text-[10.5px] ring-1",
        state === "now"
          ? cn(WAITING_INK, "ring-amber-600/40")
          : "text-muted-foreground ring-border/60",
        state === "later" && "opacity-60",
      )}
    >
      {n}
    </span>
  );
}

/**
 * The one thing to do in this step, under the step's words. A step behind holds only its
 * field, so a token can still be replaced or taken out; one ahead holds nothing at all.
 */
function Doing({
  slot,
  state,
  set,
  status,
  link,
  last,
}: {
  slot?: Slot;
  state: StepState;
  set: boolean;
  status: ReachChannelStatus | null;
  link: string | null;
  last: boolean;
}) {
  if (state === "later" || !slot) {
    if (state === "later" || !last || !status?.bot || status.allowed)
      return null;
    return <ShinyText text="Waiting for your first message…" tone="waiting" />;
  }
  if ("key" in slot)
    return <KeyField configKey={slot.key} looks={slot.looks} set={set} />;
  if (state === "done") return null;
  if ("open" in slot)
    return (
      <Button
        size="sm"
        variant="outline"
        render={<a href={slot.open} target="_blank" rel="noreferrer" />}
      >
        <ExternalLink />
        {slot.label}
      </Button>
    );
  if ("manifest" in slot) return <CopyManifest />;
  return (
    <div className="space-y-2.5">
      {link && <Scan link={link} />}
      {last && status?.bot && !status.allowed && (
        <ShinyText text="Waiting for your first message…" tone="waiting" />
      )}
    </div>
  );
}

/** The bot's own address, big enough to be read from the screen by a phone camera. */
function Scan({ link }: { link: string }) {
  const { size, data } = encode(link);
  const shown = link.replace(/^https:\/\//, "");
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="rounded-lg bg-white p-2.5">
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="block size-31 text-black"
          role="img"
          aria-label={`A picture of ${shown} for a phone camera`}
        >
          {data.flatMap((row, y) =>
            row.map((on, x) =>
              on ? (
                <rect
                  key={`${x}-${y}`}
                  x={x}
                  y={y}
                  width={1}
                  height={1}
                  fill="currentColor"
                />
              ) : null,
            ),
          )}
        </svg>
      </div>
      <div className="space-y-2">
        <p className="text-muted-foreground">
          Point your phone's camera at it, or open the link here.
        </p>
        <Button
          size="sm"
          variant="outline"
          render={<a href={link} target="_blank" rel="noreferrer" />}
        >
          <ExternalLink />
          {shown}
        </Button>
      </div>
    </div>
  );
}

/**
 * Set, replace or remove one token without leaving the step it belongs to. A token that is
 * in stays a line until the user asks to change it: the value itself is never shown.
 */
function KeyField({
  configKey,
  looks,
  set,
}: {
  configKey: string;
  looks: string;
  set: boolean;
}) {
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const done = () => {
    setValue("");
    setEditing(false);
    revalidate(queryKey.config);
    revalidate(queryKey.reach);
  };
  const [save, saving] = useServerAction(setConfigAction, { onOk: done });
  const [remove, removing] = useServerAction(removeConfigAction, {
    onOk: done,
  });

  // A step already behind stays quiet: one muted way back in, and nothing else
  if (set && !editing)
    return (
      <Button
        size="xs"
        variant="ghost"
        onClick={() => setEditing(true)}
        className="-ml-2 text-muted-foreground"
      >
        Change the token
      </Button>
    );

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save(configKey, value).catch(() => {});
      }}
    >
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={looks}
        aria-label="Token"
        autoComplete="off"
        spellCheck={false}
        className="w-72 font-mono"
      />
      <Button
        type="submit"
        size="sm"
        loading={saving}
        disabled={value.trim().length < 8}
      >
        {set ? "Replace" : "Save"}
      </Button>
      {set && (
        <>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          {/* set apart from what saves, at the far end and in red */}
          <Button
            size="sm"
            variant="ghost"
            loading={removing}
            onClick={() => void remove(configKey).catch(() => {})}
            className="ml-auto text-destructive hover:text-destructive"
          >
            Remove
          </Button>
        </>
      )}
    </form>
  );
}

function CopyManifest() {
  const [copied, setCopied] = useState(false);
  return (
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
  );
}

/** Under the steps of a service someone is let in through: the way to let them go. */
function LetGo({ name, who }: { name: ReachChannelName; who: string }) {
  const [forget, forgetting] = useServerAction(forgetReachAction, {
    onOk: () => revalidate(queryKey.reach),
  });
  return (
    <div className="flex flex-wrap items-center gap-2 pt-3 pl-8 text-[13px] text-muted-foreground">
      <span>{who} can write from a phone.</span>
      <Button
        size="sm"
        variant="outline"
        loading={forgetting}
        onClick={() => void forget(name).catch(() => {})}
      >
        Let them go
      </Button>
    </div>
  );
}
