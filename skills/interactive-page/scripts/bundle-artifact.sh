#!/bin/bash
set -e

echo "📦 Bundling React app to a single HTML file..."

# Check if we're in a project directory
if [ ! -f "package.json" ]; then
  echo "❌ Error: No package.json found. Run this script from your project root."
  exit 1
fi
if [ ! -f "index.html" ]; then
  echo "❌ Error: No index.html found in project root."
  exit 1
fi

# The project made by init-artifact.sh already has vite-plugin-singlefile in
# vite.config.ts, so the whole bundle step is one build. Everything — JS, CSS,
# fonts, images under src/ — is inlined; nothing is fetched at open time.
rm -rf dist bundle.html
pnpm exec vite build
cp dist/index.html bundle.html

FILE_SIZE=$(du -h bundle.html | cut -f1)
echo ""
echo "✅ Bundle complete!"

# The finished file belongs in the workspace's artifacts/ — that is what the
# report names and the screen opens; the project stays where it is. The
# workspace is the nearest ancestor with a pnpm-workspace.yaml (the app plants
# one there); with none in sight, bundle.html here is all there is.
WORKSPACE_ROOT="$PWD"
while [ "$WORKSPACE_ROOT" != "/" ] && [ ! -f "$WORKSPACE_ROOT/pnpm-workspace.yaml" ]; do
  WORKSPACE_ROOT="$(dirname "$WORKSPACE_ROOT")"
done
if [ -f "$WORKSPACE_ROOT/pnpm-workspace.yaml" ]; then
  mkdir -p "$WORKSPACE_ROOT/artifacts"
  OUT="$WORKSPACE_ROOT/artifacts/$(basename "$PWD").html"
  cp bundle.html "$OUT"
  echo "📄 Output: artifacts/$(basename "$PWD").html ($FILE_SIZE) — hand back this path"
else
  echo "📄 Output: $(pwd)/bundle.html ($FILE_SIZE)"
fi
