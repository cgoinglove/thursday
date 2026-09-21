import { type ToolSet, tool } from "ai";
import z from "zod";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import {
  borrowSignIn,
  keepSignIn,
  sessionBrowser,
} from "@/features/signins/signins.query";
import { siteOf } from "@/features/signins/signins.schema";
import type { Sandbox } from "@/lib/sandbox";

/**
 * A bot's two hands on the sign-ins the app keeps (signins.query): borrow one into its own
 * browser, keep the one the user just made. The session itself never passes through the
 * model or stays among the bot's files — it crosses the workspace as a file that exists for
 * one command, because the browser CLI reads and writes state by path. Whether a bot may
 * borrow a sign-in is the user's say and is settled on screen, never by what a tool is told.
 */

const SITE = z
  .string()
  .describe("The site's address, like instagram.com. No path, no https://.");

/** Where the state file stands for the length of one CLI command. */
const passing = () => `.playwright-cli/state-${crypto.randomUUID()}.json`;

export function createSignInTools(
  sandbox: Sandbox,
  bot: string,
  /** This participant's browser session (workspace jobShellEnv): the state goes into, and comes out of, its own browser. */
  env: Record<string, string>,
): ToolSet {
  const cli = async (command: string) => {
    const ran = await sandbox.exec(command, { env, timeoutMs: 30_000 });
    return ran.exitCode === 0
      ? null
      : (ran.stderr || ran.stdout).trim().slice(0, 300) ||
          `exit ${ran.exitCode}`;
  };

  return {
    [TOOL_NAMES.sign_in_use]: tool({
      description:
        "Sign your browser in to a site with a sign-in the user already made and the app kept. Open your browser first: the sign-in goes into the browser you have open, and opening another one afterwards throws it away.",
      inputSchema: z.object({ site: SITE }),
      execute: async ({ site }) => {
        // A kept session loaded into their Chrome would replace the one they are signed in with
        if ((await sessionBrowser(sandbox, env)) === "theirs")
          return "You are working in their own Chrome: it is already signed in as them, and nothing is loaded into it. Go to the site.";
        const found = await borrowSignIn(site, bot);
        if (found.kind === "none")
          return found.kept.length
            ? `Nothing is kept for ${siteOf(site)}. Kept: ${found.kept.join(", ")} — call again with one of those if it is the same site. Otherwise open the site's sign-in page in a window they can see, ask them to sign in there, and call \`${TOOL_NAMES.sign_in_keep}\` once they have.`
            : `Nothing is kept for ${siteOf(site)}. Open its sign-in page in a window they can see, ask them to sign in there, and call \`${TOOL_NAMES.sign_in_keep}\` once they have.`;
        if (found.kind === "ask")
          return `The user keeps a ${found.signIn.site} sign-in (${found.signIn.account}) and has not let you use it. Ask them, as a question, whether you may; they allow it on screen. Call again once they have said yes.`;

        const path = passing();
        await sandbox.writeFile(path, JSON.stringify(found.state));
        const failed = await cli(`playwright-cli state-load ${path}`).finally(
          () => sandbox.exec(`rm -f ${path}`),
        );
        return failed
          ? `The sign-in could not be loaded into your browser: ${failed}. Open the browser you mean to keep (\`playwright-cli open …\`, headed if you want a window), then call this again — opening another browser after this throws the sign-in away.`
          : `Signed in to ${found.signIn.site} as ${found.signIn.account}. Go to the site again (\`goto\`) — a page drawn before this still looks signed out. If it still shows you signed out after that, the site does not accept a sign-in carried over from another browser, and signing in again here will not last either: work in their own Chrome instead, \`playwright-cli attach --extension=chrome\`.`;
      },
    }),

    [TOOL_NAMES.sign_in_keep]: tool({
      description:
        "Keep the sign-in the user just made in your browser window, so later work is signed in without asking them again. Call it right after they say they signed in.",
      inputSchema: z.object({
        site: SITE,
        account: z
          .string()
          .describe(
            "Who it is signed in as, as the site shows it — a handle, an email. The site's name when nothing is shown.",
          ),
      }),
      execute: async ({ site, account }) => {
        if ((await sessionBrowser(sandbox, env)) === "theirs")
          return "You are working in their own Chrome: it stays signed in as them by itself, and nothing is kept from it.";
        const path = passing();
        const failed = await cli(
          `mkdir -p .playwright-cli && playwright-cli state-save ${path}`,
        );
        if (failed) {
          await sandbox.exec(`rm -f ${path}`);
          return `The browser's state could not be read: ${failed}. Nothing was kept.`;
        }
        try {
          const state = JSON.parse(
            await sandbox.readFile(path, "utf-8"),
          ) as unknown;
          const kept = await keepSignIn({ site, account, bot, state });
          return `Kept: ${kept.site} as ${kept.account}. It is listed for them under Settings › Sign-ins, where they can sign out of it.`;
        } finally {
          await sandbox.exec(`rm -f ${path}`);
        }
      },
    }),
  };
}
