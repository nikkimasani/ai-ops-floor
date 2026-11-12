#!/usr/bin/env bash
# Publish the probe results to the `data` branch as ONE commit (force-pushed). The branch is derived data,
# so we keep no history: the repository never grows, however often the probe runs.
set -euo pipefail
BRANCH="${DATA_BRANCH:-data}"
SRC="${1:-public/data}"
TMP="$(mktemp -d)"
TMPBRANCH="publish-$$"                      # unique, and deleted on exit, so repeated local runs never collide
trap 'git worktree remove --force "$TMP" >/dev/null 2>&1 || true; rm -rf "$TMP"; git branch -D "$TMPBRANCH" >/dev/null 2>&1 || true' EXIT
git worktree add --quiet --detach "$TMP"
(
  cd "$TMP"
  git checkout --quiet --orphan "$TMPBRANCH"
  git rm -rf --quiet . >/dev/null 2>&1 || true
  cp "$OLDPWD/$SRC"/*.json .
  git add -A
  git -c user.name="${GIT_AUTHOR_NAME:-ops-floor-bot}" -c user.email="${GIT_AUTHOR_EMAIL:-ops-floor-bot@users.noreply.github.com}" commit --quiet -m "data: probe $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  git push --quiet --force origin "$TMPBRANCH:$BRANCH"
)
echo "published $SRC to '$BRANCH'"
