# Designer's kit

One skill the Designer seed is born with, copied into `.agents/skills/` in its own folder when it
is created. It is listed to that bot alone.

| Skill | What it adds |
|---|---|
| `design-canvas` | `canvas.mjs`, which writes one HTML file holding a pan/zoom surface, a board per option and a note per board, and shoots every board to a picture of its exact size through the shipped `browser` skill's `render.mjs` |

Written for this app. The shape — options side by side on one surface, each with the axis it
explores and what it costs, the leading one marked — follows how design options are compared
generally; no code or text is copied from any other tool.

The canvas is one self-contained file: no network, no build, light and dark, and it opens fitted
because the app draws a page 1024px wide without scrolling it. The pictures need a browser already
open in the job, which the shipped `browser` skill provides.
