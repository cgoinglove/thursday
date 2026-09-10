"use client";

import { format, formatDistanceToNowStrict } from "date-fns";
import { Check, Pencil, Pin, Plus, Trash2, X } from "lucide-react";
import { Fragment, useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { notify } from "@/components/ui/notify";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PAGE_SIZE } from "@/config";
import {
  addFactsAction,
  createNoteAction,
  deleteNoteAction,
  forgetFactAction,
  reviseFactAction,
  setFactAlwaysLoadAction,
  updateNoteAction,
} from "@/features/memory/memory.action";
import {
  isFading,
  type MemoryNote,
  type MemorySection,
  memorySourceLabel,
  noteTitle,
  sectionOf,
} from "@/features/memory/memory.schema";
import {
  SettingDialogContent,
  SettingError,
  SettingMore,
  SettingPanes,
  SettingPanesSkeleton,
} from "@/features/settings/components/setting-ui";
import { useDraft } from "@/hooks/use-draft";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { useServerPages } from "@/lib/protocol/use-server-pages";
import { revalidate } from "@/lib/protocol/use-server-route";
import { cn } from "@/lib/utils";

const SECTIONS: { key: MemorySection; label: string }[] = [
  { key: "you", label: "You" },
  { key: "people", label: "People" },
  { key: "projects", label: "Projects" },
  { key: "topics", label: "Topics" },
  { key: "inbox", label: "Inbox" },
];

export function MemorySetting() {
  // Order comes from the server; re-sorting arrived pages would shift the list.
  const {
    items: notes,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    sentinelRef,
  } = useServerPages<MemoryNote>({
    key: (index) => queryKey.memoryPage(index * PAGE_SIZE),
  });
  // Track the pick by id: row objects are replaced on every revalidation.
  const [pickedId, setPickedId] = useState<number | null>(null);
  const picked = notes.find((note) => note.id === pickedId) ?? notes[0] ?? null;

  if (isLoading) return <SettingPanesSkeleton />;
  if (error) return <SettingError message={error.message} />;

  return (
    <SettingPanes
      footer={picked && <NoteReadLog note={picked} />}
      left={
        <div className="flex flex-col py-2">
          <button
            type="button"
            onClick={openMemoryCreate}
            className="mx-2 mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-muted-foreground outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
          >
            <Plus className="size-3.5 shrink-0" />
            New note
          </button>

          {SECTIONS.map(({ key, label }) => {
            const rows = notes.filter((note) => sectionOf(note.path) === key);
            if (rows.length === 0) return null;

            return (
              <Fragment key={key}>
                <span className="px-3 pt-3 pb-1 font-mono text-[10px] text-muted-foreground/60">
                  {label}
                  {key === "inbox" && (
                    <span className="pl-1.5 text-muted-foreground/50">
                      waiting to be filed
                    </span>
                  )}
                </span>
                {rows.map((note) => (
                  <NoteLink
                    key={note.id}
                    note={note}
                    active={note.id === picked?.id}
                    onPick={() => setPickedId(note.id)}
                  />
                ))}
              </Fragment>
            );
          })}
          <SettingMore
            hasMore={hasMore}
            loading={isLoadingMore}
            sentinelRef={sentinelRef}
            count={3}
            ghost={
              <div className="mx-2 flex items-center gap-2 px-2 py-2">
                <Skeleton className="h-3 w-28" />
                <span className="flex-1" />
                <Skeleton className="h-2.5 w-2.5" />
              </div>
            }
          />
        </div>
      }
      right={
        picked ? (
          // Keyed so editing state does not carry over to the next note.
          <NotePage key={picked.id} note={picked} />
        ) : (
          <div className="space-y-4 p-8">
            <p className="text-sm leading-relaxed text-muted-foreground">
              During calls Thursday saves what it picks up — that a teammate
              moved teams, that you take meetings in the morning — and reads it
              back before answering. File the first note yourself and it starts
              the next call already knowing something.
            </p>
            <Button variant="outline" onClick={openMemoryCreate}>
              <Plus />
              Add note
            </Button>
          </div>
        )
      }
    />
  );
}

/** How often the open note was read back. It is the section's rail, not a bar inside the pane. */
function NoteReadLog({ note }: { note: MemoryNote }) {
  const carried = note.facts.filter((fact) => fact.alwaysLoad).length;
  return (
    <>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
        {note.path} · {note.hits} {note.hits === 1 ? "read" : "reads"} ·{" "}
        {note.lastReadAt
          ? `last read ${formatDistanceToNowStrict(note.lastReadAt, {
              addSuffix: true,
            })}`
          : "never read back"}
      </span>
      {carried > 0 && (
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">
          {carried} carried into every call
        </span>
      )}
    </>
  );
}

function NoteLink({
  note,
  active,
  onPick,
}: {
  note: MemoryNote;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        "mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
        active
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        isFading(note) && !active && "opacity-55",
      )}
    >
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[13px]",
          active && "font-medium",
        )}
      >
        {noteTitle(note.path)}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">
        {note.factCount}
      </span>
    </button>
  );
}

/** Every write revalidates the whole memory prefix: a fact changes the index too. */
function NotePage({ note }: { note: MemoryNote }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const noteOptions = { onOk: () => revalidate(queryKey.memory) } as const;
  const [editDescription] = useServerAction(updateNoteAction, noteOptions);
  const [addFacts] = useServerAction(addFactsAction, noteOptions);
  const [reviseFact] = useServerAction(reviseFactAction, noteOptions);
  const [forgetFact] = useServerAction(forgetFactAction, noteOptions);
  const [setAlwaysLoad] = useServerAction(setFactAlwaysLoadAction, noteOptions);
  const [removeNote, removing] = useServerAction(deleteNoteAction, noteOptions);

  const submitDraft = async () => {
    const lines = draft
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    await addFacts(note.id, lines);
    setDraft("");
  };

  const confirmRemove = async () => {
    const confirmed = await notify.confirm({
      title: `Forget ${note.path}?`,
      description: "Every fact in this note is deleted for good.",
      okText: "Delete",
      destructive: true,
    });
    if (confirmed) removeNote(note.id);
  };

  return (
    <div
      className={cn(
        "flex min-h-full flex-col",
        // Fading notes dim instead of disappearing.
        isFading(note) && "opacity-55",
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-6 py-2.5">
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {note.path}
        </span>
        <span className="flex shrink-0 gap-1">
          <Button
            size="icon-sm"
            variant={editing ? "secondary" : "ghost"}
            aria-label={editing ? "Done editing" : "Edit this note"}
            onClick={() => setEditing(!editing)}
          >
            {editing ? <Check /> : <Pencil />}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Forget this note"
            loading={removing}
            onClick={confirmRemove}
          >
            <Trash2 />
          </Button>
        </span>
      </div>

      <div className="flex-1 space-y-5 px-6 py-5">
        <div className="space-y-1.5">
          <p className="text-xl font-semibold">{noteTitle(note.path)}</p>
          {editing ? (
            <DescriptionRow
              text={note.description}
              onCommit={async (description) => {
                await editDescription(note.id, { description });
              }}
            />
          ) : (
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {note.description}
            </p>
          )}
        </div>

        {editing ? (
          <div className="space-y-2">
            {note.facts.map((fact) => (
              <FactRow
                key={fact.id}
                text={fact.text}
                alwaysLoad={fact.alwaysLoad}
                onRevise={async (text) => {
                  await reviseFact(note.id, fact.id, text);
                }}
                onCarry={async (next) => {
                  await setAlwaysLoad(note.id, fact.id, next);
                }}
                onForget={async () => {
                  await forgetFact(note.id, fact.id);
                }}
              />
            ))}

            <div className="flex gap-2 pt-1">
              {/* Enter files it; Shift+Enter starts another line */}
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitDraft();
                  }
                }}
                placeholder="Add facts — one per line"
                className="min-h-9 resize-none py-1.5 text-sm"
              />
              <Button
                size="icon"
                variant="outline"
                disabled={!draft.trim()}
                onClick={submitDraft}
              >
                <Plus />
              </Button>
            </div>
          </div>
        ) : note.facts.length === 0 ? (
          <p className="text-xs text-muted-foreground/70">
            Nothing saved here yet — the agent adds facts during calls
          </p>
        ) : (
          <ul className="divide-y divide-border/60 border-y border-border/60">
            {note.facts.map((fact) => (
              <li key={fact.id} className="flex gap-3 py-3">
                <span className="flex w-3.5 shrink-0 justify-center pt-1">
                  {fact.alwaysLoad ? (
                    <Pin className="size-3 text-foreground" />
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </span>
                <span className="flex-1 text-sm leading-relaxed text-foreground/90">
                  {fact.text}
                </span>
                {/* When, and whose hand — memory is kept by four of them */}
                <span className="shrink-0 pt-0.5 text-right text-[11px] text-muted-foreground/50">
                  <span className="block font-mono">
                    {format(fact.createdAt, "yyyy.MM.dd")}
                  </span>
                  {memorySourceLabel(fact.source) && (
                    <span className="block">
                      {memorySourceLabel(fact.source)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DescriptionRow({
  text,
  onCommit,
}: {
  text: string;
  onCommit: (text: string) => Promise<void>;
}) {
  const draft = useDraft(text, onCommit);
  return (
    <Input
      value={draft.value}
      onChange={(e) => draft.set(e.target.value)}
      onBlur={draft.commit}
      onKeyDown={draft.onKeyDown}
      placeholder="One-line summary"
      className="text-sm text-muted-foreground"
    />
  );
}

/** The alwaysLoad cap is enforced server-side; a refusal arrives as a toast. */
function FactRow({
  text,
  alwaysLoad,
  onRevise,
  onCarry,
  onForget,
}: {
  text: string;
  alwaysLoad: boolean;
  onRevise: (text: string) => Promise<void>;
  onCarry: (next: boolean) => Promise<void>;
  onForget: () => Promise<void>;
}) {
  const draft = useDraft(text, onRevise);

  return (
    <div className="flex gap-2">
      <Input
        value={draft.value}
        onChange={(e) => draft.set(e.target.value)}
        onBlur={draft.commit}
        onKeyDown={draft.onKeyDown}
        className="text-sm"
      />
      <Button
        size="icon"
        variant={alwaysLoad ? "secondary" : "ghost"}
        aria-label={
          alwaysLoad ? "Stop carrying into calls" : "Carry into every call"
        }
        title="Carried into every call, without opening this note"
        onClick={() => onCarry(!alwaysLoad)}
      >
        <Pin className={cn(!alwaysLoad && "text-muted-foreground/60")} />
      </Button>
      <Button size="icon" variant="ghost" onClick={onForget}>
        <X />
      </Button>
    </div>
  );
}

const NOTE_KINDS = [
  {
    key: "people",
    label: "Person",
    placeholder: "jihoon",
    fact: "Moved to the platform team in March",
  },
  {
    key: "projects",
    label: "Project",
    placeholder: "thursday",
    fact: "Ships behind a feature flag until April",
  },
  {
    key: "topics",
    label: "Topic",
    placeholder: "scheduling",
    fact: "No meetings before 10am",
  },
] as const;

/** Kind + name becomes the path; profile and inbox stay agent-managed. */
export function openMemoryCreate() {
  return notify.component({
    className: "sm:max-w-lg",
    renderer: ({ close }) => <MemoryCreate onDone={close} />,
  });
}

function MemoryCreate({ onDone }: { onDone: () => void }) {
  const [kind, setKind] =
    useState<(typeof NOTE_KINDS)[number]["key"]>("people");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [facts, setFacts] = useState("");

  // Errors render inline; the form stays open.
  const [create, busy, , error] = useServerAction(createNoteAction, {
    errorMessage: false,
    onOk: () => {
      revalidate(queryKey.memory);
      onDone();
    },
  });

  const active = NOTE_KINDS.find((entry) => entry.key === kind);
  const canSubmit = name.trim() && description.trim() && !busy;

  const submit = () => {
    if (!canSubmit) return;
    create(
      `${kind}/${name.trim()}`,
      description.trim(),
      facts
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    );
  };

  return (
    <SettingDialogContent
      title="New note"
      description="Where the agent files what it learns about this subject."
      footer={
        <>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} loading={busy} onClick={submit}>
            {!busy && <Plus />}
            Create
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <Field>
          <FieldLabel>Kind</FieldLabel>
          <Tabs
            value={kind}
            onValueChange={(value) => setKind(value as typeof kind)}
          >
            <TabsList className="w-full">
              {NOTE_KINDS.map((entry) => (
                <TabsTrigger key={entry.key} value={entry.key}>
                  {entry.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </Field>

        <Field>
          <FieldLabel htmlFor="note-name">Name</FieldLabel>
          <FieldContent>
            <Input
              id="note-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={active?.placeholder}
              spellCheck={false}
              required
            />
            <p className="font-mono text-[11px] text-muted-foreground">
              {kind}/{name.trim() || "…"}
            </p>
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel htmlFor="note-summary">Summary</FieldLabel>
          <FieldContent>
            <Input
              id="note-summary"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && submit()}
              placeholder="One line the agent sees in its note list"
              required
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel htmlFor="note-facts">Facts</FieldLabel>
          {/* A note with no facts tells the agent nothing, so file them together */}
          <Textarea
            id="note-facts"
            value={facts}
            onChange={(event) => setFacts(event.target.value)}
            placeholder={`One per line\n${active?.fact ?? ""}`}
            className="min-h-24 resize-none text-sm"
          />
        </Field>
      </div>

      {error && <p className="font-mono text-xs text-destructive">{error}</p>}
    </SettingDialogContent>
  );
}
