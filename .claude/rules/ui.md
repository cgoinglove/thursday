---
checked: 2026-09-25
paths:
  - "{components,hooks}/**"
  - "app/globals.css"
  - "app/**/*.tsx"
  - "features/**/components/**"
  - "features/settings/**"
  - "lib/{utils,theme}.ts"
---

# Shared UI and settings

Every screen reads the same way: the same parts, one meaning per colour, and a sign for every wait.

## Start here
- `app/globals.css` — every colour token in both themes, `.inverse`, the app's keyframes.
- `components/ui/button.tsx` — the button variants and `loading`.
- `components/ui/shiny-text.tsx` — words for something still running, coloured by `tone`.
- `features/settings/components/settings.tsx` — the settings dialog: its sections and nav badges.
- `features/settings/components/setting-ui.tsx` — what every section is built from, its skeletons.
- `hooks/use-hotkey.ts` — the keys the window owns: Esc layers, `windowKey`, the call combo.
- `lib/utils.ts` — `cn`, `WAITING_INK` and the formatters screens share.

## How it fits
`components/ui` is shadcn in its Base UI style (`components.json`) plus the app's own parts. A
settings section is its domain's `*-setting.tsx`, loaded only when opened. What a section reports
is its domain's `components/*-badge.tsx`, which loads with the app: the nav draws each badge, and
`features/settings/settings.alert.ts` joins their hooks for the call screen's corner and the tab.

## Rules
- Every colour is a token from `app/globals.css`, picked by meaning: `destructive` failed, `waiting`
  wants the user, `brand` is picked or asked for, success has none — a palette class or a hex does
  not follow the theme or `.inverse`, and a hue with a second meaning stops being read.
- A link that leaves the app is an `<a>` with `cn(buttonVariants(…))`, never a `Button` rendering
  one — Base UI gives that anchor `role="button"`, so it is no longer announced as a link.
- Every wait shows: a pending button takes `loading`, a list a `Skeleton` in its rows' shape, words
  still running `ShinyText` — an unanswered click is clicked again, and late content pushes rows.
- A layer the app draws itself closes through `useEscape`, and a plain key a screen claims asks
  `windowKey` — a keydown listener of its own closes two layers on one Esc or fires while typing.
- A field that saves itself commits on Enter or blur (`useDraft`) or on a pick, never per
  keystroke — a write per keystroke stores a half-typed value.
- Deleting asks first, `notify.confirm({ destructive: true })` — one stray click destroys data.
- A dialog that opens by itself to grant something starts on cancel, `notify.confirm({ cautious:
  true })` — it opens over whatever is being typed, and the key already on its way answers it.

## Check
No suite covers this area: serve a scratch copy (AGENTS.md, Running the app), look in both themes.
