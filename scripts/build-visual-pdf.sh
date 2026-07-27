#!/usr/bin/env bash
# Assemble docs/visual/sections/*.html into one document and render it to PDF.
#
# Chrome is used as the renderer because it is the only engine on this machine that
# supports the CSS the mockups rely on (custom @page sizes, break-inside, print-color-adjust
# so the dark backgrounds survive). weasyprint/wkhtmltopdf are not installed.
#
# Usage: ./scripts/build-visual-pdf.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VIS="$ROOT/docs/visual"
OUT_HTML="$VIS/insidor-walkthrough.html"
OUT_PDF="$ROOT/docs/Insidor-Walkthrough.pdf"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

if [ ! -x "$CHROME" ]; then
  echo "Chrome not found at: $CHROME" >&2
  exit 1
fi

shopt -s nullglob
SECTIONS=("$VIS/sections"/*.html)
if [ ${#SECTIONS[@]} -eq 0 ]; then
  echo "No sections found in $VIS/sections" >&2
  exit 1
fi

echo "Assembling ${#SECTIONS[@]} sections…"
{
  cat "$VIS/shell-head.html"
  cat "$VIS/shell-cover.html"
  for f in "${SECTIONS[@]}"; do
    echo "<!-- $(basename "$f") -->"
    cat "$f"
    echo
  done
  echo "</body></html>"
} > "$OUT_HTML"

echo "Wrote $OUT_HTML ($(wc -c < "$OUT_HTML") bytes)"

# --virtual-time-budget gives webfonts and layout time to settle before the snapshot;
# without it the first render can capture fallback metrics and reflow the tables.
echo "Rendering PDF…"
"$CHROME" --headless --disable-gpu --no-sandbox \
  --no-pdf-header-footer \
  --virtual-time-budget=20000 \
  --print-to-pdf="$OUT_PDF" \
  "file://$OUT_HTML" 2>&1 | grep -vE "task_policy_set|GPU|Fontconfig" || true

if [ -f "$OUT_PDF" ]; then
  echo "OK  $OUT_PDF  ($(du -h "$OUT_PDF" | cut -f1))"
else
  echo "PDF was not produced" >&2
  exit 1
fi
