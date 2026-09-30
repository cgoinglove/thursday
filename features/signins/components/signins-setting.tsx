"use client";

import {
  AppWindow,
  ArrowUpRight,
  Globe,
  KeyRound,
  LogIn,
  LogOut,
  ShieldCheck,
  X,
} from "lucide-react";
import { useAppEvent } from "@/app/api/events/app-event.client";
import { queryKey } from "@/app/api/query-key";
import { Button, buttonVariants } from "@/components/ui/button";
import { notify } from "@/components/ui/notify";
import { SiteIcon } from "@/components/ui/site-icon";
import type { Bot } from "@/features/bot/bot.schema";
import { BotMark, markOf } from "@/features/bot/components/bot-mark";
import {
  SettingError,
  SettingItems,
  SettingRailNote,
  SettingScreen,
  SettingSkeleton,
} from "@/features/settings/components/setting-ui";
import { useLocale } from "@/hooks/use-locale";
import { whenOf } from "@/lib/date-like";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { cn, WAITING_INK } from "@/lib/utils";
import { type SigninsDict, settingsDictOf } from "@/messages";
import { removeSignInAction, setSignInBotAction } from "../signins.action";
import type { SignIn } from "../signins.schema";

/**
 * The sign-ins the app keeps: the site, who it signs in as, the bots that may borrow it,
 * and the way to sign out. Nothing is added here — a sign-in comes to be when a bot needs
 * one and the user makes it in the window that bot opened. A site keeps one per account:
 * one account is one row, as it always was, and a second puts each under the site.
 */
export function SignInsSetting() {
  const { data, isLoading, error } = useServerRoute<SignIn[]>(queryKey.signIns);
  const { data: bots } = useServerRoute<Bot[]>(queryKey.bot);
  useAppEvent({ signins: () => void revalidate(queryKey.signIns) });
  const locale = useLocale();
  const t = settingsDictOf(locale).signins;

  if (isLoading) return <SettingSkeleton rows={3} />;
  if (error) return <SettingError message={error.message} />;
  const all = data ?? [];

  return (
    <SettingScreen footer={<SettingRailNote>{t.railNote}</SettingRailNote>}>
      <How t={t} />
      <SettingItems>
        {all.length === 0 ? (
          <p className="p-4 text-sm leading-relaxed text-muted-foreground">
            {t.empty}
          </p>
        ) : (
          bySite(all).map((accounts) =>
            accounts.length === 1 ? (
              <Row
                key={`${accounts[0].site}\n${accounts[0].account}`}
                signIn={accounts[0]}
                bots={bots}
              />
            ) : (
              <SiteAccounts
                key={accounts[0].site}
                accounts={accounts}
                bots={bots}
              />
            ),
          )
        )}
        <OwnChrome />
      </SettingItems>
    </SettingScreen>
  );
}

/** How a sign-in comes to be here and who gets to use it, in three steps: the list below is what step two leaves. */
const STEP_ICONS = [AppWindow, LogIn, ShieldCheck] as const;

function How({ t }: { t: SigninsDict }) {
  return (
    <ol className="grid gap-3 pb-5 sm:grid-cols-3">
      {t.steps.map((step, at) => {
        const Icon = STEP_ICONS[at];
        return (
          <li
            key={step.title}
            className="flex gap-3 rounded-xl bg-muted/40 p-3.5"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-background text-muted-foreground ring-1 ring-border/60">
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 space-y-0.5">
              <span className="block text-[13px] font-medium">
                {at + 1}. {step.title}
              </span>
              <span className="block text-xs leading-relaxed text-muted-foreground">
                {step.text}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The list's sign-ins by site, in its order: a site's accounts together. */
function bySite(all: SignIn[]): SignIn[][] {
  const sites = new Map<string, SignIn[]>();
  for (const signIn of all)
    sites.set(signIn.site, [...(sites.get(signIn.site) ?? []), signIn]);
  return [...sites.values()];
}

/** A site with one account kept: the site, who it signs in as, and its bots, in one row. */
function Row({ signIn, bots }: { signIn: SignIn; bots?: Bot[] }) {
  return (
    <div className="flex flex-col gap-2.5 p-4">
      <div className="flex items-center gap-3">
        <SiteBadge site={signIn.site} />
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="block truncate text-sm font-medium">
            {signIn.site}
          </span>
          <span className="block truncate text-[13px] text-muted-foreground">
            {signIn.account}
          </span>
        </span>
        <When signIn={signIn} />
        <SignOut signIn={signIn} others={0} />
      </div>
      <Bots signIn={signIn} bots={bots} className="pl-13" />
    </div>
  );
} /**
 * A site with more than one account kept: the site once, and under it each account with its
 * own time, sign-out and bots, so none is behind another.
 */
function SiteAccounts({
  accounts,
  bots,
}: {
  accounts: SignIn[];
  bots?: Bot[];
}) {
  const { site } = accounts[0];
  const t = settingsDictOf(useLocale()).signins;
  return (
    <div className="flex flex-col p-4 pb-1">
      <div className="flex items-center gap-3">
        <SiteBadge site={site} />
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="block truncate text-sm font-medium">{site}</span>
          <span className="block truncate text-[13px] text-muted-foreground">
            {accounts.length} {t.accountsWord}
          </span>
        </span>
      </div>
      <div className="mt-3 ml-13 flex flex-col">
        {accounts.map((signIn) => (
          <div
            key={signIn.account}
            className="flex flex-col gap-2 border-t border-border/60 py-3"
          >
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
                {signIn.account}
              </span>
              <When signIn={signIn} />
              <SignOut signIn={signIn} others={accounts.length - 1} />
            </div>
            <Bots signIn={signIn} bots={bots} />
          </div>
        ))}
      </div>
    </div>
  );
}

function SiteBadge({ site }: { site: string }) {
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted/60">
      <SiteIcon
        host={site}
        className="size-5 rounded-[5px]"
        fallback={<KeyRound className="size-4 text-muted-foreground" />}
      />
    </span>
  );
}

function When({ signIn }: { signIn: SignIn }) {
  const locale = useLocale();
  const t = settingsDictOf(locale).signins;
  return (
    <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
      {signIn.usedAt
        ? `${t.usedWord} ${whenOf(signIn.usedAt, locale)}`
        : `${t.keptWord} ${whenOf(signIn.keptAt, locale)}`}
    </span>
  );
}

/** Signing out of one account; `others` is how many more the site keeps, which stay. */
function SignOut({ signIn, others }: { signIn: SignIn; others: number }) {
  const t = settingsDictOf(useLocale()).signins;
  const [remove, removing] = useServerAction(removeSignInAction, {
    onOk: () => revalidate(queryKey.signIns),
  });

  const signOut = async () => {
    const ok = await notify.confirm({
      title: others
        ? t.signOutTitleAccount(signIn.account, signIn.site)
        : t.signOutTitleOne(signIn.site),
      description: t.signOutBody(others, signIn.site),
      okText: t.signOutOk,
      destructive: true,
    });
    if (ok) void remove(signIn.site, signIn.account);
  };

  return (
    <Button
      variant="outline"
      size="sm"
      loading={removing}
      aria-label={others ? t.signOutAria(signIn.account) : undefined}
      onClick={() => void signOut()}
    >
      <LogOut />
      {t.signOutBtn}
    </Button>
  );
}

/** The bots that may use one account's sign-in, each with its ×, then those asking to. */
function Bots({
  signIn,
  bots,
  className,
}: {
  signIn: SignIn;
  bots?: Bot[];
  className?: string;
}) {
  const [setBot, setting] = useServerAction(setSignInBotAction, {
    onOk: () => revalidate(queryKey.signIns),
  });
  const t = settingsDictOf(useLocale()).signins;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
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
            aria-label={t.revokeAria(name)}
            onClick={() =>
              void setBot(signIn.site, signIn.account, name, false)
            }
            className="grid size-5 place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {signIn.bots.length === 0 && signIn.asking.length === 0 && (
        <span className="text-[13px] text-muted-foreground">{t.noBot}</span>
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
          {name} {t.asksSuffix}
          <Button
            size="sm"
            variant="secondary"
            className="h-5 rounded-full px-2 text-[11px]"
            disabled={setting}
            onClick={() => void setBot(signIn.site, signIn.account, name, true)}
          >
            {t.allowBtn}
          </Button>
        </span>
      ))}
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
  const t = settingsDictOf(useLocale()).signins;
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
        <span className="block text-sm font-medium">{t.ownChromeTitle}</span>
        <span className="block text-[13px] text-muted-foreground">
          {t.ownChromeDesc}
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
        {t.getExtension}
        <ArrowUpRight />
      </a>
    </div>
  );
}
