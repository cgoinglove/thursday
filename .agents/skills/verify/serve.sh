#!/bin/bash
# Serve this checkout on its own empty data folder, never the user's database.
#   serve.sh start [port]   prints the URL once it answers
#   serve.sh stop           stops only what start began, and removes its data folder
set -u
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
STATE_DIR="${TMPDIR:-/tmp}/thursday-verify"
STATE="$STATE_DIR/state"
mkdir -p "$STATE_DIR"

free_port() {
  local p="${1:-3988}"
  while lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; do p=$((p + 1)); done
  echo "$p"
}

dev_server_here() {
  for pid in $(pgrep -f "next dev" 2>/dev/null); do
    lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | grep -qx "n$ROOT" && return 0
  done
  return 1
}

case "${1:-}" in
start)
  if [ -f "$STATE" ]; then echo "already up: $(cut -d' ' -f1 "$STATE") (run stop first)"; exit 1; fi
  PORT="$(free_port "${2:-3988}")"
  HOME_DIR="$(mktemp -d "$STATE_DIR/home.XXXXXX")"
  cd "$ROOT" || exit 1
  if dev_server_here; then
    # Next allows one dev server per folder: build and serve the build instead
    pnpm -s build > "$HOME_DIR/build.log" 2>&1 || { tail -30 "$HOME_DIR/build.log"; rm -rf "$HOME_DIR"; exit 1; }
    (THURSDAY_HOME="$HOME_DIR" THURSDAY_SKIP_BROWSER=1 nohup pnpm -s exec next start -H 127.0.0.1 -p "$PORT" > "$HOME_DIR/server.log" 2>&1 &)
  else
    (THURSDAY_HOME="$HOME_DIR" THURSDAY_SKIP_BROWSER=1 nohup pnpm -s exec next dev -H 127.0.0.1 -p "$PORT" > "$HOME_DIR/server.log" 2>&1 &)
  fi
  echo "http://127.0.0.1:$PORT $HOME_DIR" > "$STATE"
  for _ in $(seq 1 90); do
    curl -s -o /dev/null -m 2 "http://127.0.0.1:$PORT/" && { echo "http://127.0.0.1:$PORT"; exit 0; }
    sleep 1
  done
  echo "did not answer in 90s; log: $HOME_DIR/server.log"; tail -20 "$HOME_DIR/server.log"; exit 1
  ;;
stop)
  [ -f "$STATE" ] || { echo "nothing to stop"; exit 0; }
  read -r URL HOME_DIR < "$STATE"
  PORT="${URL##*:}"
  for pid in $(lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null); do kill "$pid" 2>/dev/null; done
  sleep 1
  case "$HOME_DIR" in "$STATE_DIR"/home.*) rm -rf "$HOME_DIR" ;; esac
  rm -f "$STATE"
  echo "stopped $URL"
  ;;
*)
  echo "usage: serve.sh start [port] | stop"; exit 2
  ;;
esac
