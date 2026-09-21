# Keys, models, skills, services, files

The first time the app opens it walks through the first three of these on the call screen
itself — a voice key, the microphone, which bots come along, what they think with — and its
last button places the first call. She talks through it in a recorded voice, in English, and
says so first: her real voice starts with the first call. The speaker button at the top right
mutes the recording, and stays muted the next time. Every step can be passed and done later
from the screens below, and it stops showing once a call has been placed. Adding `?intro` to
the address brings it back.

## Keys

**Settings › API keys** holds them, and they stay on this machine. One OpenAI key is all
a call needs — it pays for both the voice and the model behind it. That key is checked with
OpenAI as it is saved: one OpenAI turns away is not kept, and the screen says what OpenAI
said about it (a mistyped key, one that was deleted). Bots can run on that same
key. The screen puts the two easy ways next: a GPT Subscription sign-in (bots run on the
ChatGPT plan, no key), and the Vercel AI Gateway, one key for every model and the one the app
recommends. Under them every other provider is a mark to tap and paste a key into: Anthropic,
Google, xAI, Mistral, DeepSeek, Groq, Cerebras, Together, Fireworks, DeepInfra, Cohere. The box
a key goes in shows how that provider's keys begin (`sk-ant-…` for Anthropic) where it is known,
with a link to the page that makes one; **Remove**, on a key already set, is the red word at the
far left.

A search key (Exa) is optional. With it, calls and bots both search through Exa, which is
cheaper per search and comes with free credits every month. Without it, a call uses OpenAI's
own search and a bot its model's own. Only OpenAI, Anthropic, Google and xAI models carry
one; a bot on anything else has no search of its own, so it opens pages in its browser instead.

## Models

The same screen picks the model bots use when their own page says nothing — a small one is
quick and costs little, and is the place to start; the first run's model step sets this same
one, and **App default** at the top of a bot's model list puts that bot back on it — and the models for images, video, speech
and transcription. A kind with no model picked simply is not
there — a bot that needs it says so rather than guessing. The call's own two models are in
Settings › Thursday instead.

Under the model is how hard it thinks: an **Auto** button beside a slider of the steps that model
takes. Higher is slower and costs more, and **Auto** leaves it to the model, which is what
every model starts on. The steps differ by model — some offer four, some two, and one whose
steps the app cannot check offers none, so it runs on its own. Change the model and the step
comes along where the new one has it, and falls back to **Auto** where it does not. A bot's own
page has the same slider under its model; a bot back on **App default** follows this one again.

## Skills

A skill is a written-down way of doing something that a bot reads before it starts. Some ship
with the app — the browser, this Mac, finding more skills, building a page or a chart, and
writing a new skill. The one for this Mac is not listed on other computers.
**Settings › Skills** lists them, switches one off, uploads one, or
writes one. Opening a skill shows its files; in one of their own, **Edit** on a file writes
it back, which is how a typo or a changed step is fixed without making the skill again. The
ones that ship are read-only. A bot can also install one from the open registry while it
works: for itself alone unless they asked for every bot to have it. A bot's own skills sit
in its own folder and are not on that screen, which lists the shared ones.

## Connected services

**Settings › Connectors** connects MCP servers, by picking one from the list or pasting its
details. Once connected, its tools are there for bots to search and call, and up to ten of
them can be pinned to one bot so they are always in front of it. Opening a server lists every
tool it carries, with a box to narrow them by name. Signing in happens in a popup window; a
server that needs it again turns red on that screen.

The list starts with everyday services — to-dos, the house, flights, and Zapier for Gmail,
Google Calendar and the other apps connected there — and the tools for developers come after.
Home Assistant is the one that asks for two things first: the address of their own Home
Assistant, and a long-lived access token made on their profile page there. Its Model Context
Protocol Server integration has to be added in Home Assistant too.

## Sites they signed in to

When a bot needs them signed in to a website — to post, to read mail, to order — it opens a
window of the bots' own browser (Google Chrome for Testing, not their Chrome) on their screen
and asks; they sign in there themselves, and the app keeps that
sign-in so later work does not ask again. **Settings › Sign-ins** lists each one:
the site, the account, and the bots that may use it. What is kept is the site's session, never
a password, on this machine and outside the folder the bots work in.

- The bot that asked for the sign-in may use it. Another bot that needs the same one asks
  first, and its question carries a button that lets it in; the **×** on a bot's name in the
  list takes that back.
- Some sites — Google is one — do not accept a sign-in carried from one browser to another:
  the bot is signed out again on its next job however often they sign in. For those a bot
  works in a tab of their own Chrome instead, signed in as they already are. That needs the
  **Playwright Extension** from the Chrome Web Store installed in their Chrome once, and
  Chrome open: the last row of the list, **Your own Chrome**, has the button to it. The bot
  gets a tab of its own and cannot see theirs; nothing is kept from it.
- **Sign out** removes what is kept; the next job that needs the site asks them to sign in
  again. The site may go on listing the session until it ends it, so a lost or shared
  computer is also a reason to sign out on the site itself.
- A site that ends the session by itself just makes the bot ask again.

## Its own window

The app runs in a browser tab, and a tab is easy to lose: closed, it takes the wake phrase,
the shortcut and her calls with it. Chrome and Edge can install it instead, which gives it
its own window and its own icon in the Dock or the taskbar, and the browser can be told to
open that window when the computer starts. The call screen offers it once, under the buttons
at its top right — **Install**, or **Not now** and it does not ask again — and **Install app**
stays at the foot of the Settings list for as long as it is not installed. Safari on a Mac
does it from its File menu, **Add to Dock**; Firefox cannot. It is the same local app either
way; nothing moves anywhere.

The window only shows what the server is serving, and the server is started in a terminal. On
a Mac it does not have to be: `thursday autostart` hands it to the computer, which starts it at
login and starts it again whenever it stops, so the icon in the Dock opens straight into a call
with no terminal anywhere. `thursday autostart --off` takes it back. A server nobody is watching
writes what it would have said to `server.local.log`, beside the database. The address is the
one it is on when autostart is turned on, so moving it with `--port` means turning autostart on
once more. Linux and Windows start it the way they start anything else at login.

The app comes back on the same address every time it starts: the first start takes port 4747,
which other apps rarely use, and keeps it. If that port is taken by
something else one day, it says so where it was started and serves on the next one for that
day; the browser then shows other settings, because a browser keeps settings per address.
Starting it once with `--port` and a number moves it to that address for good.

## Where the files are

Everything is on this computer, in one folder: `.thursday` in their home folder when the app
was started with `npx thursday-agent`, or the folder it was started from otherwise. It holds
the database with calls, memory, bots and keys, and the workspace with finished results,
projects, each bot's folder and the skills that were installed. The folder her shell opens in
is that workspace, so the exact place is one command away when they ask. Updating the app
never touches it. Nothing is sent anywhere but the model providers that were set up
and the services that were connected. The app listens only to this machine and has no account
and no login.

One thing sits outside it: the browser the bots work in. It is downloaded once into this
computer's own cache folder, a few hundred megabytes, and an app update that moves to a newer
browser leaves the older one there — so that folder, not `.thursday`, is where to look if the
disk is short.

A copy of that folder is the backup, and it is taken with the app stopped. While it runs, the
newest calls and messages are in a second file beside the database, so a copy of the database on
its own can be missing the last thing that was said; stopping the app folds that file back in and
leaves one whole database behind. Moving to another computer is the same folder put in the same
place there. If the app ever says it cannot open the database, it does not throw the old one away:
it moves it aside with `.corrupt` and the time in the name, next to the new empty one.

## What it costs

The user brings their own keys, so the cost is whatever those providers charge: the call is
billed per minute it is open, silence included, and everything else by how much text the
models read and write. A long job on a large model is what adds up fastest.
