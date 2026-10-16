#!/bin/bash
# Install the periapsis reporter as a launchd agent on macOS.
# Clones (if needed), builds, generates this account's keypair, and registers
# a LaunchAgent that runs the reporter. The private key never leaves this machine.
set -euo pipefail

REPO="https://github.com/double-nibble/periapsis"
ROOT="$HOME/.periapsis"
SRC="$ROOT/src"
CONFIG="$ROOT/config.json"
LOG="$ROOT/reporter.log"
PLIST_LABEL="com.double-nibble.periapsis-reporter"
PLIST="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"

mkdir -p "$ROOT"

command -v node >/dev/null || { echo "node is required (the claude CLI provides it)"; exit 1; }
command -v pnpm >/dev/null || npm install -g pnpm@9.12.0

# Clone or update, then build.
if [ -d "$SRC/.git" ]; then git -C "$SRC" pull --ff-only; else git clone "$REPO" "$SRC"; fi
( cd "$SRC" && pnpm install && pnpm build )

CLI="$SRC/packages/cli/dist/cli.js"

# First run: scaffold a config and generate this account's keypair.
if [ ! -f "$CONFIG" ]; then
  cp "$SRC/packages/reporter/install/config.example.json" "$CONFIG"
  ACCOUNT="$(node -e "process.stdout.write(require(process.argv[1]).account)" "$CONFIG")"
  echo "Generating the keypair for $ACCOUNT..."
  # keygen writes <account>.key in the current directory; run it in $ROOT.
  ( cd "$ROOT" && node "$CLI" keygen "$ACCOUNT" >"$ROOT/$ACCOUNT.pub.json" )
  # Merge the private keys into the config.
  node -e '
    const fs = require("fs");
    const [, , keyPath, cfgPath] = process.argv;
    const k = JSON.parse(fs.readFileSync(keyPath, "utf8"));
    const c = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    c.signPrivate = k.signPrivate;
    c.boxPrivate = k.boxPrivate;
    fs.writeFileSync(cfgPath, JSON.stringify(c, null, 2));
  ' "$ROOT/$ACCOUNT.key" "$CONFIG"
  chmod 600 "$ROOT/$ACCOUNT.key" "$CONFIG"
  echo ""
  echo "Config written to $CONFIG."
  echo "Edit it: set rootSignPublic, and each instance's token and login."
  echo "Then register this account's PUBLIC key with the operator:"
  echo "  $ROOT/$ACCOUNT.pub.json"
  echo "Re-run this script after editing the config to start the reporter."
  exit 0
fi

# Install the LaunchAgent.
NODE="$(command -v node)"
REPORTER="$SRC/packages/reporter/dist/main.js"
mkdir -p "$HOME/Library/LaunchAgents"
sed -e "s#__NODE__#$NODE#" -e "s#__REPORTER__#$REPORTER#" -e "s#__CONFIG__#$CONFIG#" -e "s#__LOG__#$LOG#" \
  "$SRC/packages/reporter/install/$PLIST_LABEL.plist" > "$PLIST"

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "periapsis reporter installed and started. Logs: $LOG"
