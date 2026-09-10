"use client";

import type { JSONValue, ModelMessage } from "ai";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Minus,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import ShinyText from "@/components/ui/shiny-text";
import { ModelPicker } from "@/features/ai/components/model-picker";
import { ProviderIcon } from "@/features/ai/components/provider-icon";
import type { TextModelProviderId } from "@/features/ai/model.schema";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { applyMemoryEditAction } from "@/features/memory/memory.action";
import type {
  MemoryEditCall,
  MemoryEditStep,
  MemoryNote,
} from "@/features/memory/memory.schema";
import { isResultOk, type Result, unwrapResult } from "@/lib/protocol/result";
import { cn, errorToString } from "@/lib/utils";

type ToolPart = Extract<ModelMessage, { role: "tool" }>["content"][number];
type ToolAnswer = Extract<ToolPart, { type: "tool-result" }>;
type KnownFact = { text: string; path: string };

/**
 * Editing memory in a line, floating over the panes above the rail. A request
 * runs one model step at a time (memory.edit); each change the model asks for
 * rises as a card, saved on the spot or dropped, and once every card of a step is
 * answered the run carries on. The model is picked here for this edit and never
 * saved. A waiting card carries no color: nothing about it is failing.
 */
export function MemoryEdit({ notes }: { notes: MemoryNote[] }) {
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState<{
    provider: TextModelProviderId | null;
    model: string;
  }>({ provider: null, model: "" });
  const [picking, setPicking] = useState(false);
  const [working, setWorking] = useState(false);
  const [cards, setCards] = useState<MemoryEditCall[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [line, setLine] = useState<{ text: string; failed?: boolean } | null>(
    null,
  );

  // Refs, because each card answers into them while the others still wait
  const thread = useRef<ModelMessage[]>([]);
  const pending = useRef<MemoryEditCall[]>([]);
  const answers = useRef<ToolAnswer[]>([]);
  const stop = useRef<AbortController | null>(null);
  useEffect(() => () => stop.current?.abort(), []);

  const known = new Map<number, KnownFact>(
    notes.flatMap((note) =>
      note.facts.map((fact) => [fact.id, { text: fact.text, path: note.path }]),
    ),
  );
  const ready = Boolean(model.provider && model.model.trim());
  const busy = working || cards.length > 0;

  const step = async (messages: ModelMessage[]) => {
    const controller = new AbortController();
    stop.current = controller;
    setWorking(true);
    try {
      const response = await fetch(queryKey.memoryEdit, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages }),
        signal: controller.signal,
      });
      const next = unwrapResult(
        (await response.json()) as Result<MemoryEditStep>,
      );
      // A step with no calls is the run's last: its words are the whole answer
      thread.current = next.calls.length ? [...messages, ...next.messages] : [];
      pending.current = next.calls;
      answers.current = [];
      setCards(next.calls);
      setLine(next.text ? { text: next.text } : null);
    } catch (cause) {
      if (controller.signal.aborted) return;
      thread.current = [];
      pending.current = [];
      setCards([]);
      setLine({ text: errorToString(cause), failed: true });
    } finally {
      if (stop.current === controller) setWorking(false);
    }
  };

  const settle = (call: MemoryEditCall, output: ToolAnswer["output"]) => {
    answers.current.push({
      type: "tool-result",
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      output,
    });
    pending.current = pending.current.filter(
      (card) => card.toolCallId !== call.toolCallId,
    );
    setCards(pending.current);
    if (pending.current.length === 0) {
      void step([
        ...thread.current,
        { role: "tool", content: answers.current },
      ]);
    }
  };

  const save = async (call: MemoryEditCall) => {
    setSaving(call.toolCallId);
    const result = await applyMemoryEditAction(call).catch((cause) => ({
      isOk: false as const,
      message: errorToString(cause),
    }));
    setSaving(null);
    if (!isResultOk(result)) {
      // The card stays: nothing was written, and the user can still drop it
      setLine({ text: result.message ?? "Could not save that", failed: true });
      return;
    }
    settle(call, {
      type: "json",
      value: (result.data.output ?? null) as JSONValue,
    });
  };

  const drop = (call: MemoryEditCall) =>
    settle(call, {
      type: "execution-denied",
      reason: "The user dropped this change.",
    });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const said = draft.trim();
    if (!said || !ready || busy) return;
    setDraft("");
    setLine(null);
    setPicking(false);
    void step([{ role: "user", content: said }]);
  };

  const status = working ? (
    <ShinyText text="Working on memory" className="text-xs" />
  ) : cards.length > 0 ? (
    <span className="text-xs text-muted-foreground">
      {cards.length === 1
        ? "1 change to review"
        : `${cards.length} changes to review`}
    </span>
  ) : line ? (
    <span
      className={cn(
        "text-xs",
        line.failed ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {line.text}
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

        {cards.length > 0 && (
          <div className="flex w-full flex-col gap-1.5">
            {cards.map((call) => (
              <EditCard
                key={call.toolCallId}
                call={call}
                known={known}
                saving={saving === call.toolCallId}
                onSave={() => save(call)}
                onDrop={() => drop(call)}
              />
            ))}
          </div>
        )}

        {status && <p className="max-w-full truncate px-1">{status}</p>}

        <form
          onSubmit={submit}
          className="flex h-10 w-full items-center gap-1.5 rounded-xl bg-popover pr-1.5 pl-3.5 shadow-lg ring-1 ring-foreground/10"
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={busy}
            aria-label="Edit memory"
            placeholder={
              cards.length > 0
                ? "Save or drop the changes above"
                : "Tell memory what changed"
            }
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
            loading={working}
            disabled={!draft.trim() || !ready || busy}
            aria-label="Send"
          >
            {!working && <ArrowUp />}
          </Button>
        </form>
      </div>
    </div>
  );
}

type Change = {
  kind: "Remember" | "Replace" | "Forget" | "Rename";
  path: string;
  lines: { before?: string; after?: string }[];
  carried: boolean;
};

/** What a call will do, read off its arguments and the facts the screen already holds. */
function describe(call: MemoryEditCall, known: Map<number, KnownFact>): Change {
  const input = (call.input ?? {}) as {
    path?: string;
    factId?: number;
    description?: string | null;
    aliases?: string[] | null;
    facts?:
      | {
          text: string;
          replaces?: number | null;
          alwaysLoad?: boolean | null;
        }[]
      | null;
  };

  if (call.toolName === TOOL_NAMES.memory_forget) {
    const fact = input.factId != null ? known.get(input.factId) : undefined;
    return {
      kind: "Forget",
      path: fact?.path ?? "",
      lines: [{ before: fact?.text ?? `Fact #${input.factId}` }],
      carried: false,
    };
  }

  const facts = input.facts ?? [];
  const lines: Change["lines"] = facts.map((fact) =>
    fact.replaces != null
      ? {
          before: known.get(fact.replaces)?.text ?? `Fact #${fact.replaces}`,
          after: fact.text,
        }
      : { after: fact.text },
  );
  if (input.description) lines.push({ after: `“${input.description}”` });
  if (input.aliases?.length) {
    lines.push({
      after: `Called ${input.aliases.map((alias) => `“${alias}”`).join(", ")}`,
    });
  }
  return {
    kind: facts.some((fact) => fact.replaces != null)
      ? "Replace"
      : facts.length
        ? "Remember"
        : "Rename",
    path: input.path ?? "",
    lines,
    carried: facts.some((fact) => fact.alwaysLoad),
  };
}

const GLYPHS = {
  Remember: Plus,
  Replace: Pencil,
  Forget: Minus,
  Rename: Pencil,
} as const;

function EditCard({
  call,
  known,
  saving,
  onSave,
  onDrop,
}: {
  call: MemoryEditCall;
  known: Map<number, KnownFact>;
  saving: boolean;
  onSave: () => void;
  onDrop: () => void;
}) {
  const change = describe(call, known);
  const Glyph = GLYPHS[change.kind];
  return (
    <div className="flex w-full animate-in items-start gap-2.5 rounded-xl bg-popover py-2.5 pr-2 pl-3 shadow-lg ring-1 ring-foreground/10 duration-200 fade-in slide-in-from-bottom-1">
      <Glyph className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-0.5">
        {change.lines.map((line, at) => (
          <div key={at}>
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
      </div>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Drop"
        disabled={saving}
        onClick={onDrop}
        className="text-muted-foreground"
      >
        <X />
      </Button>
      <Button
        size="icon-xs"
        variant="secondary"
        aria-label="Save"
        loading={saving}
        onClick={onSave}
      >
        {!saving && <Check />}
      </Button>
    </div>
  );
}
