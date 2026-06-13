#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$ROOT_DIR/dist"
LOCALES_FILE="$ROOT_DIR/locales.json"

hash_file() {
  local file_path="$1"

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file_path" | awk '{print $1}'
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file_path" | awk '{print $1}'
    return
  fi

  echo "No SHA-256 hashing tool found" >&2
  exit 1
}

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

cp "$ROOT_DIR/index.html" "$DIST_DIR/index.html"
cp "$ROOT_DIR/404.html" "$DIST_DIR/404.html"

BUILT_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
COMMIT_HASH="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")"

python3 - "$LOCALES_FILE" "$DIST_DIR/locales.json" "$COMMIT_HASH" <<'PYEOF'
import json, sys
src, dst, version = sys.argv[1], sys.argv[2], sys.argv[3]
with open(src) as f:
    data = json.load(f)
data["version"] = version
with open(dst, "w") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
PYEOF

LOCALES="$(python3 -c "import json,sys; data=json.load(open(sys.argv[1])); print('\n'.join(data['locales']))" "$LOCALES_FILE")"

while IFS= read -r locale; do
  if [ -z "$locale" ]; then
    continue
  fi

  if [ ! -d "$ROOT_DIR/$locale" ]; then
    echo "Missing locale directory: $locale" >&2
    exit 1
  fi

  mkdir -p "$DIST_DIR/$locale"
  cp -R "$ROOT_DIR/$locale/." "$DIST_DIR/$locale/"

  MAIN_FILE="$DIST_DIR/$locale/$locale.json"
  DYNAMIC_FILE="$DIST_DIR/$locale/$locale.dynamic.json"

  if [ ! -f "$MAIN_FILE" ]; then
    echo "Missing locale main file: $MAIN_FILE" >&2
    exit 1
  fi

  if [ ! -f "$DYNAMIC_FILE" ]; then
    echo "Missing locale dynamic file: $DYNAMIC_FILE" >&2
    exit 1
  fi

  MAIN_HASH="$(hash_file "$MAIN_FILE")"
  DYNAMIC_HASH="$(hash_file "$DYNAMIC_FILE")"

  cat > "$DIST_DIR/$locale/version.json" <<EOF
{
  "locale": "$locale",
  "builtAt": "$BUILT_AT",
  "hash": [
    "$MAIN_HASH",
    "$DYNAMIC_HASH"
  ]
}
EOF
done <<< "$LOCALES"
