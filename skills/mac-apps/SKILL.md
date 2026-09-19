---
name: mac-apps
description: "The user's Calendar, Reminders, Notes and Contacts on this Mac — what is on a day, what is still to do, a note, someone's number or birthday — read and added through the apps' own scripting, without driving a window. Any account the user syncs into these apps (iCloud, Google, Exchange) comes with them."
platforms: [darwin]
---

# Calendar, Reminders, Notes and Contacts

You reach the four apps with `osascript`, which asks the app for its data
directly. It is the fast and exact way; clicking through the app's window
(`computer`) is only for what scripting cannot see.

**Permission is the user's.** The first request to each app can put a macOS
prompt on their screen; an answer of `-1743` or "Not authorized to send Apple
events" means it was refused. Say which app in one line (a `question` to
Thursday: System Settings › Privacy & Security › Automation, and Calendars or
Reminders under the same page) and stop — retrying changes nothing.

**Scripts are slow; ask once.** A calendar read takes half a minute, reminders
about ten seconds. Read the window the job needs in one call and work from the
output, rather than asking day by day.

## Read

```bash
osascript <skill dir>/scripts/events.applescript 0 7     # today and the next six days
osascript <skill dir>/scripts/events.applescript -1 1    # yesterday
osascript <skill dir>/scripts/reminders.applescript       # everything not done
osascript <skill dir>/scripts/reminders.applescript "Groceries"
osascript <skill dir>/scripts/contacts.applescript "Kim"
```

Every line is tab-separated, dates in ISO form, local time:

- events — `start, end, calendar, title, location`. Calendar lists a repeating
  event only on the day it first happened, so each repeating event that began
  earlier follows as a `repeats` line carrying its rule (RRULE). Work out from
  the rule whether it falls in the window before saying a day is free.
- reminders — `due, list, title`; `-` is no due date.
- contacts — `name, phones, emails, birthday`.

Notes: search titles and text, then read one by its id.

```bash
osascript -e 'tell application "Notes"
  set hits to (a reference to (every note whose name contains "trip" or plaintext contains "trip"))
  set {ids, titles} to {id, name} of hits
  return {ids, titles}
end tell'
osascript -e 'tell application "Notes" to get plaintext of note id "x-coredata://…/ICNote/p34"'
```

## Add

Say what you are about to add in your final text; nothing here is deleted or
changed without the user asking for exactly that. Build a date by setting its
parts, never by parsing a string — `date "…"` reads the Mac's locale and gets a
Korean or German Mac wrong.

```bash
osascript -e 'set d to current date
set year of d to 2026
set month of d to 9
set day of d to 22
set hours of d to 15
set minutes of d to 0
set seconds of d to 0
tell application "Calendar" to tell calendar "Home"
  make new event with properties {summary:"Dentist", start date:d, end date:d + 1 * hours}
end tell'

osascript -e 'set d to (current date) + 1 * days
tell application "Reminders" to tell list "Reminders"
  make new reminder with properties {name:"Buy milk", due date:d}
end tell'

osascript -e 'tell application "Notes" to tell account "iCloud"
  make new note at folder "Notes" with properties {body:"<h1>Title</h1><p>Text</p>"}
end tell'
```

Calendar and list names are the user's, in their language: take them from the
read output, and when the user named none, use the one most of their items are
in. A calendar that is a subscription (holidays, birthdays) cannot be written to.

## When a script is too slow

A property read inside a loop is one message to the app per item, and a
calendar or address book with thousands of rows turns that into minutes. Ask
for a property of the whole set at once, as the scripts do:
`set {titles, dues} to {name, due date} of (a reference to (every reminder of l whose completed is false))`.
