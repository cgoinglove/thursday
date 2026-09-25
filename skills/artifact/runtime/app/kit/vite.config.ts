import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// One page per build, named by PAGE (the artifact skill's scripts/app.mjs sets it). Each
// page keeps its own output and cache, so two pages can build at once.
const page = process.env.PAGE;
if (!page)
  throw new Error(
    "PAGE is not set: build with the artifact skill's scripts/app.mjs build <name>",
  );
const root = path.resolve(__dirname, "pages", page);

export default defineConfig({
  root,
  cacheDir: path.join(root, ".vite"),
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  // The root is the page's folder; the Tailwind and PostCSS setup is the kit's
  css: { postcss: __dirname },
  build: {
    outDir: path.join(root, "dist"),
    emptyOutDir: true,
  },
  logLevel: "warn",
});
