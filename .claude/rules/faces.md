---
paths:
  - "features/thursday/field.ts"
  - "features/thursday/smoke.ts"
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

- **At rest she is smoke, and so is whatever leaves her** (`smoke.ts`). Her light is value noise
  read where another noise has moved it (`field.ts`), never a sine of her radius: a sine repeats at
  an interval the eye finds, moves every cell in step, and rings going out read as waves on water.
  For the same reason her plume runs each direction at a phase of its own and a gust reaches each
  way at its own moment. A cell takes a brighter value at once and decays on two clocks, the tail
  short and light so it trails without inking her, and keeps its glyph until its brightness really
  moves.
- **She is a circle; what is irregular is inside her and what leaves her.** She is solid to half her
  radius and soft past it, a faint uneven haze runs out past her rim, and the wind that bends what
  leaves her is calm most of the time and gusts for a moment; it moves her rim a hair, never her
  outline.
- **A ramp of emoji splits rather than shades** (`ascii.const` `emojiWeight`): alpha alone does not
  shade a shape, so the bottom rungs are the halo and fall away in size as well as alpha, and
  everything from the body up is simply there.
- **Her eyes belong to resting** (`eyes.ts`). At a noisy interval two eyes open and run one of a few
  scripts; they shut before anything else comes up. The pair sits where the bot marks put it and
  only the lens scales. The lid opens them level — the lens grows from a slit — and the outline
  never wobbles. They shut as she falls asleep: quickly and then creeping, her gaze lowering a
  little, the lids meeting below the middle, her smoke drawn in and her light dimmed for a moment.
- **What her eyes do to her smoke** (`smoke.ts`). As they part she lets out a sigh to one lower
  side, made of her: as dense as she is where it leaves her, thinning as it goes, ragged, gone in
  about two seconds, and the plume it blows through thickens behind its front, never all at once.
  After the sigh, not with it, her smoke grows thick and far-reaching while they stay open, and goes
  back as they shut. Her body itself neither grows nor brightens.
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
