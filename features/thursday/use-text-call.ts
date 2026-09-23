"use client";

import { useChat } from "@ai-sdk/react";
import {
  type ChatOnFinishCallback,
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
  type UIMessage,
} from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { TEXT_CALL } from "@/config";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { acceptThreadRelaysAction } from "@/features/bot/bot.action";
import type { Thread } from "@/features/bot/bot.schema";
import { unwrapResult } from "@/lib/protocol/result";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { plainText } from "@/lib/utils";
import { openWork, stoodBefore, toldWork } from "./open-work";
import {
  endCallAction,
  openTextCallAction,
  tellTextCallAction,
} from "./thursday.action";
import {
  type CallMessage,
  type CallStatus,
  TEXT_CALL_NOTE,
  type TextCallHandshake,
  type TextCallNote,
} from "./thursday.schema";
import { useThursdayStore } from "./thursday.store";
import { searchSourcesOf, toolBot, toolLine } from "./tool-line";
import type { ActivityLine } from "./use-thursday";

/**
 * A call in writing, as the call screen draws it: the same turns, tool line and thinking
 * a spoken call hands it, read off one streamed conversation (thursday.text). The page
 * holds that conversation and sends it whole with every turn; the row it is kept under
 * opens with the first words and closes when the call ends — Esc in the line, or a spoken
 * call taking the screen. She holds no tool that ends it: there is no line to drop.
 *
 * A chat has no line to talk over, so nothing here waits for quiet. What is written while
 * she answers joins that answer before her next step (thursday.text tellTextCall), and what
 * came after her last step starts the next turn at once. What bots send is left to her as a
 * fact the moment the inbox has it: into the answer she is writing, or as a turn of its own
 * when she is not writing one — never after a turn that broke, which keeps its error and its
 * Send it again, and at most TEXT_CALL.autoTurns in a row with no word from the user. Both go
 * as notes (`data-note` parts): words drawn as the user's, facts not drawn at all, and a
 * fact's relay rows accepted once a turn that carried it has finished.
 */

const transport = new DefaultChatTransport({ api: queryKey.textCall });

/** How long a finished tool stays on the line before it clears, as on a spoken call. */
const TOOL_LINGER_MS = 2500;

export type TextCall = {
  /** A call in writing is open. */
  on: boolean;
  /** She is answering: what is sent now joins that answer. */
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
  /** Asks again for the answer that did not come, on whatever is picked now. */
  again: () => void;
  end: () => void;
};

/** The model picked on the write line, read as each turn goes: a pick made mid-call holds from the next turn. */
const runsOn = () => useThursdayStore.getState().textModel;

/** The part a note rides in, the one the server reads (thursday.text). */
const notePart = (note: TextCallNote) => ({
  type: `data-${TEXT_CALL_NOTE}` as const,
  id: note.id,
  data: note,
});
const noteOf = (part: UIMessage["parts"][number]): TextCallNote | null =>
  part.type === `data-${TEXT_CALL_NOTE}`
    ? (part as { data: TextCallNote }).data
    : null;
const notesIn = (messages: UIMessage[]): TextCallNote[] =>
  messages.flatMap((message) =>
    message.parts.flatMap((part) => {
      const note = noteOf(part);
      return note ? [note] : [];
    }),
  );

export function useTextCall(): TextCall {
  const [line, setLine] = useState<(TextCallHandshake & { at: number }) | null>(
    null,
  );
  const held = useRef(line);
  held.current = line;
  /** What already stood when this call opened, and so is not put to her (open-work). */
  const stood = useRef(new Set<string>());
  const [open] = useServerAction(openTextCallAction);
  /** The answer streaming now, by the name its request went out under; null between turns. */
  const turn = useRef<string | null>(null);
  /**
   * What waits for the next turn: words written as an answer ended, and facts no turn has
   * carried yet. Read and changed through `pending`, drawn from `waiting`.
   */
  const pending = useRef<TextCallNote[]>([]);
  const [waiting, setWaiting] = useState<TextCallNote[]>([]);
  const hold = useCallback((notes: TextCallNote[]) => {
    pending.current = notes;
    setWaiting(notes);
  }, []);
  /** Facts put in that no finished turn has carried yet: which item, its rows, its line. */
  const facts = useRef(
    new Map<string, { key: string; rows: number[]; show: ActivityLine }>(),
  );
  /** Turns what bots sent has started since the user last wrote (TEXT_CALL.autoTurns). */
  const auto = useRef(0);
  const [relayLine, setRelayLine] = useState<ActivityLine | null>(null);
  /** What a request does once it is over; set below, where all it needs exists. */
  const after = useRef<ChatOnFinishCallback<UIMessage>>(() => {});
  const {
    messages,
    sendMessage,
    setMessages,
    status,
    stop,
    error,
    clearError,
  } = useChat({ transport, onFinish: (event) => after.current(event) });
  const running = status === "submitted" || status === "streaming";
  /** The conversation as last drawn, for a request that has to read it (again). */
  const chat = useRef(messages);
  chat.current = messages;
  /** The last turn broke: nothing goes in by itself until one goes through. */
  const broke = useRef(error);
  broke.current = error;

  /** One turn: what waited, then the words, under a new name the answer is told by. */
  const send = useCallback(
    (words: string | null) => {
      const to = held.current;
      if (!to) return;
      const carried = pending.current;
      hold([]);
      const name = crypto.randomUUID();
      turn.current = name;
      void sendMessage(
        {
          parts: [
            ...carried.map(notePart),
            ...(words ? [{ type: "text" as const, text: words }] : []),
          ],
        },
        {
          body: {
            callId: to.callId,
            standing: to.standing,
            runsOn: runsOn(),
            turn: name,
          },
        },
      );
    },
    [sendMessage, hold],
  );

  const end = useCallback(() => {
    const ending = held.current;
    if (!ending) return;
    held.current = null;
    setLine(null);
    turn.current = null;
    // Put in, but no turn that carried them finished: not told after all, so a later call
    // puts a question in again; an ending or progress stays where the screen shows it
    for (const fact of facts.current.values()) toldWork.delete(fact.key);
    facts.current.clear();
    hold([]);
    auto.current = 0;
    setRelayLine(null);
    void stop();
    setMessages([]);
    clearError();
    void endCallAction(ending.callId)
      .then(unwrapResult)
      // the log lists it from here on
      .finally(() => revalidate(queryKey.callHistory(null)));
  }, [stop, setMessages, clearError, hold]);

  // A tab that goes leaves its row to the server's sweep; a screen that goes ends it here
  const endRef = useRef(end);
  endRef.current = end;
  useEffect(() => () => endRef.current(), []);

  /** Into the answer streaming now, before her next step; it waits for the next turn otherwise. */
  const tell = useCallback(
    (note: TextCallNote) => {
      hold([...pending.current, note]);
      const to = held.current;
      const answering = turn.current;
      if (to && answering)
        // Refused once that answer is over: the note is still waiting, for the next turn
        void tellTextCallAction(to.callId, answering, note)
          .then(unwrapResult)
          .catch(() => {});
    },
    [hold],
  );

  const say = useCallback(
    async (words: string) => {
      let to = held.current;
      if (!to) {
        // the hook has already said why when this throws
        to = { ...(await open(runsOn())), at: Date.now() };
        held.current = to;
        stood.current = stoodBefore(inbox.current ?? []);
        setLine(to);
      }
      auto.current = 0;
      // She is answering: the words join it, drawn as they are sent
      if (turn.current)
        return tell({ id: crypto.randomUUID(), text: words, said: true });
      clearError();
      send(words);
    },
    [open, tell, clearError, send],
  );

  const again = useCallback(() => {
    const to = held.current;
    const all = chat.current;
    const at = all.findLastIndex((message) => message.role === "user");
    const asked = all[at];
    if (!to || !asked) return;
    // What her broken answer had read goes back in with the words it was answering, so
    // nothing is saved twice (turns are kept under their ids) and nothing is lost
    const read = notesIn(all.slice(at + 1));
    const carried = pending.current;
    hold([]);
    const name = crypto.randomUUID();
    turn.current = name;
    clearError();
    void sendMessage(
      {
        messageId: asked.id,
        parts: [...asked.parts, ...[...read, ...carried].map(notePart)],
      },
      {
        body: {
          callId: to.callId,
          standing: to.standing,
          runsOn: runsOn(),
          turn: name,
        },
      },
    );
  }, [sendMessage, clearError, hold]);

  // The inbox, the same read the spoken call makes (one request between them)
  const { data: threads } = useServerRoute<Thread[]>(queryKey.threads);
  const inbox = useRef<Thread[] | undefined>(threads);
  inbox.current = threads;

  /**
   * What bots have sent since, left to her as facts: into the answer she is writing, or as a
   * turn of its own when she is not writing one — unless a turn broke, or bots have already
   * started TEXT_CALL.autoTurns since the user last wrote: then it waits for their next words.
   */
  const wake = useCallback(() => {
    if (!held.current || !inbox.current) return;
    const open = openWork(inbox.current);
    // A fact still waiting for a turn whose work was handled meanwhile is news no more, and
    // was never told: should it come back, it is new
    const still = new Set(open.map((item) => item.key));
    const stale = pending.current.filter((note) => {
      const fact = facts.current.get(note.id);
      return fact !== undefined && !still.has(fact.key);
    });
    if (stale.length) {
      for (const note of stale) {
        const fact = facts.current.get(note.id);
        if (fact) toldWork.delete(fact.key);
        facts.current.delete(note.id);
      }
      hold(pending.current.filter((note) => !stale.includes(note)));
    }
    for (const item of open) {
      if (toldWork.has(item.key) || stood.current.has(item.key)) continue;
      toldWork.add(item.key);
      const note = { id: crypto.randomUUID(), text: item.line, said: false };
      facts.current.set(note.id, {
        key: item.key,
        rows: item.relayIds,
        show: item.show,
      });
      // Into the answer she is writing: the line says whose it is while she reads it
      if (turn.current) setRelayLine(item.show);
      tell(note);
    }
    if (turn.current || broke.current || auto.current >= TEXT_CALL.autoTurns)
      return;
    const due = pending.current.filter((note) => facts.current.has(note.id));
    const last = due.length ? facts.current.get(due[due.length - 1].id) : null;
    if (!last) return;
    auto.current += 1;
    setRelayLine(last.show);
    send(null);
  }, [hold, tell, send]);

  const on = line !== null;
  useEffect(() => {
    if (on && threads) wake();
  }, [on, threads, wake]);

  after.current = ({
    message,
    messages: all,
    isAbort,
    isError,
    isDisconnect,
  }) => {
    // Stopped by end(), which let go of it already: a later call's turn is not this one's
    if (isAbort || !held.current) return;
    turn.current = null;
    // Read by one of her steps: it is in her answer now, where she read it
    const read = new Set(notesIn([message]).map((note) => note.id));
    hold(pending.current.filter((note) => !read.has(note.id)));
    // Nothing goes by itself after a turn that broke: what waits, waits
    if (isError || isDisconnect) return;
    // Carried by a turn that finished: those bots' updates have been told
    const carried = new Set(notesIn(all).map((note) => note.id));
    const rows: number[] = [];
    for (const [id, fact] of facts.current)
      if (carried.has(id)) {
        rows.push(...fact.rows);
        facts.current.delete(id);
      }
    if (rows.length)
      void acceptThreadRelaysAction(rows)
        .then(unwrapResult)
        .catch(() => {});
    // Written after her last step: the next turn, at once
    if (pending.current.some((note) => note.said)) return send(null);
    wake();
  };

  // A bot's update stays on the line while she answers it, then clears as a tool's does
  useEffect(() => {
    if (running || !relayLine) return;
    const out = setTimeout(() => setRelayLine(null), TOOL_LINGER_MS);
    return () => clearTimeout(out);
  }, [running, relayLine]);

  const reply = messages.at(-1)?.role === "assistant" ? messages.at(-1) : null;
  const parts = reply?.parts ?? [];
  const last = parts.at(-1);

  // Her words and yours, a caption for each stretch of words; her tools are the line's, not
  // a turn. A caption draws plain words, so what she marked up — emphasis, a cited link —
  // reads as its text. Words that joined her answer sit where she read them, and those still
  // on their way come last. A fact is not drawn, so what she says after one opens a caption
  // of its own instead of running on from the words before it
  const turns = useMemo((): CallMessage[] => {
    const out: CallMessage[] = [];
    let fresh = false;
    const draw = (id: string, role: CallMessage["role"], text: string) => {
      if (!text) return;
      const opens = fresh && role === "assistant";
      if (role === "assistant") fresh = false;
      out.push({ id, role, text, ...(opens ? { fresh: true as const } : {}) });
    };
    for (const message of messages) {
      if (message.role === "system") continue;
      const role = message.role;
      let words: string[] = [];
      let piece = 0;
      const flush = () => {
        const said = words.join("\n\n").trim();
        words = [];
        draw(
          `${message.id}:${piece++}`,
          role,
          role === "assistant" ? plainText(said) : said,
        );
      };
      for (const part of message.parts) {
        if (part.type === "text") words.push(part.text);
        const note = noteOf(part);
        if (!note) continue;
        flush();
        if (note.said) draw(note.id, "user", note.text);
        else fresh = true;
      }
      flush();
    }
    // Words still on their way come last; once she has read them they are drawn there alone
    const read = new Set(notesIn(messages).map((note) => note.id));
    for (const note of waiting)
      if (note.said && !read.has(note.id)) draw(note.id, "user", note.text);
    return out;
  }, [messages, waiting]);

  // The tool she is using, or just used: it takes the line until her words follow it. The
  // pages a search read stay through her answer, until the next words are sent, as on a
  // spoken call
  const lastTool = [...parts].reverse().find(isToolUIPart);
  // The part is copied with every piece of the stream, and its arguments arrive a few
  // characters a piece: the line is a new object only when what it draws changes, or
  // every piece redraws the call screen several times over
  const id = lastTool?.toolCallId ?? null;
  const name = lastTool ? getToolName(lastTool) : null;
  const done =
    lastTool?.state === "output-available" ||
    lastTool?.state === "output-error";
  const output = lastTool?.output;
  const sources = useMemo(
    () =>
      done && name === TOOL_NAMES.web_search
        ? searchSourcesOf(JSON.stringify(output ?? null))
        : [],
    [done, name, output],
  );
  // A provider's own search names what it looked for in its answer, not in what it was asked
  const asked = (output as { action?: { query?: unknown } } | null | undefined)
    ?.action?.query;
  const args = JSON.stringify({
    ...(typeof asked === "string" ? { query: asked } : {}),
    ...(lastTool?.input ?? {}),
  });
  const bot = name
    ? toolBot(
        name,
        args,
        inbox.current,
        output === undefined ? undefined : JSON.stringify(output),
      )
    : null;
  const drawn = name ? toolLine(name, args, bot) : null;
  const answered = last?.type === "text";
  const used = useMemo((): ActivityLine | null => {
    if (!id || !name || (answered && !sources.length)) return null;
    return {
      id,
      name,
      line: drawn,
      bot,
      done,
      ...(sources.length ? { sources } : {}),
    };
  }, [id, name, drawn, bot, done, sources, answered]);
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
    again,
    end,
  };
}
