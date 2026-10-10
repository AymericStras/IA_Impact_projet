#!/usr/bin/env bash
# Publish the current commit to the team's public repository as a branch.
#
#   scripts/publish_team_branch.sh            # shows what would be pushed
#   scripts/publish_team_branch.sh --push     # pushes
#
# The published tree is HEAD with three changes, because that repository is
# public: the owner's deployment files and plan are left out, and the
# trademarked logo is replaced by the placeholders. Each run adds one commit
# on top of the branch.
set -euo pipefail

REMOTE_URL="${TEAM_REMOTE:-git@github.com:AymericStras/IA_Impact_projet.git}"
BRANCH="${TEAM_BRANCH:-feature/bilan-pdf-email}"
PRIVATE_PATHS=(docs/DEPLOYMENT.md docs/TECHNICAL_PLAN.zh-CN.md deploy/compose.yaml deploy/gateway-sncf-bilan.conf)

cd "$(git rev-parse --show-toplevel)"
if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean; commit first." >&2
  exit 1
fi
source_commit=$(git rev-parse --short=12 HEAD)

export GIT_INDEX_FILE
GIT_INDEX_FILE=$(mktemp)
trap 'rm -f "$GIT_INDEX_FILE"' EXIT
git read-tree HEAD
git rm -q --cached --ignore-unmatch "${PRIVATE_PATHS[@]}"
for name in logo.svg logo.png; do
  blob=$(git rev-parse "HEAD:assets/brand/placeholder/$name")
  git update-index --cacheinfo "100644,$blob,assets/brand/$name"
done
tree=$(git write-tree)

if git ls-files -s | grep -q -E "credentials\.env$|\.private\.zip$"; then
  echo "A credentials file is tracked; refusing to publish." >&2
  exit 1
fi

parent_args=()
if parent=$(git ls-remote "$REMOTE_URL" "refs/heads/$BRANCH" | cut -f1) && [ -n "$parent" ]; then
  git fetch -q "$REMOTE_URL" "refs/heads/$BRANCH"
  parent_args=(-p "$parent")
fi
commit=$(git commit-tree "$tree" ${parent_args[@]+"${parent_args[@]}"} -m "sncf_bilan: trip recap service (PDF + email), from $source_commit

Published copy: the logo is a placeholder and the owner's deployment files
are left out. See README.md.")

echo "Branch:  $BRANCH on $REMOTE_URL"
echo "Commit:  $commit (tree of $source_commit, ${#PRIVATE_PATHS[@]} private paths removed, logo replaced)"
git ls-tree -r --name-only "$commit" | sed 's/^/  /'
if [ "${1:-}" != "--push" ]; then
  echo "Nothing pushed. Run again with --push."
  exit 0
fi
git push "$REMOTE_URL" "$commit:refs/heads/$BRANCH"
