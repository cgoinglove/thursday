# From a phone

Thursday can be written to from a phone, through a chat app they already use — Telegram,
Discord or Slack — while the app runs on the computer at home or at work. Nothing on the
computer is opened to the internet: the app connects out to the chat service, and answers
there. Telegram is the quickest to set up. More than one can be on; what she has to tell
goes to the one they last wrote from.

## Setting it up: Telegram

1. In Telegram, write to **@BotFather**, send `/newbot`, and pick a name. It answers with a
   token — a long line of numbers and letters.
2. Paste the token in **Settings › Phone**, under **Telegram**.
3. From the phone, write anything to the new bot. It answers "open Thursday on your computer
   and press Allow".
4. On the computer a question appears: **Let … reach Thursday from a phone?** Press **Allow**.

## Setting it up: Discord

1. At **discord.com/developers/applications**, make a New Application, open its **Bot** page,
   press **Reset Token** and copy the token.
2. Paste it in **Settings › Phone**, under **Discord**.
3. A Discord bot can only be written to by someone who shares a server with it. On the
   application's **OAuth2** page, make an invite link with the `bot` scope, open it, and add
   the bot to a server of their own — a private one made for this is fine.
4. Write to the bot directly (a direct message, not in the server), then press **Allow** on
   the computer. Only direct messages are read; nothing said in a server is.

## Setting it up: Slack

Slack takes an app of their own and two tokens.

1. At **api.slack.com/apps**, Create New App › **From a manifest**, pick the workspace, and
   paste this:

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
2. Under **Basic Information › App-Level Tokens**, generate one with the
   `connections:write` scope. It starts with `xapp-`: that is the **app token**.
3. **Install App** to the workspace. The **Bot User OAuth Token** starts with `xoxb-`: that
   is the **bot token**.
4. Paste both in **Settings › Phone**, under **Slack**. It connects once both are there.
5. In Slack, open the app under **Apps** and write in its **Messages** tab, then press
   **Allow** on the computer. Slack shows no "typing…" for an app, so an answer simply arrives.

## Who is let in

One person can be let in through each service. Whoever is let in can talk to her from there, and through her start
work on the computer — so the question is asked on the computer's screen, never on the phone.
Anyone else who finds the bot is told it already answers someone else.

Removing a token in Settings stops that service, and a new token starts over: nobody is let
in to a new bot yet. **Let them go**, under the tokens, lets the person go and keeps the bot.

## What it is

A call in writing, like writing to her on the computer (`calls.md`): the same memory, the same
bots, the same things she can do. It is kept with the other calls, marked *in writing*. A
conversation that goes quiet for about ten minutes is closed; what is written next starts a
new one, and she reads the last one back like any earlier call.

- **Pictures and files** sent to the bot are kept on the computer, in the workspace's `inbox`
  folder, and she is told where. A picture she can look at herself — "what does this
  receipt say?" — and any file can be handed on: "give this to Analyst". Voice messages and
  videos are not read yet.
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

- The line under the tokens in **Settings › Phone** shows what the service said when it
  refuses one — a wrong token, or on Slack a permission the app was made without.
- The computer is asleep or the app is not running: on Telegram, messages wait and are
  answered when it is back; on Discord and Slack, what was written meanwhile is not seen.
- "No key" or a plan's limit is said in the chat in the provider's own words, as on the
  computer (`trouble.md`).
