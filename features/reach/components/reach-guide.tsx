"use client";

import {
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  KeyRound,
  Mail,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { encode } from "uqr";
import { useAppEvent } from "@/app/api/events/app-event.client";
import { queryKey } from "@/app/api/query-key";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { notify } from "@/components/ui/notify";
import { ShinyText } from "@/components/ui/shiny-text";
import { SiteIcon } from "@/components/ui/site-icon";
import { KEY_MIN } from "@/config";
import {
  removeConfigAction,
  setConfigAction,
} from "@/features/config/config.action";
import {
  CONFIG_ENTRIES,
  type ConfigStatus,
  envWords,
  isConfigFromEnv,
  isConfigSet,
  isConfigUnreadable,
  lostWords,
} from "@/features/config/config.const";
import {
  SettingItems,
  SettingNote,
} from "@/features/settings/components/setting-ui";
import { useLocale } from "@/hooks/use-locale";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { cn, WAITING_INK } from "@/lib/utils";
import {
  type ReachDict,
  type ReachSeg,
  type ReachStep,
  settingsDictOf,
} from "@/messages";
import {
  forgetReachAction,
  nameReachAction,
  removeMailboxAction,
  saveMailboxAction,
} from "../reach.action";
import {
  EMAIL_PASSWORD_KEY,
  REACH_CHANNELS,
  REACH_KEYS,
  REACH_LABEL,
  type ReachChannelName,
  type ReachChannelStatus,
  type ReachStatus,
} from "../reach.schema";

/**
 * Settings › Phone, whole: one row per chat app or mailbox, the one being connected open on its steps.
 * The steps are the state — each is done, waiting on the user, or not yet — so nothing says
 * twice where the user has got to, and a service that needs nothing is a single line. The
 * server knows only three things about a service (its keys, whether it connected or turned a
 * token away, who is let in); `stepStates` turns those into the steps' faces. The guide
 * (`guide/phone.md`) tells Thursday the same, manifest included.
 */

/** Each chat app's own site, whose icon marks its row; email is any service's, and has a mark of its own. */
const SITE: Record<Exclude<ReachChannelName, "email">, string> = {
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

/** A translated step body: plain runs, bold runs, and links. */
function Segs({ segs }: { segs: ReachSeg[] }) {
  return (
    <>
      {segs.map((seg, at) =>
        typeof seg === "string" ? (
          <span key={at}>{seg}</span>
        ) : "bold" in seg ? (
          <B key={at}>{seg.bold}</B>
        ) : (
          <Link key={at} href={seg.link.href}>
            {seg.link.label}
          </Link>
        ),
      )}
    </>
  );
}

/** The guide steps in the reader's language. */
function stepsOf(t: ReachDict): Record<ReachChannelName, ReachStep[]> {
  return t.steps as Record<ReachChannelName, ReachStep[]>;
}

/** What a step holds besides its words: the one thing to do in it. */
type Slot = NonNullable<ReachStep["slot"]>;

type Step = { body: ReachSeg[]; slot?: Slot };

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

/**
 * Email's steps from what the server says of it: her mailbox saved (and not turned away or
 * unreadable), the user's own address named. Writing to her happens in a mail app, where the
 * app cannot see it, so the last step waits on nobody once it is open.
 */
function mailStates(facts: {
  mailbox: boolean;
  stopped: boolean;
  named: boolean;
  connected: boolean;
}): StepState[] {
  const inbox = facts.mailbox && !facts.stopped;
  return [
    inbox ? "done" : "flat",
    inbox ? "done" : "now",
    !inbox ? "later" : facts.named ? "done" : "now",
    inbox && facts.named && facts.connected ? "flat" : "later",
  ];
}

export function ReachGuide() {
  const config = useServerRoute<ConfigStatus[]>(queryKey.config);
  const reach = useServerRoute<ReachStatus>(queryKey.reach);
  useAppEvent({ reach: () => void revalidate(queryKey.reach) });

  const isSet = (key: string) => isConfigSet(config.data, key);
  const isLost = (key: string) => isConfigUnreadable(config.data, key);
  const statusOf = (name: ReachChannelName) =>
    reach.data?.channels.find((one) => one.name === name) ?? null;
  // Email's address and servers are no secrets, so they are not among the keys' states
  const keyed = (name: ReachChannelName) =>
    name === "email"
      ? Boolean(statusOf(name)?.mailbox)
      : REACH_KEYS[name].every(isSet);
  const letIn = (name: ReachChannelName) => Boolean(statusOf(name)?.allowed);

  // The app opens on what is unfinished: a service that stopped — its token turned away, or
  // no longer readable (the nav's dot led here) — else one part-way through, else the first
  // one when nobody is let in anywhere. With one working and nothing half-done, none opens.
  const stopped = REACH_CHANNELS.find(
    (name) => statusOf(name)?.refused || REACH_KEYS[name].some(isLost),
  );
  const started = REACH_CHANNELS.find((name) => keyed(name) && !letIn(name));
  const none = !REACH_CHANNELS.some(letIn);
  const locale = useLocale();
  const t = settingsDictOf(locale).reach;
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
            isLost={isLost}
            open={open === name}
            onOpen={() => setOpen(open === name ? null : name)}
          />
        ))}
      </SettingItems>
      <SettingNote>{t.note}</SettingNote>
    </div>
  );
}

function Channel({
  name,
  status,
  tokensIn,
  isSet,
  isLost,
  open,
  onOpen,
}: {
  name: ReachChannelName;
  status: ReachChannelStatus | null;
  /** How many of this service's tokens are in; Slack takes two. */
  tokensIn: number;
  isSet: (key: string) => boolean;
  /** Saved, but no longer readable (config.const ConfigStatus `unreadable`). */
  isLost: (key: string) => boolean;
  open: boolean;
  onOpen: () => void;
}) {
  const locale = useLocale();
  const t = settingsDictOf(locale).reach;
  const steps = stepsOf(t)[name];
  const refused = status?.refused ?? null;
  const email = name === "email";
  const states = email
    ? mailStates({
        mailbox: Boolean(status?.mailbox),
        stopped: Boolean(refused) || isLost(EMAIL_PASSWORD_KEY),
        named: Boolean(status?.allowed),
        connected: Boolean(status?.bot),
      })
    : stepStates(steps, isSet, {
        connected: Boolean(status?.bot),
        allowed: Boolean(status?.allowed),
        refused,
      });
  // It is listening and nobody has written yet: the last step is where that waits. Email's
  // first mail is written where the app cannot see it
  const waiting =
    !email && Boolean(status?.bot) && !status?.allowed && !refused;

  return (
    <div>
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {email ? (
          <Mail className="size-4 text-muted-foreground" />
        ) : (
          <SiteIcon
            host={SITE[name]}
            className="size-4 rounded-[4px]"
            fallback={<KeyRound className="size-4 text-muted-foreground" />}
          />
        )}
        <span className="text-sm font-medium">{REACH_LABEL[name]}</span>
        <span className="min-w-0 flex-1 truncate">
          {email ? (
            <MailWords status={status} lost={isLost(EMAIL_PASSWORD_KEY)} />
          ) : (
            <ChannelWords
              status={status}
              tokensIn={tokensIn}
              tokens={REACH_KEYS[name].length}
              lost={REACH_KEYS[name].some(isLost)}
            />
          )}
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
                lost={
                  step.slot && "key" in step.slot
                    ? isLost(step.slot.key)
                    : false
                }
                refused={
                  step.slot && "key" in step.slot && step.slot.key === refused
                    ? (status?.problem ?? "")
                    : step.slot && "key" in step.slot && isLost(step.slot.key)
                      ? lostWords(
                          t.lostTokenAgain,
                          t.mailtoFallback,
                          undefined,
                          locale,
                        )
                      : null
                }
                link={status?.link ?? null}
                waiting={waiting && at === steps.length - 1}
                status={status}
                lostPassword={email && isLost(EMAIL_PASSWORD_KEY)}
              />
            ))}
          </ol>
          {/* Email's own address is changed or taken out in its step */}
          {status?.allowed && !email && (
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
  lost,
}: {
  status: ReachChannelStatus | null;
  tokensIn: number;
  tokens: number;
  /** A token of it is saved but no longer readable: stopped, as a refused one is. */
  lost: boolean;
}) {
  const t = settingsDictOf(useLocale()).reach;
  const small = "text-xs";
  if (lost)
    return (
      <span className={cn(small, "text-destructive")}>{t.stoppedToken}</span>
    );
  if (tokensIn < tokens)
    return (
      <span className={cn(small, "text-muted-foreground")}>
        {tokensIn ? t.tokensIn(tokensIn, tokens) : t.notSet}
      </span>
    );
  // Stopped for good until a token changes: said in red whoever is let in, since nothing
  // written from the phone reaches her
  if (status?.refused)
    return (
      <span className={cn(small, "text-destructive")}>
        {t.stoppedTurned(REACH_LABEL[status.name])}
      </span>
    );
  // Trouble it is trying again after, and may come back from by itself: a wait, not a failure
  if (status?.problem)
    return (
      <ShinyText
        text={
          status.bot
            ? t.reconnecting(status.problem)
            : t.connecting(status.problem)
        }
        className={cn(small, "align-middle")}
      />
    );
  if (status?.allowed)
    return (
      <span className={cn(small, "text-muted-foreground")}>
        {t.listeningAs(status.bot, status.allowed.name)}
      </span>
    );
  if (!status?.bot)
    return (
      <ShinyText
        text={t.connectingDots}
        className={cn(small, "align-middle")}
      />
    );
  return (
    <ShinyText
      text={t.waitingFirst(status.bot)}
      tone="waiting"
      className={cn(small, "align-middle")}
    />
  );
}

/** Email's folded line, as ChannelWords says a chat app's. */
function MailWords({
  status,
  lost,
}: {
  status: ReachChannelStatus | null;
  /** The saved app password can no longer be read. */
  lost: boolean;
}) {
  const t = settingsDictOf(useLocale()).reach;
  const small = "text-xs";
  if (lost)
    return (
      <span className={cn(small, "text-destructive")}>
        {t.mailStoppedPassword}
      </span>
    );
  if (!status?.mailbox)
    return (
      <span className={cn(small, "text-muted-foreground")}>{t.notSet}</span>
    );
  if (status.refused)
    return (
      <span className={cn(small, "text-destructive")}>
        {t.mailStoppedService}
      </span>
    );
  if (status.problem)
    return (
      <ShinyText
        text={
          status.bot
            ? t.reconnecting(status.problem)
            : t.connecting(status.problem)
        }
        className={cn(small, "align-middle")}
      />
    );
  if (!status.bot)
    return (
      <ShinyText
        text={t.connectingDots}
        className={cn(small, "align-middle")}
      />
    );
  // Connected, and a mail of theirs waits on a check that will be made again: a wait, not a stop
  if (status.holding)
    return (
      <ShinyText
        text={t.mailHeld(status.bot, status.holding)}
        className={cn(small, "align-middle")}
      />
    );
  if (status.allowed)
    return (
      <span className={cn(small, "text-muted-foreground")}>
        {t.mailCanWrite(status.bot, status.allowed.name)}
      </span>
    );
  return (
    <ShinyText
      text={t.mailNameAddress(status.bot)}
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
  lost,
  refused,
  link,
  waiting,
  status,
  lostPassword,
}: {
  n: number;
  step: Step;
  state: StepState;
  /** Key steps only: whether the token is already stored. */
  set: boolean;
  /** Key steps only: stored, but no longer readable. */
  lost: boolean;
  /** Key steps only: what the service said when it turned this step's token away. */
  refused: string | null;
  /** Where the service says this bot is, once it has connected. */
  link: string | null;
  /** This is the step the first message from the phone is being waited for in. */
  waiting: boolean;
  /** What the server says of the service: email's steps draw from it. */
  status: ReachChannelStatus | null;
  /** Email: the saved app password can no longer be read. */
  lostPassword: boolean;
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
          <Segs segs={step.body} />
        </p>
        <Doing
          slot={step.slot}
          state={state}
          set={set}
          lost={lost}
          refused={refused}
          link={link}
          waiting={waiting}
          status={status}
          lostPassword={lostPassword}
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
  lost,
  refused,
  link,
  waiting,
  status,
  lostPassword,
}: {
  slot?: Slot;
  state: StepState;
  set: boolean;
  lost: boolean;
  refused: string | null;
  link: string | null;
  waiting: boolean;
  status: ReachChannelStatus | null;
  lostPassword: boolean;
}) {
  const locale = useLocale();
  const t = settingsDictOf(locale).reach;
  const held = waiting && <ShinyText text={t.waitingFirstMsg} tone="waiting" />;
  if (state === "later") return null;
  if (slot && "mailbox" in slot)
    return (
      <MailboxField
        mailbox={status?.mailbox ?? null}
        refused={
          status?.refused
            ? (status.problem ?? "")
            : lostPassword
              ? lostWords(t.lostTokenAgain, t.mailtoFallback, undefined, locale)
              : null
        }
      />
    );
  if (slot && "person" in slot)
    return <PersonField who={status?.allowed?.chat ?? null} />;
  if (slot && "write" in slot)
    return status?.mailbox ? (
      <WriteTo address={status.mailbox.address} />
    ) : null;
  if (slot && "key" in slot)
    return (
      <KeyField
        configKey={slot.key}
        looks={slot.looks}
        set={set}
        lost={lost}
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
  const t = settingsDictOf(useLocale()).reach;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="rounded-lg bg-white p-2.5">
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="block size-31 text-black"
          role="img"
          aria-label={t.cameraAria(shown)}
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
  lost,
  refused,
}: {
  configKey: string;
  looks: string;
  set: boolean;
  /** Stored, but no longer readable: it can be replaced, or removed without a new one. */
  lost: boolean;
  refused: string | null;
}) {
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const locale = useLocale();
  const t = settingsDictOf(locale).reach;
  // Deduped with the guide's own read; a token the environment sets cannot be changed here
  const { data: config } = useServerRoute<ConfigStatus[]>(queryKey.config);
  const env = isConfigFromEnv(config, configKey);
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
  const confirmRemove = async () => {
    const confirmed = await notify.confirm({
      title: t.removeTokenTitle,
      description: t.removeTokenBody,
      okText: t.removeTokenOk,
      destructive: true,
    });
    if (confirmed) void remove(configKey);
  };

  // Set where this field cannot reach: where it is, and nothing that would not stick
  if (env)
    return (
      <>
        <p className="max-w-xl text-muted-foreground">
          {envWords(CONFIG_ENTRIES[configKey]?.label ?? configKey, locale)}
        </p>
        {refused && <p className="max-w-xl text-destructive">{refused}</p>}
      </>
    );

  // A step already behind stays quiet: one muted way back in, and nothing else
  if (set && !editing && refused === null)
    return (
      <Button
        size="xs"
        variant="ghost"
        onClick={() => setEditing(true)}
        className="-ml-2 text-muted-foreground"
      >
        {t.changeToken}
      </Button>
    );

  return (
    <>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save(configKey, value);
        }}
      >
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={looks}
          aria-label={t.tokenAria}
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
          disabled={value.trim().length < KEY_MIN}
        >
          {set ? t.replaceBtn : t.saveBtn}
        </Button>
        {(set || lost) && (
          <>
            {/* A refused token has nothing to go back to: the step waits on a new one */}
            {refused === null && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(false)}
              >
                {t.cancelBtn}
              </Button>
            )}
            {/* set apart from what saves, at the far end and in red */}
            <Button
              size="sm"
              variant="ghost"
              loading={removing}
              onClick={() => void confirmRemove()}
              className="ml-auto text-destructive hover:text-destructive"
            >
              {t.removeBtn}
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
  const t = settingsDictOf(useLocale()).reach;
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
      {copied ? t.copiedBtn : t.copyManifest}
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
  const t = settingsDictOf(useLocale()).reach;
  return (
    <div className="flex flex-wrap items-center gap-2 pt-3 pl-8 text-[13px] text-muted-foreground">
      <span>{stopped ? t.letInLine(who) : t.canWriteLine(who)}</span>
      <Button
        size="sm"
        variant="outline"
        loading={forgetting}
        onClick={async () => {
          // One press ends every chat through this service, so it is asked like a delete
          const sure = await notify.confirm({
            title: t.letGoTitle(who),
            description: t.letGoBody,
            okText: t.letGoOk,
            destructive: true,
          });
          if (sure) void forget(name);
        }}
      >
        {t.letGoBtn}
      </Button>
    </div>
  );
}

/** A mailbox server as it is kept (`host:port`), split for its two fields. */
const splitServer = (server: string | undefined, port: number) => {
  const at = server?.lastIndexOf(":") ?? -1;
  return at > 0 && server
    ? { host: server.slice(0, at), port: server.slice(at + 1) }
    : { host: "", port: String(port) };
};

/**
 * Email's step 2: her address and app password, saved together with the servers her mail
 * service publishes (mail-servers). Where it publishes none, the same form asks for them,
 * keeping what was typed. Once saved it is a line — address and servers, never the password —
 * until the user asks to change it; one the server turned away stands open, with its words.
 */
function MailboxField({
  mailbox,
  refused,
}: {
  mailbox: ReachChannelStatus["mailbox"];
  /** What the mail server said when it turned the sign-in away, or why the saved password is lost. */
  refused: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState(mailbox?.address ?? "");
  const [password, setPassword] = useState("");
  // Opened when the address's domain publishes no servers, and kept open once typed in
  const [servers, setServers] = useState(false);
  const [imap, setImap] = useState(() => splitServer(undefined, 993));
  const [smtp, setSmtp] = useState(() => splitServer(undefined, 465));
  const { data: config } = useServerRoute<ConfigStatus[]>(queryKey.config);
  const done = () => {
    setPassword("");
    setEditing(false);
    setServers(false);
    revalidate(queryKey.config);
    revalidate(queryKey.reach);
  };
  const [save, saving] = useServerAction(saveMailboxAction, {
    onOk: (saved) => {
      if (saved?.found) return done();
      setServers(true);
    },
  });
  const [remove, removing] = useServerAction(removeMailboxAction, {
    onOk: done,
  });
  const locale = useLocale();
  const t = settingsDictOf(locale).reach;
  const confirmRemove = async () => {
    const confirmed = await notify.confirm({
      title: t.removeMailboxTitle,
      description: t.removeMailboxBody,
      okText: t.removeMailboxOk,
      destructive: true,
    });
    if (confirmed) void remove();
  };

  if (isConfigFromEnv(config, EMAIL_PASSWORD_KEY))
    return (
      <>
        <p className="max-w-xl text-muted-foreground">
          {envWords(t.mailboxAppPassword, locale)}
        </p>
        {refused && <p className="max-w-xl text-destructive">{refused}</p>}
      </>
    );

  if (mailbox && !editing && refused === null)
    return (
      <div className="space-y-1">
        <p className="font-mono text-[11px] text-muted-foreground">
          {mailbox.address} · {mailbox.imap} · {mailbox.smtp}
        </p>
        <Button
          size="xs"
          variant="ghost"
          // What is saved now, which the screen may have learned after this field first drew
          onClick={() => {
            setAddress(mailbox.address);
            setEditing(true);
          }}
          className="-ml-2 text-muted-foreground"
        >
          {t.changeBtn}
        </Button>
      </div>
    );

  const domain = address.includes("@")
    ? address.slice(address.lastIndexOf("@") + 1)
    : t.domainFallback;
  const field = "grid gap-1 font-mono text-[11px] text-muted-foreground";
  return (
    <>
      <form
        className="space-y-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          // The same address keeps the servers it was saved with: a new password is not a
          // reason to ask for them again
          const kept =
            !servers &&
            mailbox?.address.toLowerCase() === address.trim().toLowerCase();
          void save({
            address: address.trim(),
            password,
            ...(servers
              ? {
                  imap: `${imap.host.trim()}:${imap.port.trim()}`,
                  smtp: `${smtp.host.trim()}:${smtp.port.trim()}`,
                }
              : kept
                ? { imap: mailbox.imap, smtp: mailbox.smtp }
                : {}),
          });
        }}
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className={field}>
            {t.addressField}
            <Input
              value={address}
              onChange={(event) => {
                setAddress(event.target.value);
                setServers(false);
              }}
              placeholder="thursday@example.com"
              type="email"
              autoComplete="off"
              spellCheck={false}
              className="w-64 font-sans"
            />
          </label>
          <label className={field}>
            {t.appPasswordField}
            <Input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t.appPasswordPlaceholder}
              // A key to her mailbox: kept out of sight, as every key field keeps its value
              type="password"
              autoComplete="off"
              spellCheck={false}
              className="w-52 placeholder:font-sans"
            />
          </label>
        </div>
        {servers && (
          <>
            <p className="max-w-xl text-muted-foreground">
              {t.noServersNote(domain)}
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <ServerFields
                label={t.readingServer}
                looks={`imap.${domain}`}
                value={imap}
                onChange={setImap}
              />
              <ServerFields
                label={t.sendingServer}
                looks={`smtp.${domain}`}
                value={smtp}
                onChange={setSmtp}
              />
            </div>
          </>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            size="sm"
            loading={saving}
            disabled={
              !address.includes("@") ||
              password.trim().length < 8 ||
              (servers && !(imap.host.trim() && smtp.host.trim()))
            }
          >
            {mailbox ? t.replaceAction : t.saveAction}
          </Button>
          {mailbox && (
            <>
              {refused === null && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditing(false)}
                >
                  {t.cancelBtn}
                </Button>
              )}
              {/* set apart from what saves, at the far end and in red */}
              <Button
                size="sm"
                variant="ghost"
                loading={removing}
                onClick={() => void confirmRemove()}
                className="ml-auto text-destructive hover:text-destructive"
              >
                {t.removeBtn}
              </Button>
            </>
          )}
        </div>
      </form>
      {refused && <p className="max-w-xl text-destructive">{refused}</p>}
    </>
  );
}

function ServerFields({
  label,
  looks,
  value,
  onChange,
}: {
  label: string;
  looks: string;
  value: { host: string; port: string };
  onChange: (value: { host: string; port: string }) => void;
}) {
  const field = "grid gap-1 font-mono text-[11px] text-muted-foreground";
  const t = settingsDictOf(useLocale()).reach;
  return (
    <>
      <label className={field}>
        {label}
        <Input
          value={value.host}
          onChange={(event) => onChange({ ...value, host: event.target.value })}
          placeholder={looks}
          autoComplete="off"
          spellCheck={false}
          className="w-52 font-mono"
        />
      </label>
      <label className={field}>
        {t.portField}
        <Input
          value={value.port}
          onChange={(event) => onChange({ ...value, port: event.target.value })}
          inputMode="numeric"
          autoComplete="off"
          className="w-18 font-mono"
        />
      </label>
    </>
  );
}

/**
 * Email's step 3: the user's own address, the only one whose mail reaches her. A line once
 * named, until they ask to change it; taking it out leaves nobody who can write.
 */
function PersonField({ who }: { who: string | null }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const t = settingsDictOf(useLocale()).reach;
  const done = () => {
    setValue("");
    setEditing(false);
    revalidate(queryKey.reach);
  };
  const [name, naming] = useServerAction(nameReachAction, { onOk: done });
  const [forget, forgetting] = useServerAction(forgetReachAction, {
    onOk: done,
  });

  if (who && !editing)
    return (
      <div className="space-y-1">
        <p className="font-mono text-[11px] text-muted-foreground">{who}</p>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => setEditing(true)}
          className="-ml-2 text-muted-foreground"
        >
          {t.changeBtn}
        </Button>
      </div>
    );

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void name("email", value.trim());
      }}
    >
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="you@example.org"
        aria-label={t.ownAddressAria}
        type="email"
        autoComplete="email"
        spellCheck={false}
        className="w-64"
      />
      <Button
        type="submit"
        size="sm"
        loading={naming}
        disabled={!value.includes("@")}
      >
        {who ? t.replaceAction : t.saveAction}
      </Button>
      {who && (
        <>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            {t.cancelBtn}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={forgetting}
            onClick={async () => {
              // Nobody can write to her by email after this, so it is asked like a delete
              const sure = await notify.confirm({
                title: t.stopMailTitle(who),
                description: t.stopMailBody,
                okText: t.stopMailOk,
                destructive: true,
              });
              if (sure) void forget("email");
            }}
            className="ml-auto text-destructive hover:text-destructive"
          >
            {t.removeBtn}
          </Button>
        </>
      )}
    </form>
  );
}

/** Email's step 4: her address, to open in a mail app or to copy into one. */
function WriteTo({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const t = settingsDictOf(useLocale()).reach;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <OutLink href={`mailto:${address}`}>{t.writeTo(address)}</OutLink>
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          void navigator.clipboard.writeText(address).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2_000);
          })
        }
      >
        {copied ? <Check /> : <Copy />}
        {copied ? t.copiedBtn : t.copyHerAddress}
      </Button>
    </div>
  );
}
