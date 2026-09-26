# From a phone

Thursday can be written to from a phone through Telegram, Discord or Slack, while the app runs on
the computer. Nothing on the computer is opened to the internet. Telegram is the quickest to set
up. More than one can be on: work started from one comes back to it, and anything else goes to the
one they last wrote from.

**Settings › Phone** lists the three chat apps, one line each. A folded line says where it stands:
*Not set*, *1 of 2 tokens in*, *Connecting…*, *Listening as … — waiting for your first message*,
*Listening as … . … is let in.*, *Reconnecting…*, or *Stopped — … turned the token away* in red.
Opening a line shows its four steps, each ticked as it is done. Tokens are pasted in the steps that
ask for them.

## Setting it up: Telegram

1. In Telegram, write to **@BotFather** (**Open @BotFather** goes there), send `/newbot` and pick a
   name. It answers with a token.
2. Paste the token in step 2 and press **Save**.
3. Step 3 shows a square code picture of the bot's address. Point the phone's camera at it to open
   the chat, and write anything. The bot answers with a four-digit code.
4. On the computer a question appears: **Let … reach Thursday from a phone?**, with a code. Press
   **Allow** only if it is the code on the phone. From then on, what is written there reaches her,
   and she answers what was written while it waited.

## Setting it up: Discord

1. At discord.com/developers (**Open discord.com/developers**), make a **New Application**. So nobody
   else can add the bot to a server, set **Install Link** to **None** on its **Installation** page
   first, then turn off **Public Bot** on its **Bot** page. There, press **Reset Token** and copy
   the token.
2. Paste it in step 2 and press **Save**.
3. Discord only delivers messages to a bot you share a server with. **Add the bot to a server**
   (or the square code picture) opens the invite; pick a server of your own. A private server made
   for this is fine.
4. Send the bot a direct message, not in the server: on a phone, tap the bot in the server's member
   list, then **Message**. Then press **Allow** on the computer, as with Telegram. Only direct
   messages are read.

## Setting it up: Slack

Slack takes an app of your own and two tokens.

1. At api.slack.com/apps, **Create New App › From a manifest**, pick the workspace, and paste the
   manifest (**Copy the manifest** in step 1 copies it):

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
2. Under **Basic Information › App-Level Tokens**, generate one with **connections:write**. It
   starts with `xapp-`; paste it in step 2.
3. **Install App** to the workspace. The Bot User OAuth Token starts with `xoxb-`; paste it in
   step 3. It connects once both are in.
4. In Slack, open the app under **Apps** and write in its **Messages** tab. A question with a code
   appears on the computer: press **Allow** if Slack shows the same code.

## Who is let in

One person per chat app. Whoever is let in can talk to her and, through her, start work on the
computer, so they are only ever let in on the computer's screen, by matching the code their phone
was sent. The question opens by itself, and a key pressed as it opens lands on **Not them**, which
turns them away. A few messages written while waiting are kept and answered once they are let in.
Anyone else who writes is told someone is already waiting, or that this Thursday already answers
someone else.

- **Change the token**, under the step that took it, offers **Replace** and **Remove**. A new token
  for the same bot keeps whoever is let in; a token for another bot starts over. **Remove** stops
  that chat app and lets the person go.
- **Let them go**, under the steps, lets the person go and keeps the bot.

## What works from a phone

It is a call in writing, like writing to her on the computer (`calls.md`): the same memory, bots,
settings and models from **Settings › Thursday**, only no voice. It is kept with the other calls,
marked *in writing*. After about ten minutes with nothing written, and no work it started still
running, the conversation closes; the next message starts a new one, and she can read the last one
back.

- **Writing again while she works** joins what she is doing, so "no, the other one" changes course
  at once.
- **Pictures and files** sent to her are kept in the workspace's `inbox` folder. She can look at a
  picture herself or hand any file to a bot. Voice messages and videos are not read. Telegram hands
  over files up to 20 MB, and the app takes up to 45 MB from any chat app; a file that does not come
  through is named in the chat.
- **Files she names in an answer** are sent with it, the newest three. What does not go — a fourth,
  or one too big (Telegram 50 MB, Discord 20 MB, any app 45 MB) — is listed under *Not sent — still
  on this computer*. Asking her to show what a bot made works the same way.
- **A page** — a report, a deck, a design — arrives as up to nine pictures of it, since no chat app
  opens one; the page itself stays on the computer. If the pictures cannot be drawn, the page file
  is sent instead.
- **A bot's question, or finished work**, arrives as the bot wrote it, under a line naming the bot
  and the thread, with its files. Work started from the phone always comes back to the phone.
  Anything else — a routine, work started on the computer — comes only while no browser has the app
  open; a bot's question left on screen goes to the phone once the last browser closes. Steps along
  the way are not sent. A bot's choices come as buttons that answer it directly; anything else
  written back goes to her.

Work handed over from the phone keeps running whether or not the app is open in a browser, as long
as the app is running on the computer. A computer that is off or asleep does nothing until it is
back.

## When it does not answer

- **A token turned away** (wrong, revoked or reset, or on Slack a missing permission): the line says
  *Stopped — … turned the token away* in red, the step holding that token opens with what the
  service said, and **Phone** in the settings list and the **Settings** button carry a red dot.
  Nothing gets through until the token is replaced.
- **No network or the service is down**: the line says *Reconnecting…* with why, and it tries again
  by itself.
- **The computer is asleep or the app is not running**: on Telegram, messages wait and are answered
  when it is back; on Discord and Slack, what was written meanwhile is not seen.
- **The GPT Subscription's limit**: with an OpenAI key set, she answers on the key, and the chat is
  told so once a conversation, with when the plan resets. With no key, the chat says the limit and
  that an OpenAI key in **Settings › API keys** would let her answer.
- **No key, or a refused one**, is said in the chat in the provider's own words (`trouble.md`).
