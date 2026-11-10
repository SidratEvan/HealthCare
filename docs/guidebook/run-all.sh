#!/usr/bin/env bash
# Fresh demo data, then every capture, in order. Log: run-all.log
cd "$(dirname "$0")" || exit 1
BOOK="$(pwd)"
rm -f shots/p-*.jpg shots/p-*.json shots/c-*.jpg shots/c-*.json
(
  cd "$BOOK/../.." || exit 1
  DATABASE_URL=postgresql://healthcare:healthcare@localhost:5432/healthcare_dev DEMO_MODE=true pnpm db:reset > "$BOOK/reset.log" 2>&1
  echo "reset exit=$?"
)
for s in cap-patient cap-console-a cap-console-b cap-fix cap-platform-new; do
  echo "=== $s $(date -u +%H:%M:%S)"
  timeout 1800 node "$s.cjs"
  echo "=== $s exit=$?"
done
echo "ALL DONE $(date -u +%H:%M:%S)"
