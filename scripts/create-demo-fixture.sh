#!/usr/bin/env bash
set -euo pipefail

destination="${1:-}"
if [[ -z "$destination" ]]; then
  destination="$(mktemp -d "${TMPDIR:-/tmp}/repo-time-machine-demo.XXXXXX")"
elif [[ -e "$destination" ]] && [[ -n "$(find "$destination" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  echo "Refusing to write into non-empty directory: $destination" >&2
  exit 1
fi

mkdir -p "$destination"
cd "$destination"
git init -b main >/dev/null

commit() {
  local message="$1"
  local date="$2"
  git add .
  GIT_AUTHOR_NAME="Demo Author" \
  GIT_AUTHOR_EMAIL="demo@example.com" \
  GIT_COMMITTER_NAME="Demo Author" \
  GIT_COMMITTER_EMAIL="demo@example.com" \
  GIT_AUTHOR_DATE="$date" \
  GIT_COMMITTER_DATE="$date" \
    git commit -m "$message" >/dev/null
}

mkdir -p src/app src/api
cat > src/app/main.py <<'PY'
from api.client import fetch_notes

def run():
    return fetch_notes()
PY
cat > src/api/client.py <<'PY'
def fetch_notes():
    return []
PY
commit "start notes application" "2025-01-10T09:00:00Z"

mkdir -p src/db
cat > src/db/store.py <<'PY'
def load_notes():
    return []
PY
cat > src/app/main.py <<'PY'
from api.client import fetch_notes
from db.store import load_notes

def run():
    cached = load_notes()
    return cached or fetch_notes()
PY
commit "add database module" "2025-02-14T09:00:00Z"

cat > src/db/store.py <<'PY'
def load_notes():
    rows = []
    return rows
PY
commit "expand database implementation" "2025-03-02T09:00:00Z"

mkdir -p src/workers
cat > src/workers/sync.py <<'PY'
from db.store import load_notes

def sync():
    return load_notes()
PY
commit "add background sync worker" "2025-04-18T09:00:00Z"

git mv src/db src/storage
cat > src/storage/__init__.py <<'PY'
from .store import load_notes
PY
commit "rename database to storage" "2025-05-23T09:00:00Z"

echo "$destination"
