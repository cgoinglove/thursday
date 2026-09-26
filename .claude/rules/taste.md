---
paths:
  - "components/**"
  - "features/**/components/**"
  - "app/**/*.tsx"
  - "app/globals.css"
---

# Taste

The maintainer's picks for how the app looks and reads, one line per subject:
`**Subject**: the pick (date)`. A new pick on a subject replaces its line. A subject past the
twentieth line drops the line picked longest ago. A look changes only when the maintainer picks it.

- **New shapes**: start from this app's own code and screens, not from generic UI (a dark theme, letter avatars, red badges). (09-17)
- **Blue**: rare, and never a surface; a picked row or card takes its faint wash from `PICKED_ROW`. (09-20)
- **Buttons**: the rest are black (`primary`) — blue says what is set, black what to press; a switch between views of one thing is a white pill (`Segmented`). (09-20)
- **Borders**: the ink at low opacity (`--alpha-*`), never a grey of their own. (09-20)
- **Separation**: groups are split by space; a hairline is only for rows in a list and the edge of a pane. (09-18)
- **Icons**: an icon on a filled button is filled, not outlined. (09-18)
- **Triggers**: sit inside what they belong to — the write button is inside the pill, not beside it. (09-18)
- **Calling her**: the call button carries no phone glyph, her face is a button too, and cancel is small and set apart. (09-18)
- **Opening**: the app opens plainly — her face alone, no boot curtain. (09-19)
- **Words**: what a first-time user reads or hears is plain everyday English with no jargon. (09-19)
- **Providers**: the ChatGPT sign-in is "GPT Subscription"; model setup leads with the Vercel AI Gateway, the others behind More. (09-18)
