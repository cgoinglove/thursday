# Launch

The runbook for going public. Written to be executed, not read: every step says who runs it — **[bot]** is Claude with `gh` and the browser skill, **[you]** is a login or a decision only the owner can make. Copy for every channel is in [posts.md](posts.md); nothing here is posted without a look first.

Goal: 10k stars. What gets there is not one post; it is a working `npx` on the day, a video people forward, and answering every comment for a week.

## Where it stands

| | State | Owner |
|---|---|---|
| Repo public at `github.com/cgoing/thursday` | not yet | [you] |
| npm login + first `pnpm release` | not yet | [you] |
| `NPM_TOKEN` secret so tags publish themselves | not yet | [you] |
| Social preview (hero PNG) | designed, not exported | [bot] export → [you] upload |
| 60-second demo video | not recorded | [you] record, [bot] cut the GIF |
| Screenshots in `docs/images/` | placeholders in README (`!![…]`) | [bot] after the design settles |
| Discord / Discussions | none | decide: Discussions first (zero upkeep) |

## T-7 — the repo reads well cold

- [ ] **[bot]** `gh repo edit` — description, homepage, topics: `voice-agent realtime speech ai-agent agent-skills local-first mcp openai-realtime playwright nextjs`
- [ ] **[bot]** Enable Discussions; create labels `bug`, `idea`, `good first issue`, `skill`, `provider`
- [ ] **[bot]** Seed 5 `good first issue`s from real gaps (a provider that is missing, a skill that should exist, a screen that is not translated). A newcomer's first hour decides whether they stay.
- [ ] **[bot]** Export the four brand artboards → `docs/images/`, replace the `!![design: …]` placeholders in both READMEs
- [ ] **[you]** Upload `hero.png` as the social preview (Settings → Social preview)
- [ ] **[you]** Record the demo (script in posts.md → *Demo*). One take, real voice, no editing beyond a cut.
- [ ] **[bot]** Cut the 12-second GIF, replace `!![video: …]`; upload the full take to YouTube (unlisted until launch)
- [ ] **[both]** Fresh-machine test: a friend's laptop, `npx thursday-agent`, one key, the eight "Try saying" lines. Fix what breaks. This is the step that matters most.

## T-1 — release

- [ ] **[you]** `npm login`
- [ ] **[bot]** `pnpm release` (builds `dist/`, publishes `thursday-agent@0.1.0`)
- [ ] **[bot]** `git tag v0.1.0 && git push --follow-tags` → the release workflow runs; `gh release create` with the notes from posts.md → *Release notes*
- [ ] **[bot]** Verify from a clean folder: `npx thursday-agent@latest` boots, the intro shows, one key opens a call
- [ ] **[bot]** Star-history badge and the demo GIF are live in the README

## Launch day — Tuesday–Thursday, 08:00–09:00 US Eastern

Hacker News first; everything else points at the HN thread for the first hours (an HN post with conversation on it ranks; one with only upvotes does not).

1. **[you → bot]** Log into HN in the headed browser. **[bot]** submits *Show HN* (posts.md → *Hacker News*), then posts the maker comment immediately underneath.
2. **[bot]** X thread (posts.md → *X*), video first. Pin it.
3. **[bot]** Reddit — r/LocalLLaMA, r/selfhosted, r/artificial — three different angles, not one cross-post (posts.md → *Reddit*). Two hours apart.
4. **[bot]** GeekNews and Disquiet (posts.md → *Korean*). Korean X post from the same account, not a translation of the English one.
5. **[bot]** Submit to the newsletters that take submissions: TLDR AI, Ben's Bites, Console.dev, The Rundown (posts.md → *Newsletters*).
6. **[both]** Answer every comment on HN and Reddit within the hour, all day. The bot drafts, you approve or type your own. Never a canned line twice.

## Launch + 2 — Product Hunt

Its own day, so it is not fighting HN for your attention. Schedule for 00:01 PT.

- **[you]** Hunter is you. Gallery: hero, how-it-works, bots, one-job, two screenshots. Video: the 60-second take.
- **[bot]** Tagline, description, first comment (posts.md → *Product Hunt*)
- **[both]** Reply to every comment. Ask nobody for upvotes.

## Launch + 7 — the long tail

- [ ] **[bot]** PRs to the lists people actually browse: `awesome-ai-agents`, `awesome-mcp-clients`, the Vercel AI SDK community showcase, the OpenAI developer forum's Realtime category. One paragraph each, their format, no hype.
- [ ] **[bot]** Dev.to / Hashnode article — *Why a voice agent needs two kinds of mind* (posts.md → *Article*). The architecture, honestly, including what does not work yet.
- [ ] **[bot]** Weekly: a "what shipped" post on X and in Discussions, every Friday, for as long as it is true.
- [ ] **[both]** Every issue gets a reply the same day for the first month. Stars follow responsiveness more than features.

## Numbers to watch

`gh api repos/cgoing/thursday --jq .stargazers_count`, npm downloads at `npmjs.com/package/thursday-agent`, HN rank on the day, and — the one that predicts the rest — how many issues are opened by people who actually ran it.

## What not to do

No upvote asks, no bot accounts, no "🚀". No posting the same text in two places. No launching before a stranger has run `npx thursday-agent` on a machine you have never touched.
