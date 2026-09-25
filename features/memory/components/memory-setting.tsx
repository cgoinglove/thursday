"use client";

import { format } from "date-fns";
import { Check, ChevronRight, Pencil, Plus, Trash2, X } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { notify } from "@/components/ui/notify";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { MEMORY_LIMITS, PAGE_SIZE } from "@/config";
import { ProviderIcon } from "@/features/ai/components/provider-icon";
import { textModelProviderSchema } from "@/features/ai/model.schema";
import { MemoryEdit } from "@/features/memory/components/memory-edit";
import {
  addFactsAction,
  createNoteAction,
  deleteNoteAction,
  forgetFactAction,
  reviseFactAction,
  updateNoteAction,
} from "@/features/memory/memory.action";
import {
  isAlwaysListed,
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
  SettingFilter,
  SettingGroup,
  SettingItems,
  SettingMore,
  SettingScreen,
  SettingSkeleton,
  SettingToolbar,
} from "@/features/settings/components/setting-ui";
import { composing } from "@/hooks/use-hotkey";
import { shortAgo } from "@/lib/date-like";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { useServerPages } from "@/lib/protocol/use-server-pages";
import { revalidate } from "@/lib/protocol/use-server-route";
import { cn } from "@/lib/utils";

const SECTIONS: { key: MemorySection; label: string }[] = [
  { key: "you", label: "You" },
  { key: "people", label: "People" },
  { key: "projects", label: "Projects" },
  { key: "topics", label: "Topics" },
  { key: "other", label: "Other" },
];

/** Every write revalidates the whole memory prefix: a fact changes the list's counts too. */
const refresh = { onOk: () => revalidate(queryKey.memory) } as const;

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
  const [filter, setFilter] = useState("");
  // By id: row objects are replaced on every revalidation.
  const [flipped, setFlipped] = useState<ReadonlySet<number>>(new Set());
  const [editing, setEditing] = useState(false);

  if (isLoading) return <SettingSkeleton />;
  if (error) return <SettingError message={error.message} />;

  // The filter only sees loaded pages, and opens every note it matched
  const needle = filter.trim().toLowerCase();
  const matches = (note: MemoryNote) =>
    [note.path, note.description, ...note.facts.map((fact) => fact.text)].some(
      (text) => text.toLowerCase().includes(needle),
    );
  const shown = needle ? notes.filter(matches) : notes;
  const flip = (id: number) =>
    setFlipped((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const facts = notes.reduce((sum, note) => sum + note.factCount, 0);
  const more = hasMore ? "+" : "";

  return (
    // The edit floats over the list, above the rail (memory-edit)
    <div className="relative h-full min-h-0">
      <SettingScreen
        footer={
          <Button
            size="sm"
            variant={editing ? "secondary" : "ghost"}
            aria-pressed={editing}
            onClick={() => setEditing(!editing)}
          >
            <ProviderMarks />
            Edit with a model
          </Button>
        }
      >
        <SettingToolbar
          count={
            <span className="flex items-center gap-3">
              {`${notes.length}${more} notes · ${facts}${more} facts`}
              <Button
                size="sm"
                variant="outline"
                className="font-sans"
                onClick={openMemoryCreate}
              >
                <Plus />
                New note
              </Button>
            </span>
          }
        >
          <SettingFilter
            value={filter}
            onChange={setFilter}
            placeholder="Filter memory"
          />
        </SettingToolbar>

        {needle && shown.length === 0 && (
          <p className="px-1 text-xs text-muted-foreground/60">
            Nothing matches
          </p>
        )}

        {SECTIONS.map(({ key, label }) => {
          const rows = shown.filter((note) => sectionOf(note.path) === key);
          if (rows.length === 0) return null;
          return (
            <SettingGroup key={key} label={label}>
              <SettingItems>
                {rows.map((note) => (
                  <NoteRow
                    key={note.id}
                    note={note}
                    // A toggle flips whatever the filter decided
                    open={flipped.has(note.id) !== Boolean(needle)}
                    onToggle={() => flip(note.id)}
                  />
                ))}
              </SettingItems>
            </SettingGroup>
          );
        })}

        <SettingMore
          hasMore={hasMore}
          loading={isLoadingMore}
          sentinelRef={sentinelRef}
          ghost={
            <div className="flex h-12 items-center gap-3 px-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-56" />
            </div>
          }
        />
      </SettingScreen>
      {editing && <MemoryEdit notes={notes} />}
    </div>
  );
}

/**
 * The first three providers stand for them all: a row of thirteen read as a list
 * to check rather than a sign. ChatGPT runs on OpenAI's mark, so it would draw the
 * same circle twice.
 */
const MARKED_PROVIDERS = textModelProviderSchema.options
  .filter((provider) => provider !== "chatgpt")
  .slice(0, 3);

/** Who a memory edit can run on, as overlapping circles. */
function ProviderMarks() {
  return (
    <span className="mr-0.5 flex items-center">
      {MARKED_PROVIDERS.map((provider) => (
        <span
          key={provider}
          className="-ml-1.5 grid size-5 place-items-center rounded-full bg-background ring-1 ring-border first:ml-0"
        >
          <ProviderIcon provider={provider} className="size-3" />
        </span>
      ))}
    </span>
  );
}

/** Enter saves, Esc puts it back — and stops here, so settings stays open. */
function editKeys(save: () => void, cancel: () => void) {
  return (event: KeyboardEvent<HTMLInputElement>) => {
    // During IME composition Enter confirms the character, not the edit
    if (composing(event)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      save();
    }
    if (event.key === "Escape") {
      event.stopPropagation();
      cancel();
    }
  };
}

function NoteRow({
  note,
  open,
  onToggle,
}: {
  note: MemoryNote;
  open: boolean;
  onToggle: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [removeNote, removing] = useServerAction(deleteNoteAction, refresh);

  const confirmRemove = async () => {
    const confirmed = await notify.confirm({
      title: `Forget ${note.path}?`,
      description: "Every fact in this note is deleted for good.",
      okText: "Delete",
      destructive: true,
    });
    if (confirmed) removeNote(note.id);
  };

  const title = (
    <span className="w-36 shrink-0 truncate text-sm font-medium">
      {noteTitle(note.path)}
    </span>
  );

  return (
    <div>
      <div className="flex h-12 items-center gap-3 pr-2 pl-4">
        {renaming ? (
          <>
            <ChevronRight className="size-3.5 shrink-0 rotate-90 text-muted-foreground" />
            {title}
            <NoteLine note={note} onDone={() => setRenaming(false)} />
          </>
        ) : (
          <>
            <button
              type="button"
              aria-expanded={open}
              onClick={onToggle}
              className={cn(
                "flex h-full min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
                // Fading notes dim instead of disappearing
                isFading(note) && !open && "opacity-55",
              )}
            >
              <ChevronRight
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground transition-transform",
                  open && "rotate-90",
                )}
              />
              {title}
              <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                {note.description}
              </span>
              <span className="w-16 shrink-0 text-right font-mono text-[11px] text-muted-foreground/70">
                {note.factCount} {note.factCount === 1 ? "fact" : "facts"}
              </span>
              <span
                className="w-10 shrink-0 text-right font-mono text-[11px] text-muted-foreground/50"
                title={note.lastReadAt ? "Last read back" : "Never read back"}
              >
                {note.lastReadAt ? shortAgo(note.lastReadAt) : "—"}
              </span>
            </button>
            {/* The same width closed, so the counts line up down the list */}
            <span className="flex w-15 shrink-0 justify-end">
              {open && (
                <>
                  {/* The app writes the root notes' line and resets it at boot */}
                  {!isAlwaysListed(note.path) && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-muted-foreground"
                      aria-label="Edit the note's line"
                      onClick={() => setRenaming(true)}
                    >
                      <Pencil />
                    </Button>
                  )}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    aria-label="Forget this note"
                    loading={removing}
                    onClick={confirmRemove}
                  >
                    {!removing && <Trash2 />}
                  </Button>
                </>
              )}
            </span>
          </>
        )}
      </div>

      {open && (
        <div className="space-y-1 border-t border-border/60 bg-muted/40 py-2.5 pr-2 pl-10">
          <AddFact noteId={note.id} />
          {note.facts.map((fact) => (
            <FactRow key={fact.id} noteId={note.id} fact={fact} />
          ))}
        </div>
      )}
    </div>
  );
}

function NoteLine({ note, onDone }: { note: MemoryNote; onDone: () => void }) {
  const [draft, setDraft] = useState(note.description);
  const [save, saving] = useServerAction(updateNoteAction, {
    onOk: () => {
      onDone();
      revalidate(queryKey.memory);
    },
  });

  const commit = () => {
    const description = draft.trim();
    if (!description || description === note.description) return onDone();
    save(note.id, { description });
  };

  return (
    <>
      <Input
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={editKeys(commit, onDone)}
        aria-label="The note's line"
        placeholder="One line Thursday sees in her list"
        maxLength={MEMORY_LIMITS.descriptionChars}
        className="h-8 min-w-0 flex-1 text-[13px]"
      />
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Save"
        loading={saving}
        onClick={commit}
      >
        {!saving && <Check />}
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Cancel"
        onClick={onDone}
      >
        <X />
      </Button>
    </>
  );
}

function AddFact({ noteId }: { noteId: number }) {
  const [draft, setDraft] = useState("");
  const [add, adding] = useServerAction(addFactsAction, {
    onOk: () => {
      setDraft("");
      revalidate(queryKey.memory);
    },
  });

  const submit = () => {
    const text = draft.trim();
    if (text && !adding) add(noteId, [text]);
  };

  return (
    <div className="flex items-center gap-1.5 pb-1">
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={editKeys(submit, () => setDraft(""))}
        aria-label="Add a fact"
        placeholder="Add a fact"
        className="h-8 min-w-0 flex-1 bg-background text-sm"
      />
      <Button
        size="sm"
        variant="outline"
        loading={adding}
        disabled={!draft.trim()}
        onClick={submit}
      >
        {!adding && <Plus />}
        Add
      </Button>
    </div>
  );
}

function FactRow({
  noteId,
  fact,
}: {
  noteId: number;
  fact: MemoryNote["facts"][number];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fact.text);
  const [revise, revising] = useServerAction(reviseFactAction, {
    onOk: () => {
      setEditing(false);
      revalidate(queryKey.memory);
    },
  });
  const [forget, forgetting] = useServerAction(forgetFactAction, refresh);

  const confirmForget = async () => {
    const confirmed = await notify.confirm({
      title: "Forget this fact?",
      description: `"${fact.text}" is deleted for good.`,
      okText: "Delete",
      destructive: true,
    });
    if (confirmed) forget(noteId, fact.id);
  };

  const save = () => {
    const text = draft.trim();
    if (!text || text === fact.text) return setEditing(false);
    revise(noteId, fact.id, text);
  };
  const source = memorySourceLabel(fact.source);

  return (
    <div className="flex min-h-10 items-center gap-1.5">
      {editing ? (
        <>
          <Input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={editKeys(save, () => setEditing(false))}
            aria-label="Fact"
            className="h-8 min-w-0 flex-1 bg-background text-sm"
          />
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Save"
            loading={revising}
            onClick={save}
          >
            {!revising && <Check />}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Cancel"
            onClick={() => setEditing(false)}
          >
            <X />
          </Button>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 pl-1 text-sm leading-relaxed text-foreground/90">
            {fact.text}
          </span>
          {/* When, and whose hand — memory is kept by three of them */}
          <span className="shrink-0 pr-1 font-mono text-[11px] text-muted-foreground/50">
            {format(fact.createdAt, "yyyy.MM.dd")}
            {source && ` · ${source}`}
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground"
            aria-label="Edit this fact"
            onClick={() => {
              setDraft(fact.text);
              setEditing(true);
            }}
          >
            <Pencil />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground"
            aria-label="Forget this fact"
            loading={forgetting}
            onClick={() => void confirmForget()}
          >
            {!forgetting && <Trash2 />}
          </Button>
        </>
      )}
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

/** Kind + name becomes the path; profile and preferences stay agent-managed. */
function openMemoryCreate() {
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
      description="Where Thursday keeps what she learns about this."
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
              onKeyDown={(event) => {
                // During IME composition Enter confirms the character, not the note
                if (event.nativeEvent.isComposing || event.keyCode === 229)
                  return;
                if (event.key === "Enter") submit();
              }}
              placeholder="One line Thursday sees in her list"
              maxLength={MEMORY_LIMITS.descriptionChars}
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
