---
name: media-digest
description: "Reads anything long — a video, podcast, talk, article or PDF — and hands it back short. Use it when the user points at one and asks what is in it, or which videos on a topic are worth watching."
---

# Media digest

Every script is `node <this skill's dir>/scripts/<name>.mjs`, needs no key and prints a few
lines; the text itself goes to a file. Chain them with `&&` in one bash call.

```bash
S=<this skill's dir>/scripts
node $S/yt.mjs transcript <url|id>... --out <scratch> [--lang ko]   # <id>.txt + <id>.json per video
node $S/yt.mjs search "<query>" [--within hour|day|week|month|year] [--length short|medium|long] [--sort relevance|views|date] [--max 20] --out <scratch>/rows.json
node $S/text.mjs <article url | pdf url | file.pdf> --out <scratch>/<name>.txt
node $S/part.mjs <file> <n>                                         # part n of a long file, one read
node $S/audio.mjs cut <url|file> --out <scratch>/audio [--minutes 10]   # no captions: pieces to transcribe
node $S/digest.mjs <digest.json> --name <page>                      # the page, in your artifacts folder
```

Two facts decide the work:

- **One bash call shows 8,000 characters; the rest is cut.** So every file these scripts
  write is split into `## Part N` blocks that each fit one read, and the head they print says
  how many. One part per bash call — two in one call are cut — and the calls for several
  parts sent together in one step. A question about one thing is `grep -n -i` on the file first, then only the parts
  that hit; a summary reads every part. How: `references/reading.md`.
- **A timestamp is only worth giving when it comes from the file.** Each transcript line
  starts with `[m:ss]`; cite that time, never one worked out. A `~` marks a time estimated
  from where the words fall in a piece of audio; cite it with the `~`, which still opens the
  source at that second.

YouTube is read with yt-dlp, which the first `yt.mjs` or `audio.mjs` call fetches into
`projects/` once (~50 MB); after that a video takes a few seconds.

`references/page.md` is the page's JSON and how an answer is shaped; `references/no-captions.md`
is a video or podcast with no transcript.
