#!/bin/zsh
# Stage C: runs the load scenarios in order, one at a time, resumably. LOCAL TEST STACK ONLY.
#   e2e/load/stage-c.sh [scenario ...]        default: smoke average rampup spike breakpoint soak
# Expects the stack up in the production-like set-up:
#   node e2e/run.mjs up --perf --apps=4 --pool=5 --db-latency=30-80
# For each scenario: money and date rules checked before, the sampler started, k6 run, the sampler stopped,
# the rules checked after, the slowest statements and the app servers' errors saved. A finished scenario
# leaves e2e/.reports/stageC/<name>.done and is skipped on a rerun, so a cut-off run resumes at the next one.
# A scenario that fails is NOT retried here: rerun it by hand once at most, and say so.
set -u
cd "$(dirname "$0")/../.."
R=e2e/.reports/stageC
mkdir -p $R
K6=e2e/.state/k6/k6-v2.3.0-macos-arm64/k6
APPS=${APPS:-3200,3201,3202,3203}
if [ $# -gt 0 ]; then SCENARIOS=("$@"); else SCENARIOS=(smoke average rampup spike breakpoint soak); fi
note() { echo "$(date '+%F %T') $*" | tee -a $R/stage-c.log }
pgq() { node e2e/run.mjs exec node -e "const pg=require('pg');const c=new pg.Client('postgresql://postgres:e2e@127.0.0.1:${E2E_SAMPLER_PG_PORT:-54331}/fiegh_e2e');c.connect().then(async()=>{const r=await c.query(process.argv[1]);console.log(JSON.stringify(r.rows));await c.end()})" "$1" }

# The ids k6 needs: instant-book short-stay load listings, and load guests' emails
if [ ! -f $R/ids.json ]; then
  node e2e/run.mjs exec node -e "
const pg=require('pg');const fs=require('fs');const c=new pg.Client(process.env.DIRECT_URL);c.connect().then(async()=>{
const instant=(await c.query(\"select id from \\\"Listing\\\" where id like 'load\\\\_l\\\\_%' and \\\"instantBook\\\" and \\\"rentalModes\\\"='[\\\"SHORT_STAY\\\"]' order by id\")).rows.map(r=>r.id);
const guests=(await c.query(\"select email from \\\"User\\\" where id like 'load\\\\_u\\\\_%' and role='GUEST' order by id\")).rows.map(r=>r.email);
fs.writeFileSync('$R/ids.json',JSON.stringify({instant,guests}));console.log('ids',instant.length,guests.length);await c.end()})"
fi

for s in $SCENARIOS; do
  if [ -f $R/$s.done ]; then note "skip $s (done)"; continue; fi
  df=$(df -g / | tail -1 | awk '{print $4}'); [ "$df" -lt 5 ] && { note "STOP: free disk ${df} GB"; exit 3 }
  note "=== $s: invariants before"
  E2E_PERF=1 E2E_INVARIANTS_LABEL=$s-before node e2e/run.mjs test --project=perf load/invariants.spec.ts --reporter=line > $R/$s-invariants-before.log 2>&1 || note "INVARIANTS BROKEN before $s (see invariants/$s-before.json)"
  pgq "select pg_stat_statements_reset()" > /dev/null
  for p in ${(s:,:)APPS}; do wc -c < e2e/.state/app-$p.log | tr -d ' ' > $R/$s-applog-$p.offset; done
  every=5; [ $s = soak ] && every=60
  E2E_SAMPLER_PG_PORT=${E2E_SAMPLER_PG_PORT:-54331} node e2e/load/sampler.mjs $s $every $APPS > $R/$s-sampler.log 2>&1 &  # directly: run.mjs exec would not pass the stop signal on
  sampler=$!
  note "=== $s: k6"
  ( cd e2e/load/k6 && ../../../$K6 run -q -e SCENARIO=$s -e APPS=$APPS -e AVG_VUS=${AVG_VUS:-50} -e IDS=../../.reports/stageC/ids.json \
      --out csv=../../.reports/stageC/$s-k6.csv.gz mix.js ) > $R/$s-k6.log 2>&1
  rc=$?
  kill $sampler 2>/dev/null; wait $sampler 2>/dev/null
  note "=== $s: k6 exit $rc ($( [ $rc -eq 99 ] && echo 'a threshold failed' || echo ok ))"
  pgq "select calls::int, round(mean_exec_time::numeric,2)::float mean_ms, round(max_exec_time::numeric,1)::float max_ms, round(total_exec_time::numeric)::float total_ms, left(regexp_replace(query,'\s+',' ','g'),240) q from pg_stat_statements where dbid=(select oid from pg_database where datname='fiegh_e2e') order by total_exec_time desc limit 20" > $R/$s-pg-statements.json
  for p in ${(s:,:)APPS}; do off=$(cat $R/$s-applog-$p.offset); tail -c +$((off+1)) e2e/.state/app-$p.log > $R/$s-app-$p.log; done
  grep -hoE "P20[0-9]{2}|Timed out fetching a new connection|too many clients|ECONNRESET|ECONNREFUSED|FATAL|Error: [A-Za-z ]{0,60}" $R/$s-app-*.log 2>/dev/null | sort | uniq -c | sort -rn > $R/$s-app-errors.txt
  note "=== $s: invariants after"
  E2E_PERF=1 E2E_INVARIANTS_LABEL=$s-after node e2e/run.mjs test --project=perf load/invariants.spec.ts --reporter=line > $R/$s-invariants-after.log 2>&1 && touch $R/$s.done || note "INVARIANTS BROKEN after $s: CRITICAL (see invariants/$s-after.json)"
  [ -f $R/$s.done ] || { note "stopping: $s did not finish cleanly"; exit 1 }
done
note "all scenarios done"
