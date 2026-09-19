#!/usr/bin/env python3
"""Stop hook: before a turn ends, check what THIS session changed and has not committed.

Several sessions may edit one tree, so every check is narrowed to the files this session's
Edit/Write calls touched that still differ from HEAD. It blocks with a reason Claude can act on,
at most twice for the same changes; the migration and guide reminders are said once. It reads
and reports, and never changes a file.
"""
import glob, hashlib, json, os, re, subprocess, sys

inp = json.load(sys.stdin)
root = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=inp.get("cwd") or ".", capture_output=True, text=True).stdout.strip()
if not root:
    sys.exit(0)
state_dir = os.path.join(root, ".claude/hooks/state.local.d")
os.makedirs(state_dir, exist_ok=True)
state_path = os.path.join(state_dir, f"stop-{inp.get('session_id', 'x')}.json")
try:
    state = json.load(open(state_path))
except (OSError, ValueError):
    state = {}


def save():
    json.dump(state, open(state_path, "w"))


# What this session wrote, from its own transcript
touched = set()
try:
    for line in open(inp.get("transcript_path") or "", errors="ignore"):
        if '"tool_use"' not in line or not re.search(r'"name":"(Edit|Write|MultiEdit|NotebookEdit)"', line):
            continue
        try:
            msg = json.loads(line).get("message") or {}
        except ValueError:
            continue
        for c in msg.get("content") or []:
            if isinstance(c, dict) and c.get("type") == "tool_use":
                p = (c.get("input") or {}).get("file_path") or (c.get("input") or {}).get("notebook_path")
                if p and p.startswith(root + "/"):
                    touched.add(os.path.relpath(p, root))
except OSError:
    sys.exit(0)

status = subprocess.run(["git", "status", "--porcelain", "--untracked-files=all"], cwd=root, capture_output=True, text=True).stdout
pending_all = {l[3:].split(" -> ")[-1].strip('"') for l in status.splitlines() if l}
mine = sorted(p for p in touched if p in pending_all and os.path.exists(os.path.join(root, p)))
if not mine:
    sys.exit(0)

code = [p for p in mine if re.search(r"\.(ts|tsx|mts|mjs|cjs|js|css|json)$", p) and ".local." not in p]
sig = hashlib.sha1("".join(f"{p}:{os.stat(os.path.join(root, p)).st_mtime_ns}" for p in mine).encode()).hexdigest()
if state.get("passed") == sig:
    sys.exit(0)
if state.get("sig") != sig:
    state.update(sig=sig, blocks=0, reminded=[])
if state.get("blocks", 0) >= 2:
    # Two blocks in a row on the same changes: say it once more in the log and let the turn end
    state["passed"] = sig
    save()
    sys.exit(0)

issues = []


def run(cmd, timeout=280):
    try:
        r = subprocess.run(cmd, cwd=root, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout + r.stderr)
    except subprocess.TimeoutExpired:
        return 0, ""


if code:
    _, out = run(["pnpm", "-s", "typecheck"])
    errs = [l for l in out.splitlines() if "error TS" in l and any(l.startswith(p) for p in code)]
    if errs:
        issues.append("typecheck errors in files this session changed:\n" + "\n".join(errs[:15]))
    rc, out = run(["pnpm", "exec", "biome", "check", *code])
    if rc != 0:
        issues.append("biome check failed on files this session changed:\n" + "\n".join(out.splitlines()[:30]))
    _, out = run(["pnpm", "-s", "knip", "--no-progress", "--reporter", "compact", "--no-exit-code"])
    unused = [l for l in out.splitlines() if any(p in l for p in code)]
    if unused:
        issues.append("knip: nothing uses these any more — delete them, do not rename with an underscore:\n" + "\n".join(unused[:15]))

if "database/tables.ts" in mine and not any(p.startswith("database/migrations/") for p in pending_all) and "migration" not in state["reminded"]:
    state["reminded"].append("migration")
    issues.append("database/tables.ts changed but database/migrations/ did not: run `pnpm db:generate` and commit the migration, or say in one line why this change needs no SQL.")

ui = [p for p in mine if re.match(r"(features/[^/]+/components/|components/ui/|app/.+\.tsx$)", p)]
if ui and not any(p.startswith("guide/") for p in pending_all) and "guide" not in state["reminded"]:
    state["reminded"].append("guide")
    issues.append("Screen files changed (" + ", ".join(ui[:5]) + ") but guide/ did not. If the user would notice this change, update guide/ in the same work; if not, say so in one line.")

if issues:
    state["blocks"] = state.get("blocks", 0) + 1
    save()
    print(json.dumps({"decision": "block", "reason": "\n\n".join(issues)}))
    sys.exit(0)
state["passed"] = sig
save()
