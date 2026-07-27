#!/usr/bin/env bash
# Assemble docs/visual2 into the walkthrough deck and render it to PDF.
#
# Three parts, each preceded by a divider page. Fragments carry their own charset
# and standalone typography so they can be opened individually; both are stripped
# here because the shell supplies them.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VIS="$ROOT/docs/visual"
OUT_HTML="$VIS/insidor-walkthrough.html"
OUT_PDF="$ROOT/docs/Insidor-Walkthrough.pdf"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

[ -x "$CHROME" ] || { echo "Chrome not found at $CHROME" >&2; exit 1; }

emit_section() {
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
    "01 &nbsp; What Insidor is<br>02 &nbsp; The narratives feed<br>03 &nbsp; The narrative page<br>04 &nbsp; Create a coin<br>05 &nbsp; Trading, watchlist, search, trending"
  for s in 01-what 02-feed 03-narrative-page 04-create 05-supporting; do emit_section "$s.html"; done

  divider "two" "The machinery" \
    "The six parts that run on a schedule, without anyone pressing anything. None of this is ever visible to a user." \
    "06 &nbsp; The six parts of the machine<br>07 &nbsp; What we build, what we rent<br>08 &nbsp; What we store, and what it costs"
  for s in 06-machinery 07-build-rent 08-store-cost; do emit_section "$s.html"; done

  divider "three" "How it comes together" \
    "Where the line between the two halves sits, one story followed all the way through, and the order we build in." \
    "09 &nbsp; Where the line sits<br>10 &nbsp; One story, end to end<br>11 &nbsp; The build plan"
  for s in 09-the-line 10-end-to-end 11-plan; do emit_section "$s.html"; done

  echo "</body></html>"
} > "$OUT_HTML"

echo "Wrote $OUT_HTML ($(wc -c < "$OUT_HTML") bytes)"

echo "Rendering…"
"$CHROME" --headless --disable-gpu --no-sandbox --no-pdf-header-footer \
  --virtual-time-budget=25000 --print-to-pdf="$OUT_PDF" "file://$OUT_HTML" 2>&1 \
  | grep -vE "task_policy_set|GPU|Fontconfig|DEPRECATED|allocator" || true

if [ -f "$OUT_PDF" ]; then
  pages=$(python3 -c "import re,sys;print(len(re.findall(rb'/Type\s*/Page[^s]',open('$OUT_PDF','rb').read())))")
  echo "OK  $OUT_PDF  ($(du -h "$OUT_PDF" | cut -f1), $pages pages)"
else
  echo "PDF not produced" >&2; exit 1
fi
