"use client";

import {
  AppWindow,
  ArrowUpRight,
  Globe,
  KeyRound,
  LogIn,
  LogOut,
  type LucideIcon,
  ShieldCheck,
  X,
} from "lucide-react";
import { useAppEvent } from "@/app/api/events/app-event.client";
import { queryKey } from "@/app/api/query-key";
import { Button, buttonVariants } from "@/components/ui/button";
import { notify } from "@/components/ui/notify";
import { SiteIcon } from "@/components/ui/site-icon";
import type { Bot } from "@/features/bot/bot.schema";
import { BotMark } from "@/features/bot/components/bot-mark";
import {
  SettingError,
  SettingItems,
  SettingRailNote,
  SettingScreen,
  SettingSkeleton,
} from "@/features/settings/components/setting-ui";
import { whenOf } from "@/lib/date-like";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { cn, WAITING_INK } from "@/lib/utils";
import { removeSignInAction, setSignInBotAction } from "../signins.action";
import type { SignIn } from "../signins.schema";

/**
 * The sign-ins the app keeps: the site, who it signs in as, the bots that may borrow it,
 * and the way to sign out. Nothing is added here — a sign-in comes to be when a bot needs
 * one and the user makes it in the window that bot opened.
 */
export function SignInsSetting() {
  const { data, isLoading, error } = useServerRoute<SignIn[]>(queryKey.signIns);
  const { data: bots } = useServerRoute<Bot[]>(queryKey.bot);
  useAppEvent({ signins: () => void revalidate(queryKey.signIns) });

  if (isLoading) return <SettingSkeleton rows={3} />;
  if (error) return <SettingError message={error.message} />;
  const all = data ?? [];

  return (
    <SettingScreen
      footer={
        <SettingRailNote>
          A site's session as the browser held it — never a password. Kept on
          this machine, outside the folder the bots work in.
        </SettingRailNote>
      }
    >
      <How />
      <SettingItems>
        {all.length === 0 ? (
          <p className="p-4 text-sm leading-relaxed text-muted-foreground">
            Nothing is kept yet. When a bot needs you signed in somewhere, it
            opens a window for you to sign in — and that sign-in is kept here
            for its later work.
          </p>
        ) : (
          all.map((signIn) => (
            <Row key={signIn.site} signIn={signIn} bots={bots} />
          ))
        )}
        <OwnChrome />
      </SettingItems>
    </SettingScreen>
  );
}

/** How a sign-in comes to be here and who gets to use it, in three steps: the list below is what step two leaves. */
const STEPS: [LucideIcon, string, string][] = [
  [
    AppWindow,
    "A bot opens a window",
    "When its work needs you signed in to a site, it opens that site on your screen and asks.",
  ],
  [
    LogIn,
    "You sign in there",
    "The app keeps that sign-in here — the site's session, never your password.",
  ],
  [
    ShieldCheck,
    "Only that bot uses it",
    "Later work is signed in without asking. Another bot has to ask you first.",
  ],
];

function How() {
  return (
    <ol className="grid gap-3 pb-5 sm:grid-cols-3">
      {STEPS.map(([Icon, title, text], at) => (
        <li key={title} className="flex gap-3 rounded-xl bg-muted/40 p-3.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-background text-muted-foreground ring-1 ring-border/60">
            <Icon className="size-4" />
          </span>
          <span className="min-w-0 space-y-0.5">
            <span className="block text-[13px] font-medium">
              {at + 1}. {title}
            </span>
            <span className="block text-xs leading-relaxed text-muted-foreground">
              {text}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function Row({ signIn, bots }: { signIn: SignIn; bots?: Bot[] }) {
  const done = () => revalidate(queryKey.signIns);
  const [setBot, setting] = useServerAction(setSignInBotAction, {
    onOk: done,
  });
  const [remove, removing] = useServerAction(removeSignInAction, {
    onOk: done,
  });

  const signOut = async () => {
    const ok = await notify.confirm({
      title: `Sign out of ${signIn.site}?`,
      description:
        "What is kept here is removed, and the bots that used it ask you to sign in again. The site itself may still list the session until it ends it.",
      okText: "Sign out",
      destructive: true,
    });
    if (ok) void remove(signIn.site).catch(() => {});
  };

  return (
    <div className="flex flex-col gap-2.5 p-4">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted/60">
          <SiteIcon
            host={signIn.site}
            className="size-5 rounded-[5px]"
            fallback={<KeyRound className="size-4 text-muted-foreground" />}
          />
        </span>
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="block truncate text-sm font-medium">
            {signIn.site}
          </span>
          <span className="block truncate text-[13px] text-muted-foreground">
            {signIn.account}
          </span>
        </span>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
          {signIn.usedAt
            ? `used ${whenOf(signIn.usedAt)}`
            : `kept ${whenOf(signIn.keptAt)}`}
        </span>
        <Button
          variant="outline"
          size="sm"
          loading={removing}
          onClick={() => void signOut()}
        >
          <LogOut />
          Sign out
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 pl-13">
        {signIn.bots.map((name) => (
          <span
            key={name}
            className="flex h-7 items-center gap-1.5 rounded-full bg-muted/60 pr-1 pl-1.5 text-[13px]"
          >
            <BotMark size={18} seed={name} {...markOf(name, bots)} />
            {name}
            <button
              type="button"
              disabled={setting}
              aria-label={`${name} may no longer use it`}
              onClick={() =>
                void setBot(signIn.site, name, false).catch(() => {})
              }
              className="grid size-5 place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {signIn.bots.length === 0 && signIn.asking.length === 0 && (
          <span className="text-[13px] text-muted-foreground">
            No bot may use it. One that needs it will ask.
          </span>
        )}
        {signIn.asking.map((name) => (
          <span
            key={name}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-full pr-1 pl-1.5 text-[13px] ring-1 ring-border ring-inset",
              WAITING_INK,
            )}
          >
            <BotMark size={18} seed={name} {...markOf(name, bots)} />
            {name} asks
            <Button
              size="sm"
              variant="secondary"
              className="h-5 rounded-full px-2 text-[11px]"
              disabled={setting}
              onClick={() =>
                void setBot(signIn.site, name, true).catch(() => {})
              }
            >
              Allow
            </Button>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Where the extension a bot attaches through is installed from; the browser CLI names the same page when it is missing. */
const EXTENSION =
  "https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm";

/**
 * The other way a bot is signed in, in the shape of the rows above it: a site that refuses a
 * kept sign-in is worked in a tab of the user's own Chrome (skills/browser). The row claims no
 * state — whether the extension is there is known only by attaching, which a bot's job does.
 */
function OwnChrome() {
  return (
    <div className="flex items-center gap-3 p-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted/60">
        <SiteIcon
          host={new URL(EXTENSION).host}
          className="size-5 rounded-[5px]"
          fallback={<Globe className="size-4 text-muted-foreground" />}
        />
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="block text-sm font-medium">Your own Chrome</span>
        <span className="block text-[13px] text-muted-foreground">
          For a site that will not stay signed in. A bot gets a tab of its own,
          signed in as you.
        </span>
      </span>
      {/* A link, not a button that navigates: it leaves the app, and should be heard as one */}
      <a
        href={EXTENSION}
        target="_blank"
        rel="noreferrer"
        // Merged as Button merges them: a variant's border has to beat the base's transparent one
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
      >
        Get the extension
        <ArrowUpRight />
      </a>
    </div>
  );
}

const markOf = (name: string, bots?: Bot[]) => {
  const icon = bots?.find((bot) => bot.name === name)?.icon;
  return {
    color: icon?.color,
    shape: icon?.shape,
    outline: icon?.outline,
    paint: icon?.paint,
    notify: false,
  };
};
