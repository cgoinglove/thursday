# From a phone

Thursday can be written to from a phone, through a chat app, while the app runs on the
computer at home or at work. Nothing on the computer is opened to the internet: the app asks
the chat service what was written, and answers there.

## Setting it up (Telegram)

1. In Telegram, write to **@BotFather**, send `/newbot`, and pick a name. It answers with a
   token — a long line of numbers and letters.
2. Paste the token in **Settings › Models & keys**, under **phone › Telegram**.
3. From the phone, write anything to the new bot. It answers "open Thursday on your computer
   and press Allow".
4. On the computer a question appears: **Let … reach Thursday from a phone?** Press **Allow**.

One person can be let in. Whoever is let in can talk to her from there, and through her start
work on the computer — so the question is asked on the computer's screen, never on the phone.
Anyone else who finds the bot is told it already answers someone else.

Removing the token in Settings stops it, and a new token starts over: nobody is let in to a
new bot yet.

## What it is

A call in writing, like writing to her on the computer (`calls.md`): the same memory, the same
bots, the same things she can do. It is kept with the other calls, marked *in writing*. A
conversation that goes quiet for about ten minutes is closed; what is written next starts a
new one, and she reads the last one back like any earlier call.

- **Pictures and files** sent to the bot are kept on the computer, in the workspace's `inbox`
  folder, and she is told where — so "what is in this receipt?" or "hand this to Analyst"
  work. Voice messages and videos are not read yet.
- **Files she names in an answer** — a report, an image a bot made — are sent along with it,
  up to three, since a phone cannot open a path on the computer.
- **A bot's question, or work that finished**, reaches the phone about a minute after it
  happened, unless it was told or opened on the computer first. Steps along the way are not
  sent. When a bot offered choices, they are buttons: pressing one answers that bot directly.
  Anything else written back goes to her, and she passes it on.

She uses her default voice-backend settings from a phone: changes made in **Settings ›
Thursday** are kept in the browser and do not reach it.

## Work while away

Bots stop when no browser tab has the app open, unless **Work while the app is closed** is
on (Settings › Bots, `bots.md`). Someone who wants to hand over work from the phone and
have it run while the computer's browser is closed needs that switch on. The app itself must
still be running on the computer.

## When it does not answer

- The token line in Settings shows what Telegram said when it refuses the token.
- The computer is asleep or the app is not running: messages wait at Telegram and are
  answered when it is back.
- "No key" or a plan's limit is said in the chat in the provider's own words, as on the
  computer (`trouble.md`).
