---
name: instagram
description: "Instagram by script instead of snapshots: read DMs, study reference accounts and search results, render slides at exact size, and fill the post composer up to Share."
---

# Instagram

A snapshot of an Instagram page runs 10-25k characters and a DM thread takes one per
screen. These scripts read the same pages through your own browser session and print a
few lines, so run them first and snapshot only when one tells you to. Each is
`node <this skill's dir>/scripts/<name>.mjs`; chain them with `&&` in one bash call.

Sign in before any of them: `sign_in_use` with `instagram.com`, then `playwright-cli goto
https://www.instagram.com/`. A script that says "Not signed in" means that step is missing.

**Opening a DM thread marks it seen.** `inbox` never opens one; `read` does.

| Script | Does |
|---|---|
| `inbox.mjs [--folder primary\|general\|requests] [--unread]` | Threads without opening them: unread mark, name, last line, time, id |
| `read.mjs <thread id> --out <file.jsonl> [--since YYYY-MM-DD] [--max 200]` | One thread to a file, oldest first; prints a summary and the last 10 |
| `search.mjs "<topic>" [--type reel\|carousel\|image] [--sheet covers.png]` | What Instagram's search shows, with likes, and the accounts behind it |
| `profile.mjs <handle> [--posts 12] [--out posts.json] [--sheet covers.png]` | How an account posts: type, slides, ratio, caption and tags per post, and the pattern |
| `sheet.mjs --out sheet.png <posts.json> [--post N]` | Covers, or one post's slides, as one image to `look_at` once |
| `compose.mjs --ratio 4:5 --caption <file> [--ai-label] [--shot last.png] <png>...` | The composer up to its last screen, crop set; never presses Share. `--discard` throws a draft away |

Two more are the browser skill's, `node $THURSDAY_SKILLS/browser/scripts/<name>.mjs`:
`webimage.mjs <page url> --out <dir> [--all]` saves a news page's own picture with its credit
line, and `render.mjs <slides.html> --size 1080x1350 --out <dir>` turns each `[data-slide]` into
a PNG of exactly that size.

A script that stops with "Selectors changed" means Instagram moved something: snapshot that
page once, fix the line in `scripts/selectors.mjs`, and run it again.

- DMs, reading a thread cheaply, and pictures in messages: `references/dm.md`
- Studying reference accounts and building a post the way they do: `references/post.md`
