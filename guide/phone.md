# From a phone

Thursday can be written to from a phone, through a chat app they already use — Telegram, Discord or
Slack — while the app runs on the computer at home or at work. Nothing on the computer is opened to
the internet: the app connects out to the chat service and answers there. Telegram is the quickest
to set up. More than one can be on: work started from one comes back to it, and anything else goes
to the one they last wrote from.

**Settings › Phone** lists the three chat apps, one line each. A folded line says where it stands —
*Not set*, *1 of 2 tokens in*, *Connecting…*, *Listening as …, waiting for your first message*,
*Listening as … . … is let in.*, *Reconnecting…* while the connection comes back, or *Stopped — …
turned the token away* in red. Opening a line shows its four steps, each marked as it is done; once
someone is let in, all four are. The tokens are pasted in the steps that ask for them; there is no
separate list of keys.

## Setting it up: Telegram

1. In Telegram, write to **@BotFather** (the step's **Open @BotFather** button goes there), send
   `/newbot`, and pick a name. It answers with a token — a long line of numbers and letters.
2. Paste the token in step 2 and press **Save**. The step ticks, and the line says which bot is
   listening.
3. Step 3 shows a **square picture of the bot's address**. Point the phone's camera at it — that
   opens the chat with the new bot — and write anything. (The address is a button too, for a
   computer that has Telegram on it.) The bot answers with a four-digit code: *Almost there.
   Thursday is asking on your computer whether to let you in. Press Allow there only if it shows
   4821, and she answers what you wrote.*
4. On the computer a question appears: **Let … reach Thursday from a phone?**, with the name
   Telegram gives them, what they wrote, and a code. Press **Allow** only if it is the code on your
   phone. The bot says *You are in*, she answers what was written while it waited, and from then on
   what is written there reaches her.

## Setting it up: Discord

1. At **discord.com/developers/applications** (**Open discord.com/developers**), make a New
   Application. So nobody else can add the bot to a server of theirs, set **Install Link** to
   **None** on its **Installation** page, then turn off **Public Bot** on its **Bot** page —
   Discord refuses the second while an install link is set. On the **Bot** page, press **Reset
   Token** and copy the token. The invite in step 3 still works for its owner.
2. Paste it in step 2 of **Discord**, in **Settings › Phone**.
3. A Discord bot can only be written to by someone who shares a server with it. Step 3 has the
   invite, made for them: **Add the bot to a server** opens it, or the phone's camera can read its
   square picture. It asks which server and adds the bot with no permissions in it; a private
   server made for this is fine.
4. Write to the bot directly — a direct message, not in the server. On a phone, open the server,
   tap the bot in its member list, then **Message**. The bot sends a code, and the question on the
   computer shows one: press **Allow** if they are the same. Only direct messages are read;
   nothing said in a server is.

## Setting it up: Slack

Slack takes an app of their own and two tokens.

1. At **api.slack.com/apps**, Create New App › **From a manifest**, pick the workspace, and paste the
   manifest — **Copy the manifest** in step 1 copies it:

   ```yaml
   display_information:
     name: Thursday
   features:
     app_home:
       messages_tab_enabled: true
       messages_tab_read_only_enabled: false
     bot_user:
       display_name: Thursday
   oauth_config:
     scopes:
       bot: [chat:write, im:history, im:read, users:read, files:read, files:write]
   settings:
     event_subscriptions:
       bot_events: [message.im]
     interactivity:
       is_enabled: true
     socket_mode_enabled: true
   ```
2. Under **Basic Information › App-Level Tokens**, generate one with the `connections:write` scope.
   It starts with `xapp-`: that is the **app token**.
3. **Install App** to the workspace. The **Bot User OAuth Token** starts with `xoxb-`: that is the
   **bot token**. Each token is pasted in the step that asks for it, in **Settings › Phone ›
   Slack**; it connects once both are there.
4. In Slack, open the app under **Apps** and write in its **Messages** tab. The app sends a code,
   and the question on the computer shows one: press **Allow** if they are the same. Slack shows no
   "typing…" for an app, so an answer simply arrives.

## Who is let in

One person can be let in through each service. Whoever is let in can talk to her from there, and
through her start work on the computer — so the question is asked on the computer's screen, never
on the phone. A name in a chat app is anyone's to pick, so the question carries the code that
phone was sent: whoever holds the phone showing it is the one being let in. The question opens by
itself, over whatever is being typed, so a key pressed as it opens lands on **Not them**, which
turns the person away. What the one waiting writes meanwhile is kept, a few messages of it, and
answered once they are let in; turned away, it goes with them. While someone waits, anyone else
who writes is told so; once someone is let in, anyone else is told this Thursday already answers
someone else.

**Change the token**, under the step that took it, offers **Replace** and **Remove**. A new token
for the same bot — one revoked in BotFather, or reset on Discord — keeps whoever is let in; a
token for another bot starts over, since nobody is let in to it yet. Removing stops that service
and lets the person go with it. **Let them go**, under that app's steps, lets the person go and
keeps the bot.

## What it is

A call in writing, like writing to her on the computer (`calls.md`): the same memory, the same
bots, the same things she can do. It is kept with the other calls, marked *in writing*. A
conversation that goes quiet for about ten minutes is closed, unless work she started from it is
still running; closing the app's tabs on the computer does not close it. What is written next
starts a new one, and she reads the last one back like any earlier call.

- **Writing again while she is still working** does not start a second answer: the words join what
  she is doing and are read before her next step, so "no, the other one" changes course at once.
  What arrives after she has finished gets an answer of its own.
- **A long conversation** keeps its words. What a tool answered and what she thought along the way
  are kept for the follow-up right after and then dropped; past about forty messages the oldest go.
- **Pictures and files** sent to the bot are kept on the computer, in the workspace's `inbox`
  folder, and she is told where. A picture she can look at herself — "what does this receipt say?"
  — and any file can be handed on: "give this to Analyst". Voice messages and videos are not read.
  A file that does not come through — Telegram hands a bot files up to 20 MB, and the app takes up
  to 45 MB from any chat app — is named in the chat with why, and what was written with it is
  still answered.
- **Files she names in an answer** — a report, an image a bot made — are sent along with it, the
  newest three, since a phone cannot open a path on the computer. What does not go — a fourth, or
  one past what the chat app takes (Telegram 50 MB, with pictures over 10 MB sent as files; Discord
  20 MB; any app 45 MB) — is listed in the chat under *Not sent — still on this computer*, with
  why. Asking her to show what a bot made works the same way: she names the files and they arrive
  in the chat.
- **A page** — a report, a deck, a design — arrives as pictures of it, since no chat app opens
  one: a deck slide by slide, a design board by board, anything else a phone's screen at a time
  from the top, nine at most. The page itself stays on the computer, and the chat says so under
  *Not sent — still on this computer*; sent along, it showed as code in a chat and its own pictures
  never opened on a phone. Drawing them takes a few seconds and needs the browser bots use; without
  it the page comes alone.
- **What she did** — noted something down, started work, looked something up — is said in one short
  line, in the words the call screen uses, only when she ended a turn without writing anything;
  under an answer she wrote, the line read as part of her reply.
- **How her words look**: bold, lists, links and code arrive the way each chat app draws them. A
  table arrives as rows and a heading as a bold line, since a chat has neither, and a long answer
  comes as several messages, each cut where a paragraph or a code block ends.
- **A bot's question, or work that finished**, comes as the bot wrote it, under a line that says
  whose it is and which thread — `Jarvis finished · Credit check` — with the files it names. She
  does not say it again, and she knows it went. Work started from the phone comes back to the phone
  as soon as it happens. Anything else — a routine, work started at the computer — comes only while
  no browser has the app open; with the app open on a screen it is the screen's, so an app left open
  while they are out keeps that work from the phone. A bot's question the screen was showing goes
  to the phone once the last browser closes, since the bot waits on its answer; what finished stays
  the screen's. What reached the phone counts as read on the
  computer and is not sent twice. Steps along the way are not sent. When a bot offered choices, they
  are buttons: pressing one answers that bot directly. Anything else written back goes to her, never
  straight to a bot, and she passes it on.

She is the same Thursday from a phone as on the computer: the style, the models, how hard she
thinks, whether she can search the web and the backend instructions are all what **Settings ›
Thursday** says. Her voice is the one thing that plays no part here, since nothing is spoken.

## Work while away

Work handed over from the phone runs whether or not the app is open in a browser on the computer,
and its result comes back to the phone. There is no switch for this. The app itself must be running
on the computer: a machine that is off or asleep does nothing until it is back.

## When it does not answer

- A service that turns a token away — a wrong one, one revoked or reset since, or on Slack a
  permission the app was made without — stops: its line in **Settings › Phone** says *Stopped — …
  turned the token away* in red, the step holding that token opens with what the service said and
  where to get a new one, and **Phone** in the settings list, like **Settings** on the call screen,
  carries a red dot. Nothing written from the phone reaches her until the token is replaced; a new
  token for the same bot keeps whoever was let in.
- While the line is down — no network, the service unwell — the app's line says *Reconnecting…*
  with why, and it tries again by itself.
- The computer is asleep or the app is not running: on Telegram, messages wait and are answered
  when it is back; on Discord and Slack, what was written meanwhile is not seen.
- "No key" or a plan's limit is said in the chat in the provider's own words, as on the computer
  (`trouble.md`).
