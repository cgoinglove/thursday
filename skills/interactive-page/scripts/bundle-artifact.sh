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

# The finished file belongs in the bot's folder in artifacts/ — that is what
# the report names and the screen opens; the project stays where it is. The app
# hands that folder to the shell as THURSDAY_ARTIFACTS, relative to the
# workspace, which is the nearest ancestor with a pnpm-workspace.yaml (the app
# plants one there); with none in sight, bundle.html here is all there is.
WORKSPACE_ROOT="$PWD"
while [ "$WORKSPACE_ROOT" != "/" ] && [ ! -f "$WORKSPACE_ROOT/pnpm-workspace.yaml" ]; do
  WORKSPACE_ROOT="$(dirname "$WORKSPACE_ROOT")"
done
if [ -f "$WORKSPACE_ROOT/pnpm-workspace.yaml" ]; then
  OUT="${THURSDAY_ARTIFACTS:-artifacts}/$(basename "$PWD").html"
  mkdir -p "$(dirname "$WORKSPACE_ROOT/$OUT")"
  cp bundle.html "$WORKSPACE_ROOT/$OUT"
  echo "📄 Output: $OUT ($FILE_SIZE) — hand back this path"
else
  echo "📄 Output: $(pwd)/bundle.html ($FILE_SIZE)"
fi
