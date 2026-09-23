---
paths:
  - "features/thursday/field.ts"
  - "features/thursday/eyes.ts"
  - "features/thursday/ascii.const.ts"
  - "features/thursday/face*.ts"
  - "features/thursday/wash.ts"
  - "features/thursday/components/ascii-orb.tsx"
  - "features/thursday/components/face.tsx"
  - "features/thursday/components/thursday-mark.tsx"
  - "features/thursday/components/connect-wave.tsx"
  - "features/bot/mark.const.ts"
  - "features/bot/components/bot-mark.tsx"
  - "features/bot/components/crew-motion.ts"
  - "features/bot/components/write-orb.tsx"
---

# Faces

Her face and the bots' faces were each picked by the maintainer, and every file here says why at
its head. What follows is what a change must not undo.

## Hers

- **At rest she is an ember that remembers.** The field is value noise read where another noise has
  moved it (`field.ts`), never a sine: a sine repeats at an interval the eye finds and moves every
  cell in step. A cell takes a brighter value at once and decays on two clocks, so what moves leaves
  a tail, and it keeps its glyph until its brightness really moves.
- **She is a circle; what is irregular is inside her and what leaves her.** A slow noise moves her
  radius a few percent and the falloff reaches past it, so her edge scatters faint; nothing pushes
  the whole outline. What leaves her leans on a slow wind and comes apart into crumbs on their own
  clocks.
- **A ramp of emoji splits rather than shades** (`ascii.const` `emojiWeight`): alpha alone does not
  shade a shape, so the bottom rungs are the halo and fall away in size as well as alpha, and
  everything from the body up is simply there.
- **Her eyes belong to resting** (`eyes.ts`). At a noisy interval the body closes and two eyes open
  and run one of a few scripts; they shut before anything else comes up. The pair sits where the bot
  marks put it and only the lens scales. The lid opens and closes them — the lens grows from a slit
  and returns to one — and the outline never wobbles. Opening her eyes changes nothing else about her.
- Every screen draws her small through `thursday-mark`, the orb in miniature: glyphs keep one size,
  so a bigger box holds more of them. Only the browser tab keeps the bot-style mark
  (`THURSDAY_SEED`).
- The one full-screen wave (`connect-wave`) belongs to a call picking up and to nothing else.

## The bots'

- **A bot draws with the face picked on its page, everywhere.** The stored colour is the user's and
  never changes; the light theme draws the too-light ones as a darker twin (`markInk`). A mark varies
  only by state, never by thread or place: one waiting dot while anything of its wants the user (a
  question, a stop, an unopened result alike), crossed-out eyes on a thread the user stopped. Faces
  do not dim while others work; the lift of the one moving says who is.
- A face is up while its own bot's row is running or queued (`room.participants`), never because its
  thread is working.
- **A face answers what happens to its bot with one gesture, and `crew-motion` is the whole
  vocabulary**: which gesture each event gets, how long it runs, and which layer it takes (the body
  through the air, the shape pressing, the turn). One gesture at a time per face; a second starts
  over. A gesture is a moment and a dot a state, so the dot outlives it. Nothing moves that nothing
  happened to, and at rest every face breathes on its own phase.
- **The pill's "+" turns to smoke while the write line is up** (`write-orb`): one hue walked from
  `--brand` in three tones, carried left to right at a pace that breathes, painted per pixel from
  value noise with no library, keeping its box so the pill is the same pill. It stands still for
  anyone who asked for less motion. Its numbers were read off frames the maintainer brought.
