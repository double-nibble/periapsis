#!/bin/bash
# Operator step: admit an identity to the registry and publish it.
# Adds a public key, signs the registry with the root key, uploads to the bucket.
# The root private key stays with the operator; never in CI or the repo.
set -euo pipefail

if [ $# -lt 3 ]; then
  echo "usage: publish-registry.sh <root.key> <bucket> <name.pub.json> [more.pub.json ...]"
  exit 1
fi

ROOT_KEY="$1"; BUCKET="$2"; shift 2
CLI="$(dirname "$0")/../dist/cli.js"
WORK="$(mktemp -d)"
REG="$WORK/registry.json"

# Start from the current published registry if present, else empty.
aws s3 cp "s3://$BUCKET/registry.json" "$WORK/signed.json" 2>/dev/null \
  && node -e "const fs=require('fs');fs.writeFileSync('$REG',JSON.stringify(JSON.parse(fs.readFileSync('$WORK/signed.json','utf8')).registry))" \
  || echo '{"identities":{},"signedAt":0}' > "$REG"

for PUB in "$@"; do
  node "$CLI" registry-add "$REG" "$PUB" > "$REG.tmp" && mv "$REG.tmp" "$REG"
done

node "$CLI" sign-registry "$ROOT_KEY" "$REG" > "$WORK/signed.json"
aws s3 cp "$WORK/signed.json" "s3://$BUCKET/registry.json" --content-type application/json
echo "published signed registry to s3://$BUCKET/registry.json"
rm -rf "$WORK"
