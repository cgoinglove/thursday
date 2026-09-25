# Keys, models, skills, services, files

## The first run

The first time the app opens, she comes in larger than the screen and steps down to her own size,
and opens her eyes there, with a soft beat on each step and a run of chimes as she lands; a browser
keeps a page silent until it is clicked, so the opening is often seen without its sound. When the
system is set to reduce motion, she is simply there. Then it walks
through six steps on the call screen itself: a voice key, the microphone, which bots come along, what
they think with, her style, and the first call. She talks
through it in a recorded voice, in English, and says so first; her real voice starts with the first
call. The speaker button at the top right mutes the recording, and stays muted the next time, the opening's sounds with it. Every
step can be passed and done later from the screens below. The bots picked there are set up when
it ends, key or no key; they run once there is a model to run on. With a key the last button is
**Call her**; without one it is **Look around**, and she says whether the bots can already work or
still need a key or a ChatGPT sign-in. It stops showing once a call has been placed, and adding
`?intro` to the address brings it back.

## Around the screen

The buttons at the top right of the call screen open **Thursday**, **Memory** and **Bots** directly,
and **Settings** opens everything; each carries a dot when something there wants the user. The
Settings list is Thursday, Memory, Bots, Threads, Routines, Files, Skills, Connectors, Sign-ins,
Models, API keys and Phone. ⌘K (Ctrl+K) jumps to its filter, and ⌘ with a number opens one of the
first nine.
Under Phone, as a group of their own named community, **Ask on Discord** opens the app's community,
where people who use and build it answer questions, and **GitHub** opens its code, bug reports and
releases. The theme — **System**, **Light** or **Dark** — is picked at the foot of the list.

## Keys

**Settings › API keys** holds them, and they stay on this machine. One OpenAI key is all a call
needs — it pays for both the voice and the model behind it. That key is checked with OpenAI as it is
saved: one OpenAI turns away is not kept, and the screen says what OpenAI said about it (a mistyped
key, one that was deleted). Bots can run on that same key.

The screen puts the two easy ways next: **GPT Subscription**, a sign-in with ChatGPT (bots run on the
ChatGPT plan, no key; the row shows how much of the plan is used and when it resets), and the
**Vercel AI Gateway**, one key for every model and the one the app recommends (its row shows what is
left). Under them every other provider is a mark to tap and paste a key into — Claude, Gemini, xAI
and the rest; the first run shows four of them and keeps the others behind **More**. The box a key goes in shows how that provider's keys begin where it is
known, with a link to the page that makes one; **Remove**, on a key already set, is the red word at
the far left.

A search key (Exa) is optional. With it, calls and bots both search through Exa, which is cheaper
per search and comes with free credits every month. Without it, a call uses OpenAI's own search and
a bot its model's own — which the GPT Subscription has, and OpenAI, Claude, Gemini and xAI on their
own keys. A bot running through the Gateway or any other provider has no search of its own, so it
opens pages in its browser instead.

## Models

**Settings › Models** has two groups. **Bots** holds the **Default model** — the one a bot uses when
its own page says nothing; a small one is quick and costs little, and is the place to start — and
its **Default effort**. Left unset it shows *auto* and names the model bots run on now: the GPT
Subscription's when you are signed in, since the plan is already paid for, else OpenAI's, else xAI's,
else the first provider with a key — the **small** model on OpenAI and the GPT Subscription, the one
the call's backend starts on too, and the **mid** one elsewhere. A default picked here whose key is
later removed is not swapped for another provider: bots stop and say so until it is back or another
is picked. The
first run's model step sets this same one, and **App default** at the top of a bot's model list puts
that bot back on it. **Studio** holds the **Image model**, **Video model**, **Speech model** and
**Transcription model**. A kind with no model picked simply is not there — a bot that needs it says
so rather than guessing. The call's own two models are in Settings › Thursday.

**Effort** is how hard a model thinks, as a row of buttons: **auto** first, then one for every step
that model takes (none, low, medium, high, xhigh and so on). Higher is slower and costs more, and
**auto** leaves the step to the model, which is where every model starts. The steps differ by model —
some offer four, some two, and one whose steps the app cannot check offers **auto** alone. Change the
model and the step comes along where the new one has it, and falls back to **auto** where it does
not. A bot's own page and the call's backend have the same control; a bot back on **App default**
follows this one again.

## Skills

A skill is a written-down way of doing something that a bot reads before it starts. The ones that
ship with the app are every bot's alike: the browser; this Mac (listed on a Mac only); what the user
keeps, looks at or uses — a document, a design canvas, a picture book, the deck every bot can make,
and a page or a small app, with charts and diagrams — as one (the first app installs its kit, which
takes a minute and the network); reading a video, a podcast, an article, a PDF or a recording of
their own, a meeting written up as notes; answers built on
published numbers, with charts, the weather on given days and an amount in another currency; a
daily news brief; finding more skills; and writing a new one. **Marketer** also carries one of its
own for marketing — a product's brief, page copy, email sequences, a launch, social posts, an SEO
audit — and **Concierge** one for trips — flights and stays compared, a booking handed over, a
day-by-day page — which no other bot sees. **Settings › Skills** lists them in groups: **Custom** (the
user's own), one for each bot that has skills of its own (**Marketer's own**: what ships with it,
and what it found or wrote for itself), and **Default** (the ones that ship, read-only). There a skill can be switched off (it stays off through an update of the app), uploaded (a `.md`,
`.zip` or `.skill` file up to 20 MB; an archive that would unpack past 100 MB or 1,000 files is
refused), written from scratch, or deleted when it is one of their own. Each row says what the
skill does; opening it shows the rest of its description and its files. In one of their own,
**Edit** on a file writes it back, which is how a typo or a changed step is fixed without making
the skill again; picking another file with changes not saved asks before dropping them. A bot can
also find one in the open registry while it works, or write a new one. Before it installs one from the registry it asks, saying who published it, its license
and what its security checks found. Either way it decides whether the skill is for itself alone
or for every bot: to itself unless any bot would use it or the user said everyone, and its report
says which. One it keeps for itself shows under its name there, where it can be opened, switched
off, edited or deleted like one of their own.

## Connected services

**Settings › Connectors** connects MCP servers, by picking one from the list or pasting its details.
Once connected, its tools are there for bots to search and call, and up to ten of them can be pinned
to one bot so they are always in front of it; she does not use them on a call herself, she hands
that work to a bot. Opening a server lists every tool it carries, with a box to narrow them by name,
and has **Reconnect** and **Delete**. Signing in happens in a popup window; a server that needs it
again turns red on that screen, with its error, and **Reconnect** signs in again.

The list starts with everyday services — to-dos, the house, flights, and Zapier for Gmail, Google
Calendar and the other apps connected there — and the tools for developers come after. Home
Assistant asks for two things first: the address of their own Home Assistant, and a long-lived
access token made on their profile page there. Its Model Context Protocol Server integration has to
be added in Home Assistant too.

## Sites they signed in to

When a bot needs them signed in to a website — to post, to read mail, to order — it opens a window of
the bots' own browser (Google Chrome for Testing, not their Chrome) on their screen and asks; they
sign in there themselves, and the app keeps that sign-in so later work does not ask again. The
window then closes by itself and the bot goes on out of sight, still signed in; it stays up only when
what comes next is for them to see, like the products they asked for or a checkout to confirm. A bot
never opens a window just to look at a page, deck or canvas it made. **Settings
› Sign-ins** lists each one: the site, the account, and the bots that may use it. What is kept is the
site's session, never a password, on this machine and outside the folder the bots work in.

- The bot that asked for the sign-in may use it. Another bot that needs the same one asks first: its
  question carries a button to let it in, and the list shows *… asks* with **Allow**. The **×** on a
  bot's name in the list takes that back. A bot that has not been let in cannot replace what is
  kept either: if they sign in to the same site for it, that sign-in lasts for its job only, and it
  asks — to use the kept one, or for them to sign out of it here so the new one can be kept.
- Some sites — Google is one — do not accept a sign-in carried from one browser to another: the bot
  is signed out again on its next job however often they sign in. For those a bot works in a tab of
  their own Chrome instead, signed in as they already are. That needs the **Playwright Extension**
  from the Chrome Web Store installed in their Chrome once, and Chrome open: the last row of the
  list, **Your own Chrome**, has the button to it. The bot gets a tab of its own and cannot see
  theirs; nothing is kept from it.
- **Sign out** removes what is kept; the next job that needs the site asks them to sign in again. The
  site may go on listing the session until it ends it, so a lost or shared computer is also a reason
  to sign out on the site itself.
- A site that ends the session by itself just makes the bot ask again.

## Its own window

The app runs in a browser tab, and a tab is easy to lose: closed, it takes the wake phrase, the
shortcut and her calls with it. Chrome and Edge can install it instead, which gives it its own window
and its own icon in the Dock or the taskbar, and the browser can be told to open that window when
the computer starts. The call screen offers it once, under the buttons at its top right —
**Install**, or **Not now** and it does not ask again — and **Install app** stays at the foot of the
Settings list for as long as it is not installed. Safari on a Mac does it from its File menu, **Add
to Dock**; Firefox cannot. It is the same local app either way; nothing moves anywhere.

The window only shows what the server is serving, and the server is started in a terminal. On a Mac
it does not have to be: `thursday autostart` hands it to the computer, which starts it at login and
again whenever it stops, so the icon in the Dock opens the call screen with no terminal anywhere.
It needs the app installed with `npm i -g thursday-agent`, not run through `npx`.
`thursday autostart --off` takes it back. A server nobody is watching writes what it would have said
to `server.local.log`, beside the database. The address is the one it is on when autostart is turned
on, so moving it with `--port` means turning autostart on once more. Linux and Windows start it the
way they start anything else at login.

The app comes back on the same address every time it starts: the first start takes port 4747, which
other apps rarely use, and keeps it. If that port is taken by something else one day, it says so
where it was started and serves on the next one for that day; the browser then shows other
settings, because a browser keeps settings per address. Starting it once with `--port` and a number
moves it to that address for good; if that port is taken, it says so and stops. `thursday --help`
lists the rest: `--home` for another data folder, `--no-open` to start without opening a browser.

## Where the files are

Everything is on this computer, in one folder: `.thursday` in their home folder when the app was
installed or started with `npx thursday-agent`, or the folder it was started from otherwise; every
start prints it. It holds the database with calls, memory, bots, keys and who she is set to be, the
sites they signed in to, and the workspace with finished results, projects, each bot's folder and
the skills that were installed. The folder her shell opens in is that workspace, so the exact place
is one command away when they ask. Updating the app never touches it. Nothing is sent anywhere but
the model providers that were set up and the services that were connected. The app listens only to
this machine and has no account and no login.

One thing sits outside it: the browser the bots work in. It is downloaded once into this computer's
own cache folder, a few hundred megabytes — so that folder, not `.thursday`, is where to look if the
disk is short.

A copy of that folder is the backup, and it is taken with the app stopped. While it runs, the newest
calls and messages are in a second file beside the database, so a copy of the database on its own
can be missing the last thing that was said; stopping the app folds that file back in. Moving to
another computer is the same folder put in the same place there. If the app ever cannot open the
database, the terminal it was started in asks whether to set it aside and start over; yes moves it
next to the new one with `.corrupt-` and a number in its name, and nothing is thrown away. Started by
autostart it cannot ask, so it does not come up until it is started once from a terminal.

## What it costs

The user brings their own keys, so the cost is whatever those providers charge: a spoken call is
billed per minute it is open, silence included, and everything else by how much text the models
read and write — a call in writing included. The GPT Subscription spends the ChatGPT plan's usage
instead. A long job on a large model is what adds up fastest.
