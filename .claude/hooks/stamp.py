#!/usr/bin/env python3
"""Records that a recurring pass ran today: stamp.py cleanup|checkup"""
import datetime, json, os, sys

path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stamps.local.json")
try:
    stamps = json.load(open(path))
except (OSError, ValueError):
    stamps = {}
for name in sys.argv[1:]:
    stamps[name] = datetime.date.today().isoformat()
json.dump(stamps, open(path, "w"), indent=2)
print(stamps)
