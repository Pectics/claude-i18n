#!/usr/bin/env bash
set -euo pipefail

# A queued workflow must calculate from the current main, never from its trigger SHA.
for attempt in 1 2 3; do
  git fetch --no-tags origin main
  git checkout -B locale-stats origin/main
  base_sha="$(git rev-parse HEAD)"

  node scripts/locale-stats/update_readme_stats.mjs --skip-invalid-targets
  if ! git diff --quiet -- README.md README.zh.md README.tw.md; then
    git config user.name "github-actions[bot]"
    git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
    git add -- README.md README.zh.md README.tw.md
    git commit -m "docs: Update locale pack statistics"
    if ! git push origin HEAD:refs/heads/main; then
      echo "main moved while pushing README statistics (attempt $attempt/3)." >&2
      continue
    fi
  fi

  git fetch --no-tags origin main
  if [ "$(git rev-parse origin/main)" = "$(git rev-parse HEAD)" ]; then
    echo "Statistics snapshot: $(git rev-parse HEAD) (started from $base_sha)"
    exit 0
  fi
  echo "main moved after statistics calculation (attempt $attempt/3)." >&2
done

echo "Could not calculate statistics from a stable main snapshot after three attempts." >&2
exit 1
