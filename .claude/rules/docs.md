---
paths:
  - "README.md"
  - "README.ko.md"
  - "docs/how-it-works.md"
  - "docs/images/**"
  - "guide/**"
---

# README, public docs and the guide

- **The README is a landing page** for someone who just arrived, as short as a well-known AI
  open-source project's: hero, a quick start in one block, each feature as a short text with an
  image, a short list, the FAQ in `<details>`, links. Anything longer goes to `docs/how-it-works.md`.
- `README.ko.md` changes with `README.md`, in the same structure — the one translated file in the tree.
- Screenshots are `<picture>` light/dark pairs (`*-light.png`, `*-dark.png`). The README links images
  by absolute raw.githubusercontent URL, because it also ships in the npm package; `how-it-works.md`
  links them relatively.
- **The text names no seed bot and counts none** ("starter bots", "a bot"): seeds are renamed, dropped
  and switched off, and a name in the text soon lies. Images show real seed faces and names, but no
  value that moves, such as a connector count or a tool name.
- **`guide/` is for the person using the app, read aloud by Thursday** (`features/ai/guide.ts` installs
  it). It says what the user sees — screens, settings, labels as the screen writes them — never code,
  files or internals, and `index.md` says which file answers what. A change the user would notice
  updates it in the same commit, and a guide that describes a screen the app no longer has is
  answered with confidence.
