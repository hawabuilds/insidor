#!/usr/bin/env bash
# Assemble docs/analysis/visual into the walkthrough deck and render it to PDF.
#
# Four parts, each preceded by a divider page. Fragments carry their own charset
# and standalone typography so they can be opened individually; both are stripped
# here because the shell supplies them.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VIS="$ROOT/docs/analysis/visual"
OUT_HTML="$VIS/insidor-walkthrough.html"
OUT_PDF="$ROOT/docs/Insidor-Walkthrough.pdf"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

[ -x "$CHROME" ] || { echo "Chrome not found at $CHROME" >&2; exit 1; }

emit() {
  local f="$VIS/sections/$1"
  [ -f "$f" ] || { echo "  MISSING $1" >&2; return; }
  echo "<!-- $1 -->"
  sed -e '/<meta charset="utf-8">/d' \
      -e '/<!--standalone-->/,/<!--\/standalone-->/d' "$f"
  echo
}

divider() { # number, title, blurb, index
  cat <<EOF
<div class="part">
  <div class="pn">Part $1</div>
  <h2>$2</h2>
  <p>$3</p>
  <div class="idx">$4</div>
</div>
EOF
}

echo "Assembling…"
{
  cat "$VIS/shell-head.html"
  cat "$VIS/shell-cover.html"

  divider "one" "The product" \
    "What a trader sees and does. Every screen in this part shows facts about the world and nothing about how we decided." \
    "01 &nbsp; What Insidor is<br>02 &nbsp; The feed<br>03 &nbsp; The story page<br>04 &nbsp; Create a coin<br>05 &nbsp; Trading, watchlist, search, trending"
  for s in 01-what 02-feed 03-story 04-create 05-supporting; do emit "$s.html"; done

  divider "two" "The machinery" \
    "How a post is found, grouped, matched to a coin, and how the whole thing gets smarter. None of this is ever visible to a user." \
    "06 &nbsp; How we find viral posts<br>07 &nbsp; How posts become stories<br>08 &nbsp; How stories become coins<br>09 &nbsp; How the system learns<br>10 &nbsp; What we store, and what it costs"
  for s in 06-detect 07-group 08-match 09-learn 10-store-cost; do emit "$s.html"; done

  divider "three" "How we build it" \
    "The languages, the structure, the order the pieces get made in, and how long it honestly takes." \
    "11 &nbsp; The stack, and why<br>12 &nbsp; Where the code lives<br>13 &nbsp; How each part gets built<br>14 &nbsp; The timeline, honestly"
  for s in 11-stack 12-structure 13-howbuilt 14-timeline; do emit "$s.html"; done

  divider "four" "How it comes together" \
    "The line between what we compute and what we show, and one story followed all the way through." \
    "15 &nbsp; Where the line sits<br>16 &nbsp; One story, end to end"
  for s in 15-the-line 16-end-to-end; do emit "$s.html"; done

  echo "</body></html>"
} > "$OUT_HTML"

echo "Wrote $OUT_HTML ($(wc -c < "$OUT_HTML") bytes)"

echo "Rendering…"
"$CHROME" --headless --disable-gpu --no-sandbox --no-pdf-header-footer \
  --virtual-time-budget=30000 --print-to-pdf="$OUT_PDF" "file://$OUT_HTML" 2>&1 \
  | grep -vE "task_policy_set|GPU|Fontconfig|DEPRECATED|allocator|externally_managed" || true

if [ -f "$OUT_PDF" ]; then
  pages=$(python3 -c "import re;print(len(re.findall(rb'/Type\s*/Page[^s]',open('$OUT_PDF','rb').read())))")
  echo "OK  $OUT_PDF  ($(du -h "$OUT_PDF" | cut -f1), $pages pages)"
else
  echo "PDF not produced" >&2; exit 1
fi
