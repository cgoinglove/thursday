# A diagram to present

For a system map someone opens on its own — architecture, a workflow, a call
sequence, a data flow, a lifecycle — drawn as one offline HTML page with light
and dark themes, pan and zoom, search and export. You write a small typed JSON
spec; the archify engine in `scripts/archify` lays it out, checks it and renders
it. The page comes out the same every time, and a crossing edge or a clipped
label is caught before the user sees it. A chart of numbers is not this: that is
a mermaid block in the report.

Run the engine as `node <skill dir>/scripts/archify/bin/archify.mjs` (`archify`
below). Node is all it needs. Keep the spec in this job's scratch folder; the
page goes to `<name>.html` in your folder under `artifacts/`, which the shell
holds as `$THURSDAY_ARTIFACTS`.

## Steps

1. Pick the type from the question the diagram answers:

   | Type | For |
   |---|---|
   | `architecture` | components, services, cloud or security boundaries |
   | `workflow` | a process, approval gates, tool calls, runbooks, CI/CD |
   | `sequence` | calls in order, request lifecycles, async traces |
   | `dataflow` | pipelines, ETL, lineage, who consumes what |
   | `lifecycle` | states, retries, waiting and terminal states |

   Unsure: `archify guide "<what the diagram should answer>" --json`.

2. Read three files and no more: `scripts/archify/schemas/<type>.schema.json`,
   `scripts/archify/schemas/common.schema.json`, and one `*.<type>.json` in
   `scripts/archify/examples/`. The example gives the field shape, never the
   content: new ids, the job's own wording, its own layout. A new workflow uses
   `schema_version: 2`.

3. Write the spec before reading anything else. One clear main path, short side
   branches, few labels, at most 12 primary nodes, and
   `meta.quality_profile: "showcase"`. Start with automatic routes and labels;
   add `via`, `channelX`, `channelY` or `labelAt` only when a diagnostic asks
   for one, and one per repair.

4. Check after every edit:

   ```bash
   archify validate <type> <spec.json> --quality showcase --json
   ```

   A pass has all 9 artifact checks ok, no composition errors and no warnings.
   On a failure, change only the diagnosed `subject`, choose from
   `supportedFixes`, and run it again. When two rounds in a row leave the error
   count no lower, stop and report the diagnostics as they are: a page that did
   not pass is not handed back as done.

5. Deliver once:

   ```bash
   archify deliver <type> <spec.json> "$THURSDAY_ARTIFACTS/<name>.html" --quality showcase --json
   ```

   A non-zero exit means no new page was written, whatever else was printed.
   Hand back the path. To look at it yourself, use the `browser` skill and serve
   the folder as SKILL.md describes.

## Writing the spec

- One obvious main path; a side branch leaves the nearest node on it. Remove a
  low-value edge before reaching for routing controls.
- A relationship label carries meaning. When it collides, move it, re-route,
  then shorten the wording — deleting it to pass a check loses what it said.
- Write labels in the user's language and leave `meta.locale` out: the page's
  own buttons stay in English. Product names, commands and API paths stay as
  written.
- Leave `meta.visual_preset`, `meta.subtitle`, `meta.legend`, `meta.animation`
  and `meta.engineering_profile` out unless the user asked for that look or
  review.
- Component types are `frontend`, `backend`, `database`, `cloud`, `security`,
  `messagebus` and `external`; variants are `default`, `emphasis`, `security`
  and `dashed`.
- Brand logos are not in this copy, so leave `brand` out.
- A pasted Mermaid diagram is read for its meaning, then written fresh:
  `flowchart` becomes `workflow` (or `architecture` for a component map),
  `sequenceDiagram` becomes `sequence`, `stateDiagram` becomes `lifecycle`.

## Further detail

Read these only when a step needs them, all in `scripts/archify/references/`:
`authoring-contract.md` for field enums, spacing and geometry repair,
`delivery-contract.md` for receipts, and `viewer-runtime.md` for motion, named
views and share cards when the user asks for them.
