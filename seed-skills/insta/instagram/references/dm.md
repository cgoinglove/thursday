# DMs

## Look before you open

`inbox.mjs` reads the thread list from the inbox page: a `*` marks an unread thread, and
the last field is the id `read.mjs` takes. General and Requests are `--folder general` and
`--folder requests`. Nothing is opened, so nothing is marked seen.

Open a thread only when the job is to read it. An unread thread the user has not asked
about stays unread.

## Reading a thread

```bash
node <skill>/scripts/read.mjs 1234567890 --out <scratch>/dm-1234567890.jsonl --since 2026-09-01
```

`<scratch>` is this job's scratch folder.

It walks the message pane up from the newest message a screen at a time — the pane drops
rows that leave the screen, so it is never scrolled with the mouse wheel or jumped to the
top — and stops at `--max`, at `--since`, at the top of the thread, or after two rounds
with nothing new. It prints one summary line, then the last 10 messages (`--tail 0` for
none). A thread of 50 messages takes about 20 seconds.

Each line of the file is one message:
`{ id, ts, at, from: "me" | "them", sender, text, images: [url], video, links: [url] }`.
Read it with `grep`, `tail`, `sed -n`, or `node -e`, not all at once. `sender` is the
sender's account number; in a group, the same number is the same person.

A shared post or reel is a message whose `links` holds its url and whose `text` holds its
caption as shown.

## Pictures in messages

`images` are the picture urls; they expire after a while, so use them in the same job.
When what a picture shows matters, put them on one sheet and look once:

```bash
node <skill>/scripts/sheet.mjs --out <scratch>/dm-pictures.png <url> <url> ...
```

A screenshot of the thread is the fallback when a message holds something that is neither
text nor a picture url.

## When something covers the page

A dialog (notifications, a daily time-limit screen) can cover the inbox; `inbox` then says
so. Snapshot once, close it with its own close button, and run the script again.
