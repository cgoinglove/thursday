---
name: skill-creator
description: "Creates new skills and improves existing ones. Use it when the user wants a repeatable way of working written down, or a skill fixed or made to trigger better, even without the word skill."
---

# Skill Creator

A skill for creating new skills and iteratively improving them.

At a high level, the process of creating a skill goes like this:

- Decide what you want the skill to do and roughly how it should do it
- Write a draft of the skill
- Create a few test prompts and run them yourself with the skill loaded
- Show the user the results and ask what they would change
- Rewrite the skill based on the user's feedback
- Repeat until you're satisfied
- Expand the test set and try again at larger scale

Your job when using this skill is to figure out where the user is in this process and then jump in and help them progress through these stages. So for instance, maybe they're like "I want to make a skill for X". You can help narrow down what they mean, write a draft, write the test cases, run all the prompts, and repeat.

On the other hand, maybe they already have a draft of the skill. In this case you can go straight to the test/iterate part of the loop.

Of course, you should always be flexible and if the user is like "I don't need to run a bunch of evaluations, just vibe with me", you can do that instead.

Cool? Cool.

## In this app

This section replaces the parts of Anthropic's original that run only in Claude's own products. Where it and the rest of this skill disagree, this section wins.

### Who does the writing

**If you are Thursday**, on a call, the interview is yours, out loud (one question per turn, no lists read aloud), and it includes who the skill is for: one bot, or every bot. Then hand the whole brief with `thread_start` to the bot it is for, or to any bot when it is for every bot. The bot cannot hear the call, so the request carries every answer, who the skill is for, and that the skill is validated before it is reported. Writing and testing a skill takes minutes, which is a bot's work.

**If you are a bot**, the brief is in your hands. The user is not at your screen: what you need from them goes to Thursday with `send_message`, kind `question` (clearly, with the context to answer, and short options when they help), and your turn ends there until the answer brings you back. So ask what only the user knows in one question with parts, not an interview, and never ask what the brief or the conversation already answers.

### Who it is for, and where it goes

Before you write a new skill, unless the request already says who it is for, send Thursday one question: what the skill is and why this job needs it, with the options "Only this bot" and "Every bot". Wait for the answer. If the user left it to you ("up to you", "decide yourself"), it is for this bot only. If they asked for it for everyone, it is for every bot.

- **Only this bot:** `<your own folder>/.agents/skills/<name>/` (the Environment names your own folder). Listed to you alone.
- **Every bot:** `.agents/skills/<name>/` at the workspace root, where your shell starts. Listed to every bot, and to the call.

The shipped skills in `$THURSDAY_SKILLS` come with the app and are read-only: never write there. When two skills share a name, the shipped one wins and the other is not listed at all, and a bot's own skill wins over an every-bot skill of the same name. To change a shipped skill, copy its folder into one of the two places above under a new name and edit the copy. That is a new skill, so ask who it is for.

To improve a skill the user already has, edit it where it is and keep its name and its folder's name: they are what the user's earlier requests and other skills refer to. `write_file` replaces a whole file, so read the file first.

### Testing, without a benchmark runner

There is no benchmark runner here: no subagents running each test with and without the skill, no baseline, no grading or benchmark scripts, no review viewer, no description optimization loop. Testing follows the path Anthropic's original gives for Claude.ai, which lacks them too:

1. **Run the test prompts yourself, one at a time.** Load the skill with `load_skill` (after an edit, read its SKILL.md again with the shell), then follow its instructions to accomplish the test prompt yourself, doing the real work in the job's scratch folder. This is less rigorous than independent runs (you wrote the skill and you're also running it, so you have full context), but it's a useful sanity check, and the human review step compensates. A step whose effect would outlast the test (sending, posting, buying, booking, deleting) stops at a draft that shows what it would have done.
2. **Show the results and ask for feedback.** In one question to Thursday: for each test case, the prompt and what came out, naming each file so the user can open it, then "How does this look? Anything you'd change?" A question ends your turn, so the test prompts go in this question with their results rather than in one of their own.
3. **Fix the skill and run the test cases again**, until the user is happy.

Keep the test prompts and their outputs in the job's scratch folder, not in the skill's folder: every file there is listed to whoever loads the skill.

### Descriptions here

Every bot reads every skill's full description on every step; the call reads at most its first sentence, cut at 90 characters. So the first sentence says what the skill does on its own, and the when follows. Write it in the third person ("Turns a meeting transcript into…", not "I can…" or "You can…"), and with the words the user actually says, in the language they speak, not only English.

### Scripts

Node is guaranteed (the app runs on it); Python and anything else may be missing. Write a bundled script for Node, or have the skill check for what its script needs before it runs it. `load_skill` lists a skill's files along with its body, up to a limit, and past it only says how many more there are; keep the tree small enough to be listed whole.

### Before you report

```bash
node $THURSDAY_SKILLS/skill-creator/scripts/validate.mjs <the skill's folder>
```

It checks what fails silently: frontmatter the app cannot parse, keys outside the spec, a name that does not match its folder, a name another skill already holds. A folder that does not pass is a skill the app skips or another app refuses, without telling anyone, which looks exactly like one that was never written. Fix it and run it again until it passes.

Then report the path, who the skill is for, and the description you settled on: to the user that line is the whole skill, because it is what makes it trigger. `load_skill` finds the skill by its exact name at once; the skill lists show it from the next turn or call.

## Communicating with the user

The skill creator is liable to be used by people across a wide range of familiarity with coding jargon. If you haven't heard (and how could you, it's only very recently that it started), there's a trend now where the power of AI agents is inspiring plumbers to open up their terminals, parents and grandparents to google "how to install npm". On the other hand, the bulk of users are probably fairly computer-literate.

So please pay attention to context cues to understand how to phrase your communication! In the default case, just to give you some idea:

- "evaluation" and "benchmark" are borderline, but OK
- for "JSON" and "assertion" you want to see serious cues from the user that they know what those things are before using them without explaining them

It's OK to briefly explain terms if you're in doubt, and feel free to clarify terms with a short definition if you're unsure if the user will get it. Here the user usually hears your words in Thursday's voice, which makes plain words matter even more.

---

## Creating a skill

### Capture Intent

Start by understanding the user's intent. The current conversation might already contain a workflow the user wants to capture (e.g., they say "turn this into a skill"). If so, extract answers from the conversation history first — the tools used, the sequence of steps, corrections the user made, input/output formats observed. The user may need to fill the gaps, and should confirm before proceeding to the next step.

1. What should this skill enable a bot to do?
2. When should this skill trigger? (what user phrases/contexts)
3. What's the expected output format?
4. Should we set up test cases to verify the skill works? Skills with objectively verifiable outputs (file transforms, data extraction, code generation, fixed workflow steps) benefit from test cases. Skills with subjective outputs (writing style, art) often don't need them. Suggest the appropriate default based on the skill type, but let the user decide.

### Interview and Research

Proactively ask questions about edge cases, input/output formats, example files, success criteria, and dependencies. Wait to write test prompts until you've got this part ironed out.

Check your connected tools and the web if useful for research (searching docs, finding similar skills, looking up best practices); the `find-skills` skill searches the open registry for skills that already exist. Come prepared with context to reduce burden on the user.

### Write the SKILL.md

Based on the user interview, fill in these components:

- **name**: Skill identifier, and the name of its folder
- **description**: When to trigger, what it does. This is the primary triggering mechanism - include both what the skill does AND specific contexts for when to use it. All "when to use" info goes here, not in the body. Note: currently models have a tendency to "undertrigger" skills -- to not use them when they'd be useful. To combat this, please make the skill descriptions a little bit "pushy". So for instance, instead of "How to build a simple fast dashboard to display internal company data.", you might write "How to build a simple fast dashboard to display internal company data. Make sure to use this skill whenever the user mentions dashboards, data visualization, internal metrics, or wants to display any kind of company data, even if they don't explicitly ask for a 'dashboard.'" (How this app shows it: In this app › Descriptions here.)
- **compatibility**: Required tools, dependencies (optional, rarely needed)
- **the rest of the skill :)**

### Skill Writing Guide

#### Anatomy of a Skill

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter (name, description required)
│   └── Markdown instructions
└── Bundled Resources (optional)
    ├── scripts/    - Executable code for deterministic/repetitive tasks
    ├── references/ - Docs loaded into context as needed
    └── assets/     - Files used in output (templates, icons, fonts)
```

#### Progressive Disclosure

Skills use a three-level loading system:
1. **Metadata** (name + description) - Always in context (~100 words)
2. **SKILL.md body** - In context whenever skill triggers (<500 lines ideal)
3. **Bundled resources** - As needed (unlimited, scripts can execute without loading)

These word counts are approximate and you can feel free to go longer if needed.

**Key patterns:**
- Keep SKILL.md under 500 lines; if you're approaching this limit, add an additional layer of hierarchy along with clear pointers about where the model using the skill should go next to follow up.
- Reference files clearly from SKILL.md with guidance on when to read them
- For large reference files (>300 lines), include a table of contents

**Domain organization**: When a skill supports multiple domains/frameworks, organize by variant:
```
cloud-deploy/
├── SKILL.md (workflow + selection)
└── references/
    ├── aws.md
    ├── gcp.md
    └── azure.md
```
The model reads only the relevant reference file.

#### Principle of Lack of Surprise

This goes without saying, but skills must not contain malware, exploit code, or any content that could compromise system security. A skill's contents should not surprise the user in their intent if described. Don't go along with requests to create misleading skills or skills designed to facilitate unauthorized access, data exfiltration, or other malicious activities. Things like a "roleplay as an XYZ" are OK though.

#### Writing Patterns

Prefer using the imperative form in instructions.

**Defining output formats** - You can do it like this:
```markdown
## Report structure
ALWAYS use this exact template:
# [Title]
## Executive summary
## Key findings
## Recommendations
```

**Examples pattern** - It's useful to include examples. You can format them like this (but if "Input" and "Output" are in the examples you might want to deviate a little):
```markdown
## Commit message format
**Example 1:**
Input: Added user authentication with JWT tokens
Output: feat(auth): implement JWT-based authentication
```

### Writing Style

Try to explain to the model why things are important in lieu of heavy-handed musty MUSTs. Use theory of mind and try to make the skill general and not super-narrow to specific examples. Start by writing a draft and then look at it with fresh eyes and improve it.

### Test Cases

After writing the skill draft, come up with 2-3 realistic test prompts — the kind of thing a real user would actually say. Then run them, as In this app describes, and share them with the user together with their results.

---

## Improving the skill

This is the heart of the loop. You've run the test cases, the user has reviewed the results, and now you need to make the skill better based on their feedback.

### How to think about improvements

1. **Generalize from the feedback.** The big picture thing that's happening here is that we're trying to create skills that can be used a million times (maybe literally, maybe even more who knows) across many different prompts. Here you and the user are iterating on only a few examples over and over again because it helps move faster. The user knows these examples in and out and it's quick for them to assess new outputs. But if the skill you and the user are codeveloping works only for those examples, it's useless. Rather than put in fiddly overfitty changes, or oppressively constrictive MUSTs, if there's some stubborn issue, you might try branching out and using different metaphors, or recommending different patterns of working. It's relatively cheap to try and maybe you'll land on something great.

2. **Keep the prompt lean.** Remove things that aren't pulling their weight. Make sure to look back at how each test run went, not just the final outputs — if it looks like the skill is making the model waste a bunch of time doing things that are unproductive, you can try getting rid of the parts of the skill that are making it do that and seeing what happens.

3. **Explain the why.** Try hard to explain the **why** behind everything you're asking the model to do. Today's LLMs are *smart*. They have good theory of mind and when given a good harness can go beyond rote instructions and really make things happen. Even if the feedback from the user is terse or frustrated, try to actually understand the task and why the user is writing what they wrote, and what they actually wrote, and then transmit this understanding into the instructions. If you find yourself writing ALWAYS or NEVER in all caps, or using super rigid structures, that's a yellow flag — if possible, reframe and explain the reasoning so that the model understands why the thing you're asking for is important. That's a more humane, powerful, and effective approach.

4. **Look for repeated work across test cases.** Look back at the test runs and notice if they all independently wrote similar helper scripts or took the same multi-step approach to something. If all 3 test cases resulted in writing a `create_docx.mjs` or a `build_chart.mjs`, that's a strong signal the skill should bundle that script. Write it once, put it in `scripts/`, and tell the skill to use it. This saves every future invocation from reinventing the wheel.

This task is pretty important and your thinking time is not the blocker; take your time and really mull things over. I'd suggest writing a draft revision and then looking at it anew and making improvements. Really do your best to get into the head of the user and understand what they want and need.

### The iteration loop

After improving the skill:

1. Apply your improvements to the skill
2. Rerun all test cases
3. Show the user the new results and ask for feedback, in one question to Thursday
4. Wait for the answer
5. Read the new feedback, improve again, repeat

Keep going until:
- The user says they're happy
- The feedback has nothing left to change (everything looks good)
- You're not making meaningful progress

---

## Description Optimization

The description field in SKILL.md frontmatter is the primary mechanism that determines whether a model invokes a skill. After creating or improving a skill, check the description for triggering accuracy. Nothing in this app measures it (there is no optimization loop), so the check is done by reading.

### How skill triggering works

Understanding the triggering mechanism helps design better eval queries. Skills appear in the model's Skills list with their name + description, and the model decides whether to consult a skill based on that description. The important thing to know is that models only consult skills for tasks they can't easily handle on their own — simple, one-step queries like "read this PDF" may not trigger a skill even if the description matches perfectly, because the model can handle them directly with basic tools. Complex, multi-step, or specialized queries reliably trigger skills when the description matches.

This means your eval queries should be substantive enough that the model would actually benefit from consulting a skill. Simple queries like "read file X" are poor test cases — they won't trigger skills regardless of description quality.

### Checking it by reading

Write a few queries of each kind, should-trigger and should-not-trigger, and read the description against each one as a model that sees only the list would.

The queries must be realistic and something a user would actually say. Not abstract requests, but requests that are concrete and specific and have a good amount of detail. For instance, file paths, personal context about the user's job or situation, column names and values, company names, URLs. A little bit of backstory. Some might be in lowercase or contain abbreviations or typos or casual speech.

Bad: `"Format this data"`, `"Extract text from PDF"`, `"Create a chart"`

Good: `"ok so my boss just sent me this xlsx file (its in my downloads, called something like 'Q4 sales final FINAL v2.xlsx') and she wants me to add a column that shows the profit margin as a percentage. The revenue is in column C and costs are in column D i think"`

For the **should-trigger** queries, think about coverage. You want different phrasings of the same intent — some formal, some casual. Include cases where the user doesn't explicitly name the skill or file type but clearly needs it. Throw in some uncommon use cases and cases where this skill competes with another but should win.

For the **should-not-trigger** queries, the most valuable ones are the near-misses — queries that share keywords or concepts with the skill but actually need something different. Think adjacent domains, ambiguous phrasing where a naive keyword match would trigger but shouldn't, and cases where the query touches on something the skill does but in a context where another tool is more appropriate.

The key thing to avoid: don't make should-not-trigger queries obviously irrelevant. "Write a fibonacci function" as a negative test for a PDF skill is too easy — it doesn't test anything. The negative cases should be genuinely tricky.

Read them against the other skills on your list too: the description competes with them for the model's attention, so make it distinctive and immediately recognizable. Where a should-trigger query would be missed, widen the description in the words the user would use; where a near-miss would fire it, say where the skill stops. Generalize rather than add the words of one query.

---

Repeating one more time the core loop here for emphasis:

- Figure out what the skill is about, and who it is for
- Draft or edit the skill
- Run the test prompts yourself with the skill loaded
- Show the user the outputs and ask for feedback
- Repeat until you and the user are satisfied
- Validate it, and report where it is and who it is for

Good luck!

---

Adapted from Anthropic's skill-creator (Apache-2.0) at anthropics/skills 34040c9: the subagent eval runs, benchmark and grading scripts, review viewer, blind comparison, description optimization loop, packaging and the Claude.ai and Cowork sections are removed, and one In this app section says who writes a skill, who it is for, where it goes, and how to test it by hand as the Claude.ai path does.
