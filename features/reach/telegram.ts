import { REACH } from "@/config";

/**
 * Telegram's Bot API, as far as reach uses it: asked for what was written (a long poll, so
 * nothing calls in), told what to send back. Plain `fetch`; no library earns its place for
 * eight methods.
 */

const API = "https://api.telegram.org";

type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramFile = { file_id: string; file_size?: number };

export type TelegramMessage = {
  message_id: number;
  from?: TelegramUser;
  chat: { id: number; type: string };
  text?: string;
  caption?: string;
  /** The same picture at several sizes, smallest first. */
  photo?: (TelegramFile & { width: number })[];
  document?: TelegramFile & { file_name?: string; mime_type?: string };
  voice?: TelegramFile;
  audio?: TelegramFile;
  video?: TelegramFile;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  /** A button under one of our messages was pressed. */
  callback_query?: {
    id: string;
    from: TelegramUser;
    message?: TelegramMessage;
    data?: string;
  };
};

/** The service answered, and refused: its words are the user's to act on (a wrong token, a blocked bot). */
export class TelegramRefusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type Telegram = ReturnType<typeof createTelegram>;

export function createTelegram(token: string) {
  async function call<T>(
    method: string,
    body?: Record<string, unknown> | FormData,
    signal?: AbortSignal,
  ): Promise<T> {
    const form = body instanceof FormData;
    const response = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      signal,
      ...(form
        ? { body }
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body ?? {}),
          }),
    });
    const said = (await response.json().catch(() => null)) as {
      ok?: boolean;
      result?: T;
      description?: string;
    } | null;
    if (!said?.ok)
      throw new TelegramRefusal(
        response.status,
        said?.description ?? `Telegram answered ${response.status}`,
      );
    return said.result as T;
  }

  const nameOf = (user?: TelegramUser) =>
    [user?.first_name, user?.last_name].filter(Boolean).join(" ") ||
    (user?.username ? `@${user.username}` : "Someone");

  return {
    nameOf,

    /** The bot's own name, which is also how a token is found to be good. */
    me: (signal?: AbortSignal) =>
      call<{ username?: string; first_name?: string }>(
        "getMe",
        undefined,
        signal,
      ),

    /** What was written since `offset`, waiting up to `REACH.pollSeconds` for something. */
    updates: (offset: number, signal: AbortSignal) =>
      call<TelegramUpdate[]>(
        "getUpdates",
        {
          offset,
          timeout: REACH.pollSeconds,
          allowed_updates: ["message", "callback_query"],
        },
        // Past the wait itself, the connection is taken for dead
        AbortSignal.any([
          signal,
          AbortSignal.timeout((REACH.pollSeconds + 15) * 1000),
        ]),
      ),

    /** One message; `buttons` go under it, one to a row, each carrying its own `data`. */
    say: (
      chat: string,
      text: string,
      buttons?: { text: string; data: string }[],
    ) =>
      call<TelegramMessage>("sendMessage", {
        chat_id: chat,
        text,
        link_preview_options: { is_disabled: true },
        ...(buttons?.length
          ? {
              reply_markup: {
                inline_keyboard: buttons.map((button) => [
                  { text: button.text, callback_data: button.data },
                ]),
              },
            }
          : {}),
      }),

    /** "typing…" under the bot's name, for a few seconds. */
    typing: (chat: string) =>
      call("sendChatAction", { chat_id: chat, action: "typing" }).catch(
        () => {},
      ),

    /** Ends the spinner on a pressed button. */
    pressed: (id: string) =>
      call("answerCallbackQuery", { callback_query_id: id }).catch(() => {}),

    /** Takes the buttons off a message once one was pressed, and says which. */
    settle: (chat: string, messageId: number, text: string) =>
      call("editMessageText", {
        chat_id: chat,
        message_id: messageId,
        text,
        link_preview_options: { is_disabled: true },
      }).catch(() => {}),

    /** A file someone sent, as the bytes and the name it came with. */
    async fetchFile(
      fileId: string,
      name: string,
      type?: string,
    ): Promise<File> {
      const { file_path: path } = await call<{ file_path?: string }>(
        "getFile",
        { file_id: fileId },
      );
      if (!path) throw new Error("Telegram did not say where the file is");
      const response = await fetch(`${API}/file/bot${token}/${path}`);
      if (!response.ok)
        throw new Error(`Telegram answered ${response.status} for the file`);
      const ext = path.includes(".") ? path.slice(path.lastIndexOf(".")) : "";
      return new File(
        [await response.arrayBuffer()],
        name.includes(".") ? name : `${name}${ext}`,
        type ? { type } : undefined,
      );
    },

    /** A file of ours, as a picture when it is one and as a document otherwise. */
    sendFile(chat: string, bytes: Uint8Array, name: string, picture: boolean) {
      const form = new FormData();
      form.set("chat_id", chat);
      form.set(
        picture ? "photo" : "document",
        new Blob([bytes as BlobPart]),
        name,
      );
      return call(picture ? "sendPhoto" : "sendDocument", form);
    },
  };
}
