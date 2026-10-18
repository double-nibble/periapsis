#!/usr/bin/env bash
# periapsis reporter installer (macOS). This machine generates its own identity
# and NATS nkey, installs a launchd agent, and prints an enrollment line for the
# operator to authorize. No password or private key is ever downloaded.
#
#   curl -fsSL https://status.<your-domain>/install.sh | bash -s -- https://status.<your-domain> <account>
#
set -euo pipefail

BASE="${1:-}"
ACCOUNT="${2:-}"
if [ -z "$BASE" ]; then
  printf "Status site base URL (e.g. https://status.example.com): "
  read -r BASE </dev/tty
fi
BASE="${BASE%/}"
if [ -z "$ACCOUNT" ]; then
  printf "Account name for this reporter: "
  read -r ACCOUNT </dev/tty
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install it (e.g. 'brew install node') and re-run." >&2
  exit 1
fi

DIR="$HOME/.periapsis"
mkdir -p "$DIR"

echo "Downloading reporter from $BASE ..."
curl -fsSL "$BASE/bootstrap.json" -o "$DIR/bootstrap.json"
curl -fsSL "$BASE/periapsis.mjs" -o "$DIR/periapsis.mjs"
curl -fsSL "$BASE/reporter.mjs" -o "$DIR/reporter.mjs"

BROKER=$(node -e "process.stdout.write(require('$DIR/bootstrap.json').brokerUrl)")
REGISTRY=$(node -e "process.stdout.write(require('$DIR/bootstrap.json').registryUrl)")
node -e "const b=require('$DIR/bootstrap.json');require('fs').writeFileSync('$DIR/root.pub.json',JSON.stringify({signPublic:b.rootSignPublic}))"
[ -f "$DIR/instances.json" ] || printf '[]\n' >"$DIR/instances.json"

BLOB=""
if [ -f "$DIR/config.json" ]; then
  echo "A config already exists at $DIR/config.json; keeping it (remove it to re-enroll)."
else
  BLOB=$(node "$DIR/periapsis.mjs" reporter-enroll --account "$ACCOUNT" \
    --broker "$BROKER" --registry "$REGISTRY" --root-pub "$DIR/root.pub.json" \
    --instances "$DIR/instances.json" --out "$DIR/config.json")
fi

NODE_BIN=$(command -v node)
PLIST="$HOME/Library/LaunchAgents/com.periapsis.reporter.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat >"$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.periapsis.reporter</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$DIR/reporter.mjs</string>
    <string>$DIR/config.json</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/reporter.log</string>
  <key>StandardErrorPath</key><string>$DIR/reporter.log</string>
</dict></plist>
PLIST_EOF

launchctl unload "$PLIST" >/dev/null 2>&1 || true
launchctl load "$PLIST"

echo
echo "Installed and running (logs: $DIR/reporter.log)."
if [ -n "$BLOB" ]; then
  echo
  echo "Send this enrollment token to your operator to authorize this reporter:"
  echo
  echo "  $BLOB"
  echo
  echo "Once authorized and the broker is reloaded, it connects within a minute."
fi
