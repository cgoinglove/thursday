"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolUIPart } from "ai";
import {
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  Loader2,
  Minus,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { ShinyText } from "@/components/ui/shiny-text";
import { ModelPicker } from "@/features/ai/components/model-picker";
import { ProviderIcon } from "@/features/ai/components/provider-icon";
import type { TextModelProviderId } from "@/features/ai/model.schema";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import type { MemoryNote } from "@/features/memory/memory.schema";
import { cn } from "@/lib/utils";

type KnownFact = { text: string; path: string };

/** How long a finished edit's lines stay up before they clear. */
const LINGER_MS = 4000;

/** One transport for every edit: the model rides on each request, not on the hook. */
const transport = new DefaultChatTransport({ api: queryKey.memoryEdit });

/**
 * Editing memory in a line, floating over the panes above the rail. One send is
 * one streamed run (memory.edit): the model writes with memory's own tools as it
 * goes and each call is drawn as it arrives. Nothing about the exchange is kept —
 * the next send starts clean — and the model is picked here, never saved.
 */
export function MemoryEdit({ notes }: { notes: MemoryNote[] }) {
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState<{
    provider: TextModelProviderId | null;
    model: string;
  }>({ provider: null, model: "" });
  const [picking, setPicking] = useState(false);
  const {
    messages,
    sendMessage,
    setMessages,
    status,
    stop,
    error,
    clearError,
  } = useChat({ transport });

  // A run nobody is looking at has nobody to show its lines to
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(
    () => () => {
      void stopRef.current();
    },
    [],
  );

  // Facts seen on screen, kept after they go so a finished change still reads as what it replaced
  const seen = useRef(new Map<number, KnownFact>());
  for (const note of notes) {
    for (const fact of note.facts) {
      seen.current.set(fact.id, { text: fact.text, path: note.path });
    }
  }

  const running = status === "submitted" || status === "streaming";
  const ready = Boolean(model.provider && model.model.trim());
  const reply = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  const parts = reply?.parts ?? [];
  const calls = parts.filter(isToolUIPart);
  const words = parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join(" ")
    .trim();
  const failed =
    Boolean(error) || calls.some((call) => call.state === "output-error");
  const written = calls.filter(
    (call) =>
      call.state === "output-available" &&
      getToolName(call) !== TOOL_NAMES.memory_recall,
  ).length;

  useEffect(() => {
    if (status !== "ready" || failed || messages.length === 0) return;
    const clear = setTimeout(() => setMessages([]), LINGER_MS);
    return () => clearTimeout(clear);
  }, [status, failed, messages.length, setMessages]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const said = draft.trim();
    if (!said || !ready || running) return;
    setDraft("");
    setPicking(false);
    clearError();
    // One send is one run: nothing from the last one rides along
    setMessages([]);
    void sendMessage({ text: said }, { body: { model } });
  };

  const line = running ? (
    <ShinyText text="Working on memory" className="text-xs" />
  ) : error ? (
    <span className="text-xs text-destructive">{error.message}</span>
  ) : reply ? (
    <span className="text-xs text-muted-foreground">
      {words ||
        (written === 0
          ? "Nothing to change"
          : written === 1
            ? "1 change saved"
            : `${written} changes saved`)}
    </span>
  ) : null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-18 z-10 flex justify-center px-8">
      <div className="pointer-events-auto flex w-full max-w-120 flex-col items-center gap-2">
        {picking && (
          <div className="w-full rounded-xl bg-popover p-2 shadow-lg ring-1 ring-foreground/10">
            <ModelPicker
              provider={model.provider}
              model={model.model}
              unset="Provider"
              onChange={setModel}
            />
          </div>
        )}

        {calls.length > 0 && (
          <ul className="w-full divide-y divide-border/60 overflow-hidden rounded-xl bg-popover shadow-lg ring-1 ring-foreground/10">
            {calls.map((call) => (
              <ChangeRow
                key={call.toolCallId}
                name={getToolName(call)}
                input={call.input}
                state={call.state}
                errorText={
                  call.state === "output-error" ? call.errorText : undefined
                }
                known={seen.current}
              />
            ))}
          </ul>
        )}

        {line && <p className="max-w-full truncate px-1">{line}</p>}

        <form
          onSubmit={submit}
          className="flex h-10 w-full items-center gap-1.5 rounded-xl bg-popover pr-1.5 pl-3.5 shadow-lg ring-1 ring-foreground/10"
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={running}
            aria-label="Edit memory"
            placeholder="Tell memory what changed"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => setPicking(!picking)}
            className={cn("max-w-44", !ready && "text-muted-foreground")}
          >
            {ready && model.provider ? (
              <>
                <ProviderIcon provider={model.provider} className="size-3" />
                <span className="truncate">{model.model}</span>
              </>
            ) : (
              "Model"
            )}
            <ChevronDown className="text-muted-foreground" />
          </Button>
          <Button
            type="submit"
            size="icon-sm"
            loading={running}
            disabled={!draft.trim() || !ready || running}
            aria-label="Send"
          >
            {!running && <ArrowUp />}
          </Button>
        </form>
      </div>
    </div>
  );
}

type Change = {
  kind: "Remember" | "Replace" | "Forget" | "Rename" | "Opened";
  path: string;
  lines: { before?: string; after?: string }[];
  carried: boolean;
};

/** What a call does, read off its arguments — still arriving while it streams — and the facts the screen has shown. */
function describe(
  name: string,
  input: unknown,
  known: Map<number, KnownFact>,
): Change {
  const args = (input ?? {}) as {
    path?: string;
    factId?: number;
    description?: string | null;
    aliases?: (string | undefined)[] | null;
    facts?:
      | ({
          text?: string;
          replaces?: number | null;
          alwaysLoad?: boolean | null;
        } | null)[]
      | null;
  };

  if (name === TOOL_NAMES.memory_recall) {
    return { kind: "Opened", path: args.path ?? "", lines: [], carried: false };
  }

  if (name === TOOL_NAMES.memory_forget) {
    const fact = args.factId != null ? known.get(args.factId) : undefined;
    const fallback = args.factId != null ? `Fact #${args.factId}` : "";
    return {
      kind: "Forget",
      path: fact?.path ?? "",
      lines: [{ before: fact?.text ?? fallback }],
      carried: false,
    };
  }

  const facts = (args.facts ?? []).filter((fact) => fact != null);
  const lines: Change["lines"] = facts.map((fact) =>
    fact.replaces != null
      ? {
          before: known.get(fact.replaces)?.text ?? `Fact #${fact.replaces}`,
          after: fact.text,
        }
      : { after: fact.text },
  );
  if (args.description) lines.push({ after: `“${args.description}”` });
  const aliases = (args.aliases ?? []).filter(Boolean);
  if (aliases.length) {
    lines.push({
      after: `Called ${aliases.map((alias) => `“${alias}”`).join(", ")}`,
    });
  }
  return {
    kind: facts.some((fact) => fact.replaces != null)
      ? "Replace"
      : facts.length
        ? "Remember"
        : "Rename",
    path: args.path ?? "",
    lines,
    carried: facts.some((fact) => fact.alwaysLoad),
  };
}

const GLYPHS = {
  Remember: Plus,
  Replace: Pencil,
  Forget: Minus,
  Rename: Pencil,
  Opened: BookOpen,
} as const;

function ChangeRow({
  name,
  input,
  state,
  errorText,
  known,
}: {
  name: string;
  input: unknown;
  state: string;
  errorText?: string;
  known: Map<number, KnownFact>;
}) {
  const change = describe(name, input, known);
  const Glyph = GLYPHS[change.kind];
  const broke = state === "output-error";
  const done = state === "output-available";
  return (
    <li className="flex animate-in items-start gap-2.5 px-3 py-2.5 duration-200 fade-in slide-in-from-bottom-1">
      <Glyph className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-0.5">
        {change.lines.map((line, at) => (
          <div key={`${change.kind}-${at}`}>
            {line.before && (
              <p className="text-[13px] leading-5 text-muted-foreground/60 line-through">
                {line.before}
              </p>
            )}
            {line.after && (
              <p className="text-sm leading-5 text-foreground/90">
                {line.after}
              </p>
            )}
          </div>
        ))}
        <p className="pt-0.5 font-mono text-[11px] text-muted-foreground">
          {change.kind}
          {change.path && ` · ${change.path}`}
          {change.carried && " · carried into every call"}
        </p>
        {broke && errorText && (
          <p className="text-xs text-destructive">{errorText}</p>
        )}
      </div>
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center text-muted-foreground">
        {broke ? (
          <X className="size-3.5 text-destructive" />
        ) : done ? (
          <Check className="size-3.5" />
        ) : (
          <Loader2 className="size-3.5 animate-spin" />
        )}
      </span>
    </li>
  );
}
