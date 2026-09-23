#!/usr/bin/env node
// Kept where skills installed before 0.14 call it: the camera that shoots what a bot made is
// the artifact skill's (artifact/runtime/render.mjs), and this runs that one.
await import(
  new URL("../../artifact/runtime/render.mjs", import.meta.url).href
);
