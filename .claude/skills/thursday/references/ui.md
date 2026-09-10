# Screens

Settings sections, the task room, and the two file screens. Read this before adding or changing a
screen. Domain-agnostic components are shadcn (`components/ui/`) — check there before writing one.

- **Settings screens live in their domain** (`features/<d>/components/<d>-setting.tsx`).
  `features/settings/` holds only the shell (nav, dialog) and shared setting grammar. The shell
  gives a section the space under the header; the section fills it and draws its own scroll area,
  so it picks a width and ends in a rail:
  - **One column** (`SettingColumn`, centred, 880) carries the section title, a list body, the
    skeleton and the rail's words — the same on every section, so nothing moves when the section
    changes. A per-section width was tried and reverted: it moved the title and the skeleton on
    every switch, which reads as three designs rather than one.
  - **What is a surface fills the section instead**: a reader's panes (`SettingPanes` — Memory,
    Bots, Workspace) and every rail's rule go edge to edge. Both panes reach the bottom edge, so
    nothing clips, and the rail below them is the section's, not a pane's.
  - **A section waits in the shape it arrives in.** `SettingSkeleton` is the column's;
    `SettingPanesSkeleton` is the panes', built out of `SettingPanes` so the two cannot drift.
    Both waits use it — the section's own read and the chunk (`lazySection`'s second argument) —
    or opening one section draws two layouts. Neither belongs in a dialog: a dialog has its own
    padding, so it waits as plain `Skeleton` lines shaped like what is coming.
  - `SettingRail` is the bottom edge of every section: what the whole set is, plus the actions
    that act on all of it. It also gives a short section a bottom, so the empty half of a tall
    dialog reads as margin rather than a truncated page. **What cannot be undone is not a rail
    action**: the rail is on screen the whole time a section is open, so a wipe sits at the foot
    of the body as a `Danger zone` group and is reached by scrolling to it (Thursday's Reset
    history). A panes section has no body to put one in, so its rail keeps that action
    (Workspace's Empty scratch).
  - **Every list in a section body is the same card** (`SettingItems`), however long it runs:
    Tasks was a full-bleed log of dividers and read as a different app one nav row over.
    Dividers-only belongs where there is already a surface — a reader's pane, a dialog.
    A group label (`SettingGroup`) is plain text above its card, never a tinted band.
  - **`SettingGroup` is the only shape a section is built from**: a header line (label, its
    `hint`, a `filter`, and the set's state at the far end), a body, and a `note` under it —
    never that markup written out by hand. A switch that runs something by itself is
    `SettingToggle`; a line that qualifies a body is `SettingNote`.
  - **One spacing rhythm, set in `setting-ui.tsx` and nowhere else**: 32px between groups, 12px
    from a label to its body, 8px from a body to the note about it. What reads as cramped is the
    ratio, not the numbers — a group 20px from its neighbour and 8px from its own label leaves
    the label floating between two cards instead of belonging to one.
  - A row's second line is its state, not a second name for it, and stays tight; a sentence that
    wraps gets its own leading. Any list that grows carries a `SettingFilter` — on its group's
    header line when it filters that group, on the section's (`SettingToolbar`) when it filters
    more than one. Cmd+K focuses it, Cmd+1..9 jump sections, arrows move inside the nav.
- **Artifacts and Workspace are two sections because they answer two questions.** Artifacts
  (`features/artifact`) lists **the top of `artifacts/` only, one entry per row** — which is
  already how the bots file things: a skill writes `artifacts/<name>.html`, a job that makes a set
  writes `artifacts/<name>/`. So the folder is the index; nothing is recorded, and no artifact is
  attributed to a job. The menu is flat and newest-first, and **a folder does not open into another
  listing** — it opens as a sheet of what it holds, which is what a set of pictures is for.
  Navigating a tree, and everything a bot wrote that is not finished work, is Workspace's. Both
  open files through the same `FilePreview`, so the caps below hold in both.
- **`file-kind.ts` decides what the Workspace section shows.** A file's `viewKindOf` says how the
  screen opens it *and* whether it is listed at all — a kind of `none` is never listed — and
  `isListedFolder` says the same for folders: hidden ones and what a package manager installs are
  machinery, not work. Giving an extension a kind puts it on that screen; taking one away removes it.
- **Nothing in the Workspace section is recursive.** A folder's size is every file under it, and a
  bot that ran one `pnpm install` puts 16,000 of them in the tree — so no folder is measured and
  no total is summed. One `readdir` per folder, one `stat` per file actually drawn, capped at
  `WORKSPACE_VIEW.rows` with the rest behind Show more, so a folder of twenty and a folder of
  twenty thousand cost the same. Only files carry a size, because one `stat` is free. `du`
  questions go to Reveal folder. What the browser is handed is capped the same way
  (`WORKSPACE_VIEW.textMax` / `elementMax`): text arrives as a Range and says it is a head, and an
  image or page past the cap is not drawn at all — an `<img>` decodes whole and a dead tab
  explains nothing. Audio and video are uncapped; they stream.

## The task room

- **A memory edit draws its writes as they happen** (`memory/components/memory-edit`). One floating
  panel of rows, one per tool call: a spinner while the call streams and runs, a plain check once
  it has written (success carries no color), red only for a write that failed. Opening a note is a row too, with no text but its path, and never counts toward "changes saved". The working line is
  `ShinyText`, the send button's spinner is the button's own `loading`, and a clean run's rows
  clear a moment later while a failed one stays until the next send. The float never shifts the
  panes under it.
- **A task's thread is a room its own bot owns** (`bot-room.tsx` `Conversation`). That bot holds the
  left; everyone it talks to — Thursday, and any bot it delegated to — answers from the right, and
  one 80% cap sits on the turn's column so an answer and a one-line remark end on the same edge.
  A bot arriving is a centred system line (`Invite`), drawn once, where an `ask` first names it —
  not an arrow on somebody's message, and never on the way back: after that the side and the face
  say who is speaking, the way a group chat does. **The answer is not a card**: it is already inside
  a thread inside a section, and a third border reads as a second chat window. What tells it from a
  passing remark is that it is the only prose there at foreground weight, plus the files it names.
  Who was in the room is `rosterOf` — derived from the lines, never a table.
- **An ending is seen when the user opens it** (`task.seen`): its thread in the room in the call
  screen's corner, or its row expanded in Settings › Tasks (task.store `useSeenOnDetail`) — or a
  cancel, which whoever cancelled has already seen. A list scrolled past does not count, and neither
  does Thursday saying it: hearing a line is not reading the answer, and a line sent as the call closes
  is not heard at all. Until it is opened it is owed, like a question: amber in the nav count and on
  the room's pill ("1 new answer"), red when it failed, and a pill with one thing owed opens straight
  into it. The inbox carries only the latest `INBOX_FINISHED` endings, so the badge owes at most that
  many and each has a row right there; an older one leaves the badge and stays unread in Tasks.
- **The call log says what became of a job** (`call-log` `jobOf`): under the `delegate` line that
  opened it, the job's status and answer as they stand now, found by label the same way her prompt
  finds it (`tool-line` `delegatedLabel`). Nothing is written for it — the task row is the record.
