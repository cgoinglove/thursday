# Building a page

A page someone uses rather than reads: controls that keep state, a calculator, charts that
respond, a small app.

Every page is built on one kit: React 18, TypeScript, Tailwind CSS 3, shadcn/ui
(its components are in the kit's `src/components/ui`), recharts for charts and
react-markdown with remark-gfm for text. It is installed once in the workspace and
shared by every page after it. The script is in this skill's directory (the path
you were handed when you loaded it) and finds the workspace wherever you run it:

1. `node <skill dir>/scripts/app.mjs new <name>` starts the page in
   `projects/.page-kit/pages/<name>/`. The first page ever installs the kit, a
   minute or two; after that it is instant.
2. Write the page in its `src/App.tsx`, with more files beside it as it grows.
   Shared parts import as `@/components/ui/…` and `@/lib/utils`.
3. `node <skill dir>/scripts/app.mjs build <name>` makes one self-contained file,
   copies it to `<name>.html` in your folder under `artifacts/` and prints that
   path: the one you hand back. The user opens it from the thread row; the source
   is not named in the report. It opens with no network, so nothing comes from a
   CDN: fonts and images go in the page's folder and are imported.
4. To change a page later, from any job: edit its folder and build again, and the
   same file is replaced. `new` refuses a name already taken.

A library the kit lacks: `node <skill dir>/scripts/app.mjs add <package>`, and
every page can import it from then on. Keep what one page needs in its own
folder rather than in the kit's `src/`: an app update replaces those shared files.

Build it, and a build that fails names what to fix. Look at it only when asked: testing
upfront adds latency between the request and the finished file.

## Design

The page is a tool someone opens to use, and what it looks like comes from the
job it was built for — a rate calculator, a reading list and a test report
should not arrive as the same page in three colors. Before the first component,
settle four things in a line each: the palette (4-6 values), the type, the
layout, and the one element the page exists for. Skipping that is how a page
gets built out of defaults.

**Type carries a hard constraint here.** The bundle opens from disk with no
network, so a font fetched from a CDN falls back silently to whatever the
machine has. Embed the file in the bundle, or build on the system stack and
spend the personality on weight, size and spacing instead. Set a real scale, and
keep body text under about 80 characters a line.

**Spend the boldness once.** One element carries the page — the number, the
chart, the control the whole thing exists for — and everything around it stays
quiet. Structure is not decoration: a border, a divider, a numbered marker each
claim something about the content, so number a list only when it is a sequence.
Cut what claims nothing.

Some looks are defaults rather than decisions, and they turn up whatever the
page is about: everything chopped into identical rounded cards under the same
soft shadow, a tracked-out capital label above every heading, meta lines joined
with middle dots, an arrow glued to the end of button text, a gradient standing
in for a background, one centered column all the way down. None of them are
wrong — they are what gets produced when nothing was chosen. If the user asked
for one of them, that settles it: their words win over this list.

Motion answers an action — opening, expanding, confirming — and shows what
changed. Entrance animations on every section are the default look. Honor
`prefers-reduced-motion`.

Words are design too. A control says what it does ("Save changes", not
"Submit") and keeps that name wherever it appears, so a button that says Publish
leaves a message that says Published. An empty state says what to do next, and
an error says what happened and how to fix it, without apologizing.

Build to the floor without announcing it: usable down to a phone, focus visible
on the keyboard, contrast that holds.

## Reference

- **shadcn/ui components**: https://ui.shadcn.com/docs/components
