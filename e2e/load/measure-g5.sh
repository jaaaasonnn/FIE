#!/bin/zsh
# G5 (mobile speed): one measured step. Rebuilds the app through the harness, runs the bundle guard at both
# sizes, then Lighthouse (5 runs a page) on the empty database and on the seeded load set, which it removes
# again. Resumable: each finished step is written to e2e/.reports/mobile-speed/<label>/done.txt.
#   zsh e2e/load/measure-g5.sh <label>
# Then: node e2e/load/compare-g5.mjs msbefore <label>
set -u
cd "$(dirname "$0")/../.."
L=$1; D=e2e/.reports/mobile-speed/$L; J=$D/done.txt; mkdir -p $D; touch $J
C=$(git rev-parse --short HEAD)
step() { local name=$1; shift; if grep -q "^$name " $J; then echo "skip $name"; return 0; fi
  echo "== $name start $(date -u +%FT%TZ)"; local t=$(date +%s)
  "$@" > $D/$name.log 2>&1; local s=$?
  echo "$name $s $C $(( $(date +%s)-t ))s $(date -u +%FT%TZ)" >> $J; echo "== $name exit $s"; return $s; }
if ! grep -q "^stack " $J; then
  node e2e/run.mjs down >/dev/null 2>&1
  node e2e/run.mjs up --build > $D/stack.log 2>&1 &
  for i in {1..300}; do grep -q "\[e2e\] up:" $D/stack.log && break; grep -q "build failed" $D/stack.log && break; sleep 2; done
  grep -q "\[e2e\] up:" $D/stack.log || { echo "stack did not come up"; exit 1; }
  cp e2e/.state/build.log $D/build.log
  echo "stack 0 $C $(date -u +%FT%TZ)" >> $J
fi
step bundle node e2e/run.mjs test --project=chromium tests/perf/bundle.spec.ts -g "first load" --retries=0 --reporter=line
cp e2e/.reports/bundle/phone.json $D/bundle-phone.json 2>/dev/null; cp e2e/.reports/bundle/desktop.json $D/bundle-desktop.json 2>/dev/null
step lh-empty node e2e/run.mjs exec node e2e/load/lighthouse.mjs ms$L-empty 5
step seed node e2e/run.mjs exec node e2e/load/seed.mjs
step lh-seeded node e2e/run.mjs exec node e2e/load/lighthouse.mjs ms$L-seeded 5
step unseed node e2e/run.mjs exec node e2e/load/seed.mjs --remove
echo ALL DONE
