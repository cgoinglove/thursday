import { REACH } from "@/config";

/**
 * What reach needs from a chat service, and nothing more: hear one person, answer them, put
 * buttons under a question. Each service is one file that returns this (telegram, discord,
 * slack); reach itself never learns which one it is talking through. Every one of them
 * connects outward — a long poll or a socket the app opens — so nothing calls in.
 */

/**
 * A file someone sent, fetched only when it is wanted. `size` is what the service says it
 * weighs, where it says, so one past `limits.take` is never asked for.
 */
export type IncomingFile = {
  name: string;
  size?: number;
  fetch(): Promise<File>;
};

export type Incoming =
  | {
      kind: "message";
      /** Where to answer: the one-to-one conversation with this person. */
      chat: string;
      /** Who wrote, as the service names them. */
      name: string;
      words: string;
      files: IncomingFile[];
      /** It carried something reach cannot read yet (a voice note, a video). */
      unreadable: boolean;
    }
  | {
      kind: "press";
      chat: string;
      /** The pressed button's own `data`, as it was sent. */
      data: string;
      /** The message the buttons were under, to be settled once the press is taken. */
      under: { id: string; text: string } | null;
    };

export type Button = { text: string; data: string };

/** A file of ours. A picture goes as a picture where the service draws one. */
export type OutgoingFile = {
  bytes: Uint8Array;
  name: string;
  picture: boolean;
};

export type Channel = {
  /**
   * Connects, reports the bot's own name once known, then hands over what arrives until
   * `signal` aborts. Only one-to-one conversations are handed over: her answers are one
   * person's. Throws `ChannelRefusal` when the service turns the token away — asking again
   * would not change that — and anything else for trouble worth another try.
   *
   * `link` is the address that takes someone to this bot on the service, which only the
   * service's own file can name — a chat to open on Telegram, an invite to accept on
   * Discord — or null where the service has none. The screen draws it for a phone to read,
   * so nothing about a service is worked out from its bot's name.
   */
  listen(
    on: {
      ready(bot: string, link: string | null): void;
      incoming(incoming: Incoming): void;
    },
    signal: AbortSignal,
  ): Promise<void>;
  /** One message, at most `REACH.chars` long; `buttons` go under it, one to a row. */
  say(chat: string, text: string, buttons?: Button[]): Promise<void>;
  /** "typing…", for a few seconds. */
  typing(chat: string): Promise<void>;
  /** Takes the buttons off a message once one was pressed, and leaves `text` in its place. */
  settle(chat: string, messageId: string, text: string): Promise<void>;
  /**
   * Files of ours, in as few messages as the service takes them: the pictures together,
   * drawn as pictures, and the rest as files.
   */
  sendFiles(chat: string, files: OutgoingFile[]): Promise<void>;
  /**
   * In bytes: the largest file the service hands a bot (`take`), the largest of ours it takes
   * (`file`), and the largest it draws as a picture (`picture`). A picture past `picture` goes
   * as a file; a file past either of the others is named in the chat instead.
   */
  limits: { take: number; file: number; picture: number };
};

/** The service answered, and refused: its words are the user's to act on (a wrong token, a missing permission). */
export class ChannelRefusal extends Error {}

/**
 * Waits out a service's "too many requests" for as long as it says, so an answer that goes as
 * several messages is not cut off halfway. False when it names no wait, asks for longer than
 * REACH.rateWaitMs, or has asked REACH.rateRetries times already: its refusal then stands.
 */
export async function waitOut(
  seconds: number | null | undefined,
  attempt: number,
): Promise<boolean> {
  if (seconds == null || !Number.isFinite(seconds)) return false;
  const ms = Math.max(0, seconds * 1000);
  if (attempt >= REACH.rateRetries || ms > REACH.rateWaitMs) return false;
  await new Promise((resolve) => setTimeout(resolve, ms));
  return true;
}
