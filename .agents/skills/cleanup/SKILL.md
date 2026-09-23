---
name: cleanup
description: Weekly cleanup of code that nothing uses any more - unused files, exports, dependencies and deprecated API calls - deleted only after each one is proven dead. Use when asked to clean up, remove dead or unused code, or when the weekly cleanup reminder is due.
---

Agents rarely delete: they wrap old code in guards and leave the replaced path behind. This pass finds what nothing reaches and removes it, and the burden of proof is on deletion.

1. Find candidates, from the repository root:
   - `pnpm knip` (never with `--cache`: on Next 16 a warm cache reports every `page.tsx` as unused).
   - `node .agents/skills/cleanup/deprecated.cjs` lists every call the installed types mark deprecated. `keyCode === 229` beside `isComposing` stays wherever it is: Safari confirms Korean input with `isComposing` already false.
2. Prove each candidate dead before touching it. Default to alive. It is alive if any of these finds it:
   - its file's basename or its exported name as a plain string anywhere in the repo, including `skills/`, `bin/`, `scripts/`, `.github/`, `package.json` and markdown;
   - a dynamic `import()` or a path built at runtime (`config.ts` paths, route segments);
   - a Next special file or route convention (`page`, `layout`, `route`, `instrumentation`, `proxy`, `opengraph-image`…);
   - an import kept for its side effect.
3. Leave alone whatever another session has uncommitted (`git status`), and anything under `*.local.*`, `.sign-ins/`, `.ai-workspace/`, `workspace/`.
4. Delete what is proven dead: the whole body, never an underscore rename or a guard. When knip strips an `export` and Biome then reports the function unused, delete the function.
5. Run `pnpm typecheck`, `pnpm lint` and every offline test suite (`pnpm test:live`, `test:bot`, `test:memory`, `test:reach`, `test:artifact`, `test:skills`).
6. Report in the user's language: what was deleted and the proof each was dead, what stayed and which check kept it alive, the before and after counts. Commit only when asked, only these files, by path.
7. Record the run: `python3 .claude/hooks/stamp.py cleanup`.
