import { LIVE_CALL } from "@/config";
import { logger } from "@/lib/logger";
import { briefLiveEvent, createProbe } from "@/lib/probe";
import { errorToString } from "@/lib/utils";
import type { LiveClose, LiveFragment } from "./live.schema";
import { createWebRtcTransport } from "./live.transport";

const probe = createProbe("live");

/** A revisable display group, independent of audio playback and backend responses. */
export type LiveTurn = {
  id: string;
  role: "user" | "assistant" | "tool";
  tool?: string;
  text: string;
  seq: number;
  done: boolean;
  fragments?: LiveFragment[];
};
export type LiveToolCall = {
  id: string;
  name: string;
  arguments: string;
  /** The output item the call arrived in: the id its tool turn is saved under. */
  item?: string;
};
/**
 * One reasoning summary part of the backend, whole. A summary is the backend's
 * own account of its thinking, not its reasoning tokens, and comes only while a
 * model reasons.
 */
export type LiveReasoning = {
  /** The reasoning item and the summary part within it. */
  id: string;
  text: string;
  /** Where in the call, on the turns' clock. */
  seq: number;
};
export type LiveActivity = {
  working: boolean;
  speaking: boolean;
  tools: string[];
};
/** A page the backend's web search read, as the item or a citation names it. */
export type LiveSource = { url: string; title?: string };
/**
 * A web search the backend ran with its hosted tool: reported as it starts and once
 * it is done. Its answer's citations come separately (`cited`), under the same response.
 */
export type LiveSearch = {
  /** The search item. */
  id: string;
  /** The backend response it belongs to. */
  responseId: string;
  query: string | null;
  sources: LiveSource[];
  done: boolean;
  /** Where in the call, on the turns' clock. */
  seq: number;
};
export type LiveAudio = {
  element: HTMLAudioElement;
  listen(stream: MediaStream): void;
  hear?(stream: MediaStream): void;
  levels?(): { output: number };
};
type LiveOptions = {
  /** Exchanges the offer on the server and returns the SDP answer. */
  initialize(sdp: string): Promise<string>;
  audio: LiveAudio;
  on: {
    runTool(call: LiveToolCall): Promise<string>;
    reasoning?(part: LiveReasoning): void;
    search?(search: LiveSearch): void;
    /** URL citations on a backend answer, by the response that wrote it. */
    cited?(responseId: string, sources: LiveSource[]): void;
    turn(turn: LiveTurn): void;
    activity(activity: LiveActivity): void;
    finalized?(close: LiveClose): void;
    warn(message: string): void;
    failed(message: string): void;
  };
};
type AppendKind = "instructions" | "commentary" | "thinking";
/** One update, split into chunks Live accepts; settles once, true only if every chunk was acknowledged. */
type Append = { kind: AppendKind; chunks: string[]; settle(ok: boolean): void };

/**
 * Live takes at most 500 tokens per append. A token is at least one UTF-8 byte,
 * so a byte bound holds for any script; words stay whole unless one alone is too long.
 */
const APPEND_BYTES = 480;
const encoder = new TextEncoder();

export function appendChunks(text: string): string[] {
  const chunks: string[] = [];
  let chunk = "";
  let bytes = 0;
  const push = (piece: string) => {
    const size = encoder.encode(piece).length;
    if (bytes + size > APPEND_BYTES && chunk) {
      chunks.push(chunk);
      chunk = "";
      bytes = 0;
    }
    if (size <= APPEND_BYTES) {
      chunk += piece;
      bytes += size;
      return;
    }
    for (const character of piece) {
      const length = encoder.encode(character).length;
      if (bytes + length > APPEND_BYTES) {
        chunks.push(chunk);
        chunk = "";
        bytes = 0;
      }
      chunk += character;
      bytes += length;
    }
  };
  for (const piece of text.split(/(?<=\s)/)) push(piece);
  if (chunk) chunks.push(chunk);
  return chunks;
}
export type LiveSession = ReturnType<typeof createLiveSession>;

export async function openLiveSession(
  options: LiveOptions,
): Promise<LiveSession> {
  const session = createLiveSession(options);
  try {
    await session.connect();
    return session;
  } catch (cause) {
    await session.close();
    throw cause;
  }
}

/** Events consumed from Live; backend events remain inside response.event. */
type LiveEvent = {
  type: string;
  event_id?: string;
  delegation_id?: string;
  client_event_id?: string;
  delta?: string;
  start_ms?: number;
  end_ms?: number;
  offset_ms?: number;
  error?: { message?: string; client_event_id?: string };
  reason?: string;
  usage?: { seconds: number };
  event?: {
    type: string;
    response?: {
      id: string;
      error?: { message?: string };
      status?: string;
      usage?: unknown;
    };
    response_id?: string;
    item_id?: string;
    summary_index?: number;
    text?: string;
    item?: {
      type: string;
      id: string;
      call_id: string;
      name: string;
      arguments: string;
      status?: string;
      /** A `web_search_call` item: what it searched, and the pages when included. */
      action?: {
        query?: string;
        /** The guide says a search action lists its `queries`; its example shows `query`. */
        queries?: string[];
        sources?: { url?: string }[];
      };
      /** A `message` item: the answer, with its citations. */
      content?: {
        type: string;
        annotations?: { type: string; url?: string; title?: string }[];
      }[];
    };
  };
};

/** Pages a search item names, each once. */
function sourcesOf(sources: { url?: string }[] | undefined): LiveSource[] {
  const urls = (sources ?? []).flatMap((source) =>
    source.url ? [source.url] : [],
  );
  return [...new Set(urls)].map((url) => ({ url }));
}

/** URL citations across an answer's parts, each page once with its title. */
function citationsOf(
  content: NonNullable<NonNullable<LiveEvent["event"]>["item"]>["content"],
): LiveSource[] {
  const found = new Map<string, LiveSource>();
  for (const part of content ?? [])
    for (const note of part.annotations ?? [])
      if (note.type === "url_citation" && note.url && !found.has(note.url))
        found.set(note.url, {
          url: note.url,
          ...(note.title ? { title: note.title } : {}),
        });
  return [...found.values()];
}

type Transcript = {
  turn: LiveTurn;
  end: number;
  fragments: { start: number; end: number; text: string }[];
};
type BackendResponse = {
  calls: Map<string, Promise<void>>;
  terminal: boolean;
  continued: boolean;
};

/** Full-duplex speech and a separate Responses tool loop share one Live connection. */
export const createLiveSession = ({ initialize, audio, on }: LiveOptions) => {
  let started = false;
  let closing = false;
  let closed = false;
  let resolveStarted: (() => void) | undefined;
  let rejectStarted: ((cause: Error) => void) | undefined;
  let resolveClosed: (() => void) | undefined;
  let closePromise: Promise<void> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let activityTimer: ReturnType<typeof setInterval> | undefined;
  let transcriptTimer: ReturnType<typeof setTimeout> | undefined;
  let appendTimer: ReturnType<typeof setTimeout> | undefined;
  let timeline = 0;
  let ordinal = 0;
  let activityKey = "";
  const transcripts: Transcript[] = [];
  const dirty = new Set<Transcript>();
  const events = new Set<string>();
  const calls = new Set<string>();
  const responses = new Map<string, BackendResponse>();
  /** An incomplete response was just continued; the next one in a row is not. */
  let salvaging = false;
  const delegatedResponses = new Map<string, string>();
  const tools = new Map<string, string>();
  const appends: Append[] = [];
  /** The chunk on the wire, by the event id its acknowledgement names. */
  let pendingAppend: string | null = null;
  let lastOutput = -Infinity;

  const flushTranscripts = () => {
    clearTimeout(transcriptTimer);
    transcriptTimer = undefined;
    for (const group of dirty)
      on.turn({ ...group.turn, fragments: [...group.fragments], done: true });
    dirty.clear();
  };
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearTimeout(closeTimer);
    clearTimeout(appendTimer);
    clearInterval(activityTimer);
    flushTranscripts();
    pendingAppend = null;
    for (const entry of appends.splice(0)) entry.settle(false);
    transport.close();
    resolveClosed?.();
  };
  const fail = (message: string) => {
    rejectStarted?.(new Error(message));
    cleanup();
    if (started && !closing) on.failed(message);
    else if (closing) on.warn(message);
  };
  const activity = () => {
    if (closed || closing) return;
    const now = performance.now();
    const levels = audio.levels?.();
    // A short release follows the phrase rather than each syllable.
    if (levels && levels.output > 0.01) lastOutput = now;
    const value = {
      speaking: now - lastOutput < 300,
      working:
        [...responses.values()].some((response) => !response.terminal) ||
        tools.size > 0,
      tools: [...tools.values()],
    };
    const key = JSON.stringify(value);
    if (key !== activityKey || value.speaking || value.working) {
      activityKey = key;
      on.activity(value);
    }
  };
  const appendNext = () => {
    if (!started || closed || closing || pendingAppend || !appends.length)
      return;
    const [next] = appends;
    pendingAppend = crypto.randomUUID();
    probe("out", {
      type: `session.${next.kind}.append`,
      client: pendingAppend,
      head: next.chunks[0].slice(0, 80),
      chunksLeft: next.chunks.length,
    });
    transport.send({
      type: `session.${next.kind}.append`,
      event_id: pendingAppend,
      // Required, and null for app updates in Responses mode: a response id is not a delegation id.
      delegation_id: null,
      content: next.chunks[0],
    });
    appendTimer = setTimeout(() => {
      on.warn(
        "Live did not acknowledge the conversation update; delivery is unknown.",
      );
      settleAppend(false);
    }, LIVE_CALL.appendMs);
  };
  /**
   * An acknowledged chunk sends the next one of the same update. A rejected or
   * unacknowledged one drops the rest of that update — half an instruction is
   * worse than none — and is never resent, since it may have landed.
   */
  const settleAppend = (ok: boolean) => {
    clearTimeout(appendTimer);
    pendingAppend = null;
    const [entry] = appends;
    if (!entry) return;
    if (ok) entry.chunks.shift();
    if (!ok || !entry.chunks.length) {
      appends.shift();
      entry.settle(ok);
    }
    appendNext();
  };
  const transcript = (event: LiveEvent, role: "user" | "assistant") => {
    if (
      !event.delta ||
      event.start_ms === undefined ||
      event.end_ms === undefined
    )
      return;
    const start = event.start_ms;
    const end = event.end_ms;
    let group = transcripts.findLast(
      (entry) =>
        entry.turn.role === role &&
        start >= entry.turn.seq - LIVE_CALL.transcriptGapMs &&
        start <= entry.end + LIVE_CALL.transcriptGapMs,
    );
    if (!group) {
      group = {
        turn: {
          id: `live-${ordinal++}`,
          role,
          text: "",
          seq: start,
          done: false,
        },
        end,
        fragments: [],
      };
      transcripts.push(group);
    }
    group.fragments.push({ start, end, text: event.delta });
    group.fragments.sort((a, b) => a.start - b.start);
    group.end = Math.max(group.end, end);
    group.turn.text = group.fragments.map((fragment) => fragment.text).join("");
    on.turn({ ...group.turn, done: false });
    dirty.add(group);
    // Periodic checkpoints can be revised by a late fragment; these are display groups, not semantic turns.
    transcriptTimer ??= setTimeout(
      flushTranscripts,
      LIVE_CALL.transcriptSaveMs,
    );
  };
  const continueResponse = async (response: BackendResponse) => {
    if (!response.terminal || response.continued || !response.calls.size)
      return;
    response.continued = true;
    await Promise.all(response.calls.values());
    probe("out", { type: "response.create", closing, closed });
    if (!closing && !closed)
      transport.send({
        type: "response.create",
        event_id: crypto.randomUUID(),
      });
    activity();
  };
  const handle = (event: LiveEvent) => {
    if (closed) return;
    if (event.event_id) {
      if (events.has(event.event_id)) return;
      events.add(event.event_id);
    }
    timeline = Math.max(timeline, event.offset_ms ?? 0, event.end_ms ?? 0);
    if (!event.type.endsWith(".delta") && !event.event?.type.endsWith(".delta"))
      probe("in", briefLiveEvent(event));
    switch (event.type) {
      case "session.started":
        started = true;
        resolveStarted?.();
        appendNext();
        break;
      case "session.closed":
        on.finalized?.({
          reason: event.reason ?? "closed",
          seconds: event.usage?.seconds ?? null,
        });
        logger.info("Live session closed", {
          reason: event.reason,
          seconds: event.usage?.seconds,
        });
        rejectStarted?.(
          new Error("OpenAI Live closed before startup completed."),
        );
        cleanup();
        if (!closing)
          on.failed(`The Live call ended (${event.reason ?? "closed"}).`);
        break;
      case "session.input_transcript.delta":
        transcript(event, "user");
        break;
      case "session.output_transcript.delta":
        transcript(event, "assistant");
        break;
      case "session.instructions.appended":
      case "session.commentary.appended":
      case "session.thinking.appended":
        if (pendingAppend && event.client_event_id === pendingAppend)
          settleAppend(true);
        break;
      case "error": {
        const message =
          event.error?.message ?? "OpenAI Live reported an error.";
        if (!started) {
          fail(message);
          break;
        }
        on.warn(message);
        if (pendingAppend && event.error?.client_event_id === pendingAppend)
          settleAppend(false);
        break;
      }
      case "response.event": {
        const nested = event.event;
        if (!nested || closing) break;
        if (
          nested.type === "response.created" &&
          nested.response &&
          event.delegation_id
        )
          delegatedResponses.set(event.delegation_id, nested.response.id);
        const id =
          nested.response?.id ??
          nested.response_id ??
          (event.delegation_id
            ? delegatedResponses.get(event.delegation_id)
            : undefined);
        if (!id) break;
        let response = responses.get(id);
        if (!response) {
          response = { calls: new Map(), terminal: false, continued: false };
          responses.set(id, response);
        }
        if (nested.type === "response.reasoning_summary_text.done") {
          on.reasoning?.({
            id: `${nested.item_id}:${nested.summary_index ?? 0}`,
            text: nested.text ?? "",
            seq: timeline,
          });
        }
        // The hosted web search runs inside the backend: nothing to execute or answer,
        // only what it looked for and read. Sources come on the item when the response
        // carries them, and as citations on the answer that used them.
        if (
          (nested.type === "response.output_item.added" ||
            nested.type === "response.output_item.done") &&
          nested.item?.type === "web_search_call"
        ) {
          const item = nested.item;
          const done = nested.type === "response.output_item.done";
          if (done) logger.debug("Live web search", item);
          on.search?.({
            id: item.id,
            responseId: id,
            query:
              (
                item.action?.query ?? item.action?.queries?.join(" · ")
              )?.trim() || null,
            sources: sourcesOf(item.action?.sources),
            done,
            seq: timeline,
          });
        }
        if (
          nested.type === "response.output_item.done" &&
          nested.item?.type === "message"
        ) {
          const cited = citationsOf(nested.item.content);
          if (cited.length) on.cited?.(id, cited);
        }
        if (
          nested.type === "response.output_item.done" &&
          nested.item?.type === "function_call"
        ) {
          const item = nested.item;
          if (calls.has(item.call_id)) break;
          calls.add(item.call_id);
          // Cut off by the output cap: the arguments are a fragment, and Live ends the
          // handoff with a top-level error, never a terminal event for this response.
          // Calls it completed before the cut still ran, so their results are continued,
          // under the same once-in-a-row bound as an incomplete response.
          if (item.status === "incomplete") {
            response.terminal = true;
            logger.warn("Live backend call cut off; not run", {
              responseId: id,
              name: item.name,
              arguments: item.arguments.slice(0, 200),
            });
            if (response.calls.size && !salvaging) {
              salvaging = true;
              void continueResponse(response);
            } else response.continued = true;
            break;
          }
          on.turn({
            id: item.id,
            role: "tool",
            tool: item.name,
            text: item.arguments,
            seq: timeline,
            done: true,
          });
          flushTranscripts();
          tools.set(item.call_id, item.name);
          const running = Promise.resolve()
            .then(() =>
              on.runTool({
                id: item.call_id,
                name: item.name,
                arguments: item.arguments,
                item: item.id,
              }),
            )
            .catch((cause) => `Error: ${errorToString(cause)}`)
            .then((output) => {
              tools.delete(item.call_id);
              probe("out", {
                type: "function_call_output",
                name: item.name,
                call: item.call_id,
                size: output.length,
              });
              if (!closed && !closing)
                transport.send({
                  type: "response.item.create",
                  event_id: crypto.randomUUID(),
                  item: {
                    type: "function_call_output",
                    call_id: item.call_id,
                    output,
                  },
                });
              activity();
            });
          response.calls.set(item.call_id, running);
          void continueResponse(response);
        }
        if (
          [
            "response.completed",
            "response.failed",
            "response.incomplete",
            "response.cancelled",
          ].includes(nested.type)
        ) {
          response.terminal = true;
          if (nested.type === "response.completed") {
            salvaging = false;
            logger.debug("Live backend usage", {
              responseId: id,
              usage: nested.response?.usage,
            });
            void continueResponse(response);
          } else if (
            nested.type === "response.incomplete" &&
            response.calls.size &&
            !salvaging
          ) {
            // Cut off after asking for tools: its outputs still go in, and a turn
            // left there never ends. One continuation only, so running out cannot loop.
            salvaging = true;
            logger.warn("Live backend response incomplete; continuing once", {
              responseId: id,
            });
            void continueResponse(response);
          } else {
            salvaging = false;
            response.continued = true;
            on.warn(
              nested.response?.error?.message ??
                `The Live backend ${nested.type.slice(9)}.`,
            );
          }
        }
        break;
      }
    }
    activity();
  };
  const transport = createWebRtcTransport<LiveEvent, Record<string, unknown>>({
    audio,
    negotiate: async (sdp) => {
      const answer = await initialize(sdp);
      if (!answer) throw new Error("OpenAI Live returned no SDP answer.");
      return answer;
    },
    on: { event: handle, dropped: fail },
  });

  return {
    async connect() {
      audio.element.muted = false;
      const ready = new Promise<void>((resolve, reject) => {
        resolveStarted = resolve;
        rejectStarted = reject;
      });
      void ready.catch(() => {});
      const timer = setTimeout(
        () => fail("OpenAI Live did not start in time."),
        LIVE_CALL.startupMs,
      );
      try {
        await Promise.all([transport.connect(), ready]);
        if (closed) throw new Error("The Live call closed during startup.");
        activityTimer = setInterval(activity, 100);
      } catch (cause) {
        cleanup();
        throw cause;
      } finally {
        clearTimeout(timer);
        rejectStarted = undefined;
      }
    },
    close() {
      if (closePromise) return closePromise;
      if (closed) return Promise.resolve();
      closing = true;
      flushTranscripts();
      if (!started) {
        cleanup();
        return Promise.resolve();
      }
      closePromise = new Promise<void>((resolve) => {
        resolveClosed = resolve;
      });
      closeTimer = setTimeout(() => {
        on.warn("Live disconnected without confirming final session usage.");
        cleanup();
      }, LIVE_CALL.closeMs);
      audio.element.muted = true;
      probe("out", { type: "session.close" });
      transport.send({ type: "session.close", event_id: crypto.randomUUID() });
      return closePromise;
    },
    /**
     * Queues an update in order: `instructions` for trusted behaviour, `commentary`
     * for something to convey, `thinking` for context that need not be spoken.
     * Resolves true once Live acknowledged all of it — which is not proof it was
     * spoken — and false when it was rejected, unacknowledged or the call closed.
     */
    append(kind: AppendKind, text: string): Promise<boolean> {
      const chunks = appendChunks(text);
      if (closed || closing || !chunks.length) return Promise.resolve(false);
      return new Promise<boolean>((settle) => {
        appends.push({ kind, chunks, settle });
        appendNext();
      });
    },
  };
};
