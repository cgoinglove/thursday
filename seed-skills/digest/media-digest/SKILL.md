---
name: media-digest
description: "Long things made short: a YouTube video, a podcast, a talk, an article or a PDF read into a file with its timestamps or pages, searched for what matters, summarized in passes, and handed back as a spoken-style answer, a page with clickable moments, or audio to listen to. Also finds the videos worth watching on a topic."
---

# Media digest

Every script is `node <this skill's dir>/scripts/<name>.mjs`, needs no key and prints a few
lines; the text itself goes to a file. Chain them with `&&` in one bash call.

```bash
S=<this skill's dir>/scripts
node $S/yt.mjs transcript <url|id>... --out <scratch>          # <id>.txt + <id>.json per video, ~1 s each
node $S/yt.mjs search "<query>" --within month --length long --out <scratch>/rows.json
node $S/text.mjs <article url | pdf url | file.pdf> --out <scratch>/<name>.txt
node $S/part.mjs <file> <n>                                     # part n of a long file, one read
node $S/audio.mjs cut <url|file> --out <scratch>/audio          # no captions: pieces to transcribe
node $S/digest.mjs <digest.json> --name <page>                  # the page, in your artifacts folder
```

Two facts decide the work:

- **One bash call shows 8,000 characters; the rest is cut.** So every file these scripts
  write is split into `## Part N` blocks that each fit one read, and the head they print says
  how many. One part per bash call — two in one call are cut — and the calls for several
  parts sent together in one step. A question about one thing is `grep -n -i` on the file first, then only the parts
  that hit; a summary reads every part. How: `references/reading.md`.
- **A timestamp is only worth giving when it comes from the file.** Each transcript line
  starts with `[m:ss]`; cite that time, never one worked out. `~` marks an estimated one.

`references/page.md` is the page's JSON and how an answer is shaped; `references/no-captions.md`
is a video or podcast with no transcript.
