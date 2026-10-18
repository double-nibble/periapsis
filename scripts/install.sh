#!/usr/bin/env bash
# periapsis reporter installer (macOS). This machine generates its own identity
# and NATS nkey, writes ~/.periapsis/run to start the reporter in the foreground,
# and prints an enrollment token for the operator to authorize. No password or
# private key is ever downloaded.
#
#   curl -fsSL https://status.<your-domain>/install.sh | bash -s -- https://status.<your-domain> <account>
#
# To remove the reporter and its keys from this machine:
#
#   curl -fsSL https://status.<your-domain>/install.sh | bash -s -- --uninstall
#
set -euo pipefail

DIR="$HOME/.periapsis"
# Earlier versions ran the reporter as a launchd agent; remove it if present.
OLD_PLIST="$HOME/Library/LaunchAgents/com.periapsis.reporter.plist"
remove_old_agent() {
  if [ -f "$OLD_PLIST" ]; then
    launchctl unload "$OLD_PLIST" >/dev/null 2>&1 || true
    rm -f "$OLD_PLIST"
    echo "Removed the launchd agent from an earlier install."
  fi
}

if [ "${1:-}" = "--uninstall" ]; then
  remove_old_agent
  rm -rf "$DIR"
  echo "Removed $DIR (including this machine's keys)."
  echo "Installing again generates new keys, which need enrolling again."
  exit 0
fi

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
  if ! BLOB=$(node "$DIR/periapsis.mjs" reporter-enroll --account "$ACCOUNT" \
    --broker "$BROKER" --registry "$REGISTRY" --root-pub "$DIR/root.pub.json" \
    --instances "$DIR/instances.json" --out "$DIR/config.json" 2>"$DIR/enroll.err"); then
    cat "$DIR/enroll.err" >&2
    exit 1
  fi
  rm -f "$DIR/enroll.err"
fi

remove_old_agent

cat >"$DIR/run" <<RUN_EOF
#!/bin/sh
# Start this machine's periapsis reporter in the foreground; Ctrl-C stops it.
exec node "$DIR/reporter.mjs" "$DIR/config.json"
RUN_EOF
chmod +x "$DIR/run"

echo
echo "Installed in $DIR."
if [ -n "$BLOB" ]; then
  echo
  echo "Send this enrollment token to your operator to authorize this reporter:"
  echo
  echo "  $BLOB"
  echo
  echo "Once it is enrolled and the broker has the new accounts.conf, start the reporter:"
else
  echo "Start the reporter:"
fi
echo
echo "  $DIR/run"
echo
echo "It runs in the foreground (Ctrl-C to stop); set PERIAPSIS_LOG=debug for detail."
