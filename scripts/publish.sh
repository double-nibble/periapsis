#!/usr/bin/env bash
# Build the CLI and reporter bundles and publish them, with the installer, to the
# status site's bucket. Also uploads bootstrap.json and root.pub.json when they
# are in the current directory. Every file published is public.
#
#   scripts/publish.sh <registry bucket>      (or set REGISTRY_BUCKET)
#
set -euo pipefail

BUCKET="${1:-${REGISTRY_BUCKET:-}}"
if [ -z "$BUCKET" ]; then
  echo "usage: scripts/publish.sh <registry bucket> (or set REGISTRY_BUCKET)" >&2
  exit 1
fi
HERE="$PWD"
cd "$(dirname "$0")/.."

pnpm build
pnpm bundle

put() {
  aws s3 cp "$1" "s3://$BUCKET/$2" --content-type "$3" --cache-control "max-age=60" --only-show-errors
  echo "published $2"
}
put scripts/install.sh install.sh text/x-shellscript
put dist-bundle/periapsis.mjs periapsis.mjs text/javascript
put dist-bundle/reporter.mjs reporter.mjs text/javascript
for f in bootstrap.json root.pub.json; do
  if [ -f "$HERE/$f" ]; then put "$HERE/$f" "$f" application/json; fi
done

echo
echo "Reporters update by running the installer again; it keeps their keys and config."
