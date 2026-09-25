#!/usr/bin/env node
// Kept where skills installed before the page skill was folded into artifact call it: the
// chart is the artifact skill's now (artifact/scripts/chart.mjs), and this runs that one.
await import(new URL("../../artifact/scripts/chart.mjs", import.meta.url).href);
