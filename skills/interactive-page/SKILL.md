---
name: interactive-page
description: "A result meant to be used, not just read: controls, tabs, charts, a calculator. One self-contained HTML file opened from your report; a result only read is a .md."
license: Complete terms in LICENSE.txt
---

# Interactive Page

## In this app

- The scripts live in this skill's directory (the absolute path you were handed
  when you loaded it), not in your cwd: `bash <skill dir>/scripts/init-artifact.sh <name>`.
- The project is made at `projects/<name>` in your workspace, wherever you run
  the script from — it finds the workspace itself. One project per page is
  fine: pnpm hard-links the store, so the 300 MB `node_modules` costs disk once.
- `bundle-artifact.sh`, run inside the project, builds one self-contained file
  and copies it to `artifacts/<name>.html` — that is the path it prints, and the
  path you hand back. The user opens it from the task row; the source stays in
  `projects/` and is not named in the report.
- To look at it yourself, the `browser` skill: it refuses `file:` URLs, so
  serve the folder first (`python3 -m http.server 48800 --bind 127.0.0.1 --directory <dir> &`),
  `goto http://127.0.0.1:48800/<name>.html`, and kill the server after.

To build a page, follow these steps:
1. Initialize the project using `scripts/init-artifact.sh`
2. Develop the page by editing the generated code
3. Bundle all code into a single HTML file using `scripts/bundle-artifact.sh`
4. Hand back the `artifacts/<name>.html` path the bundle script printed
5. (Optional) Test the page

**Stack**: React 18 + TypeScript + Vite (+ vite-plugin-singlefile for bundling) + Tailwind CSS + shadcn/ui

## Design & Style Guidelines

VERY IMPORTANT: To avoid what is often referred to as "AI slop", avoid using excessive centered layouts, purple gradients, uniform rounded corners, and Inter font.

## Quick Start

### Step 1: Initialize Project

Run the initialization script to create a new React project:
```bash
bash <skill dir>/scripts/init-artifact.sh <project-name>
cd projects/<project-name>
```

This creates a fully configured project with:
- ✅ React + TypeScript (via Vite)
- ✅ Tailwind CSS 3.4.1 with shadcn/ui theming system
- ✅ Path aliases (`@/`) configured
- ✅ 40+ shadcn/ui components pre-installed
- ✅ All Radix UI dependencies included
- ✅ vite-plugin-singlefile configured, so `vite build` emits one HTML file
- ✅ Node 18+ compatibility (auto-detects and pins Vite version)

### Step 2: Develop the Page

Edit the generated files. See **Common Development Tasks** below for guidance.

### Step 3: Bundle to Single HTML File

To bundle the React app into a single HTML file:
```bash
bash scripts/bundle-artifact.sh
```

This creates `bundle.html` - a self-contained file with all JavaScript, CSS, and dependencies inlined - and copies it to `artifacts/<project-name>.html` in the workspace. It opens from disk with no network.

**Requirements**: Your project must have an `index.html` in the root directory.

**What the script does**: `vite build` with vite-plugin-singlefile (already in the generated `vite.config.ts`), then copies `dist/index.html` to `bundle.html` and to the workspace's `artifacts/`. (Upstream used Parcel here; Parcel cannot resolve the `development` export condition in current @radix-ui packages, so the build failed on a fresh project.)

### Step 4: Hand back the path

Report the `artifacts/<project-name>.html` path the script printed. The user opens it from the task row.

### Step 5: Testing/Visualizing the Page (Optional)

Only when asked or when something looks wrong — testing upfront adds latency between the request and the finished file. See "In this app" above for how to open it in the browser (serve over http; `file:` is blocked).

## Reference

- **shadcn/ui components**: https://ui.shadcn.com/docs/components