/**
 * Reaching Thursday from a phone: one chat, held by the server, answered by the same backend
 * a call in writing runs (thursday.text). The vocabulary both sides share.
 */

/** The Telegram bot's token, from @BotFather. Set, the server asks Telegram for what is written to it. */
export const TELEGRAM_TOKEN_KEY = "TELEGRAM_BOT_TOKEN";

/**
 * The one person allowed to write, as the screen let them in (`ReachPerson`, JSON). Kept
 * beside the token rather than in it: a new token is a new bot, and nobody is let in to it yet.
 */
export const REACH_PERSON_KEY = "REACH_PERSON";

/** Someone writing from a chat app: the chat the service names, and what it calls them. */
export type ReachPerson = { chat: string; name: string };

/** What the screen is told: which bot is listening, who may write, and who is asking to. */
export type ReachStatus = {
  /** The bot's own name on the service, once the token has been taken; null before. */
  bot: string | null;
  allowed: ReachPerson | null;
  /** Someone wrote who is not let in yet: the screen asks the user whether they are. */
  asking: ReachPerson | null;
  /** Why nothing is being listened for, in the service's own words; null while it is. */
  problem: string | null;
};
