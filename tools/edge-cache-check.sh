#!/bin/zsh
# CHECKS THAT VERCEL'S EDGE ANSWERS THE SHARED READS, AND ONLY THOSE, after a deploy of the
# vercel.json read rewrite and services/read/src/edge-cache.ts.
#
# Run it right after the deploy shows Ready (and the read service shows SUCCESS):
#
#   zsh tools/edge-cache-check.sh                     # against https://insidor.app
#   BASE=https://<preview>.vercel.app zsh tools/edge-cache-check.sh
#   RUNS=10 PAUSE=0.5 zsh tools/edge-cache-check.sh
#
# It sends GETs only, to routes the read service answers from memory: no wallet, no search,
# nothing that reaches a paid source. About 200 requests, paced, because Vercel's firewall
# challenges a burst of about a hundred from one address; if it does, the script stops and says so
# (exit 100) rather than reporting failures. Nothing here tries to get past a challenge.
#
# Each route is asked RUNS times on fresh connections (cold: DNS, TCP, TLS and the request) and
# RUNS times on one kept connection (warm, as a phone in use; the first warm ask is dropped).
#
# What it proves, each as a PASS or FAIL line:
#   1. a shared read is answered at the edge (HIT or STALE), and how fast a HIT is;
#   2. the browser is told to revalidate and never sees vercel-cdn-cache-control;
#   3. the query string reaches the service (the sorted route is 400 without it), and two
#      queries are two edge copies;
#   4. For You's own feed, a request with a sign-in token, a 404 and /health are never a HIT;
#   5. the function path (/api/fn/read) still answers, for comparison and rollback.
# Exit status is the number of FAILs.

BASE=${BASE:-https://insidor.app}
RUNS=${RUNS:-6}
# Seconds between fresh connections.
PAUSE=${PAUSE:-0.4}
R="$BASE/api/read"
FAILS=0
# What the phone's fetch sends: accept, compression, and fetch's no-store mode adds the two no-cache lines.
PHONE=(-H 'accept: application/json' -H 'accept-encoding: br, gzip' -H 'pragma: no-cache' -H 'cache-control: no-cache')
PLAIN=(-H 'accept: application/json' -H 'accept-encoding: br, gzip')
# For reading a body here: gzip only, since the curl that ships with macOS cannot unpack brotli.
BODY=(-H 'accept: application/json' --compressed)

pass() { print -- "PASS  $*"; }
fail() { print -- "FAIL  $*"; FAILS=$((FAILS + 1)); }

# The header block of one GET (body thrown away), and one header's value from such a block.
head_of() { sleep $PAUSE; curl -s -o /dev/null -D - "$@"; }
header() { print -r -- "$1" | tr -d '\r' | awk -v k="$2" 'tolower($0) ~ "^"tolower(k)":" {sub(/^[^:]*: */, ""); print; exit}'; }
# Seconds on stdin, one per line, to the median in whole milliseconds ("-" for none).
median() { sort -n | awk 'NF{a[++n]=$1} END{if(n==0){print "-"; exit} m=(n%2)?a[(n+1)/2]:(a[n/2]+a[n/2+1])/2; printf "%.0f", m*1000}'; }
# curl -D - output plus "T <ttfb> <code>" per response, to "<ttfb> <code> <x-vercel-cache|-> <x-vercel-mitigated|->".
runs() { tr -d '\r' | awk '
  tolower($0) ~ /^x-vercel-cache:/ {c=$2}
  tolower($0) ~ /^x-vercel-mitigated:/ {m=$2}
  /^T / {print $2, $3, (c==""?"-":c), (m==""?"-":m); c=""; m=""}'; }
stop_if_challenged() {
  if [[ $1 == *challenge* || $1 == *deny* ]]; then
    print -- "STOP  Vercel's firewall challenged this address (x-vercel-mitigated: $1). Wait a minute, then run again with a smaller RUNS or a larger PAUSE."
    exit 100
  fi
}

# A post, a narrative and a coin to ask about: from For You, the narrative from the Narratives list if no post has one.
ids=$(curl -s "${BODY[@]}" "$R/rising/fyp" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    try { const p=JSON.parse(s).posts??[];
      const post=p[0]?.id??""; const story=(p.find(x=>x.storyId)?.storyId)??"";
      const coin=(p.map(x=>x.coins?.coin?.coinId).find(Boolean))??"";
      console.log([post,story,coin].map(encodeURIComponent).join(" "));
    } catch { console.log("  "); } });')
POST=${ids%% *}; rest=${ids#* }; STORY=${rest%% *}; COIN=${rest#* }
if [[ -z $STORY ]]; then
  STORY=$(curl -s "${BODY[@]}" "$R/narratives/default" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(encodeURIComponent(JSON.parse(s).stories?.[0]?.id??""))}catch{console.log("")}})')
fi
print "base $BASE  runs $RUNS  pause ${PAUSE}s  post=${POST:--} story=${STORY:--} coin=${COIN:--}"
print

SHARED=(/board/default /narratives/default "/narratives/default/all?sort=new&offset=0" /rising/fyp/tick "/rising/fyp/sorted?by=trending&window=now")
[[ -n $STORY ]] && SHARED+=("/story/$STORY" "/story/$STORY/sheet")
[[ -n $POST ]] && SHARED+=("/post/$POST/sheet")
[[ -n $COIN ]] && SHARED+=("/coin/$COIN" "/coin/$COIN/market?tf=1m" "/coin/$COIN/about")

printf '%-50s %-4s %7s %7s %7s  %s\n' route code cold_ms warm_ms hit_ms "x-vercel-cache, cold and warm asks"
for route in "${SHARED[@]}" /rising/fyp; do
  url="$R$route"
  cold_out=$(for i in {1..$RUNS}; do curl -s -o /dev/null -D - "${PHONE[@]}" -w 'T %{time_starttransfer} %{http_code}\n' "$url"; sleep $PAUSE; done | runs)
  many=(); for i in {1..$RUNS}; do many+=(-o /dev/null "$url"); done
  warm_out=$(curl -s -D - "${PHONE[@]}" -w 'T %{time_starttransfer} %{http_code}\n' "${many[@]}" | runs)
  all="$cold_out
$warm_out"
  stop_if_challenged "$(print -r -- "$all" | awk '{print $4}' | sort -u | tr '\n' ' ')"
  cold=$(print -r -- "$cold_out" | awk '{print $1}' | median)
  warm=$(print -r -- "$warm_out" | sed 1d | awk '{print $1}' | median)
  hit=$(print -r -- "$all" | awk '$3=="HIT"{print $1}' | median)
  code=$(print -r -- "$all" | awk 'NF{print $2}' | sort | uniq -c | sort -rn | awk 'NR==1{print $2}')
  states=$(print -r -- "$all" | awk 'NF{print $3}' | sort | uniq -c | awk '{printf "%s×%s ", $2, $1}')
  printf '%-50s %-4s %7s %7s %7s  %s\n' "${route:0:50}" "$code" "$cold" "$warm" "$hit" "$states"

  if [[ $route == /rising/fyp ]]; then
    [[ $states == *HIT* ]] && fail "/rising/fyp was answered from the edge; it must reach the service (see edge-cache.ts)" || pass "/rising/fyp is never an edge HIT"
    continue
  fi
  [[ $code == 200 ]] || { fail "$route answered $code"; continue; }
  [[ $states == *HIT* || $states == *STALE* ]] && pass "$route is answered at the edge" || fail "$route was never a HIT ($states)"
  hdrs=$(head_of "${PHONE[@]}" "$url")
  cc=$(header "$hdrs" cache-control); vc=$(header "$hdrs" vercel-cdn-cache-control)
  [[ -z $vc ]] || fail "$route: vercel-cdn-cache-control reached the browser ($vc)"
  [[ $cc == *max-age=0* && $cc != *s-maxage* && $cc != *stale-while* ]] || fail "$route: the browser is told '$cc', not to revalidate"
done
print

# The query string reaches the service: without one the sorted route is a 400.
q=$(head_of "${PLAIN[@]}" "$R/rising/fyp/sorted?by=trending&window=now" | head -1 | awk '{print $2}')
nq=$(head_of "${PLAIN[@]}" "$R/rising/fyp/sorted" | head -1 | awk '{print $2}')
[[ $q == 200 && $nq == 400 ]] && pass "the query string reaches the read service (200 with it, 400 without)" || fail "query string: with=$q without=$nq (want 200 and 400)"

# Two queries are two edge copies.
a=$(sleep $PAUSE; curl -s "${BODY[@]}" "$R/rising/fyp/sorted?by=trending&window=now" | shasum | cut -c1-12)
b=$(sleep $PAUSE; curl -s "${BODY[@]}" "$R/rising/fyp/sorted?by=most_viewed&window=today" | shasum | cut -c1-12)
[[ $a != $b ]] && pass "different queries get different replies" || fail "two different sorted queries returned the same bytes ($a)"

# A sign-in token is never answered from the edge, and is answered privately.
for i in 1 2 3; do h=$(head_of "${PLAIN[@]}" -H 'authorization: Bearer edge-cache-check' "$R/board/default"); done
xc=$(header "$h" x-vercel-cache); cc=$(header "$h" cache-control)
stop_if_challenged "$(header "$h" x-vercel-mitigated)"
[[ $xc != HIT && $xc != STALE && $cc == *private* ]] && pass "a request with authorization is not served from the edge (${xc:--}, $cc)" || fail "a request with authorization: ${xc:--} / $cc"

# A 404 and /health are not kept.
for i in 1 2 3; do h=$(head_of "${PLAIN[@]}" "$R/story/edge-cache-check-no-such-story"); done
[[ $(header "$h" x-vercel-cache) != HIT ]] && pass "a 404 is not kept at the edge" || fail "a 404 was answered from the edge"
for i in 1 2 3; do h=$(head_of "${PLAIN[@]}" "$R/health"); done
[[ $(header "$h" x-vercel-cache) != HIT ]] && pass "/health is not kept at the edge" || fail "/health was answered from the edge"

# The function path still works, and how its TTFB compares on fresh connections.
fn=$(head_of "${PLAIN[@]}" "$BASE/api/fn/read/board/default" | head -1 | awk '{print $2}')
[[ $fn == 200 ]] && pass "the function path /api/fn/read still answers (rollback)" || fail "/api/fn/read/board/default answered $fn"
fncold=$(for i in {1..$RUNS}; do sleep $PAUSE; curl -s -o /dev/null "${PHONE[@]}" -w '%{time_starttransfer}\n' "$BASE/api/fn/read/board/default"; done | median)
edcold=$(for i in {1..$RUNS}; do sleep $PAUSE; curl -s -o /dev/null "${PHONE[@]}" -w '%{time_starttransfer}\n' "$R/board/default"; done | median)
print -- "info  /board/default cold TTFB: edge rewrite ${edcold} ms, function ${fncold} ms"
h=$(head_of "${PLAIN[@]}" "$R/board/default"); print -- "info  served by $(header "$h" x-vercel-id), x-vercel-cache $(header "$h" x-vercel-cache)"

print
(( FAILS == 0 )) && print "all checks passed" || print "$FAILS check(s) failed"
exit $FAILS
