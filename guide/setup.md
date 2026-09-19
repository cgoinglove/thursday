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
Google, xAI, Mistral, DeepSeek, Groq, Cerebras, Together, Fireworks, DeepInfra, Cohere.

A search key (Exa) is optional. With it, calls and bots both search through Exa, which is
cheaper per search and comes with free credits every month. Without it, a call uses OpenAI's
own search and a bot its model's own. Only OpenAI, Anthropic, Google and xAI models carry
one; a bot on anything else has no search of its own, so it opens pages in its browser instead.

## Models

The same screen picks the model bots use when their own page says nothing — a small one is
quick and costs little, and is the place to start — and the models for images, video, speech
and transcription. A kind with no model picked simply is not
there — a bot that needs it says so rather than guessing. The call's own two models are in
Settings › Thursday instead.

## Skills

A skill is a written-down way of doing something that a bot reads before it starts. Some ship
with the app — the browser, this Mac, finding more skills, building a page or a chart, and
writing a new skill. **Settings › Skills** lists them, switches one off, uploads one, or
writes one. A bot can also install one from the open registry while it works: for itself
alone unless they asked for every bot to have it. A bot's own skills sit in its own folder
and are not on that screen, which lists the shared ones.

## Connected services

**Settings › Connectors** connects MCP servers, by picking one from the list or pasting its
details. Once connected, its tools are there for bots to search and call, and up to ten of
them can be pinned to one bot so they are always in front of it. Signing in happens in a
popup window; a server that needs it again turns red on that screen.

## Sites they signed in to

When a bot needs them signed in to a website — to post, to read mail, to order — it opens a
browser window on their screen and asks; they sign in there themselves, and the app keeps that
sign-in so later work does not ask again. **Settings › Sign-ins** lists each one:
the site, the account, and the bots that may use it. What is kept is the site's session, never
a password, on this machine and outside the folder the bots work in.

- The bot that asked for the sign-in may use it. Another bot that needs the same one asks
  first, and its question carries a button that lets it in; the **×** on a bot's name in the
  list takes that back.
- **Sign out** removes what is kept; the next job that needs the site asks them to sign in
  again. The site may go on listing the session until it ends it, so a lost or shared
  computer is also a reason to sign out on the site itself.
- A site that ends the session by itself just makes the bot ask again.

## Its own window

The app runs in a browser tab, and a tab is easy to lose: closed, it takes the wake phrase,
the shortcut and her calls with it. Chrome and Edge can install it instead — the install
icon at the right of the address bar, or the menu's "Install Thursday" — which gives it its
own window and its own icon in the Dock or the taskbar, and it can be set to open when the
computer starts. It is the same local app either way; nothing moves anywhere.

The app comes back on the same address every time it starts. If that port is taken by
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

## What it costs

The user brings their own keys, so the cost is whatever those providers charge: the call is
billed per minute it is open, silence included, and everything else by how much text the
models read and write. A long job on a large model is what adds up fastest.
