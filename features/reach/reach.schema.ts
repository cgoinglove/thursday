/**
 * Reaching Thursday from a phone: a chat app the user already has, held by the server,
 * answered by the same backend a call in writing runs (thursday.text). The vocabulary both
 * sides share.
 */

export const REACH_CHANNELS = ["telegram", "discord", "slack"] as const;
export type ReachChannelName = (typeof REACH_CHANNELS)[number];

/** The Telegram bot's token, from @BotFather. */
export const TELEGRAM_TOKEN_KEY = "TELEGRAM_BOT_TOKEN";
/** The Discord application's bot token, from its Bot page. */
export const DISCORD_TOKEN_KEY = "DISCORD_BOT_TOKEN";
/** Slack takes two: the app-level token that opens the socket, and the bot token that speaks. */
export const SLACK_APP_TOKEN_KEY = "SLACK_APP_TOKEN";
export const SLACK_BOT_TOKEN_KEY = "SLACK_BOT_TOKEN";

/** What each service needs set before it is listened to, in the order its maker takes them. */
export const REACH_KEYS: Record<ReachChannelName, readonly string[]> = {
  telegram: [TELEGRAM_TOKEN_KEY],
  discord: [DISCORD_TOKEN_KEY],
  slack: [SLACK_APP_TOKEN_KEY, SLACK_BOT_TOKEN_KEY],
};

export const REACH_LABEL: Record<ReachChannelName, string> = {
  telegram: "Telegram",
  discord: "Discord",
  slack: "Slack",
};

/**
 * The one person allowed to write through a service, as the screen let them in
 * (`ReachPerson` and the bot they were let in to, JSON). Kept beside the token rather than in
 * it: a token given again for the same bot keeps them, and another bot starts with nobody.
 */
export const reachPersonKey = (name: ReachChannelName) =>
  `REACH_PERSON_${name.toUpperCase()}`;

/** Someone writing from a chat app: the conversation the service names, and what it calls them. */
export type ReachPerson = { chat: string; name: string };

/**
 * Someone who wrote and is not let in yet, as the screen asks about them: who the service
 * says they are (`handle`, the name nobody else holds, where it has one), what they wrote
 * first, and the code their phone was sent. The code is what tells the phone in the user's
 * hand from a stranger's: a display name can be anyone's.
 */
export type ReachAsking = ReachPerson & {
  handle: string | null;
  said: string;
  code: string;
};

/** One service as the screen is told of it; only those with their keys set are listed. */
export type ReachChannelStatus = {
  name: ReachChannelName;
  /** The bot's own name on the service, once it has connected; null before. */
  bot: string | null;
  /**
   * Where to go to reach this bot, named by the service itself (`channel.ts`): the chat to
   * open on Telegram, the invite that adds it to a server on Discord. Null where the
   * service names none, or before it has connected.
   */
  link: string | null;
  allowed: ReachPerson | null;
  /** Someone wrote who is not let in yet: the screen asks the user whether they are. */
  asking: ReachAsking | null;
  /**
   * The key whose token the service turned away. Nothing is listened for until a key of
   * this service changes; null while it listens or tries again.
   */
  refused: string | null;
  /**
   * Why nothing is heard, in the service's own words: what it refused (`refused`), or the
   * trouble it is trying again after. Null while it listens.
   */
  problem: string | null;
};

export type ReachStatus = { channels: ReachChannelStatus[] };
