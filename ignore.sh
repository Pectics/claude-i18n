#!/usr/bin/env bash

set -euo pipefail

deploy_paths=(
  "build.sh"
  "ignore.sh"
  "vercel.json"
  "index.html"
  "404.html"
  "locales.json"
  "assets"
)

head_ref="${VERCEL_GIT_COMMIT_SHA:-HEAD}"
if ! git cat-file -e "$head_ref^{commit}" 2>/dev/null; then
  head_ref="HEAD"
fi

commit_message="${VERCEL_GIT_COMMIT_MESSAGE:-}"
if [ -z "$commit_message" ]; then
  commit_message="$(git log -1 --pretty=%B "$head_ref" 2>/dev/null || true)"
fi

if printf '%s\n' "$commit_message" | grep -Eiq '\[deploy\]'; then
  echo "Deploy forced by commit message marker: [deploy]"
  exit 1
fi

if [ "${VERCEL_ENV:-}" = "preview" ]; then
  echo "Preview deployment requested; deploy."
  exit 1
fi

commit_ref="${VERCEL_GIT_COMMIT_REF:-}"
pull_request_id="${VERCEL_GIT_PULL_REQUEST_ID:-}"
base_ref=""

is_preview_branch=false
if [ -n "$pull_request_id" ]; then
  is_preview_branch=true
elif [ -n "$commit_ref" ] && [ "$commit_ref" != "main" ] && [ "$commit_ref" != "master" ]; then
  is_preview_branch=true
fi

if [ "$is_preview_branch" = "true" ]; then
  for candidate in origin/main main origin/master master; do
    if git cat-file -e "$candidate^{commit}" 2>/dev/null; then
      base_ref="$(git merge-base "$head_ref" "$candidate" 2>/dev/null || true)"
      [ -n "$base_ref" ] && break
    fi
  done

  if [ -z "$base_ref" ]; then
    echo "Could not find a preview branch merge base; deploy."
    exit 1
  fi
else
  base_ref="${VERCEL_GIT_PREVIOUS_SHA:-}"
  if [ -n "$base_ref" ] && ! git cat-file -e "$base_ref^{commit}" 2>/dev/null; then
    echo "Previous Vercel SHA is not available in this clone; falling back to the parent commit."
    base_ref=""
  fi

  if [ -z "$base_ref" ]; then
    if git rev-parse --verify "$head_ref^" >/dev/null 2>&1; then
      base_ref="$head_ref^"
    else
      echo "No comparison commit found; deploy."
      exit 1
    fi
  fi
fi

if [ ! -f "locales.json" ]; then
  echo "locales.json is unavailable; deploy."
  exit 1
fi

if ! locale_paths="$(python3 - "locales.json" <<'PYEOF'
import json
import re
import sys

with open(sys.argv[1], encoding="utf-8") as file:
    data = json.load(file)

locales = data.get("locales")
pattern = re.compile(r"^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")
if not isinstance(locales, list) or not locales:
    raise ValueError("locales.json must contain a non-empty locales array")
if any(not isinstance(locale, str) or not pattern.fullmatch(locale) for locale in locales):
    raise ValueError("locales.json contains an invalid locale")

print("\n".join(locales))
PYEOF
)"; then
  echo "Could not read locale deployment paths; deploy."
  exit 1
fi

while IFS= read -r locale_path; do
  [ -n "$locale_path" ] && deploy_paths+=("$locale_path")
done <<< "$locale_paths"

if ! changed_files="$(git diff --name-only "$base_ref" "$head_ref" -- "${deploy_paths[@]}")"; then
  echo "Could not inspect changed deployment paths; deploy."
  exit 1
fi

if [ -z "$changed_files" ]; then
  echo "No deployment-relevant changes; skip Vercel build."
  exit 0
fi

echo "Deployment-relevant changes detected:"
printf '%s\n' "$changed_files"
exit 1
