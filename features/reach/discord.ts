import { type Channel, ChannelRefusal, type Incoming } from "./channel";
import { inPieces, runSocket } from "./socket";

/**
 * Discord as a reach channel: the Gateway socket hands over direct messages and button
 * presses, REST sends what goes back. A bot can be written to by someone who shares a
 * server with it, so the user adds it to a server of their own and then writes to it
 * directly; only those direct messages are read.
 */

const REST = "https://discord.com/api/v10";
const GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";
/** DIRECT_MESSAGES. A direct message carries its words without the privileged content intent. */
const INTENTS = 1 << 12;
/** Discord's cap on one message. */
const MAX = 1_900;
/** Close codes that mean the token or what it asked for is refused, not that the line dropped. */
const REFUSED: Record<number, string> = {
  4004: "Discord did not take the bot token.",
  4013: "Discord refused the intents this bot asked for.",
  4014: "Discord refused an intent this bot is not allowed — check the bot's page.",
};

type DiscordUser = {
  id: string;
  username: string;
  global_name?: string | null;
  bot?: boolean;
};
type DiscordMessage = {
  id: string;
  channel_id: string;
  guild_id?: string;
  author: DiscordUser;
  content: string;
  attachments?: { filename: string; url: string; content_type?: string }[];
};
type DiscordInteraction = {
  id: string;
  token: string;
  type: number;
  channel_id: string;
  guild_id?: string;
  data?: { custom_id?: string };
  message?: { id: string; content: string };
};

export function createDiscord(token: string): Channel {
  async function rest<T>(
    method: string,
    path: string,
    body?: Record<string, unknown> | FormData,
  ): Promise<T> {
    const form = body instanceof FormData;
    const response = await fetch(`${REST}${path}`, {
      method,
      headers: {
        authorization: `Bot ${token}`,
        ...(form || !body ? {} : { "content-type": "application/json" }),
      },
      body: form ? body : body ? JSON.stringify(body) : undefined,
    });
    if (response.ok)
      return (response.status === 204 ? null : await response.json()) as T;
    const said = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    const why = said?.message ?? `Discord answered ${response.status}`;
    throw response.status === 401 ? new ChannelRefusal(why) : new Error(why);
  }

  const rows = (buttons: { text: string; data: string }[]) => {
    // Five rows of five at most; one to a row while they fit, so they read as a list
    const perRow = buttons.length <= 5 ? 1 : 5;
    const out: unknown[] = [];
    for (let at = 0; at < buttons.length && out.length < 5; at += perRow)
      out.push({
        type: 1,
        components: buttons.slice(at, at + perRow).map((button) => ({
          type: 2,
          style: 2,
          label: button.text.slice(0, 80),
          custom_id: button.data,
        })),
      });
    return out;
  };

  function read(type: string, data: unknown): Incoming | null {
    if (type === "MESSAGE_CREATE") {
      const message = data as DiscordMessage;
      if (message.guild_id || message.author.bot) return null;
      return {
        kind: "message",
        chat: message.channel_id,
        name: message.author.global_name || message.author.username,
        words: message.content.trim(),
        files: (message.attachments ?? []).map((file) => ({
          name: file.filename,
          fetch: async () => {
            const response = await fetch(file.url);
            if (!response.ok)
              throw new Error(
                `Discord answered ${response.status} for the file`,
              );
            return new File([await response.arrayBuffer()], file.filename, {
              type: file.content_type ?? "",
            });
          },
        })),
        unreadable: false,
      };
    }
    if (type === "INTERACTION_CREATE") {
      const pressed = data as DiscordInteraction;
      // A button; acknowledged at once, since Discord gives three seconds
      if (pressed.type !== 3 || pressed.guild_id) return null;
      void rest(
        "POST",
        `/interactions/${pressed.id}/${pressed.token}/callback`,
        {
          type: 6,
        },
      ).catch(() => {});
      return {
        kind: "press",
        chat: pressed.channel_id,
        data: pressed.data?.custom_id ?? "",
        under: pressed.message
          ? { id: pressed.message.id, text: pressed.message.content }
          : null,
      };
    }
    return null;
  }

  return {
    async listen(on, signal) {
      let sequence: number | null = null;
      let beat: ReturnType<typeof setInterval> | undefined;
      try {
        const closed = await runSocket(
          GATEWAY,
          {
            message(frame, send) {
              const { op, d, s, t } = frame as {
                op: number;
                d: unknown;
                s: number | null;
                t: string | null;
              };
              if (s !== null) sequence = s;
              if (op === 10) {
                // HELLO: beat at the pace it names, then say who we are
                const every = (d as { heartbeat_interval: number })
                  .heartbeat_interval;
                beat = setInterval(() => send({ op: 1, d: sequence }), every);
                send({
                  op: 2,
                  d: {
                    token,
                    intents: INTENTS,
                    properties: {
                      os: process.platform,
                      browser: "thursday",
                      device: "thursday",
                    },
                  },
                });
              } else if (op === 1) send({ op: 1, d: sequence });
              else if (op === 0 && t === "READY")
                on.ready((d as { user: DiscordUser }).user.username);
              else if (op === 0 && t) {
                const incoming = read(t, d);
                if (incoming) on.incoming(incoming);
              }
            },
          },
          signal,
        );
        const refused = REFUSED[closed.code];
        if (refused) throw new ChannelRefusal(refused);
        // A reconnect it asked for, an invalid session, a dropped line: reach connects again
        if (!signal.aborted)
          throw new Error(`Discord closed the connection (${closed.code})`);
      } finally {
        clearInterval(beat);
      }
    },

    async say(chat, text, buttons) {
      const pieces = inPieces(text, MAX);
      for (const [at, piece] of pieces.entries())
        await rest("POST", `/channels/${chat}/messages`, {
          content: piece,
          ...(buttons?.length && at === pieces.length - 1
            ? { components: rows(buttons) }
            : {}),
        });
    },

    async typing(chat) {
      await rest("POST", `/channels/${chat}/typing`).catch(() => {});
    },

    async settle(chat, messageId, text) {
      await rest("PATCH", `/channels/${chat}/messages/${messageId}`, {
        content: text.slice(0, MAX),
        components: [],
      }).catch(() => {});
    },

    async sendFile(chat, bytes, name) {
      const form = new FormData();
      form.set(
        "payload_json",
        JSON.stringify({ attachments: [{ id: 0, filename: name }] }),
      );
      form.set("files[0]", new Blob([bytes as BlobPart]), name);
      await rest("POST", `/channels/${chat}/messages`, form);
    },
  };
}
