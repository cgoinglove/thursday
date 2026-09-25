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
import { Button, buttonVariants } from "@/components/ui/button";
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
 * server knows only three things about a service (its keys, whether it connected or turned a
 * token away, who is let in); `stepStates` turns those into the steps' faces. The guide
 * (`guide/phone.md`) tells Thursday the same, manifest included.
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
  /**
   * The address the service named for this bot, drawn for a phone to read. `does` is what
   * pressing it does, for an address too long to read as a label.
   */
  | { says: string; does?: string };

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
      slot: { says: "Point your phone's camera at it to open the chat." },
    },
    {
      body: (
        <>
          A question with a code appears on this computer. Press <B>Allow</B> if
          your phone shows the same code.
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
          <B>Add the bot to a server of your own</B> — Discord only delivers a
          message to a bot you share a server with. A private server made for
          this is fine.
        </>
      ),
      slot: {
        says: "Point your phone's camera at it, or open it here. It asks which server, and adds the bot with no permissions in it.",
        does: "Add the bot to a server",
      },
    },
    {
      body: (
        <>
          <B>Send the bot a direct message</B> (not in the server). A question
          with a code appears here: press <B>Allow</B> if your phone shows the
          same code.
        </>
      ),
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
          <B>Messages</B> tab. A question with a code appears here: press{" "}
          <B>Allow</B> if Slack shows the same code.
        </>
      ),
    },
  ],
};

/** How a step is drawn. `flat` is a step the app cannot see the end of — it happens elsewhere. */
type StepState = "flat" | "now" | "done" | "later";

/**
 * The steps' faces from the only facts the server has. Before every key is in, the first
 * field still wanting a token — empty, or holding one the service turned away — is what
 * waits on the user and what follows it is not yet; once they are all in, everything up to
 * the last field is behind them and what follows waits on the phone, until someone is let in
 * and nothing waits at all.
 */
function stepStates(
  steps: Step[],
  isSet: (key: string) => boolean,
  facts: { connected: boolean; allowed: boolean; refused: string | null },
): StepState[] {
  const keyAt = steps.map((step) =>
    step.slot && "key" in step.slot ? step.slot.key : null,
  );
  const wants = (key: string) => !isSet(key) || key === facts.refused;
  const firstEmpty = keyAt.findIndex((key) => key && wants(key));
  const lastKey = keyAt.reduce((last, key, at) => (key ? at : last), -1);
  return steps.map((_, at) => {
    const key = keyAt[at];
    if (key) return !wants(key) ? "done" : at === firstEmpty ? "now" : "later";
    // A step with no field of its own is read from the fields around it: one before the
    // first empty field still has to be done — unless a token came of it, turned away
    // since — and one after it is not yet
    if (firstEmpty >= 0)
      return at < firstEmpty ? (facts.refused ? "done" : "flat") : "later";
    if (facts.allowed) return "done";
    // Every field is in: the rest happens on the phone, and the app only learns of it
    // when someone writes, so those steps wait on the user rather than on us
    return at < lastKey ? "done" : facts.connected ? "now" : "flat";
  });
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

  // The app opens on what is unfinished: a service that stopped (the nav's dot led here),
  // else one part-way through, else the first one when nobody is let in anywhere. With one
  // working and nothing half-done, none opens.
  const stopped = REACH_CHANNELS.find((name) => statusOf(name)?.refused);
  const started = REACH_CHANNELS.find((name) => keyed(name) && !letIn(name));
  const none = !REACH_CHANNELS.some(letIn);
  const [open, setOpen] = useState<ReachChannelName | null>(
    stopped ?? started ?? (none ? REACH_CHANNELS[0] : null),
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
        read. Work started here runs whether or not a tab is open, while
        Thursday is running on this computer.
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
  const refused = status?.refused ?? null;
  const states = stepStates(steps, isSet, {
    connected: Boolean(status?.bot),
    allowed: Boolean(status?.allowed),
    refused,
  });
  // It is listening and nobody has written yet: the last step is where that waits
  const waiting = Boolean(status?.bot) && !status?.allowed && !refused;

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
                refused={
                  step.slot && "key" in step.slot && step.slot.key === refused
                    ? (status?.problem ?? "")
                    : null
                }
                link={status?.link ?? null}
                waiting={waiting && at === steps.length - 1}
              />
            ))}
          </ol>
          {status?.allowed && (
            <LetGo
              name={name}
              who={status.allowed.name}
              stopped={Boolean(refused)}
            />
          )}
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
  // Stopped for good until a token changes: said in red whoever is let in, since nothing
  // written from the phone reaches her
  if (status?.refused)
    return (
      <span className={cn(small, "text-destructive")}>
        Stopped — {REACH_LABEL[status.name]} turned the token away
      </span>
    );
  // Trouble it is trying again after, and may come back from by itself: a wait, not a failure
  if (status?.problem)
    return (
      <ShinyText
        text={`${status.bot ? "Reconnecting" : "Connecting"}… ${status.problem}`}
        className={cn(small, "align-middle")}
      />
    );
  if (status?.allowed)
    return (
      <span className={cn(small, "text-muted-foreground")}>
        Listening as {status.bot}. {status.allowed.name} is let in.
      </span>
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
  refused,
  link,
  waiting,
}: {
  n: number;
  step: Step;
  state: StepState;
  /** Key steps only: whether the token is already stored. */
  set: boolean;
  /** Key steps only: what the service said when it turned this step's token away. */
  refused: string | null;
  /** Where the service says this bot is, once it has connected. */
  link: string | null;
  /** This is the step the first message from the phone is being waited for in. */
  waiting: boolean;
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
          refused={refused}
          link={link}
          waiting={waiting}
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
          ? cn(WAITING_INK, "ring-waiting/40")
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
 * field, so a token can still be replaced or taken out, and the way to the bot, so the chat
 * can still be opened; one ahead holds nothing at all.
 */
function Doing({
  slot,
  state,
  set,
  refused,
  link,
  waiting,
}: {
  slot?: Slot;
  state: StepState;
  set: boolean;
  refused: string | null;
  link: string | null;
  waiting: boolean;
}) {
  const held = waiting && (
    <ShinyText text="Waiting for your first message…" tone="waiting" />
  );
  if (state === "later") return null;
  if (slot && "key" in slot)
    return (
      <KeyField
        configKey={slot.key}
        looks={slot.looks}
        set={set}
        refused={refused}
      />
    );
  // Behind them: the picture for a camera has done its work, the address stays
  if (state === "done")
    return slot && "says" in slot && link ? (
      <OutLink href={link}>{slot.does ?? bare(link)}</OutLink>
    ) : null;
  if (!slot) return held || null;
  if ("open" in slot) return <OutLink href={slot.open}>{slot.label}</OutLink>;
  if ("manifest" in slot) return <CopyManifest />;
  // The service has not named its address yet: the words alone are the step
  if (!link) return held || null;
  return (
    <div className="space-y-2.5">
      <Scan link={link} says={slot.says} does={slot.does} />
      {held}
    </div>
  );
}

/** The bot's own address, big enough to be read from the screen by a phone camera. */
function Scan({
  link,
  says,
  does,
}: {
  link: string;
  says: string;
  does?: string;
}) {
  const { size, data } = encode(link);
  const shown = bare(link);
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
        <p className="text-muted-foreground">{says}</p>
        <OutLink href={link}>{does ?? shown}</OutLink>
      </div>
    </div>
  );
}

/** An address as a label reads it: the scheme says nothing a person needs. */
const bare = (link: string) => link.replace(/^https:\/\//, "");

/** A way out to the service, drawn as a button and heard as the link it is. */
function OutLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      // Merged as Button merges them: a variant's border has to beat the base's transparent one
      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
    >
      <ExternalLink />
      {children}
    </a>
  );
}

/**
 * Set, replace or remove one token without leaving the step it belongs to. A token that is
 * in stays a line until the user asks to change it: the value itself is never shown. One the
 * service turned away stands open instead, with what the service said under it.
 */
function KeyField({
  configKey,
  looks,
  set,
  refused,
}: {
  configKey: string;
  looks: string;
  set: boolean;
  refused: string | null;
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
  if (set && !editing && refused === null)
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
    <>
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
          // A token is a key to the bot: kept out of sight, as every key field keeps its value
          type="password"
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
            {/* A refused token has nothing to go back to: the step waits on a new one */}
            {refused === null && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            )}
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
      {refused && <p className="max-w-xl text-destructive">{refused}</p>}
    </>
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

/**
 * Under the steps of a service someone is let in through: the way to let them go. While the
 * service is stopped they are let in and still cannot write, and the line says only the first.
 */
function LetGo({
  name,
  who,
  stopped,
}: {
  name: ReachChannelName;
  who: string;
  stopped: boolean;
}) {
  const [forget, forgetting] = useServerAction(forgetReachAction, {
    onOk: () => revalidate(queryKey.reach),
  });
  return (
    <div className="flex flex-wrap items-center gap-2 pt-3 pl-8 text-[13px] text-muted-foreground">
      <span>
        {stopped ? `${who} is let in.` : `${who} can write from a phone.`}
      </span>
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
