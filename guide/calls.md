# The call

## Starting one

Three ways in, and any of them also answers a call she placed:

- Tap her face.
- Say the wake phrase, "hey thursday" unless they changed it. It is off to begin with. It keeps
  the microphone open while the tab is, uses the browser's own speech recognition (Chrome sends
  what it hears to Google), and listens in English only.
- Press the shortcut, Alt + Shift + T (⌥⇧T on a Mac) unless they changed it. It is off to begin
  with too, and works only while the app's tab is in front and nothing is being typed.

Both are switched on, off or changed in **Settings › Thursday › Starting a call**.

She speaks first, with a short greeting, in the language the user speaks, and switches when they
do. Until she starts speaking — three seconds at most — she does not hear the room, so words said
in that moment are lost. Every call starts fresh, but she remembers the last part of her recent
calls and picks a subject up when the user does. Anything older is gone unless she kept it in
memory (`memory.md`). A call she places herself opens on why she called.

## What she does on the line, and what goes to a bot

She answers from what she knows about them, searches the web, runs a single command on their
computer, and holds the conversation. Anything that takes longer — a browser, a file to make,
several steps — goes to a bot while the call carries on. She picks the bot and says who took it.

While she is working, the line under her face says so. The microphone stays open: anything said
meanwhile is heard and answered once she is done, so there is no need to repeat it.

**Share screen**, on that line during a spoken call, shows her a screen, a window or a tab; the
browser asks which. A small copy of it stands at the top right while it is shared. Nothing of it
is sent while it is only shared: she looks when what they ask needs it — "what does this error
say?" — and then a picture of it as it is at that moment goes to the model behind her, nowhere
else. **Stop** on the line, the browser's own bar, or the end of the call stops sharing. When the
browser refuses — on a Mac, the browser needs Screen Recording in System Settings › Privacy &
Security to share a window or the whole screen — its reason shows, and nothing is shared.

## Ending it

Saying goodbye usually ends the call, but not always. Tapping her face ends it for certain, and so
does the shortcut. When nothing is said and she is neither talking nor working for 25 seconds, the
call ends by itself; the last 10 seconds count down on screen. A spoken call is billed by the
minute while it is open, silence included. Work already handed to a bot carries on.

## Writing to her instead

The **+** at the left end of the pill in the bottom right corner — or the `/` key — opens a line at
the foot of the screen. Sending her a message there starts a call in writing: her answers show
beside her face, and the line stays open for writing back. She has the same memory, tools and bots
as on a spoken call, with no voice and no per-minute billing.

- **Her answers** keep their shape (lists, tables), and what she names is a link: a file opens over
  the call, a web page in a new tab.
- **Files**: the paperclip, a paste, or a drop anywhere on the window — at most 8 at a time, 25 MB
  each. She can look at a picture herself, so "what does this say?" is answered on the spot.
- **Who it goes to**: the chip at the left of the line, or `@` and a name at the start. A bot picked
  there gets that one message, then the line goes back to her; **Esc** with a bot picked also goes
  back to her.
- **What it runs on**: the GPT Subscription when one is signed in, else the OpenAI key. The small
  **runs on** button under the line shows which, and can pick another model, from any provider with
  a key, for writing only. With nothing to run on it says so; keys are in **Settings › API keys**.
- **When the GPT Subscription's limit is reached** and an OpenAI key is set, the turn is answered on
  the key, on the backend model from **Settings › Thursday**, and a notice says so once a call with
  when the plan resets. Every turn tries the plan first, so it goes back to the plan by itself once
  the plan resets. Turns on the key are billed to it. With no key, the turn fails as below.
- **When a turn fails** — a refused key, a plan's limit with no key to go on — her face says ERROR
  and the provider's reason shows in red under the line, with **Send it again** and a link to
  **API keys**. When an OpenAI key is set and was not the problem, the button reads **Send it again
  on your OpenAI key**.
- **Ending it**: **Esc** ends it (saying goodbye does not), and so does starting a spoken call.
  Opening a thread in the corner does not: the corner says *Thursday is still on the line*, with
  **Back to her** to return.

It is kept with the other calls, marked *in writing*.

During a spoken call the line writes to bots only. A file put down then is one she is told about —
its chip says *she knows it is here* — and what to do with it can simply be said; she hands it to a
bot.

## Seeing the words

**Settings › Thursday › Captions** picks how the words show:

- **Both sides** (the default): hers on the left, theirs on the right. Clicking a line of hers reads
  it again.
- **Her last line**: one caption under her face, only what she said.

A narrow window always shows her last line.

What she is doing — a search, a hand-off to a bot, a command — shows as a short line. Pages she
read on the web show under her face, and each opens in a new tab.

## Her voice, face, style and models

These are in **Settings › Thursday › Models**, in two parts, **Voice** and **Backend**. Changes
apply from the next call.

- **voice**: 22 voices; clicking a name plays it. Only the spoken call uses it.
- **style**: Bright, Calm, Straight or Rough. It changes only how she talks, never what she can do.
  **Your own** adds their own words on top — how she talks, how much she says — and wins where the
  two differ. What she calls them is not set here: tell her on a call and she remembers it.
- Under **Backend**, **model** and **effort**: the model that thinks and uses tools behind the voice, and how
  hard it thinks (`setup.md`, Models).
- **tools**: **Search the web** is on unless switched off, so a question about today — the weather,
  a price, a score — is answered on the line. **Read skills herself** is off to begin with; on, she
  can open the same skills a bot reads, and each one she opens adds a page of reading to the call.
- **instructions**: how work should be handed over and what to check first.

Her face has no setting: on a Mac, iPhone or iPad she is drawn in Apple's emoji, elsewhere in
letters. At rest she is a face of smoke that now and then opens its eyes, and she sometimes spells
a short word, such as a goodbye when a call ends.

Voice, style and the backend settings belong to the app, so they are the same in every browser and
from a phone. Captions and **Starting a call** belong to this browser.

## When work has something to say

During a call, a bot's question or result reaches her by itself — on a spoken call in a quiet
moment — and she tells the user. Work that finished before the call opened is not read out; it is
on screen, and she looks it up when asked.

With no call open, a finished job lands as a card in the bottom left corner, plus a browser
notification when the app is not the window in front. With no app tab open, the computer's own
notification says it instead (on a Mac, clicking it opens Script Editor, not the app).

**Settings › Thursday › Starting a call › She calls you** makes the screen ring instead:

- **When a job needs me** (the default) rings when a bot asks something.
- **Whenever a job ends** rings for every ending too.
- **Never** leaves it to the notification.

It needs this tab open. While it rings, the screen shows whose work it is and what it asks, with
the bot's suggested answers — picking one replies without a call. **Answer**, tapping her face or
the wake phrase picks up; **Esc** is "not now". A missed ring stays on screen with **Call back**
until called back or cleared with Esc. She cannot switch this on herself: when asked to call back,
say where it is.

## History

**Settings › Thursday › History** has two tiles. **Call history** lists every kept call, each with
the jobs it started and where they stand; one call can be deleted, or all with **Delete all**.
Calls are kept for three months, then removed by themselves. **Reset history** deletes every call,
every job and everything she remembers, for good; keys, bots and connectors stay, and so does what
each bot keeps for itself.
