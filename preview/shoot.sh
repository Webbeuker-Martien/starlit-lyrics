#!/usr/bin/env bash
# Renders the webview harness to PNGs with headless Chrome. Usage: bash preview/shoot.sh [outdir]
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
OUT="${1:-preview/out}"
mkdir -p "$OUT"
PROFILE="$(mktemp -d)"
ROOT="$(cygpath -m "$PWD" 2>/dev/null || pwd)"
OUT_ABS="$(cygpath -w "$(cd "$OUT" && pwd)" 2>/dev/null || (cd "$OUT" && pwd))"

shot() { # name query [width height]
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --force-prefers-reduced-motion \
    --user-data-dir="$PROFILE" --window-size="${3:-520},${4:-640}" --virtual-time-budget=2500 \
    --screenshot="$OUT_ABS/$1.png" "file:///$ROOT/preview/index.html?$2" >/dev/null 2>&1
  echo "$1.png"
}

shot starry-synced "state=synced&theme=starryNight"
shot starry-away "state=synced&theme=starryNight&away=1"
shot vscode-synced "state=synced&theme=matchVsCode"
shot vscode-away "state=synced&theme=matchVsCode&away=1"
shot starry-none "state=none"
shot starry-paused "state=synced&paused=1"
shot starry-plain "state=plain"
shot starry-loading "state=loading"
shot starry-signin "state=signedOut"
shot starry-instrumental "state=instrumental"
shot starry-podcast "state=podcast"
shot starry-ad "state=ad"
shot starry-nothing "state=nothing"
shot starry-error "state=error&banner=Spotify%20rate%20limit%20reached.%20Resuming%20in%2030%20s."
rm -rf "$PROFILE"
