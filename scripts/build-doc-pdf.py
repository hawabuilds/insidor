#!/usr/bin/env python3
"""
Render a markdown document to a styled, print-ready PDF in the Insidor design language.

    ./scripts/build-doc-pdf.py docs/ARCHITECTURE.md "Engineering Architecture" \
        "How Insidor is built" docs/Insidor-Architecture.pdf

Chrome is the renderer because it is the only engine on this machine that supports
custom @page sizes plus print-color-adjust, which the dark surfaces need. Mermaid
blocks are rendered client-side before the snapshot, so --virtual-time-budget must
stay generous enough for the CDN fetch plus layout.
"""
import html
import re
import subprocess
import sys
from pathlib import Path

import markdown
from pygments.formatters import HtmlFormatter

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Pygments' dark themes all fight the palette somewhere. Overriding the handful of
# token classes that actually appear in SQL/TS keeps code in the product's own colours.
CODE_CSS = """
.codehilite{background:#0E0E11;border:1px solid #212127;border-left:2px solid #2E2E36;
  border-radius:8px;padding:14px 18px;margin:18px 0 22px;overflow-x:auto;
  break-inside:avoid;page-break-inside:avoid;}
.codehilite pre{margin:0;font-family:var(--mono);font-size:12px;line-height:1.62;
  color:#C8CCD4;white-space:pre;}
.codehilite .c,.codehilite .c1,.codehilite .cm,.codehilite .cs,.codehilite .ch{color:#5A5A62;font-style:italic}
.codehilite .k,.codehilite .kd,.codehilite .kn,.codehilite .kr,.codehilite .kt,.codehilite .kc{color:#3DE0FF}
.codehilite .s,.codehilite .s1,.codehilite .s2,.codehilite .sb,.codehilite .sd,.codehilite .se{color:#9BF03C}
.codehilite .m,.codehilite .mi,.codehilite .mf,.codehilite .il{color:#FFB84D}
.codehilite .nf,.codehilite .fm{color:#F4F5F7;font-weight:500}
.codehilite .nc,.codehilite .nn{color:#F4F5F7}
.codehilite .o,.codehilite .ow,.codehilite .p{color:#8A8A93}
.codehilite .nb,.codehilite .bp{color:#3DE0FF}
.codehilite .err{color:#FF5C6E;background:none}
.codehilite .nv,.codehilite .vi{color:#F4F5F7}
"""

SHELL = """<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>Insidor — {title}</title>
<link rel="preconnect" href="https://api.fontshare.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://api.fontshare.com/v2/css?f[]=clash-display@600,700&f[]=general-sans@400,500,600&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{{
  --bg0:#060607;--bg1:#0C0C0E;--bg2:#131316;--bg3:#1A1A1E;
  --line:#212127;--line2:#2E2E36;
  --ink:#F4F5F7;--muted:#8A8A93;--dim:#5A5A62;
  --ion:#3DE0FF;--lime:#9BF03C;--red:#FF5C6E;--amber:#FFB84D;
  --disp:"Clash Display",-apple-system,system-ui,sans-serif;
  --sans:"General Sans",-apple-system,BlinkMacSystemFont,system-ui,sans-serif;
  --mono:"JetBrains Mono",ui-monospace,Menlo,monospace;
}}
@page{{ size:1200px 1600px; margin:0; }}
*{{box-sizing:border-box}}
html,body{{margin:0;padding:0;background:var(--bg0)}}
body{{color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.65;
 -webkit-font-smoothing:antialiased;-webkit-print-color-adjust:exact;print-color-adjust:exact}}

.cover{{height:1600px;padding:0 90px;display:flex;flex-direction:column;justify-content:center;
 page-break-after:always;break-after:page}}
.cover .brandline{{display:flex;align-items:center;gap:14px;margin-bottom:56px}}
.cover .dot{{width:14px;height:14px;border-radius:50%;background:var(--ion);
 box-shadow:0 0 18px rgba(61,224,255,.75)}}
.cover .wordmark{{font-family:var(--disp);font-size:26px;font-weight:600;letter-spacing:.16em}}
.cover h1{{font-family:var(--disp);font-size:68px;line-height:1.06;font-weight:600;
 letter-spacing:-.025em;margin:0 0 26px;max-width:20ch}}
.cover .sub{{font-size:20px;color:var(--muted);max-width:62ch;line-height:1.55;margin-bottom:64px}}
.cover .meta{{font-family:var(--mono);font-size:12.5px;color:var(--dim);letter-spacing:.1em;
 text-transform:uppercase;border-top:1px solid var(--line);padding-top:24px}}
.cover .meta b{{color:var(--muted);font-weight:400}}

/* Two columns so a long contents list fits one page. A break-after here plus a
   break-before on .body produced an empty page whenever the list overflowed, so
   the break lives in exactly one place: the start of the body. */
.tocpage{{padding:64px 56px}}
.tocpage h2{{border:0;margin-bottom:22px}}
.tocpage .toc{{column-count:2;column-gap:44px;column-fill:auto}}
.tocpage .toc ul{{list-style:none;padding-left:0;margin:0}}
.tocpage .toc > ul > li{{border-bottom:1px solid var(--line);padding:9px 0;
 break-inside:avoid;page-break-inside:avoid}}
.tocpage .toc > ul > li > a{{font-size:15px;font-weight:500;color:var(--ink)}}
.tocpage .toc ul ul{{padding-left:14px;margin:5px 0 0}}
.tocpage .toc ul ul li{{padding:2px 0;border:0}}
.tocpage .toc ul ul a{{font-size:12px;color:var(--muted);line-height:1.45}}
.tocpage .toc ul ul ul{{display:none}}

.body{{padding:0 56px 72px;page-break-before:always;break-before:page}}
h1,h2,h3,h4,h5{{font-family:var(--disp);letter-spacing:-.015em}}
h1{{font-size:40px;font-weight:600;margin:0 0 20px;padding-bottom:16px;border-bottom:1px solid var(--line)}}
h2{{font-size:32px;font-weight:600;margin:0 0 18px;padding:64px 0 14px;
 border-bottom:1px solid var(--line);page-break-before:always;break-before:page}}
h2:first-of-type{{page-break-before:auto;break-before:auto}}
h3{{font-size:21px;font-weight:600;margin:36px 0 10px}}
h4{{font-size:16.5px;font-weight:600;margin:26px 0 8px;color:var(--ink)}}
h5{{font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:.13em;
 text-transform:uppercase;color:var(--dim);margin:22px 0 8px}}

p{{margin:0 0 14px;max-width:92ch}}
ul,ol{{margin:0 0 16px;padding-left:22px;max-width:92ch}}
li{{margin-bottom:6px}}
li > p{{margin-bottom:8px}}
strong{{font-weight:600;color:var(--ink)}}
em{{color:var(--muted)}}
a{{color:var(--ion);text-decoration:none}}
hr{{border:0;border-top:1px solid var(--line);margin:34px 0}}

code{{font-family:var(--mono);font-size:.88em;background:var(--bg2);color:var(--ion);
 padding:1.5px 5px;border-radius:4px;overflow-wrap:anywhere}}
/* In a table cell, break-anywhere turns packages/contracts into "packages/contr
   acts". Identifiers must stay whole; let the column widen instead. */
td code,th code{{white-space:nowrap;overflow-wrap:normal}}
.codehilite code{{background:none;color:inherit;padding:0}}

blockquote{{border-left:3px solid var(--amber);background:rgba(255,184,77,.07);
 margin:20px 0;padding:14px 20px;border-radius:0 8px 8px 0;max-width:92ch;
 break-inside:avoid;page-break-inside:avoid}}
blockquote p:last-child{{margin-bottom:0}}
blockquote strong{{color:var(--amber)}}

table{{width:100%;border-collapse:collapse;margin:18px 0 24px;font-size:13.5px;
 break-inside:avoid;page-break-inside:avoid}}
th{{text-align:left;font-family:var(--mono);font-size:10px;letter-spacing:.11em;
 text-transform:uppercase;color:var(--dim);font-weight:500;padding:9px 12px;
 border-bottom:1px solid var(--line2);vertical-align:bottom}}
td{{padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top;color:var(--muted)}}
td:first-child{{color:var(--ink)}}
td code,th code{{font-size:11.5px}}

/* The dependency graph is wide, so it is given the full page width rather than the
   prose measure, and rendered at natural size — mermaid's useMaxWidth shrinks a
   complex graph until the labels are unreadable. */
pre.mermaid{{background:var(--bg1);border:1px solid var(--line);border-radius:10px;
 padding:26px 18px;margin:24px -34px;text-align:center;
 break-inside:avoid;page-break-inside:avoid}}
pre.mermaid svg{{width:100%!important;max-width:100%!important;height:auto}}
pre.mermaid .nodeLabel,pre.mermaid .edgeLabel,pre.mermaid .cluster-label{{
 font-family:var(--mono)!important}}
{code_css}
</style></head><body>
"""

MERMAID = """
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>
  mermaid.initialize({
    startOnLoad: true, securityLevel: 'loose',
    theme: 'base',
    // useMaxWidth:false makes mermaid emit the graph at its natural size; CSS then
    // scales the whole SVG uniformly, so text shrinks with the diagram instead of
    // being laid out tiny inside a large box.
    flowchart: { useMaxWidth: false, htmlLabels: true, nodeSpacing: 34, rankSpacing: 46 },
    themeVariables: {
      background:'#0C0C0E', primaryColor:'#16161A', primaryTextColor:'#F4F5F7',
      primaryBorderColor:'#3DE0FF', lineColor:'#8A8A93', secondaryColor:'#1A1A1E',
      tertiaryColor:'#0E0E11', clusterBkg:'#0A0A0C', clusterBorder:'#2E2E36',
      edgeLabelBackground:'#0C0C0E', titleColor:'#F4F5F7',
      fontFamily:'JetBrains Mono, ui-monospace, monospace', fontSize:'17px'
    }
  });
</script>
"""


def build(md_path: Path, title: str, subtitle: str, out_pdf: Path) -> None:
    md_path, out_pdf = md_path.resolve(), out_pdf.resolve()
    raw = md_path.read_text(encoding="utf-8")

    # Strip the H1 and any leading metadata lines — the cover carries them.
    body_md = re.sub(r"\A#\s+.*?\n", "", raw, count=1)

    md = markdown.Markdown(
        extensions=["tables", "fenced_code", "codehilite", "toc", "attr_list", "sane_lists"],
        extension_configs={
            "codehilite": {"css_class": "codehilite", "guess_lang": False},
            "toc": {"toc_depth": "2-3"},
        },
    )
    body_html = md.convert(body_md)
    toc_html = md.toc

    # Mermaid arrives from codehilite as a plain <pre>; hand it to mermaid.js instead.
    body_html = re.sub(
        r'<div class="codehilite"><pre><span></span><code>(.*?)</code></pre></div>',
        lambda m: f'<pre class="mermaid">{m.group(1)}</pre>'
        if "flowchart" in m.group(1) or "graph " in m.group(1)
        else m.group(0),
        body_html,
        flags=re.S,
    )

    words = len(raw.split())
    shell = SHELL.format(title=html.escape(title), code_css=CODE_CSS)

    doc = f"""{shell}
<div class="cover">
  <div class="brandline"><span class="dot"></span><span class="wordmark">INSIDOR</span></div>
  <h1>{html.escape(title)}</h1>
  <p class="sub">{html.escape(subtitle)}</p>
  <div class="meta">
    {md_path.name} &nbsp;·&nbsp; <b>27 July 2026</b><br>
    {words:,} words &nbsp;·&nbsp; generated from the repository, not maintained separately
  </div>
</div>
<div class="tocpage"><h2 style="page-break-before:auto;break-before:auto;padding-top:0">Contents</h2>
{toc_html}
</div>
<div class="body">
{body_html}
</div>
{MERMAID}
</body></html>"""

    out_html = out_pdf.with_suffix(".html")
    out_html.write_text(doc, encoding="utf-8")
    print(f"  html  {out_html.name}  ({len(doc):,} bytes)")

    subprocess.run(
        [CHROME, "--headless", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer",
         "--virtual-time-budget=30000", f"--print-to-pdf={out_pdf}", out_html.as_uri()],
        check=True, capture_output=True,
    )
    size = out_pdf.stat().st_size
    pages = len(re.findall(rb"/Type\s*/Page[^s]", out_pdf.read_bytes()))
    print(f"  pdf   {out_pdf.name}  ({size/1_048_576:.1f} MB, {pages} pages)")


if __name__ == "__main__":
    if len(sys.argv) != 5:
        print(__doc__)
        sys.exit(1)
    build(Path(sys.argv[1]), sys.argv[2], sys.argv[3], Path(sys.argv[4]))
