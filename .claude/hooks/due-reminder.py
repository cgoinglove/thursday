#!/usr/bin/env python3
"""SessionStart hook: when the weekly cleanup or the monthly checkup is due, have Claude say so once.

A pass never run on this machine starts counting from today, so a fresh clone is not told on its
first session. `stamp.py` records a run; the dates live in `stamps.local.json`, never committed.
"""
import datetime, json, os

path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stamps.local.json")
try:
    stamps = json.load(open(path))
except (OSError, ValueError):
    stamps = {}
today = datetime.date.today()
due = []
for name, every in (("cleanup", 7), ("checkup", 30)):
    last = stamps.get(name)
    if not last:
        stamps[name] = today.isoformat()
        continue
    if (today - datetime.date.fromisoformat(last)).days >= every:
        due.append(f"the {name} skill (every {every} days) last ran {last}")
json.dump(stamps, open(path, "w"), indent=2)
if due:
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext":
        "Due in this repo: " + "; ".join(due) + ". Mention it in one line of your first answer, in the user's language, then do what they asked."}}))
