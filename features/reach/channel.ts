/**
 * What reach needs from a chat service, and nothing more: hear one person, answer them, put
 * buttons under a question. Each service is one file that returns this (telegram, discord,
 * slack); reach itself never learns which one it is talking through. Every one of them
 * connects outward — a long poll or a socket the app opens — so nothing calls in.
 */

/** A file someone sent, fetched only when it is wanted. */
export type IncomingFile = { name: string; fetch(): Promise<File> };

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

export type Channel = {
  /**
   * Connects, reports the bot's own name once known, then hands over what arrives until
   * `signal` aborts. Only one-to-one conversations are handed over: her answers are one
   * person's. Throws `ChannelRefusal` when the service turns the token away — asking again
   * would not change that — and anything else for trouble worth another try.
   */
  listen(
    on: { ready(bot: string): void; incoming(incoming: Incoming): void },
    signal: AbortSignal,
  ): Promise<void>;
  /** One message, at most `REACH.chars` long; `buttons` go under it, one to a row. */
  say(chat: string, text: string, buttons?: Button[]): Promise<void>;
  /** "typing…", for a few seconds. */
  typing(chat: string): Promise<void>;
  /** Takes the buttons off a message once one was pressed, and leaves `text` in its place. */
  settle(chat: string, messageId: string, text: string): Promise<void>;
  /** A file of ours: a picture as a picture where the service draws one. */
  sendFile(
    chat: string,
    bytes: Uint8Array,
    name: string,
    picture: boolean,
  ): Promise<void>;
};

/** The service answered, and refused: its words are the user's to act on (a wrong token, a missing permission). */
export class ChannelRefusal extends Error {}
