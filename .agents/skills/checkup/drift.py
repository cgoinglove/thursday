#!/usr/bin/env python3
"""Backticked names in AGENTS.md and .claude/rules/ that the code no longer has."""
import glob, os, re, subprocess

root = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], cwd=os.path.dirname(os.path.abspath(__file__)), text=True).strip()
os.chdir(root)
code_files = subprocess.check_output(["git", "ls-files"], text=True).split()
blob = []
for f in code_files:
    if re.search(r"\.(ts|tsx|mts|mjs|cjs|js|json|css|sql|sh)$", f) and not f.startswith("skills/"):
        try: blob.append(open(f, errors="ignore").read())
        except OSError: pass
blob = "\n".join(blob)
tracked = set(code_files)

docs = ["AGENTS.md"] + sorted(glob.glob(".claude/rules/*.md"))
# Names and paths the rules take from elsewhere: SQL, Playwright, an outside skill pack, a build
OUTSIDE = {"ATTACH", "route.fulfill", ".agents/product-marketing.md", "dist/"}
missing_total = 0
for doc in docs:
    text = open(doc, errors="ignore").read()
    names = set(re.findall(r"`([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)`", text))
    names = {n for n in names if re.search(r"[A-Z_]", n) or "." in n}
    missing = sorted(n for n in names if n not in OUTSIDE and n.split(".")[-1] not in blob)
    paths = set(re.findall(r"`((?:[\w.-]+/)+[\w.-]*)`", text))
    # A path may be written short (`lib/utils`, `tools/look.tool`): it exists if some tracked path holds it
    missing_paths = sorted(p for p in paths if "<" not in p and "*" not in p and p not in OUTSIDE
                           and not re.match(r"[A-Z_]+/|[\w-]+\.(com|dev|ai|io|org)/", p)
                           and not any(p.rstrip("/") in t for t in tracked)
                           and not os.path.exists(p))
    missing_total += len(missing) + len(missing_paths)
    if missing or missing_paths:
        print(f"{doc}: names {missing} paths {missing_paths}")
print(f"{missing_total} names or paths in {len(docs)} files point at nothing" if missing_total else f"all names and paths in {len(docs)} files still exist")
