---
paths:
  - "features/**/components/**"
  - "components/**"
  - "app/**/*.tsx"
  - "app/globals.css"
  - "hooks/**"
---

# UI

What holds on every screen. The call screen's layout is `call-screen.md` and the faces are
`faces.md`. Each look here was picked by the maintainer: a change to one is proposed, never made
on the way to something else.

## Parts

- Domain-agnostic components live in `components/ui/`: shadcn first, then the app's own (markdown,
  notify, toast, `segmented`, `shiny-text`, `site-icon`…). Check there before writing a new one.
- Settings screens are built from `features/settings/components/setting-ui` (`SettingScreen`,
  `SettingPanes`, `SettingItems`, and the skeleton and error that keep a section's padding).
- A link that leaves the app is an `<a>` wearing the button's look, `cn(buttonVariants(…))`, never a
  `Button` that renders one: Base UI gives that anchor `role="button"`, so it is no longer heard as
  a link. The `cn` is not optional — unmerged, the base's `border-transparent` beats the variant's
  border in the light theme.
- Markdown renders through `components/ui/markdown.tsx`. Confirmations and prompts are
  `notify.confirm` / `notify.prompt`, and a destructive action confirms first. A toast
  (`toast.add`) is only for what happens off-screen.
- **Esc goes to the last thing that opened, and one Esc does one thing** (`useEscape`,
  `hooks/use-hotkey`). One window listener holds the key for every layer the app draws itself; a
  dialog keeps its own. A field that wants the key calls `preventDefault`, and mid-composition the
  key belongs to the character being made. A layer that opens in steps walks back the way its own
  buttons do. A plain key a screen claims (`/`, `↓`) asks `windowKey` rather than repeating the guard.
- An icon-only button carries an `aria-label`, and usually a tooltip. A hand-made control takes
  `Button`'s focus ring (`focus-visible:ring-3 focus-visible:ring-ring/50`).
- A free field is a draft until it commits: `use-draft` on Enter or blur, a combobox on a pick or
  Save — never per keystroke, or a half-typed value lands in the database.

## Waiting and errors

- Every wait shows: a pending button takes `loading`, a list a `Skeleton` — never dots, and never
  something that appears when the wait ends and pushes the row.
- **Words for something still running shine** (`ShinyText`), the call screen included. Only what is
  not words — a dot, an icon, a bar — pulses. It takes its colour from `tone`, never a colour, and
  truncates in its own box.
- Errors are never swallowed: inline or a toast, they reach the user, in the provider's own words
  where a provider said them (`data.md`).

## Colour

- **Colour is picked by meaning; the theme picks only which step.** Every colour comes off the grey
  ladder or one of the three hues in `app/globals.css`; no call site names a raw value. The floor is
  4.5:1 for text and 3:1 for a shape or text 24px and up, measured before a colour goes in.
- **A border is never a grey of its own**: it is the ink at low opacity (`--alpha-*`), so it needs no
  second value for the dark. The ladder reads from the other end in the dark (`--gray-0` is the
  paper in both), so a surface is named once.
- **Brand blue (`--brand`) is rare, so it keeps meaning.** It is what a screen asks for
  (`Button variant="brand"`, the one round button), Thursday herself (her caption dot), and
  everything picked — a switch, a radio, a slider, a filled segment or chip, a picked card's border
  and tick. A picked row or card takes its faint wash from one constant (`PICKED_ROW`). Chips that
  may all be picked are tinted with a tick, not filled. What is not picked is a hairline or muted
  words. Blue is never a surface.
- **Other buttons are black** (`primary`): blue says what is set, black what to press. A tick that
  reports (saved, done, a key set) is black. A switch between views of one thing sets nothing and is
  a white pill (`Segmented view`, a dialog's tabs).
- **Two status colours, both warm.** `--destructive` (plain red) is what failed or is about to be
  destroyed: an error's own words with their glyph, a connector that will not connect, a key a
  provider refused, the delete button. `--waiting` (`WAITING_INK`, an ember) is whatever wants the
  user — a question, a stopped job, an answer not yet opened, a required field — as a dot on a face,
  a count, or a word with its glyph, never a button or a name. Words that want the user shine instead
  (`ShinyText tone="reading"`). Success, connected and enabled have no colour. The settings nav
  reports the same two (`NavBadge`), and the settings door wears the worst of what it opens
  (`CornerDot`). A screen that already means "this waits on you" — the ringing call — says so
  without them.
- How hard a model thinks is a value to pick like any other: one `Segmented` group
  (`effort-switch`), `auto` first, one button per step that model takes and nothing beside them.

## Taste

- **A new shape starts from this app**: drawn from its own code and screens and judged by whether it
  belongs here. A first pass from generic UI — a dark theme, letter avatars, red badges — does not.
- Groups are split by space. A hairline is for rows in a list and the edge of a pane, nothing heavier.
- An icon on a filled button is filled, not outlined.
- A trigger sits inside what it belongs to: the write button is inside the pill, not a circle
  floating beside it.
- The button that calls her carries no phone glyph; her face is a button too. Cancel is small and
  set apart (the Esc hint), never a twin of the main button.
- The app opens plainly: ascii is her face alone, with no full-screen wave and no boot curtain.
- What a first-time user reads or hears is plain, everyday English with no jargon (a key is "think
  of it as a password").
- Signing in with ChatGPT is the provider "GPT Subscription". Where models are set up it leads with
  the Vercel AI Gateway, and the other providers wait behind More as a row of marks.
- Counts, paths, ids and hints are small mono in the muted ink. Korean prose takes `break-keep`.
