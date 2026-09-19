"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
  type UIMessage,
} from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { CALL_RELAY } from "@/config";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { acceptThreadRelaysAction } from "@/features/bot/bot.action";
import type { Thread } from "@/features/bot/bot.schema";
import { unwrapResult } from "@/lib/protocol/result";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { plainText } from "@/lib/utils";
import { openWork, toldWork } from "./open-work";
import { endCallAction, openTextCallAction } from "./thursday.action";
import type {
  CallMessage,
  CallStatus,
  TextCallHandshake,
} from "./thursday.schema";
import { thursdaySettings } from "./thursday.store";
import { searchSourcesOf, toolBot, toolLine } from "./tool-line";
import type { ActivityLine } from "./use-thursday";

/**
 * A call in writing, as the call screen draws it: the same turns, tool line and thinking
 * a spoken call hands it, read off one streamed conversation (thursday.text). The page
 * holds that conversation and sends it whole with every turn; the row it is kept under
 * opens with the first words and closes when the call ends — Esc in the line, or a spoken
 * call taking the screen. She holds no tool that ends it: there is no line to drop.
 *
 * Background work that waits on the user is put to her here as it is on a spoken call
 * (open-work): between turns, once nothing has been written for CALL_RELAY.quietMs, one
 * kind at a time, each item once a call. It goes in as a turn of its own that is neither
 * drawn nor kept as the user's words — a bot's message, under the bracket that says so —
 * and its relay rows are accepted once she has answered it.
 */

/** A turn the page put in for a bot, not words the user wrote (thursday.text reads the same mark). */
export const RELAY_TURN = { relay: true } as const;
const isRelayTurn = (message: UIMessage) =>
  (message.metadata as { relay?: unknown } | undefined)?.relay === true;

const transport = new DefaultChatTransport({ api: queryKey.textCall });

/** How long a finished tool stays on the line before it clears, as on a spoken call. */
const TOOL_LINGER_MS = 2500;

export type TextCall = {
  /** A call in writing is open. */
  on: boolean;
  /** She is answering; the next words wait until she has. */
  busy: boolean;
  status: CallStatus;
  messages: CallMessage[];
  tool: ActivityLine | null;
  thinkingSince: number | null;
  thinkingTitle: string | null;
  /** When it opened (ms). */
  since: number | null;
  /** Why the last answer did not come, in the provider's own words. */
  error: string | null;
  /** Sends words to her, opening the call with the first. Resolves once they are on their way. */
  say: (words: string) => Promise<void>;
  end: () => void;
};

const wordsOf = (message: UIMessage) =>
  message.parts
    .flatMap((part) => (part.type === "text" ? part.text : []))
    .join("\n\n")
    .trim();

export function useTextCall(): TextCall {
  const [line, setLine] = useState<(TextCallHandshake & { at: number }) | null>(
    null,
  );
  const held = useRef(line);
  held.current = line;
  const [open] = useServerAction(openTextCallAction);
  const {
    messages,
    sendMessage,
    setMessages,
    status,
    stop,
    error,
    clearError,
  } = useChat({ transport });
  const running = status === "submitted" || status === "streaming";

  const end = useCallback(() => {
    const ending = held.current;
    if (!ending) return;
    held.current = null;
    setLine(null);
    void stop();
    setMessages([]);
    clearError();
    void endCallAction(ending.callId)
      .then(unwrapResult)
      // the log lists it from here on
      .finally(() => revalidate(queryKey.callHistory(null)));
  }, [stop, setMessages, clearError]);

  // A tab that goes leaves its row to the server's sweep; a screen that goes ends it here
  const endRef = useRef(end);
  endRef.current = end;
  useEffect(() => () => endRef.current(), []);

  const say = useCallback(
    async (words: string) => {
      const settings = thursdaySettings();
      let to = held.current;
      if (!to) {
        // the hook has already said why when this throws
        to = { ...(await open(settings)), at: Date.now() };
        held.current = to;
        setLine(to);
      }
      clearError();
      void sendMessage(
        { text: words },
        { body: { callId: to.callId, settings, standing: to.standing } },
      );
    },
    [open, sendMessage, clearError],
  );

  // The inbox, the same read the spoken call makes (one request between them)
  const { data: threads } = useServerRoute<Thread[]>(queryKey.threads);
  const inbox = useRef<Thread[] | undefined>(threads);
  inbox.current = threads;
  /** When something was last written, by either side: the quiet the relay waits for. */
  const stirred = useRef(Date.now());
  /** The update she is answering: its items, their relay rows, and whether her answer has begun. */
  const relaying = useRef<{
    keys: string[];
    rows: number[];
    began: boolean;
  } | null>(null);
  const [relayLine, setRelayLine] = useState<ActivityLine | null>(null);
  const busy = useRef(running);
  busy.current = running;

  // Her answer to an update is over: its rows are accepted, as once her voice has carried one
  useEffect(() => {
    stirred.current = Date.now();
    const update = relaying.current;
    if (running) {
      if (update) update.began = true;
      return;
    }
    // sent, and her answer not begun yet: nothing is over
    if (update && !update.began) return;
    relaying.current = null;
    // Her answer never came: the update was not told, and a later call puts it in again
    if (update && error) for (const key of update.keys) toldWork.delete(key);
    if (update?.rows.length && !error)
      void acceptThreadRelaysAction(update.rows)
        .then(unwrapResult)
        .catch(() => {});
    if (!relayLine) return;
    const out = setTimeout(() => setRelayLine(null), TOOL_LINGER_MS);
    return () => clearTimeout(out);
  }, [running, error, relayLine]);

  const on = line !== null;
  useEffect(() => {
    if (!on) return;
    const tick = setInterval(() => {
      const to = held.current;
      if (!to || busy.current || relaying.current || !inbox.current) return;
      if (Date.now() - stirred.current < CALL_RELAY.quietMs) return;
      const open = openWork(inbox.current).filter(
        (item) => !toldWork.has(item.key),
      );
      const first = open[0];
      if (!first) return;
      const due = open
        .filter((item) => item.kind === first.kind)
        .slice(0, CALL_RELAY.perTurn);
      for (const item of due) toldWork.add(item.key);
      relaying.current = {
        keys: due.map((item) => item.key),
        rows: due.flatMap((item) => item.relayIds),
        began: false,
      };
      setRelayLine((due.at(-1) ?? first).show);
      stirred.current = Date.now();
      // an earlier turn's failure is not this one's
      clearError();
      const lines = due.map((item) => item.line);
      void sendMessage(
        {
          text:
            lines.length === 1
              ? lines[0]
              : `[${lines.length} updates.]\n\n${lines.join("\n\n")}`,
          metadata: RELAY_TURN,
        },
        {
          body: {
            callId: to.callId,
            settings: thursdaySettings(),
            standing: to.standing,
          },
        },
      );
    }, 1000);
    return () => clearInterval(tick);
  }, [on, sendMessage, clearError]);

  const reply = messages.at(-1)?.role === "assistant" ? messages.at(-1) : null;
  const parts = reply?.parts ?? [];
  const last = parts.at(-1);

  // Her words and yours, a turn per message; her tools are the line's, not a turn. A caption
  // draws plain words, so what she marked up — emphasis, a cited link — reads as its text
  const turns = useMemo(
    (): CallMessage[] =>
      messages.flatMap((message) => {
        if (message.role === "system" || isRelayTurn(message)) return [];
        const said = wordsOf(message);
        const text = message.role === "assistant" ? plainText(said) : said;
        return text ? [{ id: message.id, role: message.role, text }] : [];
      }),
    [messages],
  );

  // The tool she is using, or just used: it takes the line until her words follow it. The
  // pages a search read stay through her answer, until the next words are sent, as on a
  // spoken call
  const lastTool = [...parts].reverse().find(isToolUIPart);
  const used = useMemo((): ActivityLine | null => {
    if (!lastTool) return null;
    const name = getToolName(lastTool);
    // A provider's own search names what it looked for in its answer, not in what it was asked
    const asked = (lastTool.output as { action?: { query?: unknown } } | null)
      ?.action?.query;
    const args = JSON.stringify({
      ...(typeof asked === "string" ? { query: asked } : {}),
      ...(lastTool.input ?? {}),
    });
    const done =
      lastTool.state === "output-available" ||
      lastTool.state === "output-error";
    const sources =
      done && name === TOOL_NAMES.web_search
        ? searchSourcesOf(JSON.stringify(lastTool.output ?? null))
        : [];
    if (last?.type === "text" && !sources.length) return null;
    return {
      id: lastTool.toolCallId,
      name,
      line: toolLine(name, args),
      bot: toolBot(name, args),
      done,
      ...(sources.length ? { sources } : {}),
    };
  }, [lastTool, last?.type]);
  const [lingered, setLingered] = useState<string | null>(null);
  const usedId = used?.done && !used.sources ? used.id : null;
  useEffect(() => {
    if (!usedId) return;
    const out = setTimeout(() => setLingered(usedId), TOOL_LINGER_MS);
    return () => clearTimeout(out);
  }, [usedId]);
  // Her own tool first; else the update she is answering, as a relay holds the spoken line
  const tool = used && used.id !== lingered ? used : relayLine;

  // Thinking is every stretch she is at work with no tool and no words on the way
  const thinking =
    running && last?.type !== "text" && !(used && !used.done) ? true : false;
  const [thinkingSince, setThinkingSince] = useState<number | null>(null);
  useEffect(() => {
    setThinkingSince(thinking ? Date.now() : null);
  }, [thinking]);
  // A summary opens with its title in bold, as the spoken call's does (use-thursday)
  const thought = [...parts]
    .reverse()
    .find((part) => part.type === "reasoning");
  const thinkingTitle =
    (thinking &&
      thought?.type === "reasoning" &&
      /^\s*\*\*(.+?)\*\*/.exec(thought.text)?.[1]?.trim()) ||
    null;

  const callStatus: CallStatus = !line
    ? "idle"
    : !running
      ? "listening"
      : last?.type === "text"
        ? "speaking"
        : used && !used.done && used.name === TOOL_NAMES.thread_start
          ? "delegating"
          : "working";

  return {
    on: line !== null,
    busy: running,
    status: callStatus,
    messages: turns,
    tool,
    thinkingSince,
    thinkingTitle,
    since: line?.at ?? null,
    error: error ? error.message : null,
    say,
    end,
  };
}
