#!/usr/bin/env bash

set -euo pipefail

artifacts_dir=""
worktree_dir=""
branch="bot/coverage-data"
remote="origin"

usage() {
  echo "Usage: bash publish_coverage.sh --artifacts-dir <path> --worktree-dir <path> [--branch <name>] [--remote <name>]" >&2
  exit 2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --artifacts-dir)
      [ "$#" -ge 2 ] || usage
      artifacts_dir="$2"
      shift 2
      ;;
    --worktree-dir)
      [ "$#" -ge 2 ] || usage
      worktree_dir="$2"
      shift 2
      ;;
    --branch)
      [ "$#" -ge 2 ] || usage
      branch="$2"
      shift 2
      ;;
    --remote)
      [ "$#" -ge 2 ] || usage
      remote="$2"
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

[ -n "$artifacts_dir" ] || usage
[ -n "$worktree_dir" ] || usage
[ -f "$artifacts_dir/coverage.json" ] || { echo "Missing $artifacts_dir/coverage.json" >&2; exit 1; }
[ -d "$artifacts_dir/badges" ] || { echo "Missing $artifacts_dir/badges" >&2; exit 1; }
find "$artifacts_dir/badges" -maxdepth 1 -type f -name '*.svg' -print -quit | grep -q . \
  || { echo "No badge SVG files found in $artifacts_dir/badges" >&2; exit 1; }
[[ "$branch" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] || { echo "Invalid branch name: $branch" >&2; exit 1; }

repo_root="$(git rev-parse --show-toplevel)"
artifacts_dir="$(cd "$artifacts_dir" && pwd)"
worktree_dir="$(cd "$(dirname "$worktree_dir")" && pwd)/$(basename "$worktree_dir")"

cleanup() {
  git -C "$repo_root" worktree remove --force "$worktree_dir" >/dev/null 2>&1 || true
  rm -rf "$worktree_dir"
}
trap cleanup EXIT
cleanup

remote_ref="refs/remotes/$remote/$branch"
if git ls-remote --exit-code --heads "$remote" "$branch" >/dev/null 2>&1; then
  git fetch --no-tags "$remote" "+refs/heads/$branch:$remote_ref"
  git worktree add --detach "$worktree_dir" "$remote_ref"
else
  git worktree add --detach "$worktree_dir" HEAD
  git -C "$worktree_dir" checkout --orphan "$branch"
fi

git -C "$worktree_dir" rm -rf --ignore-unmatch . >/dev/null
git -C "$worktree_dir" clean -fdx >/dev/null
cp -a "$artifacts_dir/." "$worktree_dir/"
git -C "$worktree_dir" add -A

if git -C "$worktree_dir" diff --cached --quiet; then
  echo "published=false"
  exit 0
fi

git -C "$worktree_dir" config user.name "github-actions[bot]"
git -C "$worktree_dir" config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git -C "$worktree_dir" commit -m "chore: Update locale coverage data"
git -C "$worktree_dir" push "$remote" "HEAD:refs/heads/$branch"
echo "published=true"
