#!/usr/bin/env bash
# Bring the previous probe results (history, incidents) back from the `data` branch, so the next probe run
# continues where the last one stopped. With no `data` branch yet, start clean (this also discards the
# committed DEMO data, so demo numbers can never be mixed into real history).
set -euo pipefail
BRANCH="${DATA_BRANCH:-data}"
DEST="${1:-public/data}"
mkdir -p "$DEST"
if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  git fetch --quiet --depth=1 origin "$BRANCH"
  rm -f "$DEST"/*.json
  git archive FETCH_HEAD | tar -x -C "$DEST"
  echo "restored previous data from '$BRANCH'"
else
  rm -f "$DEST"/*.json
  echo "no '$BRANCH' branch yet: starting with empty history"
fi
