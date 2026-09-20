import { type Channel, ChannelRefusal, type Incoming } from "./channel";
import { inPieces, runSocket } from "./socket";

/**
 * Slack as a reach channel, in Socket Mode: the app-level token opens a socket Slack sends
 * events down, the bot token speaks through the Web API. Only the direct conversation with
 * the app (its Messages tab) is read. The app itself is made from the manifest in the guide,
 * which asks for exactly the scopes used here.
 */

const API = "https://slack.com/api";
/** Slack's cap on the text of one section block. */
const MAX = 2_900;
/** Answers that mean a token is wrong or lacks what it needs, not that Slack is unwell. */
const REFUSED = new Set([
  "invalid_auth",
  "not_authed",
  "account_inactive",
  "token_revoked",
  "not_allowed_token_type",
  "missing_scope",
]);

type SlackEvent = {
  type?: string;
  subtype?: string;
  channel_type?: string;
  channel?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  files?: { name?: string; mimetype?: string; url_private_download?: string }[];
};

export function createSlack(appToken: string, botToken: string): Channel {
  async function api<T>(
    method: string,
    body: Record<string, unknown>,
    token = botToken,
  ): Promise<T> {
    const response = await fetch(`${API}/${method}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
    const said = (await response.json().catch(() => null)) as
      | ({ ok?: boolean; error?: string; needed?: string } & T)
      | null;
    if (said?.ok) return said;
    const code = said?.error ?? `http_${response.status}`;
    const why =
      code === "missing_scope"
        ? `Slack says the app lacks a permission (${said?.needed ?? "a scope"}) — make it from the manifest in the guide.`
        : `Slack answered ${code} to ${method}`;
    throw REFUSED.has(code) ? new ChannelRefusal(why) : new Error(why);
  }

  /** A person's name as Slack shows it; their id when the app may not read it. */
  const names = new Map<string, string>();
  async function nameOf(user: string): Promise<string> {
    const known = names.get(user);
    if (known) return known;
    const name = await api<{ user?: { real_name?: string; name?: string } }>(
      "users.info",
      { user },
    )
      .then((said) => said.user?.real_name || said.user?.name || user)
      .catch(() => user);
    names.set(user, name);
    return name;
  }

  async function read(
    type: string,
    payload: Record<string, unknown>,
  ): Promise<Incoming | null> {
    if (type === "events_api") {
      const event = (payload.event ?? {}) as SlackEvent;
      const plain = !event.subtype || event.subtype === "file_share";
      if (event.type !== "message" || event.channel_type !== "im") return null;
      if (!plain || event.bot_id || !event.user || !event.channel) return null;
      return {
        kind: "message",
        chat: event.channel,
        name: await nameOf(event.user),
        words: (event.text ?? "").trim(),
        files: (event.files ?? []).flatMap((file) => {
          const url = file.url_private_download;
          if (!url) return [];
          const name = file.name ?? "file";
          return [
            {
              name,
              fetch: async () => {
                const response = await fetch(url, {
                  headers: { authorization: `Bearer ${botToken}` },
                });
                if (!response.ok)
                  throw new Error(
                    `Slack answered ${response.status} for the file`,
                  );
                return new File([await response.arrayBuffer()], name, {
                  type: file.mimetype ?? "",
                });
              },
            },
          ];
        }),
        unreadable: false,
      };
    }
    if (type === "interactive" && payload.type === "block_actions") {
      const pressed = payload as {
        channel?: { id?: string };
        message?: { ts?: string; text?: string };
        actions?: { value?: string }[];
      };
      if (!pressed.channel?.id) return null;
      return {
        kind: "press",
        chat: pressed.channel.id,
        data: pressed.actions?.[0]?.value ?? "",
        under:
          pressed.message?.ts && pressed.message.text
            ? { id: pressed.message.ts, text: pressed.message.text }
            : null,
      };
    }
    return null;
  }

  return {
    async listen(on, signal) {
      const me = await api<{ user?: string }>("auth.test", {});
      const { url } = await api<{ url: string }>(
        "apps.connections.open",
        {},
        appToken,
      );
      // Slack names no address for an app: it is opened from inside the workspace
      on.ready(me.user ? `@${me.user}` : "the app", null);

      const closed = await runSocket(
        url,
        {
          message(frame, send) {
            const {
              type,
              envelope_id: envelope,
              payload,
            } = frame as {
              type?: string;
              envelope_id?: string;
              payload?: Record<string, unknown>;
            };
            // Acknowledged first: Slack sends again what is not, and a turn takes longer than it waits
            if (envelope) send({ envelope_id: envelope });
            if (!type || !payload) return;
            void read(type, payload).then((incoming) => {
              if (incoming) on.incoming(incoming);
            });
          },
        },
        signal,
      );
      // Slack closes every socket after a few hours and says so beforehand: reach connects again
      if (!signal.aborted)
        throw new Error(`Slack closed the connection (${closed.code})`);
    },

    async say(chat, text, buttons) {
      const pieces = inPieces(text, MAX);
      for (const [at, piece] of pieces.entries()) {
        const last = buttons?.length && at === pieces.length - 1;
        await api("chat.postMessage", {
          channel: chat,
          text: piece,
          unfurl_links: false,
          ...(last
            ? {
                blocks: [
                  {
                    type: "section",
                    text: { type: "plain_text", text: piece },
                  },
                  {
                    type: "actions",
                    elements: buttons.slice(0, 25).map((button, index) => ({
                      type: "button",
                      action_id: `choice_${index}`,
                      text: {
                        type: "plain_text",
                        text: button.text.slice(0, 75),
                      },
                      value: button.data,
                    })),
                  },
                ],
              }
            : {}),
        });
      }
    },

    // Slack gives an app no way to say it is typing
    async typing() {},

    async settle(chat, messageId, text) {
      await api("chat.update", {
        channel: chat,
        ts: messageId,
        text: text.slice(0, MAX),
        blocks: [],
      }).catch(() => {});
    },

    async sendFile(chat, bytes, name) {
      const form = new URLSearchParams({
        filename: name,
        length: String(bytes.byteLength),
      });
      const asked = await fetch(`${API}/files.getUploadURLExternal`, {
        method: "POST",
        headers: { authorization: `Bearer ${botToken}` },
        body: form,
      });
      const slot = (await asked.json()) as {
        ok?: boolean;
        error?: string;
        upload_url?: string;
        file_id?: string;
      };
      if (!slot.ok || !slot.upload_url || !slot.file_id)
        throw new Error(
          `Slack answered ${slot.error ?? asked.status} to the upload`,
        );
      await fetch(slot.upload_url, {
        method: "POST",
        body: new Blob([bytes as BlobPart]),
      });
      await api("files.completeUploadExternal", {
        files: [{ id: slot.file_id, title: name }],
        channel_id: chat,
      });
    },
  };
}
