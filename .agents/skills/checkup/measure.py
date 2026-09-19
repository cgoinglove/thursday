#!/usr/bin/env python3
"""How Claude Code was used on this repo, from its local session transcripts.

usage: python3 measure.py [--days 30]
Prices are list prices per million tokens; check them against the pricing page before trusting the dollars.
"""
import argparse, collections, datetime, glob, json, os, re, statistics, subprocess

# $/MTok: input, 5m cache write, 1h cache write, cache read, output
PRICES = {
    "claude-opus-5": (5, 6.25, 10, 0.5, 25),
    "claude-fable-5-1": (10, 12.5, 20, 0.25, 50),
    "claude-fable-5": (10, 12.5, 20, 1, 50),
    "claude-sonnet-5": (2, 2.5, 4, 0.2, 10),
    "claude-haiku-4-5-20251001": (1, 1.25, 2, 0.1, 5),
}
FAST = {"claude-opus-5": (10, 12.5, 20, 1, 50)}

ap = argparse.ArgumentParser()
ap.add_argument("--days", type=int, default=30)
days = ap.parse_args().days
root = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], cwd=os.path.dirname(os.path.abspath(__file__)), text=True).strip()
tdir = os.path.expanduser("~/.claude/projects/" + re.sub(r"[^A-Za-z0-9]", "-", root))
since = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)).isoformat()


def bucket(path):
    if not path: return "other"
    if "/.claude/rules/" in path or path.endswith(("CLAUDE.md", "AGENTS.md", "CLAUDE.local.md")): return "instructions"
    if "/.claude/" in path or path.endswith(".local.md"): return "records"
    if "/features/ai/prompts/" in path: return "prompts"
    if "/guide/" in path: return "guide"
    if re.search(r"\.(ts|tsx|mts|mjs|cjs|css|json|sql)$", path): return "code"
    return "other"


seen, ctx, cost, turns_by_model = set(), [], collections.Counter(), collections.Counter()
sessions, edits, buckets10 = {}, collections.Counter(), collections.defaultdict(set)
for f in glob.glob(tdir + "/*.jsonl") + glob.glob(tdir + "/*/subagents/*.jsonl"):
    main = "/subagents/" not in f
    sid = os.path.basename(f).split(".")[0] if main else None
    for line in open(f, errors="ignore"):
        try: o = json.loads(line)
        except ValueError: continue
        ts = o.get("timestamp") or ""
        if ts < since or o.get("type") != "assistant": continue
        m = o.get("message") or {}
        for c in m.get("content") or []:
            if isinstance(c, dict) and c.get("type") == "tool_use" and c.get("name") in ("Edit", "Write", "MultiEdit") and main:
                edits[bucket((c.get("input") or {}).get("file_path"))] += 1
        u, mid = m.get("usage"), m.get("id")
        if not u or mid in seen: continue
        seen.add(mid)
        model = m.get("model")
        p = (FAST.get(model) if u.get("speed") == "fast" else None) or PRICES.get(model)
        cc = u.get("cache_creation") or {}
        w1 = cc.get("ephemeral_1h_input_tokens"); w5 = cc.get("ephemeral_5m_input_tokens")
        if w1 is None and w5 is None: w1, w5 = u.get("cache_creation_input_tokens") or 0, 0
        if p:
            cost[model] += ((u.get("input_tokens") or 0) * p[0] + (w5 or 0) * p[1] + (w1 or 0) * p[2]
                            + (u.get("cache_read_input_tokens") or 0) * p[3] + (u.get("output_tokens") or 0) * p[4]) / 1e6
        turns_by_model[model] += 1
        if main:
            ctx.append((u.get("input_tokens") or 0) + (u.get("cache_read_input_tokens") or 0) + (u.get("cache_creation_input_tokens") or 0))
            sessions[sid] = sessions.get(sid, 0) + 1
            buckets10[ts[:15]].add(sid)

q = lambda a, p: sorted(a)[min(len(a) - 1, int(len(a) * p))] if a else 0
print(f"# last {days} days · {len(sessions)} sessions · {len(ctx):,} main-session model turns")
if ctx:
    print(f"context per turn: median {q(ctx,.5)/1e3:.0f}k · p90 {q(ctx,.9)/1e3:.0f}k · over 600k {100*sum(c>6e5 for c in ctx)/len(ctx):.0f}%")
st = list(sessions.values())
if st: print(f"turns per session: median {q(st,.5)} · p90 {q(st,.9)} · max {max(st)}")
n = [len(v) for v in buckets10.values()]
if n: print(f"10-min windows with 2+ sessions at once: {100*sum(x>=2 for x in n)/len(n):.0f}% (max {max(n)})")
tot = sum(edits.values())
if tot: print("edits: " + " · ".join(f"{k} {v} ({100*v/tot:.0f}%)" for k, v in edits.most_common()))
print(f"API list-price estimate: ${sum(cost.values()):,.0f} — " + " · ".join(f"{k.replace('claude-','')} ${v:,.0f}" for k, v in cost.most_common()))
unpriced = [k for k in turns_by_model if k not in PRICES and k != "<synthetic>"]
if unpriced: print("no price for:", ", ".join(unpriced), "— add them to PRICES")


def lines(path):
    try: return sum(1 for _ in open(os.path.join(root, path)))
    except OSError: return 0


loaded = {"AGENTS.md": lines("AGENTS.md"), "CLAUDE.local.md": lines("CLAUDE.local.md")}
print("loaded every session: " + " · ".join(f"{k} {v} lines" for k, v in loaded.items()))
rules = sorted(glob.glob(os.path.join(root, ".claude/rules/*.md")))
print(f"path-scoped rules: {len(rules)} files, {sum(lines(os.path.relpath(r, root)) for r in rules)} lines")
