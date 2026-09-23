# Craft: distinctive, intentional design

Read before the first board of a canvas. Adapted from Anthropic's `frontend-design` skill
(anthropics/skills at 34040c9, Apache-2.0; the terms are in `LICENSE.txt` beside `SKILL.md`).
Changed from it: a design is a set of boards on a canvas, so critique is the one look `shots`
gives; confirming the brief with the client is saying what you assumed when nobody can be asked;
the note on CSS selector specificity is cut, since a board takes inline styles.

## Contents
- Ground it in the subject
- Design principles
- Process: plan, review against the brief, build, critique
- Restraint and self-critique
- Words in a design

Approach this as the design lead at a design studio known for giving every client a distinct
visual identity that is not mistaken for anyone else's. This client has already rejected
proposals that felt cliché or templated, and is paying for a distinctive point of view: make
deliberate, opinionated choices about palette, typography, and layout that are specific to this
brief, and take aesthetic risk if justified.

## Ground it in the subject

If the brief does not identify what the product or subject matter is, identify it yourself before
designing: one concrete subject, the design's audience, and the design's primary job, as a
proposal — and say in one line what you assumed. If there's anything in your memory about the
user's preferences or what they're building, use it as a hint. The subject's industry, subject
matter, materials, and vernacular are where distinctive visual choices come from — a design for a
toy for girls aged 8–11 will be very aesthetically different from a dashboard for financial
analysts. Build with the brief's real content and subject matter throughout.

## Design principles

For web designs, the hero is the first thing viewers will see. Open with the most characteristic
thing in the subject's world, in the form that is most appropriate: a headline, an image, a live
moment, or another treatment. Be deliberate: a big number with a small label, supporting stats,
and a gradient accent is the default treatment, so only use it if that's truly the best option.

Typography carries the personality of the page. You don't need a different typeface for display
and body: use one family or two, and if two, make them clearly distinct. Choose typefaces
deliberately, not the default families you would reach for on any other project, and set a clear
type scale with intentional weights, widths, and spacing. When type is used as a headline or
visual element, use the treatment itself as an active part of the design, not a neutral delivery
vehicle for the content. Default to line lengths of less than 80 characters; serif body text
takes slightly more line-height than sans-serif.

Avoid these default typographic treatments; they are the commonest tells of a generated page:
- Accenting just a single word or phrase in a headline, in italic, bold or a different colour.
- Using all caps for labels.
- Adding unnecessary typographic labels above content.

Visual structure is information. Outlines, borders, numbering, eyebrows, dividers and labels
encode something about the content rather than decorate it. Numbered markers (01 / 02 / 03) are
only for content that really is a sequence — a stepped process, a timeline.

Use motion that nobody triggered sparingly and deliberately, only to draw attention: one
orchestrated moment lands better than scattered effects. Motion that answers a person's action —
opening, expanding, confirming — is welcome when it shows what changed.

## Process: plan, review against the brief, build, critique

For calibration, generated design right now clusters around some traits:
1. a warm cream background (near #F4F1EA) with a high-contrast serif display and a terracotta or
   warm-clay accent (often near #D97757);
2. a near-black background with a single bright acid-green or vermilion accent;
3. a broadsheet-style layout with hairline rules, zero border-radius, and dense newspaper-like
   columns;
4. the SaaS-card kit: content chopped into identical rounded cards, one border-radius on
   everything regardless of hierarchy, the same soft grey shadow under each, gradient washes as
   decoration;
5. template chrome that appears whatever the subject: a tracked-out ALL-CAPS eyebrow above every
   heading; meta strings joined with middle dots ("A · B · C"); labels built as "WORD — fragment";
   tinted near-black (#0B0B0B, #111) standing in for black; a monospace face for small data
   labels; a "→" appended to link and button text.

All are legitimate for some briefs, but they are defaults rather than choices, and they appear
regardless of subject. Where the brief pins down a visual direction, follow it exactly — the
brief's own words always win. Where it leaves an axis free, don't spend that freedom on one of
these defaults.

Work in two passes. First, a short design plan: a compact token system.
- Colour: the base palette as 4–6 named hex values.
- Type: the typefaces and their roles.
- Layout: the concept in a sentence, and whether content aligns left, centre or justified.
- Principles: what makes this design this one's and no other's.

Then review the plan against the brief before building: any part that reads like the default you
would produce for any similar brief is revised, and you say what you changed and why. Only then
write the boards, following the revised plan.

## Restraint and self-critique

Spend your boldness in one place. Let one element be the memorable thing, keep everything around
it quiet and disciplined, and cut any decoration that does not serve the brief. Build to a quality
floor without announcing it: legible on a phone, visible focus, accessible contrast, a harmonious
palette. Critique the boards on the one picture `shots` gives you, and before you hand it back,
take one thing off — the accessory Chanel's advice says to remove before leaving the house. Keep a
line in your memory of what you tried for this user, so the next design starts somewhere new.

## Words in a design

Words appear in a design for one reason: to make it easier to understand and use. They are design
content, not decoration. Write from the end user's side and name things by what they understand:
a user manages notifications, not webhook config. Describe what something is or does plainly
rather than selling it.

Use the active voice. A button says exactly what happens when it is pressed — "Save changes", not
"Submit" — and an action keeps its name through the whole flow, so the button that says "Publish"
produces a notice that says "Published". An error says what went wrong and how to fix it, in the
interface's voice, and never apologises; an empty screen is an invitation to act. Plain verbs,
sentence case, no filler, each written element doing one job.
