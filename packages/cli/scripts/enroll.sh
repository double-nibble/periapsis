#!/bin/bash
# Operator step, run where root.key lives: authorize an enrollment token.
# Starts from the published registry (read from S3, not the CDN, so it is never
# stale), verifies it under the root key, adds the identity and its nkey,
# re-signs, uploads it, and writes accounts.conf for the broker.
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "usage: enroll.sh <root.key> <bucket> [token]   (token read from stdin if omitted)" >&2
  exit 1
fi

ROOT_KEY="$1"; BUCKET="$2"
TOKEN="${3:-$(cat)}"
CLI="$(cd "$(dirname "$0")/.." && pwd)/dist/cli.js"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# An absent registry means a new fleet; any other failure must stop us, or we
# would publish a registry that has lost every existing identity.
if ERR=$(aws s3api head-object --bucket "$BUCKET" --key registry.json 2>&1 >/dev/null); then
  aws s3 cp --quiet "s3://$BUCKET/registry.json" "$WORK/registry.json"
else
  case "$ERR" in
    *"Not Found"* | *"404"*) echo "no published registry yet; starting a new one" ;;
    *) echo "cannot read s3://$BUCKET/registry.json: $ERR" >&2; exit 1 ;;
  esac
fi

node "$CLI" enroll "$TOKEN" --root-key "$ROOT_KEY" --registry-file "$WORK/registry.json"
aws s3 cp --quiet "$WORK/registry.json" "s3://$BUCKET/registry.json" --content-type application/json
echo "published the signed registry to s3://$BUCKET/registry.json"
node "$CLI" broker-accounts --registry-file "$WORK/registry.json" --out accounts.conf
