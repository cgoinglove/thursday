/**
 * A sign-in the user made in a bot's browser window, kept by the app rather than by the bot:
 * the site's session as the browser held it, never a password. A bot borrows it through the
 * app (ai/tools/signin.tool), and which bots may is the user's to say.
 */
export type SignIn = {
  /** The site as the bot named it: a host such as `instagram.com`, lowercase. */
  site: string;
  /** Who it signs in as, as the site shows it; the site's own name when nothing is shown. */
  account: string;
  /** The bots that may borrow it. The one that kept it is the first. */
  bots: string[];
  /** A bot that asked for it and is not let in yet: the screen's one tap lets it in. */
  asking: string[];
  keptAt: string;
  usedAt: string | null;
};

/** A site as one spelling: no scheme, no `www.`, no path, lowercase. */
export const siteOf = (raw: string): string =>
  raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "");
