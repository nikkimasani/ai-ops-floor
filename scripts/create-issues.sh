#!/usr/bin/env bash
# Files docs/issues/*.md as GitHub issues. Needs the GitHub CLI logged in: gh auth login
set -euo pipefail
cd "$(dirname "$0")/.."
for f in docs/issues/*.md; do
  title="$(head -1 "$f" | sed 's/^# //')"
  gh issue create --title "$title" --body-file "$f" --label backlog || true
done
