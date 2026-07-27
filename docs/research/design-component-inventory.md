## INSIDOR — COMPONENT INVENTORY

**Source of truth:** `/Users/zainkhaliq/Desktop/Claude_Cowork/Insidor/site/index.html` (3,852 lines: CSS lines 16–1019, markup 1023–1252, app script 1253–3671, Privy module 3673–3848). Runtime helpers: `/Users/zainkhaliq/Desktop/Claude_Cowork/Insidor/site/live.js`, `/Users/zainkhaliq/Desktop/Claude_Cowork/Insidor/site/tokenpage.js`.
**Secondary:** `/Users/zainkhaliq/Desktop/Claude_Cowork/Insidor/design/insidor-prototype-v3.html` (parallel study, different token names `--bg-0/--fg-0/--act`; **do not** rebuild from it), `/Users/zainkhaliq/Desktop/Claude_Cowork/Insidor/docs/reference/insidor-social.html` (comment layer, same palette).

---

# 0. DESIGN TOKENS (`:root`, line 16)

| var | value | role |
|---|---|---|
| `--bg0` | `#060607` | page ground, button ink-on-light, inset wells |
| `--bg1` | `#0C0C0E` | card / panel / table surface |
| `--bg2` | `#131316` | hover surface, chip well, thumb placeholder |
| `--bg3` | `#1A1A1E` | badge ground, kbd, bar track |
| `--ink` | `#F4F5F7` | primary text |
| `--muted` | `#8A8A93` | secondary text |
| `--dim` | `#5A5A62` | tertiary / labels / axis |
| `--line` | `#212127` | hairline borders |
| `--ion` | `#3DE0FF` | the only UI accent |
| `--lime` | `#9BF03C` | up / on-chain proof |
| `--red` | `#FF5C6E` | down |
| `--disp` | `"Clash Display", -apple-system, sans-serif` | 400/500/600/700 |
| `--sans` | `"General Sans", -apple-system, BlinkMacSystemFont, sans-serif` | 400/500/600 |
| `--mono` | `"JetBrains Mono", ui-monospace, monospace` | 400/500/600 |

Recurring literals not tokenised (use verbatim): amber `#ffb84c` (warn), amber-2 `#ffb020` / `#ffd98a` / `#ffe8b0` (paused banner), violet `#a78bfa` (Farcaster), orange `#ff8a4c` (Reddit), sky `#4cc4ff` (Telegram), pink `#ff5b9c` (TikTok badge text), `#2c2c34` (hover border), `#001318` (ink on ion), `#0a1400` (ink on lime), `#1a0206`/`#1a0004` (ink on red).

**Body** (line 26, 35): `background: radial-gradient(120% 78% at 50% -12%, rgba(61,224,255,.045), transparent 58%), var(--bg0)`; `background-attachment: fixed`; `font-family: var(--sans)`; `14px/1.5`; `font-variant-numeric: tabular-nums`; `overflow-x:hidden`.
**Selection:** `rgba(61,224,255,.25)`. **Focus ring:** `2px solid rgba(61,224,255,.5)`, offset 2, radius 6.
**Scrollbars:** 10px, thumb `#1e1e24` (hover `#2b2b34`), 2px transparent border, `background-clip:padding-box`, radius 999; track transparent.
**Global transition:** `button,a,input { transition: all .18s cubic-bezier(.2,.7,.3,1) }`.
**Keyframes:** `fade` .15s (opacity), `pop` .18s (`translateY(10px) scale(.98)` → none), `slidein` .45s (`translateY(-8px)` → none), `pulse` 2s (opacity 1 → .35 → 1), `flashUp/flashDn` .6s, `skel` 1.2s, `narrFlash` 1.4s, `nmTickUp/nmTickDown` .85s.

---

# 1. TOP NAVIGATION BAR
Markup lines 1023–1036. Rendered on every view.

### 1.1 `.nav` container
`position:sticky; top:0; z-index:50; height:58px; display:flex; align-items:center; gap:20px; padding:0 20px; background:rgba(6,6,7,.82); backdrop-filter:blur(14px); border-bottom:1px solid var(--line)`.

### 1.2 Brand `.brand`
`font-family:var(--disp); font-weight:600; font-size:19px; letter-spacing:.06em; color:var(--ink); display:flex; align-items:center; gap:8px; flex:none`. Literal text `INSIDOR`.
`.brand .dot` — `8×8px`, `border-radius:50%`, `background:var(--ion)`, `box-shadow:0 0 12px var(--ion)`. No hover/active states; not a link in current markup (`<div>`).

### 1.3 Nav tabs `.navlinks` / `.navlink`
`.navlinks{display:flex; gap:2px; flex:none}`.
`.navlink` — `padding:7px 13px; border-radius:8px; color:var(--muted); font-weight:500; font-size:13.5px; transition:.15s; white-space:nowrap`.
- **hover:** `color:var(--ink); background:var(--bg2)`
- **active** (`.active`): `color:var(--ion); background:rgba(61,224,255,.08)`

Five buttons, in order, with `data-view`: `Trending`(trending, active on load) · `New Pairs`(new) · `Narratives`(narratives) · `Tokens`(tokens) · `Watchlist`(watchlist). `setView()` (3531) toggles `.active` by `data-view`; the `token` and `search` views leave all tabs inactive.
Optional counter `.nav-badge` (line 831): `inline-flex; min-width:16px; height:16px; padding:0 4px; margin-left:5px; border-radius:999px; background:var(--lime); color:#001318; font-family:var(--mono); font-size:10px; font-weight:700; line-height:1` — the code that increments it (`bumpNarrNewBadge`) is currently a no-op (1990).

### 1.4 Search trigger `.navsearch` (button, opens ⌘K palette)
`flex:1; max-width:360px; display:flex; align-items:center; gap:9px; background:var(--bg1); border:1px solid rgba(255,255,255,.06); border-radius:11px; padding:8px 11px; color:var(--dim); font-size:12.5px; transition:.15s`.
- **hover:** `border-color:rgba(255,255,255,.12); color:var(--muted)`
- Children: `.ic` — `font-size:15px`, glyph `⌕`; `.nst` — `flex:1; text-align:left; font-family:var(--sans)`, text `Search narratives, tickers, contracts…`; `kbd` — `font-family:var(--mono); font-size:10px; color:var(--muted); background:var(--bg3); border:1px solid var(--line); border-radius:5px; padding:2px 6px`, text `⌘K`.
- **Responsive:** `display:none` below `1180px` (line 115).
- Click → `openPalette()`.

### 1.5 SOL price pill `.solpill` — ⚠ CSS + driver exist, **markup does not**
Styled at lines 76–84, hidden below 900px (line 116), and driven by `live.js:renderSolNav()` which looks up `#solPill` and `#solPrice`. Those IDs appear **nowhere** in `site/index.html` in any commit. Rebuild it into `.navright` before `#userAuth` using this spec:

`font-family:var(--disp); font-size:13px; font-weight:600; color:var(--muted); background:linear-gradient(135deg, rgba(61,224,255,.1), rgba(12,14,18,.92)); border:1px solid rgba(61,224,255,.24); border-radius:10px; padding:8px 14px; display:flex; align-items:center; gap:8px; min-width:124px; box-shadow:0 0 24px -8px rgba(61,224,255,.35)`.
- `b#solPrice` — `color:var(--ion); font-size:16px; font-weight:700; font-variant-numeric:tabular-nums; letter-spacing:-.02em; text-shadow:0 0 18px rgba(61,224,255,.28)`
- `.sd` — `font-family:var(--mono); font-size:9px; line-height:1; font-weight:600; color:var(--lime)`

**States:** default/loading `#solPrice` = `—`, `.sd` empty. Loaded → `$` + `price.toFixed(2)`. `.solpill.sol-up` → `.sd` lime, text `▲ 2.4%`; `.solpill.sol-dn` → `.sd` `var(--muted)`, text `▼ 2.4%` (`Math.abs(change24h).toFixed(1)`). Source: DexScreener `/latest/dex/tokens/So111…112`, picks the highest-liquidity USDC/USDT pair; refreshed by `live.js`, broadcast on `window.SOL_PRICE` + `insidor-sol-price` event.

### 1.6 Connect button `.wallet-btn` (`#userAuth`)
`.navright{margin-left:auto; display:flex; align-items:center; gap:10px; flex:none}`; `#userAuth{display:flex; align-items:center}`.
`.wallet-btn` — `display:flex; align-items:center; gap:8px; font-family:var(--sans); font-size:13px; font-weight:600; color:#001318; background:linear-gradient(180deg,#5fe8ff,#3DE0FF); border-radius:10px; padding:8px 15px; transition:.15s`.
- **hover:** `box-shadow:0 0 16px rgba(61,224,255,.45)`
- **disabled / loading:** `background:var(--bg2); color:var(--muted); box-shadow:none; cursor:default; border:1px solid var(--line)`; label `Loading…` while Privy `!ready`
- **default label:** `Connect`
- `.wallet-btn .wi{display:grid;place-items:center}` (optional leading icon slot)

**Connected state → `.user-chip`** (3807): `display:flex; align-items:center; gap:8px; font-family:var(--mono); font-size:12.5px; color:var(--ink); background:var(--bg1); border:1px solid rgba(255,255,255,.08); border-radius:10px; padding:5px 7px 5px 12px`.
- `.user-name` — `max-width:130px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap`. Value = wallet `addr.slice(0,4)+'…'+addr.slice(-4)`, else Google name, else email local-part, else `Insidor user`.
- `.user-logout` — `display:grid; place-items:center; width:27px; height:27px; border-radius:7px; color:var(--muted); transition:.12s`; hover `background:var(--bg2); color:var(--red)`. Contains a 14×14 logout SVG (stroke 2, round caps).

**Error state:** on Privy load failure `fallbackConnect()` re-renders a plain `.wallet-btn` labelled `Connect` that alerts an origin/App-ID message.
**Legacy dropdown** `.auth-panel` (93–107) is fully styled (`284px` wide, `top:calc(100% + 10px)`, `right:0`, radius 16, padding 16, `box-shadow:0 30px 70px -18px rgba(0,0,0,.8)`, hidden = `opacity:0;visibility:hidden;transform:translateY(-6px)`, `.auth-menu.open` reveals) but the Privy React path never renders it. Port only if you re-introduce the in-house menu.

---

# 2. SHELL & PAGE CHROME

**`.shell`** — `display:grid; grid-template-columns:1fr 460px; max-width:none; margin:0`.
**`.main`** — `padding:26px 26px 80px; min-width:0`.
**`.view`** — `display:none`; `.view.on{display:block}`. `#v-trending.view.on` overrides to `display:flex; flex-direction:column; align-items:center`.
**Content width:** `.tab-data-wrap, .trend-wrap { width:100%; max-width:980px; margin:0 auto }`; overridden to `1140px` inside `#v-tokens`, `#v-search`, `#v-new`, `#v-watchlist` (line 220). Narratives stays at **980px**.
**Responsive ≤1040px** (1013): shell collapses to one column, `.rail{display:none}`, token page `.tp2` to 1 column, `.qstats` becomes horizontally scrollable, token table drops to 5 columns (`2fr .8fr .7fr 1fr 76px`, padding `9px 14px`, gap 8) and hides every `.h` cell; narrative table to `minmax(140px,1.9fr) 68px .8fr .8fr .9fr 48px`, padding `9px 14px`, gap 8.

**View header `.vhead`** — `margin-bottom:22px`, but overridden to `14px; text-align:left` inside `.tab-data-wrap`/`.trend-wrap`.
- `.vtitle` — `font-family:var(--disp); font-weight:600; font-size:27px; letter-spacing:-.01em`
- `.vsub` — `color:var(--muted); font-size:13.5px; margin-top:4px`; `.vsub b{color:var(--lime); font-weight:500}`
- Copy per view: Trending → “Top narratives & tokens · last 24h · `simulated data`”; Narratives → “Clustered viral stories across X & TikTok · …”; Tokens → “All live tokens · **candidate tickers appear before a coin exists**”; New pairs → “Freshly deployed coins · **newest first** · …”; Watchlist → “Star narratives & tokens from any tab · **saved for this session**”; Search → “Narratives, tickers, and contract addresses · **live results as you type**”.

**Toolbar `.tbar`** — `display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:16px; flex-wrap:wrap`; `.tbar .chips{margin-bottom:0}`.
- `.tbar-meta` — `font-family:var(--mono); font-size:11.5px; color:var(--muted); display:flex; align-items:center; gap:7px`; `.tbar-meta .lz` = `6×6` lime dot, `box-shadow:0 0 8px var(--lime)`, `animation:pulse 2s infinite`. `#tokCount{color:var(--ink)}`.

**Chip group `.chips` / `.chip`**
`.chips` — `display:inline-flex; gap:3px; margin-bottom:16px; padding:4px; background:var(--bg1); border:1px solid rgba(255,255,255,.05); border-radius:12px`.
`.chip` — `border:none; border-radius:9px; padding:7px 15px; color:var(--muted); font-weight:500; font-size:12.5px; transition:.15s`.
- hover `color:var(--ink); background:var(--bg2)`
- `.active` `background:rgba(61,224,255,.12); color:var(--ion); box-shadow:inset 0 0 0 1px rgba(61,224,255,.25)`
Instances: `#narrChips` = `New` / `Trending`(active); `#sortChips` & `#searchSortChips` = `Hot`(active) / `Gainers` / `New pairs`.

**Sound toggle `.narr-sound-toggle`** (`#narrSoundToggle`, in Narratives `.tbar`) — `border:1px solid rgba(255,255,255,.08); background:var(--bg1); border-radius:8px; width:28px; height:28px; font-size:13px; line-height:1; opacity:.45; transition:.12s`; `.on` → `opacity:1; border-color:rgba(155,240,60,.35); box-shadow:0 0 10px rgba(155,240,60,.15)`. Glyph 🔔, `aria-pressed`, persisted to `localStorage['insidor-narr-sound']`.

**`.pendbanner`** (Tokens/Search) — ⚠ **only `.pendbanner b{color:var(--ion); font-family:var(--mono)}` exists**; the container itself is unstyled (inherits body text). Two message shapes: `⚡ <b>SYM, SYM</b> detected in a viral post but has no coin yet — it appears here the moment one deploys.` and `🔎 Showing <b>N</b> tickers from this post — <b>$A  $B</b>. Clear filter →`.

---

# 3. SUB-TAB SWITCHER (Trending)
Markup 1046–1049, CSS 786–792.

`.trend-subs` — `display:flex; align-items:center; justify-content:flex-start; gap:28px; margin-bottom:16px; width:100%`.
`.trend-sub` — `font-family:var(--disp); font-size:16px; font-weight:700; color:var(--muted); background:none; border:0; padding:0; cursor:pointer; transition:color .15s; letter-spacing:.01em`.
- **hover:** `color:var(--ink)` · **on (`.on`):** `color:var(--ink)` — **no underline, no pill; the only signal is muted→ink**.
Two buttons: `Narratives`(`data-trend-sub="narratives"`, `.on` default) and `Tokens`.
Panels: `.trend-panel{width:100%}`, `.trend-pane{display:none;width:100%}`, `.trend-pane.on{display:block}`.

### 3.1 Trending narrative mini-table `.trend-narr-mini`
Header (constant `TREND_NARR_HEAD`, 2244): `# | (blank) | Narrative | Views | Gain | Age | Mcap`.
`.tnhd, .tnr` — `display:grid; grid-template-columns:26px 42px minmax(0,1.65fr) .65fr .65fr .55fr .75fr; gap:12px; align-items:center; padding:13px 20px; min-height:54px`.
`.tnhd` — `background:linear-gradient(180deg, var(--bg2), rgba(19,19,22,.35)); border-bottom:1px solid rgba(255,255,255,.06)`; its spans `font-size:10px; color:var(--dim); text-transform:uppercase; letter-spacing:.08em; font-weight:600`.
`.tnr` — `cursor:pointer; transition:background .15s`; hover `background:rgba(61,224,255,.04)`; separator `box-shadow:inset 0 -1px 0 rgba(255,255,255,.035)` on all but last.
- `.ttrank` — `font-family:var(--mono); font-size:11px; color:var(--dim); text-align:center`
- `.tnr-thumb` — `42×42; border-radius:10px; overflow:hidden; background:var(--bg2); position:relative`; img `100%/100% object-fit:cover`
- `.tnr-title` — `font-family:var(--disp); font-size:14px; font-weight:500; line-height:1.25`, nowrap ellipsis; wrapped in `.tnr-title-line` (`inline-flex; gap:4px`) with the star button
- `.tnr-prev` — `11.5px; color:var(--muted); margin-top:3px; line-height:1.35`, nowrap ellipsis; text = top post truncated to 62 chars + `…`
- `.tnr-meta` — platform marks; `.tnr-meta .nplat svg{width:10px;height:10px}`
- numeric cells `.num` — `text-align:right; font-family:var(--mono); font-size:12.5px; tabular-nums`. Views `fmtCount`, Gain `<span class="nm-gain up">+123K</span>`, Age `4h`, Mcap = `narrMcapCell()` (see §5.3).
Top 10, sorted by author velocity then views velocity.

### 3.2 Trending token mini-table `.trend-tok-mini`
Header (`TREND_TOK_HEAD`, 2245): `# | Token | 24h | Vol | Liq | Mcap`.
`.tthd, .ttk` — `grid-template-columns:28px 2.1fr .62fr .72fr .72fr .82fr; gap:12px; padding:13px 20px; min-height:54px`. Same header/row treatment as above.
- `.tkico` here `36×36; font-size:15px; border-radius:10px; position:relative; overflow:hidden`
- `.tksym b{font-size:14px}`, `.tkname{font-size:11px; color:var(--muted)}` nowrap ellipsis
- `.socrow-mini{margin-top:3px; gap:4px}`, `.socrow-mini .soc{width:14px;height:14px;opacity:.8}`, svg `9×9`
- `.chgpill{font-size:11px; min-width:52px; padding:3px 7px}`
Top 10 by `trendScore` = `.4·min(vol/mc/3,1) + .25·min(txns/4800,1) + .2·min(max(c24,0)/85,1) + .15·min(max(c1h,0)/55,1)`.

---

# 4. NARRATIVE TABLE (`#v-narratives` → `.ttable.narr-table`)
Markup 1073–1083; row builder `narrRow()` at 2039.

### 4.1 Table shell `.ttable`
`position:relative; background:linear-gradient(180deg, rgba(255,255,255,.018), transparent 100px), var(--bg1); border:1px solid rgba(255,255,255,.055); border-radius:14px; overflow:hidden; box-shadow: inset 0 1px 0 rgba(255,255,255,.035), 0 20px 50px -30px rgba(0,0,0,.85)`.

### 4.2 Header row `.nthd`
Grid (shared with `.ntk`): `grid-template-columns: minmax(180px,2.1fr) 80px .95fr .95fr 1fr 52px; gap:12px; align-items:center; padding:13px 20px; min-height:54px`.
`background:linear-gradient(180deg, var(--bg2), rgba(19,19,22,.35)); border-bottom:1px solid rgba(255,255,255,.06)`.
Header `span` — `font-size:10px; color:var(--dim); text-transform:uppercase; letter-spacing:.08em; font-weight:600`.
`.r` cells: `text-align:right; font-family:var(--mono); font-size:12.5px; font-variant-numeric:tabular-nums; justify-self:end; width:100%`.
`.sortable` — `cursor:pointer; user-select:none; display:inline-flex; align-items:center; gap:3px; justify-content:flex-end; width:100%`; hover `color:var(--muted)`; `.on` `color:var(--ion)`. Arrow `i.sar` — `font-style:normal; font-size:9px`, content `' ▼'` (dir −1) / `' ▲'` (dir +1), empty when inactive.

Columns, left→right:
1. `Narrative` — not sortable
2. `Google trend` — not sortable, 80px fixed
3. `Views` — `data-ncol="views"`
4. `Gain 24h` — `data-ncol="gain"`
5. `Top mcap` — `data-ncol="mcap"`
6. `Age` — `data-ncol="age"`, 52px fixed

### 4.3 Data row `.ntk`
`cursor:pointer; transition:background .16s`; `:not(:last-child)` → `box-shadow: inset 0 -1px 0 rgba(255,255,255,.035)`; **hover** `background: rgba(61,224,255,.04)`. Carries `data-narrative="<id>"`; click opens the narrative modal.
- **Pinned (new arrival):** `.ntk.narr-pinned` → `box-shadow: inset 3px 0 0 var(--lime), inset 0 0 0 1px rgba(155,240,60,.18)`; pin lasts 300 000 ms.
- **Arrival flash:** `.narr-flash` → `animation:narrFlash 1.4s ease-out` (0% `background:rgba(155,240,60,.22); box-shadow:inset 0 0 0 1px rgba(155,240,60,.35)` → transparent).

**Cell 1 — `.nar-cell`** `display:flex; align-items:center; gap:10px; min-width:0`
- **Thumbnail `.nar-thumb`** — `42×42px; border-radius:10px; overflow:hidden; flex:none; background:var(--bg2); position:relative`. Inner `img.memeimg` — `width:100%; height:100%; object-fit:cover`. Source order: top post `mediaUrl` → `https://loremflickr.com/80/80/<keyword>?lock=<(imgSeed+1)*97+13>` → on error `https://picsum.photos/seed/<seed>/80` → on second error the `<img>` removes itself, leaving the `--bg2` square. `loading="lazy"`.
- **`.nar-meta`** `min-width:0`
  - `.nar-title-line` — `inline-flex; align-items:center; gap:4px; max-width:100%; min-width:0; vertical-align:top`
    - `.nar-title` — `font-family:var(--disp); font-size:14px; font-weight:500; line-height:1.25; color:var(--ink)`; inside `.nar-title-line` also `overflow:hidden; text-overflow:ellipsis; white-space:nowrap`
    - `.narr-new-pin` (only while pinned) — `font-family:var(--mono); font-size:9px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--lime); background:rgba(155,240,60,.12); border:1px solid rgba(155,240,60,.35); border-radius:4px; padding:1px 5px; margin-left:6px`; text `NEW`
    - **Star** `.star` — `background:none; border:none; color:var(--dim); font-size:13px; line-height:1; padding:0; transition:.12s; flex:none; cursor:pointer`. hover `color:var(--ion); transform:scale(1.15)`. `.on` `color:var(--ion)`. Glyph `☆` off / `★` on. `data-star-narr="<id>"`, `title="Watchlist"`.
  - `.nar-blurb` — `font-size:11.5px; color:var(--muted); margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis`
  - `.nar-row-meta` — `display:flex; align-items:center; gap:5px; margin-top:4px; flex-wrap:wrap`; holds the platform marks. ⚠ **The emitted spans are `.nplat` but only `.nar-plats .nplat` is styled.** Use the intended spec: `.nplat{display:grid; place-items:center; width:16px; height:16px; color:var(--ink); opacity:.88}`, `.nplat svg{width:12px; height:12px}`.
  - Optional inside `.nar-row-meta`: `.nar-row-meta .lc-pill{padding:1px 6px; font-size:8.5px}` (lifecycle pill, see §11).

**Cell 2 — Google trend `.nm-pulse`** `display:flex; flex-direction:column; gap:3px; align-items:flex-end`; `title="Google Trends search interest"`.
- `.nm-pulse .spark{width:100%; height:22px}`. SVG: `viewBox="0 0 100 24"`, `preserveAspectRatio="none"`; filled area `polyline` `fill:rgba(61,224,255,.12)`, then line `polyline` `stroke:#3DE0FF; stroke-width:1.6; stroke-linejoin:round; fill:none`. Series normalised to 85% of height with 7.5% bottom offset.
- Optional `.nm-pulse-lbl` — `font-size:8px; color:var(--dim); text-transform:uppercase; letter-spacing:.05em; text-align:right; width:100%`.
- **Empty:** `narrSparkSVG` returns `''` when the series is empty → blank cell.

**Cell 3 — Views** `<div class="nm-col" data-metric="views">`
- `.nm-val` — `display:inline-block; transition:color .2s, transform .2s`; text `fmtCount(views)` (`2.4M`, `980K`, `842`)
- `.nm-vv` — `display:block; font-family:var(--mono); font-size:10px; color:var(--dim); margin-top:2px`; text `1.2K/min`, hidden when velocity ≤ 0
- **Tick states:** `.nm-tick-up .nm-val{color:var(--lime); animation:nmTickUp .85s ease-out}` (`translateY(4px)`→0, opacity .5→1); `.nm-tick-down .nm-val{color:var(--red); animation:nmTickDown .85s}` (`translateY(-4px)`→0). Class removed after 900 ms.

**Cell 4 — Gain 24h** `<div class="nm-col">` → `<span class="nm-gain up|down">+123K</span>`. `.nm-gain.up{color:var(--lime)}`, `.nm-gain.down{color:var(--red)}`. Threshold: `up` when gain ≥ 150 000, else `down` (value is still rendered with a leading `+`). `.nm-dash{color:var(--dim)}` for `—`.

**Cell 5 — Top mcap** `<div class="nm-col">` → **either** the formatted market cap **or** a Create button:
- Market cap when a deployed token has `mint` + liquidity>0 + `firstDeployed` + `mcap>0`: `fmtUSD` → `$1.23M` / `$412.9K` / `$980`
- Otherwise `.btn-deploy-mini.deploy-narr` — `font-family:var(--mono); font-size:10px; font-weight:600; padding:4px 10px; border-radius:999px; border:1px solid rgba(61,224,255,.38); background:linear-gradient(180deg, rgba(61,224,255,.14), rgba(61,224,255,.06)); color:var(--ion); cursor:pointer; white-space:nowrap; transition:.15s`; **hover** `background:rgba(61,224,255,.2); box-shadow:0 0 12px -4px rgba(61,224,255,.45)`. Label `Create`. `.deploy-narr` resets `font-size:10px; padding:0; border:0; background:transparent; width:auto; justify-self:end` on the wrapper. `data-deploy-narr="<narrative id>"` → opens the create sheet for that cluster.

**Cell 6 — Age** `<div class="nm-col">` plain text from `age(minutes)`: `47m` / `4h` / `2d`.

### 4.4 Table states
- **Loading:** `#narrRows` = `<div class="noresult narr-loading">Loading narratives…</div>`. `.noresult{padding:44px; text-align:center; color:var(--muted)}`; `.narr-loading{color:var(--muted); font-size:13px; letter-spacing:.02em}`. Count chip shows `…`.
- **Empty:** same `.noresult` block with the empty copy; count `0`.
- **Count:** `#narrCount` + literal ` clusters`.
- **Sort:** chip (`New` / `Trending`) or column click. Column click clears both chips' `.active`. Default: author velocity desc, then views velocity desc. Pinned ids are hoisted to the top regardless.
- **Live tag:** `.simtag` / `.sim-tag` — `font-family:var(--mono); font-size:10px; color:var(--dim); border:1px solid rgba(255,255,255,.06); border-radius:6px; padding:2px 7px`; `.is-live` → `color:var(--lime); border-color:rgba(155,240,60,.28)`. Text `simulated data`.
- **Sample-data tag** `.narr-data-tag` — `font-family:var(--mono); font-size:10px; color:#ffb020; border:1px solid rgba(255,176,32,.35); border-radius:6px; padding:2px 7px; margin-left:4px`; text `using sample data`; `hidden` by default.

### 4.5 Watchlist variant
Same `.ttable.narr-table` + `.nthd`, but **no `.sortable`** class on any header. Section header `.wl-section-hd` (`flex; align-items:baseline; justify-content:space-between; gap:12px; margin-bottom:10px`), `.wl-section-title` (`--disp 15px/600, --ink`), `.wl-section-count` (`--mono 11px, --muted`), `.wl-section{margin-bottom:26px}`.
Empty: `.wl-empty-sm` — `padding:26px 16px; text-align:center; color:var(--muted); font-size:12.5px; border:1px dashed rgba(255,255,255,.08); border-radius:12px; background:rgba(255,255,255,.01)`; copy `No watched narratives — tap ☆ on any narrative row.` / `No watched tokens — tap ☆ on any token row.`

### 4.6 Search-results narrative list `.sr-narr-list`
Same panel treatment as `.ttable` but radius 14 / border `rgba(255,255,255,.055)`.
`.sr-narr` — `display:grid; grid-template-columns:56px 1fr; gap:12px; align-items:center; padding:12px 18px; cursor:pointer; transition:background .15s`; hover `background:rgba(61,224,255,.04)`; separator `inset 0 -1px 0 rgba(255,255,255,.035)`.
`.sr-narr-thumb` — `56×56; border-radius:10px; overflow:hidden; background:var(--bg2)`; `.sr-narr-sub` — `12px; color:var(--muted); margin-top:3px; line-height:1.35`, nowrap ellipsis; content `blurb · 2.4M views · $FERRY · $412.9K` (or `No coin yet`).
`.sr-empty` / `.sr-narr-list .noresult` — `padding:28px 18px; text-align:center; color:var(--muted); font-size:12.5px`.
Section chrome: `.sr-section+.sr-section{margin-top:28px}`, `.sr-section-hd` (baseline space-between, gap 12, mb 10), `.sr-section-title` (`--disp 15px/600`), `.sr-section-count` (`--mono 11px --muted`).

---

# 5. TOKEN TABLE (`#v-tokens`, `#v-new`, `#v-search`, `#v-watchlist`)
Header markup 1103–1115; rows `liveRow()` 2714 and `candidateRow()` 2697.

### 5.1 Grid
`.thd, .tk` — `display:grid; grid-template-columns: 2.1fr .82fr .6fr .6fr .66fr 100px .92fr .92fr .92fr .54fr 76px; gap:12px; align-items:center; padding:13px 20px; min-height:54px`.
Eleven columns: `Token` · `Price` · `5m` · `1h` · `24h` · `Last 24h`(sparkline, 100px, `.h`) · `Volume`(`.h`) · `Liquidity`(`.h`) · `Mkt Cap`(`.h`) · `Age`(`.h`) · action (76px, unlabelled header).
`.h` cells are hidden ≤1040px. `data-col` values: `price, c5, c1h, c24, vol, liq, mc, ageM`.

`.thd` — `background:linear-gradient(180deg, var(--bg2), rgba(19,19,22,.35)); border-bottom:1px solid rgba(255,255,255,.06)`; spans `10px / var(--dim) / uppercase / .08em / 600`. `.sortable` — `cursor:pointer; user-select:none; transition:.12s; white-space:nowrap; display:inline-flex; align-items:center; gap:3px; justify-content:flex-end`; hover `color:var(--muted)`; `.on` `color:var(--ion)`; `.sar` `font-style:normal; font-size:9px`.

### 5.2 Live row `.tk`
`position:relative; cursor:pointer; transition:background .16s cubic-bezier(.2,.7,.3,1)`; separator `inset 0 -1px 0 rgba(255,255,255,.035)`.
- **hover:** `background: linear-gradient(90deg, rgba(61,224,255,.055), rgba(61,224,255,0) 42%), var(--bg2)`
- **hover accent bar** `.tk::before` — `content:""; position:absolute; left:0; top:0; bottom:0; width:2px; background:var(--ion); opacity:0; box-shadow:0 0 12px var(--ion); transition:opacity .16s`; `opacity:1` on hover.

**Cell 1 — `.tkn`** `display:flex; align-items:center; gap:12px; min-width:0`
- `.tkico` — `36×36px; border-radius:10px; flex-shrink:0; display:grid; place-items:center; font-family:var(--disp); font-weight:600; font-size:15px; color:var(--bg0); position:relative; overflow:hidden; box-shadow: 0 0 0 1px rgba(255,255,255,.08), inset 0 1px 2px rgba(255,255,255,.28), 0 3px 8px -4px rgba(0,0,0,.6)`. Inline `background:<SYMCOLOR[sym] || #3DE0FF>`; content = first letter of the symbol, overlaid by `img.memeimg` (absolute inset 0, cover) if a logo/keyword image resolves. `.memeimg.tok-logo{object-fit:contain; background:#0a0a0c; padding:2px}`.
  `.tk:hover .tkico` → `box-shadow: 0 0 0 1px rgba(61,224,255,.4), inset 0 1px 2px rgba(255,255,255,.28), 0 0 16px -2px rgba(61,224,255,.35)`.
  `SYMCOLOR` map: FERRY `#3DE0FF`, PLANT `#9BF03C`, STAPLR `#ffb84c`, PIGEON `#a78bfa`, VEND `#4cc4ff`, MOUSE `#ff8a4c`, FROG `#7fe07f`, NORWAY `#6db3ff`, HORN `#5ec4ff`, FERN `#8fd46a`.
- `.tkmeta{min-width:0}`
  - `.tksym` — `display:flex; align-items:center; gap:6px`; `b` — `font-family:var(--sans); font-weight:600; font-size:14px; letter-spacing:-.01em`
  - `.newbadge` (freshly deployed) — `font-family:var(--mono); font-size:9px; font-weight:700; color:#001318; background:var(--lime); border-radius:4px; padding:1px 5px; letter-spacing:.04em`; text `NEW`
  - `.star` (see §4.3)
  - `.tkname` — `font-size:11px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis`
  - `.socrow` — `display:flex; align-items:center; gap:4px; margin-top:3px`; each `.soc` — `14×14px; border-radius:4px; display:grid; place-items:center; color:var(--dim); background:var(--bg2); border:1px solid var(--line); transition:.12s`; `svg 9×9`; hover `color:var(--ion); border-color:var(--ion)`. Emitted in fixed order when present: Website (`web`, globe), X, Telegram, DexScreener (`dex`, axis+line), pump.fun (`pump`, bolt). Each is an `<a target="_blank" rel="noopener" data-soc>` and stops row-click propagation.

**Cells 2–5 — numerics** `.tk .num{font-family:var(--mono); font-size:12.5px; text-align:right}`
- Price `.num.price` — `color:var(--ink); font-weight:600; letter-spacing:-.01em`; format `fmtP`: `$0.0000123` (7dp when <0.01) else `$1.2345`
- 5m / 1h / 24h — `.chgpill` — `font-family:var(--mono); font-variant-numeric:tabular-nums; font-size:11px; padding:3px 7px; border-radius:6px; display:inline-block; min-width:52px; text-align:right; font-weight:500`; `.up{color:var(--lime); background:rgba(155,240,60,.10)}`, `.down{color:var(--red); background:rgba(255,92,110,.10)}`; text `+12.4%` / `-3.1%` (one decimal, always signed)

**Cell 6 — Sparkline** `.num.h.spark-cell{padding:0 !important; overflow:hidden}`; `.spark{width:100%; height:22px; display:block; opacity:.85; transition:opacity .16s}`; `.tk:hover .spark{opacity:1}`. SVG `viewBox="0 0 100 28"`, `preserveAspectRatio="none"`, 24 points, deterministic from `ca.charCodeAt(1) + ageM%13`. Up: stroke `#9BF03C`, fill `rgba(155,240,60,.10)`. Down: stroke `#FF5C6E`, fill `rgba(255,92,110,.10)`. `stroke-width:1.6; stroke-linejoin:round`.

**Cells 7–10** — `fmtUSD(vol)`, `fmtUSD(liq)`, `fmtUSD(mc)`, `age(ageM)`. `fmtUSD`: `$1.23B` / `$1.23M` / `$12.3K` / `$980`.

**Cell 11 — action** `.buy` — `background:var(--ion); color:#001318; border-radius:8px; padding:6px 0; font-weight:600; font-size:12px; width:100%; transition:.15s`; hover `box-shadow:0 0 14px rgba(61,224,255,.45)`. Label `Buy`, `data-buy="<sym>"` → opens the token page.

### 5.3 Candidate (pending) row `.tk.pend`
`cursor:default; opacity:.72`; hover accent bar becomes `background:var(--dim); box-shadow:none`.
- `.tkico.pend` — `background:var(--bg3) !important; color:var(--dim); border:1px dashed var(--line)`; content = first letter, no image
- `.nocoin` — `font-family:var(--mono); font-size:9px; color:var(--dim); border:1px solid var(--line); border-radius:4px; padding:1px 5px`; text `no coin yet`
- `.tkname` = source post text sliced to 34 chars + `…`
- `.tkca` — `font-family:var(--mono); font-size:9.5px; color:var(--dim)`; text `awaiting launch`
- All nine numeric cells render the literal `—`
- Action `.deploybtn` — `background:transparent; color:var(--ion); border:1px solid var(--ion); border-radius:8px; padding:7px 0; font-weight:600; font-size:12px; width:100%`; label `Create Coin`, `data-deploy="<narrIdx>"`
- Also defined but unused in the current row: `.lbadge` (`--mono 9px; color:var(--lime); border:1px solid rgba(155,240,60,.3); border-radius:4px; padding:1px 5px`)

### 5.4 Table states
- **Empty:** `.noresult` (`padding:44px; text-align:center; color:var(--muted)`) with copy `No tokens yet.` / `No new pairs yet.` / `No tickers found in this post.` / `No token or candidate matches “q”.`
- **Loading:** no dedicated skeleton — the table renders empty until `renderTokens()` runs.
- **Meta line:** `#tokCount` (e.g. `12 tokens`) · `updated ` `#tokUpd` (`now`, re-stamped every 4 s while the Tokens view is on).
- Rows are filtered to tokens with liquidity > 0 (`visibleTokens`).

---

# 6. RIGHT RAIL (`aside.rail`)
Markup 1237–1251.

### 6.1 Container
`.rail` — `border-left:1px solid var(--line); min-height:calc(100vh - 56px); position:sticky; top:56px; height:calc(100vh - 56px); display:flex; flex-direction:column; position:relative`. Grid width **460px** (`.shell` column 2). Hidden ≤1040px.

### 6.2 Header `.railhd`
`padding:16px 18px 12px; border-bottom:1px solid var(--line); display:flex; align-items:center; gap:8px; flex-shrink:0`.
- `.lz` — `7×7px; border-radius:50%; background:var(--ion); box-shadow:0 0 9px var(--ion); animation:pulse 2s infinite`
- `.t` (`#railTitle`) — `font-family:var(--disp); font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:.07em`. Values by mode: initial `Live activity`; viral → `Live viral feed`; launches → `New launches`; trades → `Live trades`
- `.rail-status` (`#streamStatus`) — `font-family:var(--mono); font-size:10px; color:var(--dim); padding:2px 7px; border-radius:999px; border:1px solid rgba(255,255,255,.08); white-space:nowrap`. `.hot` → `color:var(--lime); border-color:rgba(155,240,60,.28); background:rgba(155,240,60,.06)`. Text `feed live` initially, then `N live` / `0 live` (capped at 24)
- `.c` (`#streamCount`) — `margin-left:auto; font-family:var(--mono); font-size:10.5px; color:var(--dim)`. Text `streaming`, then `N live` or the pool length, `…` while loading

### 6.3 Tab switcher `.railtabs`
`display:flex; gap:2px; padding:9px 12px; border-bottom:1px solid var(--line); flex-shrink:0`.
`.railtabs button` — `flex:1; padding:7px; border-radius:8px; font-size:12px; font-weight:500; color:var(--muted); transition:.12s`.
- **hover:** `color:var(--ink); background:var(--bg2)`
- **on:** `color:var(--ion); background:rgba(61,224,255,.1); box-shadow: inset 0 0 0 1px rgba(61,224,255,.2)`
Three buttons: `Trades`(`data-rail="trades"`), `Launches`, `Viral` (`.on` by default).

### 6.4 Scroll body `.stream`
`overflow-y:auto; padding:12px; flex:1`. Custom scrollbar: width 6px, thumb `var(--bg3)` radius 3.

### 6.5 Scoring-paused banner `.scoring-paused-banner` (`hidden` by default)
`margin:10px 12px 0; padding:10px 12px; border-radius:10px; background:rgba(255,176,32,.12); border:1px solid rgba(255,176,32,.35); color:#ffd98a; font-family:var(--mono); font-size:11px; line-height:1.45`. `b` — `color:#ffe8b0; font-weight:600; display:block; margin-bottom:4px; font-size:11.5px`. Copy: **`Meme scoring paused`** / `Anthropic budget exhausted — new viral posts will not appear until scoring resumes.`

### 6.6 Row type A — Trades (`.tape-row`, `tapeCard()` 2594)
`display:grid; grid-template-columns:auto 1fr auto; gap:10px; align-items:center; padding:9px 10px; border-radius:10px; cursor:pointer; transition:background .12s; animation:slidein .4s ease; box-shadow: inset 0 -1px 0 rgba(255,255,255,.03)`; **hover** `background:var(--bg2)`. `data-token="<sym>"`.
- `.tape-ic` — `30×30px; border-radius:8px; display:grid; place-items:center; font-family:var(--disp); font-weight:600; font-size:13px; color:var(--bg0); position:relative; overflow:hidden; box-shadow: 0 0 0 1px rgba(255,255,255,.08), inset 0 1px 1px rgba(255,255,255,.22)`; inline `background:<SYMCOLOR|#3DE0FF>`; letter + optional logo overlay
- `.tape-mid{min-width:0}`
  - `.tape-sym` — `font-family:var(--sans); font-weight:600; font-size:12.5px; display:flex; align-items:center; gap:6px`; text `$FERRY`; optional `.tape-tag` — `--mono 9px/700; color:#001318; background:var(--lime); border-radius:4px; padding:1px 5px; letter-spacing:.03em`, text `NEW`
  - `.tape-act` — `font-family:var(--mono); font-size:10.5px; margin-top:1px`; `.b{color:var(--lime)}` / `.s{color:var(--red)}`; text `Bought 1.42 SOL` / `Sold 0.31 SOL`
- `.tape-r` — `text-align:right; font-family:var(--mono)`
  - `.tape-sol` — `font-size:11.5px; color:var(--ink)`; text `(sol × SOL_PRICE).toFixed(0)` + ` $` (renders `0 $` when the SOL price hasn't loaded)
  - `.tape-t` — `font-size:10px; color:var(--dim); margin-top:2px`; text `12s` / `4m` / `2h`
Feed keeps 14 rows, pushes one new row every 2 600 ms (`pushStream`).

### 6.7 Row type B — Launches (`launchCard()` 2602 / `launchPendCard()` 2609)
Same `.tape-row` skeleton. Live launch: `.tape-act.b` = token **name** (not a side); `.tape-sol` = `fmtUSD(mc)`; `.tape-t` = `6m old` / `2d old`. Sorted ascending by `ageM`.
Pending launch: `.tape-ic` inline `background:var(--bg3); color:var(--dim)`; `.tape-act.s` = `awaiting launch`; right column carries only `.tape-t` = `+31m lead`; `data-post="<narrIdx>"`. Pending rows render **above** live ones.

### 6.8 Row type C — Viral (`.note` / `.note-card`, `streamLiveCard()` 2333, `streamCard()` 2566)
`.note{margin-bottom:10px}`; `.note.note-enter{animation:slidein .45s ease}`.
`.note-card` — `position:relative; overflow:hidden; background:linear-gradient(180deg, var(--bg2), var(--bg1)); border:1px solid var(--line); border-radius:14px; padding:13px; cursor:pointer; transition: transform .22s cubic-bezier(.2,.7,.3,1), box-shadow .22s, border-color .22s, background .22s`.
- **`::before` left rail:** `left:0; top:0; bottom:0; width:2px; background:linear-gradient(180deg, var(--ion), rgba(61,224,255,0)); transform:scaleY(0); transform-origin:top; opacity:0; transition:.25s cubic-bezier(.2,.7,.3,1)`
- **`::after` corner glow:** `inset:0; border-radius:inherit; pointer-events:none; background:radial-gradient(120% 90% at 12% 0%, rgba(61,224,255,.10), transparent 55%); opacity:0; transition:opacity .25s`
- **hover (`.note:hover .note-card`):** `transform:translateY(-3px); border-color:rgba(61,224,255,.42); background:linear-gradient(180deg, var(--bg3,#131316), var(--bg1)); box-shadow: 0 14px 40px -8px rgba(0,0,0,.6), 0 0 0 1px rgba(61,224,255,.12), 0 8px 30px -10px rgba(61,224,255,.28)`; `::before` → `scaleY(1)`, opacity 1; `::after` → opacity 1; thumbnail → `transform:scale(1.05)` (`transition .28s`); `.note-acts .pbtn` border-color → `rgba(61,224,255,.35)`

**`.note-top`** — `display:flex; align-items:center; gap:7px; margin-bottom:9px; min-width:0`
- `.pbadge` — base `26×26px; border-radius:7px; display:grid; place-items:center; flex:none; background:var(--bg3); border:1px solid var(--line); color:var(--muted)`; svg `14×14`. **Inside `.note-top` it is `22×22` with a `12×12` svg.** Per-platform colour: `.x, .tt` → `var(--ink)` (monochrome in the feed), `.rd` → `#ff8a4c`, `.fc` → `#a78bfa`, `.tg` → `#4cc4ff`
- `.note-id` — `min-width:0; flex:1; display:flex; align-items:baseline; gap:5px; overflow:hidden`
  - `.who` — `font-family:var(--sans); font-weight:600; font-size:13px; color:var(--ink)`; in `.note-top` → `12px`, nowrap ellipsis
  - `.at` — `font-family:var(--mono); font-size:11.5px; color:var(--muted)`; in `.note-top` → `10.5px`, nowrap ellipsis
- `.note-leads` — `margin-left:auto; display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end; flex:none`
  - `.lead` — `font-family:var(--mono); font-size:11px; color:var(--lime); border:1px solid rgba(155,240,60,.28); border-radius:6px; padding:3px 7px; margin-left:auto` (0 inside `.note-leads`)
  - `.lead.lead-age` (posted-age variant) — `color:var(--muted); border-color:rgba(255,255,255,.12); background:rgba(255,255,255,.03)`; text `14m ago`

**`.note-mid`** — `display:grid; grid-template-columns:46px 1fr; gap:10px; align-items:start; min-width:0`
- `.qthumb` — base `54×54px; border-radius:9px; flex:none; position:relative; overflow:hidden`; **inside `.note-mid` → `46×46px; border-radius:8px`**. `.ph` placeholder gradient: `background:var(--bg3)` + `::before` three radial gradients driven by `--p1/--p2/--p3` (palette 1–6, see below) + `::after` `radial-gradient(120% 100% at 50% 0%, transparent 40%, rgba(0,0,0,.30))`. `img.memeimg` sits at `z-index:1`, absolute inset 0, cover.
  - `.srcchip-mini` — `position:absolute; right:3px; top:3px; height:15px; padding:0 4px; border-radius:3px; background:rgba(4,4,6,.7); backdrop-filter:blur(6px); font-family:var(--mono); font-size:8px; letter-spacing:.05em; text-transform:uppercase; color:var(--muted); display:flex; align-items:center; border:1px solid var(--line); z-index:1|2`. Labels from `SRCLABEL`: photo → none, video → `from video`, link → `from link`, reply → `from replies`, none → `no media`
  - `.play-mini` — `absolute; left:50%; top:50%; translate(-50%,-50%); 22×22px; border-radius:50%; background:rgba(4,4,6,.6); backdrop-filter:blur(6px); display:grid; place-items:center; color:var(--ink)`; 10×10 play triangle
- `.note-text` — `min-width:0; font-family:var(--disp); font-weight:400; font-size:13px; line-height:1.42; color:var(--ink); -webkit-line-clamp:3; -webkit-box-orient:vertical; display:-webkit-box; overflow:hidden`

**`.note-foot`** — `display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:10px; min-width:0`
- `.qmeta` — `display:flex; align-items:center; gap:11px; font-family:var(--mono); font-size:10.5px; color:var(--muted); min-width:0`; each metric is `<span>label <b data-post-metric="k" data-metric-val="n">2.4M</b></span>`; `b{color:var(--ink); font-weight:500}`; `.qmeta .vv{font-weight:600}`. Metric triplets: **X/Reddit/Farcaster/Telegram** → `reposts`, `replies`, `views`; **TikTok** → `shares`, `likes`, `views` (simulated mode: `shares`/`saves`/`views`). Tick animation on update: `[data-post-metric].nm-tick-up{color:var(--lime); animation:nmTickUp .85s}` / `.nm-tick-down{color:var(--red); animation:nmTickDown .85s}`
- `.note-acts` — `display:flex; flex:none; gap:6px`; `.note-acts .pbtn{padding:6px 10px; font-size:11px}`
  - `.pbtn` base — `border-radius:9px; padding:8px 14px; font-weight:600; font-size:12.5px; white-space:nowrap; transition:.15s; border:1px solid transparent`
  - `.pbtn.deploy` / `.pbtn.trade` — `background:var(--ion); color:#001318`; hover `box-shadow:0 0 16px rgba(61,224,255,.4)`. Label `Create Coin`
  - `.pbtn.find` — `background:transparent; color:var(--lime); border-color:rgba(155,240,60,.35)`; hover `background:rgba(155,240,60,.08); border-color:var(--lime)`; **disabled** `color:var(--dim); border-color:var(--line); cursor:default` and no hover fill. Label `Search` (or `Search N coins` in the main-feed card)

**Data per viral row:** `postId`, `narrativeId`, `plat` (`x|tt`), `badge`, `txt`, `who`, `at`, `rawViews/replies/quotes/retweets/likes`, `mediaUrl`/`mediaType`, `platformPostId`, `postedAt`, `pal` (1–6), `lead`.
**Rail states:** loading → `<div class="noresult narr-loading">Loading live feed…</div>`, count `…`. Empty → `.noresult` `No recent viral posts.` + a 12px `var(--dim)` second line `New ingests slide in here in real time.` DOM trimmed to **24** cards; new arrivals prepend with `.note-enter` and are throttled to one every **1 800 ms**.

**Palette map `PAL` (thumbnail `--p1/--p2/--p3`)**
1 `rgba(61,224,255,.32) / rgba(61,224,255,.14) / rgba(120,140,150,.16)` · 2 `rgba(61,224,255,.24) / rgba(46,140,166,.32) / rgba(90,110,120,.16)` · 3 `rgba(44,192,224,.30) / rgba(61,224,255,.16) / rgba(18,26,34,.55)` · 4 `rgba(61,224,255,.36) / rgba(46,140,166,.26) / rgba(120,140,150,.16)` · 5 `rgba(90,108,118,.42) / rgba(61,224,255,.16) / rgba(46,140,166,.14)` · 6 `rgba(61,224,255,.28) / rgba(44,192,224,.22) / rgba(90,110,120,.18)`

### 6.9 Collapse controls (token view only)
`.rail-gutter` (`#railToggle`) — `position:absolute; left:0; top:280px (JS-positioned); transform:translateX(-50%); z-index:45; width:22px; height:48px; display:none` → `grid` when `.shell.token-view:not(.rail-collapsed)`; `border:1px solid rgba(255,255,255,.1); border-radius:11px 0 0 11px; color:var(--muted); background:linear-gradient(180deg, var(--bg2), var(--bg1)); font-size:15px; line-height:1; box-shadow:-6px 0 18px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.04)`. Glyph `›`. hover `color:var(--ion); border-color:rgba(61,224,255,.45); box-shadow:-8px 0 22px rgba(61,224,255,.12), inset 0 1px 0 rgba(255,255,255,.05)`; active `scale(.96)`.
`.rail-reopen` (`#railReopen`) — `position:fixed; right:0; z-index:45; display:none` → `flex` when `.shell.token-view.rail-collapsed`; `align-items:center; gap:7px; padding:12px 8px; border:1px solid rgba(255,255,255,.08); border-right:0; border-radius:14px 0 0 14px; background:linear-gradient(180deg, var(--bg2), var(--bg1)); color:var(--ion); font-family:var(--sans); font-weight:600; font-size:12px; letter-spacing:.04em; box-shadow:-8px 0 24px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.04)`. Content `‹` (`.chev` 16px, ion) + `Live feed`. hover `translateX(-2px)`.
`.shell.rail-collapsed{grid-template-columns:1fr}` and `.shell.rail-collapsed .rail{display:none}`.

---

# 7. NARRATIVE MODAL (`renderNarrativeModal()` 2186)

### 7.1 Backdrop + sheet
`.dback` — `position:fixed; inset:0; z-index:200; background:rgba(4,4,6,.72); backdrop-filter:blur(8px); display:grid; place-items:center; padding:20px; animation:fade .15s ease`. Click outside the sheet closes; `Esc` closes; `document.body.style.overflow='hidden'` while open.
`.sheet` — `width:100%; max-width:472px; border-radius:20px; overflow:hidden; animation:pop .18s ease; background:linear-gradient(180deg, rgba(255,255,255,.025), transparent 160px), var(--bg1); border:1px solid rgba(255,255,255,.08); box-shadow: 0 40px 90px -20px rgba(0,0,0,.8), inset 0 1px 0 rgba(255,255,255,.04)`.
`.pd-sheet` narrows to `440px`; **`.nm-sheet` overrides to** `display:flex; flex-direction:column; max-width:520px; max-height:min(640px, calc(100dvh - 32px)); overflow:hidden; box-shadow: 0 48px 100px -24px rgba(0,0,0,.85), inset 0 1px 0 rgba(255,255,255,.05)`.

### 7.2 Header `.sh-top`
Base `display:flex; align-items:center; gap:12px; padding:17px 19px; border-bottom:1px solid rgba(255,255,255,.06)`; **in `.nm-sheet`: `padding:13px 20px; gap:10px; flex-shrink:0`**.
- `.sh-kick{flex:1; min-width:0}` → `.sh-t` — `font-family:var(--disp); font-weight:600; font-size:17px`, text `Narrative`; `.sh-s` — `font-family:var(--mono); font-size:11px; color:var(--muted); margin-top:2px`
- `.tbtn-watch` — `margin-left:auto; flex-shrink:0; white-space:nowrap; font-family:var(--mono); font-size:11.5px; color:var(--muted); background:var(--bg2); border:1px solid rgba(255,255,255,.07); border-radius:8px; padding:5px 11px; transition:.12s`; hover `color:var(--ion); border-color:rgba(61,224,255,.4)`; `.on` `color:var(--ion); border-color:rgba(61,224,255,.35); background:rgba(61,224,255,.06)`. Labels `☆ Watch` / `★ Watching`
- `.sh-x` — `margin-left:0 (nm-sheet); color:var(--muted); font-size:14px; width:32px; height:32px; border-radius:9px; transition:.12s`; hover `background:var(--bg2); color:var(--ink)`. Glyph `✕`

### 7.3 Body `.sh-body`
Base `padding:17px 19px; display:flex; flex-direction:column; gap:15px; max-height:64vh; overflow:auto`; **in `.nm-sheet`: `flex:1 1 auto; min-height:0; max-height:none; overflow-x:hidden; overflow-y:auto; padding:14px 20px 18px; display:block; overscroll-behavior:contain`**.
`.nm-prem{display:grid; gap:10px; padding-bottom:2px}`.

1. **`.nm-title`** — `font-family:var(--disp); font-size:20px; font-weight:600; line-height:1.15; letter-spacing:-.02em; color:var(--ink); margin:0`; 2-line clamp. Data: `narrative.title`.
2. **Source post card** — `a.nm-post-link` (`display:block; text-decoration:none; color:inherit; border-radius:13px; border:1px solid transparent; transition:border-color .15s, box-shadow .15s`; hover `border-color:rgba(61,224,255,.28); box-shadow:0 0 0 1px rgba(61,224,255,.08)`), `href=postURL(topPost)`, `target=_blank rel="noopener noreferrer"`.
   `.nm-post-card` — `display:grid; grid-template-columns:72px 1fr; gap:11px; padding:11px 13px; border:1px solid rgba(255,255,255,.08); border-radius:13px; background:var(--bg0); box-shadow: inset 0 1px 0 rgba(255,255,255,.04)`.
   - `.nm-post-img` — `position:relative; width:72px; height:72px; min-width:72px; border-radius:9px; overflow:hidden; background:var(--bg2)`; img absolute inset 0, cover, `z-index:1`
   - `.nm-post-body` — `min-width:0; display:grid; gap:5px; align-content:start`
     - `.nm-post-plat` — `display:flex; align-items:center; gap:6px; font-size:10.5px; color:var(--muted)`; contains a `.pbadge` (26×26 base) + `X · @nordkyst_ferge`
     - `.nm-post-txt` — `font-size:12.5px; line-height:1.38; color:var(--ink)`, 2-line clamp; text truncated at **98 chars + `…`**
     - `.nm-post-views` — `font-family:var(--mono); font-size:10.5px; color:var(--ion)`; text `2.4M views · open post ↗`
3. **`.nm-cluster`** — `padding:11px 13px; border-radius:13px; background:var(--bg0); border:1px solid rgba(255,255,255,.07); display:grid; gap:9px`
   - `.nm-viral-words` — `font-size:10.5px; font-weight:600; letter-spacing:.05em; text-transform:uppercase; color:var(--ion)`; text `Viral on X and TikTok` (1/2/n-form)
   - `.nm-total-metrics` — `display:grid; grid-template-columns:repeat(4,1fr); gap:6px`; each `.nm-metric` — `padding:7px 4px; border-radius:10px; background:rgba(255,255,255,.02); border:1px solid rgba(255,255,255,.06); text-align:center`; `b` — `display:block; font-family:var(--mono); font-size:12.5px; color:var(--ink); font-weight:600; tabular-nums`; `span` — `display:block; font-size:8.5px; color:var(--dim); text-transform:uppercase; letter-spacing:.05em; margin-top:3px`. Four cells: **Views / Reposts / Likes / Age**
4. **`.nm-about`** — `position:relative; padding:11px 13px 11px 16px; border-radius:13px; background:linear-gradient(135deg, rgba(255,255,255,.025), transparent); border:1px solid rgba(255,255,255,.07); display:grid; gap:5px`; `::before` — `left:0; top:10px; bottom:10px; width:3px; border-radius:0 2px 2px 0; background:var(--ion)`.
   - `.nm-about-1` — `font-size:12.5px; line-height:1.42; color:var(--ink); font-weight:500`, 2-line clamp; sentence = capitalised blurb + `N posts tracked across X & TikTok.`
   - `.nm-about-2` — `font-size:12px; line-height:1.4; color:var(--muted)`, 2-line clamp; sentence = the timing reason (`Momentum established — mcap $378.3K, narrative age 4h.` etc.)
5. **`.nm-bottom`** — `display:grid; gap:10px; margin-top:2px`
   - **Google trend block** `.nm-pulse-block.tall` — `padding:11px 13px; border-radius:13px; background:var(--bg0); border:1px solid rgba(255,255,255,.07); margin:0`; `.nm-pulse-hd` — `display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin-bottom:7px`; `.nm-pulse-lbl` — `font-family:var(--disp); font-size:11.5px; font-weight:600; color:var(--ink); text-align:left; text-transform:none; letter-spacing:normal`, text `Google trend`; `.nm-pulse-sub` — `font-size:9.5px; color:var(--dim); text-align:right; white-space:nowrap`, text `Google Trends · "<term>"` / `Google Trends · search interest` / `Google Trends · demo`; `.tall .spark` — `height:38px; width:100%; display:block` (SVG `viewBox="0 0 100 44"`)
   - **Top-token block** `.nm-coin-mini` — `display:grid; grid-template-columns:1fr auto; align-items:center; gap:14px; padding:12px 13px; border-radius:13px; border:1px solid rgba(61,224,255,.28); background:linear-gradient(135deg, rgba(61,224,255,.1), rgba(61,224,255,.02)); margin:0`
     - `.nm-coin-mini-lbl` — `font-size:9px; color:var(--dim); text-transform:uppercase; letter-spacing:.07em; margin-bottom:3px`, text `Top token`
     - `.nm-coin-tick` — `font-family:var(--disp); font-size:18px; font-weight:600; color:var(--ink); letter-spacing:-.02em; line-height:1`, text `$HORN`
     - `.nm-coin-r` — `display:grid; grid-auto-flow:column; gap:20px; align-items:start; justify-self:end`; each `.nm-coin-stat` — `display:grid; gap:2px; text-align:right; min-width:4rem`; `span` `8.5px / var(--dim) / uppercase / .06em`; `b` `--mono 12px / var(--ink) / 600 / tabular`. Two stats: **Mcap** (`fmtUSD`) and **Age** (`age(ageMin)`)
     - **Empty state** `.nm-coin-mini.empty` — `border-color:rgba(255,255,255,.08); background:var(--bg0); grid-template-columns:1fr`; right column omitted; `.nm-coin-empty` — `font-family:var(--mono); font-size:12px; color:var(--muted); margin-top:2px`, text `No coin deployed yet`

### 7.4 Footer `.sh-foot.nm-foot-buy`
`flex-shrink:0; position:relative; z-index:2; display:flex; justify-content:flex-end; align-items:center; padding:12px 20px 14px; border-top:1px solid rgba(255,255,255,.08); background:var(--bg1); box-shadow:0 -8px 24px rgba(0,0,0,.35)`.
`.nm-foot-buy .deploy-go` — `margin-left:0; min-width:156px; padding:10px 20px; font-size:13.5px`; base `.deploy-go` = `background:linear-gradient(180deg,#5fe8ff,#3DE0FF); color:#001318; font-weight:600; border-radius:12px; transition:.15s`; hover `box-shadow:0 0 22px rgba(61,224,255,.5); transform:translateY(-1px)`.
**Two labels:** `Buy $HORN` when a deployed token with a mint exists (→ token page), else `Create coin` (→ create sheet).

### 7.5 Post-detail modal `.pd-sheet` (sibling component, `openPostDetail()`/`openViralPostItem()`)
`.sheet.pd-sheet` max-width `440px`. Header: `.pbadge` + `.sh-t` `Who <span class="pd-at">@handle</span>` (`.pd-at{color:var(--muted); font-weight:500; font-size:12px; margin-left:2px}`) + `.sh-s` subtitle `X · Video · posted 14m ago` (or `… · flagged +31m before CT`).
- `.pd-media` — `position:relative; height:150px; border-radius:12px; overflow:hidden; border:1px solid var(--line); margin-bottom:2px`; `.pd-media.pd-open` is an `<a>` with hover overlay `::after` — `background:rgba(6,6,7,.45); color:var(--ion); font-size:18px; font-weight:700; opacity:0→1; transition:opacity .18s`, glyph `⤢` (`\2922`)
- `.pd-text` — `font-family:var(--disp); font-weight:400; font-size:15px; line-height:1.45; color:var(--ink); margin:2px 0 4px`
- `.pd-stats` — `display:grid; grid-template-columns:repeat(4,1fr); gap:8px`; `.pd-stat` — `border:1px solid var(--line); border-radius:10px; padding:8px 9px; background:var(--bg1); text-align:center`; `.pdv` — `display:block; font-family:var(--mono); font-size:14px; font-weight:600; color:var(--ink)`; `.pdk` — `display:block; font-size:9.5px; letter-spacing:.05em; text-transform:uppercase; color:var(--dim); margin-top:3px`
- `.pd-tickers` — `display:flex; flex-direction:column; gap:7px`; `.pd-l` — `--mono 10px; letter-spacing:.06em; uppercase; color:var(--dim)`, text `Tickers in this post` / `No coin yet — you could be first`; `.pd-chips` — `flex; wrap; gap:6px` of `.achip` (`cursor:default` here)
- Footer `.sh-foot`: `.deploy-go` `Create Coin` + `.sh-x2` `Search` / `Search N`
- The trigger affordance on any thumbnail: `.qthumb[data-post-detail]{cursor:pointer; position:relative}` with `::after` overlay `background:rgba(6,6,7,.5); color:var(--ion); font-size:15px; font-weight:700; opacity:0→1`, glyph `⤢`

---

# 8. TOKEN DETAIL PAGE (`#v-token` → `openToken()` 3281)

### 8.1 Back button `.tpback`
`display:inline-flex; align-items:center; gap:7px; color:var(--muted); font-size:12.5px; margin-bottom:16px; font-family:var(--mono); background:var(--bg1); border:1px solid rgba(255,255,255,.06); border-radius:9px; padding:8px 13px; transition:.15s`; hover `color:var(--ion); border-color:rgba(61,224,255,.4)`. Label `← back`.

### 8.2 Layout `.tp2`
`display:grid; grid-template-columns:1fr 356px; gap:16px; align-items:start`. `.tp2-main{min-width:0; display:flex; flex-direction:column; gap:14px}`. `.tp2-side{display:flex; flex-direction:column; gap:14px; position:sticky; top:72px}`. ≤1040px → single column, side unsticks.

**Shared panel skin** (`.tid, .qstats, .chartcard, .tradebox, .secbox`): `background:linear-gradient(180deg, rgba(255,255,255,.02), transparent 120px), var(--bg1); border:1px solid rgba(255,255,255,.055); border-radius:16px; box-shadow: inset 0 1px 0 rgba(255,255,255,.03), 0 26px 64px -38px rgba(0,0,0,.85)`.

### 8.3 Identity header `.tid`
`display:flex; align-items:center; gap:15px; padding:16px 18px`.
- `.tid .tkico` — `52×52px; font-size:23px; border-radius:15px; box-shadow: 0 0 0 1px rgba(255,255,255,.1), inset 0 1px 2px rgba(255,255,255,.3), 0 8px 20px -6px rgba(0,0,0,.6)`; inline `background:<SYMCOLOR|#3DE0FF>`; letter + logo overlay
- `.tid-top` — `display:flex; align-items:baseline; gap:9px; flex-wrap:wrap`
  - `h1` — `font-family:var(--disp); font-size:27px; font-weight:600; line-height:1; letter-spacing:-.01em`; text `$FERRY`
  - `.tid-name` — `color:var(--muted); font-size:13px`; token name or `—`
  - `.newbadge` when `justDeployed`; `.live-dot` when data is <120 s fresh — `font-family:var(--mono); font-size:10px; font-weight:600; color:var(--lime); border:1px solid rgba(155,240,60,.35); background:rgba(155,240,60,.08); border-radius:6px; padding:2px 7px; text-transform:lowercase`, text `live`
- `.tid-sub` — `display:flex; align-items:center; gap:7px; margin-top:9px; flex-wrap:wrap`
  - `.ca-mini` — `inline-flex; align-items:center; gap:6px; font-family:var(--mono); font-size:11px; color:var(--muted); background:var(--bg2); border:1px solid rgba(255,255,255,.07); border-radius:8px; padding:5px 9px; transition:.12s`; svg `12×12`; hover `border-color:rgba(61,224,255,.5); color:var(--ion)`; **copied state** `.ca-mini.copied{color:var(--lime); border-color:var(--lime)}` (1 000 ms). Text `4mZq…8xPq` + copy icon
  - `.tid-sub .soc` — `26×26px`, svg `13×13`
- `.tid-price` — `margin-left:auto; text-align:right`; `.p` (`#livePrice`) — `font-family:var(--mono); font-size:26px; font-weight:600; letter-spacing:-.02em`; `.chg` — `font-family:var(--mono); font-size:13px; margin-top:2px`, class `up`/`down`; `.chg small{color:var(--dim)}` text `24h`. Null price renders `—`.

### 8.4 Origin strip `.tp-origin` (only when the token maps to a narrative)
`display:flex; align-items:center; gap:12px; width:100%; text-align:left; background:var(--bg1); border:1px solid rgba(255,255,255,.08); border-radius:14px; padding:11px 14px; cursor:pointer; transition:border-color .15s, box-shadow .15s, background .15s; font:inherit; color:inherit`; hover `border-color:rgba(61,224,255,.35); box-shadow:0 0 0 1px rgba(61,224,255,.1); background:var(--bg2)`.
- `.tp-origin-thumb` — `48×48px; border-radius:9px; overflow:hidden; background:var(--bg2)`
- `.tp-origin-body` — `flex:1; min-width:0; display:grid; gap:4px`
  - `.tp-origin-kicker` — `display:flex; align-items:center; gap:6px; font-size:10.5px; color:var(--muted)`; `.pbadge` + `Source post · <narrative title>`
  - `.tp-origin-txt` — `font-size:12.5px; line-height:1.35; color:var(--ink)`, 2-line clamp; text = post text truncated at 86 chars + `…`, wrapped in curly quotes
- `.tp-origin-link` — `font-family:var(--mono); font-size:11.5px; color:var(--ion); white-space:nowrap; flex-shrink:0`; text `View narrative →`

### 8.5 Stat grid `.qstats` (single row, 7 cells)
`display:flex; flex-wrap:nowrap; align-items:stretch; overflow:hidden`.
`.qs` — `flex:1 1 0; min-width:0; padding:11px 12px; position:relative; transition:background .14s`; hover `background:var(--bg2)`; divider `.qs:not(:first-child)::before{content:""; position:absolute; left:0; top:24%; bottom:24%; width:1px; background:rgba(255,255,255,.06)}`.
- `.qs .k` — `font-size:9.5px; color:var(--dim); text-transform:uppercase; letter-spacing:.07em; font-weight:600`
- `.qs .v` — `font-family:var(--mono); font-size:14px; margin-top:5px; font-weight:500; letter-spacing:-.01em`; `.v.up{color:var(--lime)}`, `.v.down{color:var(--red)}`
Cells in order with ids: `5m`(#qsC5) · `1h`(#qsC1h) · `24h`(#qsC24) · `Mkt cap`(#qsMcap) · `Liquidity`(#qsLiq) · `24h vol`(#qsVol) · `Holders`(#qsHolders). Null → `—`. Changes repaint via `updateTokenQstats()`.
≤1040px: `.qstats{overflow-x:auto}`, `.qs{flex:0 0 auto; min-width:74px; padding:10px 11px}`.

### 8.6 Chart area `.chartcard`
`padding:14px` + shared panel skin.
- `.chart-top` — `display:flex; align-items:center; justify-content:space-between; margin-bottom:11px`
  - `.chart-price` — `display:flex; align-items:baseline; gap:8px`; `b` (`#chartPrice`) — `font-family:var(--mono); font-size:19px; letter-spacing:-.02em`; `.chg` — `font-family:var(--mono); font-size:12px` with `up`/`down`
  - `.tv-tag` — `font-family:var(--mono); font-size:9.5px; color:var(--dim); border:1px solid rgba(255,255,255,.07); border-radius:5px; padding:2px 6px; text-transform:uppercase; letter-spacing:.05em`; text `DexScreener`
- `.tvchart` (`#dexChart`) — `height:440px; border-radius:11px; overflow:hidden; background:var(--bg0); border:1px solid rgba(255,255,255,.045)`; `iframe{border-radius:11px; width:100%; height:100%; min-height:420px; border:0; display:block}`. Src = `https://dexscreener.com/solana/<pair>?embed=1&theme=dark&trades=0&info=0&chartLeftToolbar=0&chartTheme=dark&chartType=usd&interval=5`
- **Loading / empty:** `.tvload, .chart-empty` — `height:100%; display:grid; place-items:center; color:var(--muted); font-size:12.5px; font-family:var(--mono); padding:24px; text-align:center; min-height:420px`. Copy: `Resolving live SOL pair…` then `No live SOL pair for this token yet`.
- **Unused-but-present:** the timeframe row `.tfrow`/`.tf` (`display:flex; gap:3px; background:var(--bg0); border:1px solid rgba(255,255,255,.05); border-radius:10px; padding:3px`; `.tf{font-family:var(--mono); font-size:12px; color:var(--muted); padding:5px 12px; border-radius:7px}`; `.tf.active{background:rgba(61,224,255,.12); color:var(--ion); box-shadow: inset 0 0 0 1px rgba(61,224,255,.25)}`) and the whole canvas candle renderer (`drawChart`, 2982) are dead in the shipped page. Port them only if you re-introduce the in-house chart.

### 8.7 Tab strip `.tp-tabs` + `.tp-tabbody`
`.tp-tabs` — `display:flex; gap:2px; flex-wrap:wrap; padding:0 8px; background:var(--bg1); border:1px solid rgba(255,255,255,.055); border-bottom:none; border-radius:14px 14px 0 0`.
`.tpt` — `padding:12px 14px; font-size:13px; font-weight:500; color:var(--muted); border-bottom:2px solid transparent; transition:.12s`; hover `color:var(--ink)`; `.on` `color:var(--ion); border-bottom-color:var(--ion)`.
`.tp-tabbody` — `background:var(--bg1); border:1px solid rgba(255,255,255,.055); border-top:none; border-radius:0 0 14px 14px; padding:6px 10px 10px`. `.tppane{display:none; padding-top:6px}`, `.tppane.on{display:block}`.
Tabs (Layer-3 only for the first two): `Transactions`(trades, default `.on`) · `Top traders`(traders) · `Holders` · `Info`. Off Layer 3, only Holders (default) and Info render.

**Transactions pane** `.trhd / .trrow` — `display:grid; grid-template-columns:.7fr .7fr 1fr 1.1fr 1.1fr 1fr; gap:8px; padding:8px 10px; align-items:center`.
`.trhd` — `font-size:10px; color:var(--dim); text-transform:uppercase; letter-spacing:.06em; font-weight:600`; columns `Age | Type | SOL | <SYM> | USD | Trader`.
`.trrow` — `font-family:var(--mono); font-size:11.5px; box-shadow: inset 0 -1px 0 rgba(255,255,255,.04); border-radius:7px; transition:background .12s`; hover `background:var(--bg2)`. `.tm{color:var(--dim)}` (Solscan `<a>` inside; `a{color:var(--dim)} a:hover{color:var(--ion)}`). `.ty{font-weight:600}` `.ty.b{color:var(--lime)}` `.ty.s{color:var(--red)}` → `Buy`/`Sell`. `.wal{color:var(--muted)}` `.wal.you{color:var(--ion)}` → `4mZq…8xPq` or `you`; `[data-trader]` gets `cursor:pointer` and `hover{color:var(--ion); text-decoration:underline}`. Numbers: SOL `toFixed(4)`, tokens `toLocaleString(maxFrac 0)`, USD `fmtUSD`; missing → `—`. Max 50 rows.
Filter banner `.trfilter` — `display:flex; align-items:center; gap:8px; background:rgba(61,224,255,.07); border:1px solid rgba(61,224,255,.22); border-radius:10px; padding:9px 12px; margin-bottom:8px; font-size:12px; color:var(--muted)`; `b{color:var(--ion); font-family:var(--mono)}`; `a{margin-left:auto; font-family:var(--mono); font-size:11px; color:var(--ion)}` → `clear ✕`.
States: loading `<div class="tr-empty dim panel-loading">Loading trades…</div>` (`.tr-empty{padding:16px 10px}`, `.panel-loading{opacity:.72; animation:panelPulse 1.2s ease-in-out infinite}` .55↔.95); empty `No recent trades`. Polls every 10 000 ms; 20 s cache.

**Top traders pane** `.ttr-hd / .ttr-row` — `display:grid; grid-template-columns:24px 1.05fr .9fr .9fr .82fr .72fr .72fr; gap:6px; padding:8px 10px; align-items:center`. Header cols `# | Trader | Bought | Sold | Realised | Unreal. | Balance`.
`.ttr-row` — `font-family:var(--mono); font-size:11.5px; box-shadow: inset 0 -1px 0 rgba(255,255,255,.04); cursor:pointer; transition:background .12s; border-radius:7px`; hover `background:var(--bg2)`; `.rk{color:var(--dim)}`; `.wal{color:var(--muted)}` → hover `color:var(--ion)`. `.pnl-sub`/`.side-sub` — `display:block; font-size:9px; color:var(--dim); margin-top:1px`.
Accumulating sub-section: `.ttr-acc-hd` — `font-size:10px; color:var(--dim); uppercase; letter-spacing:.06em; font-weight:600; padding:10px 10px 4px; margin-top:4px; box-shadow: inset 0 1px 0 rgba(255,255,255,.06)`, text `Accumulating · no sells in window`; `.ttr-row.acc{opacity:.85; cursor:default}`; `.acc-tag{font-size:10px; color:var(--muted); font-style:italic}` → `accumulating`.
**Loading skeleton:** 10 × `.ttr-row.ttr-skel` (`cursor:default; pointer-events:none`); `.sk` — `display:block; height:10px; border-radius:4px; background:linear-gradient(90deg, var(--bg2) 0%, var(--bg3) 50%, var(--bg2) 100%); background-size:200% 100%; animation:skel 1.2s ease-in-out infinite`; `.rk.sk{width:18px}`, `.wal.sk{width:72px}`, `.r.sk{width:44px; margin-left:auto}`.
Footnotes: `.ttr-stale` — `font-size:10px; color:var(--dim); padding:2px 10px 4px; font-family:var(--mono)`; `.ttr-cap` — `font-size:10px; color:var(--dim); padding:0 10px 8px; line-height:1.45; max-width:520px`.
Empty: `No ranked traders with sells in this window`.

**Holders pane** `.hld-sum` — `display:flex; justify-content:space-between; font-size:12.5px; color:var(--muted); margin:4px 4px 12px`; `b{color:var(--ink); font-family:var(--mono)}`. Copy: `**1,204** holders` / `Top 10 hold **24%**` (b class `up` when ≤30, `down` when >30).
`.hld` — `display:grid; grid-template-columns:1fr 120px 46px; gap:10px; align-items:center; padding:6px 4px; font-size:11.5px`; `.hld-w` — `font-family:var(--mono); color:var(--muted)`, nowrap ellipsis; `.hld-bar` — `height:6px; border-radius:3px; background:var(--bg3); overflow:hidden`, fill `i{height:100%; background:linear-gradient(90deg, var(--ion), #2E8CA6)}`; `.hld-p` — `font-family:var(--mono); text-align:right; color:var(--ink)`, `12.34%`.
`.hld-foot` — `font-size:10px; margin-top:10px; padding:0 4px; color:var(--dim)`, text `top 5,000 accounts` (only when truncated). Empty: `No holder data`.

**Info pane** `.inf-grid` — `display:grid; grid-template-columns:1fr 1fr; gap:1px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.055); border-radius:12px; overflow:hidden`. `.inf` — `background:var(--bg1); padding:12px 14px; display:flex; flex-direction:column; gap:3px`; `.k` — `font-size:10px; color:var(--dim); text-transform:uppercase; letter-spacing:.05em`; `.v` — `font-size:12.5px; color:var(--ink)`; `.v.mono{font-family:var(--mono); display:flex; align-items:center; gap:8px}`.
Fields: `Contract` (short CA + `.ca-mini` copy) · `Created` (`6m ago`/`—`) · `Market cap` · `Liquidity` · `Total supply` (literal `1,000,000,000`) · `Origin narrative` (full-width `grid-column:1/-1`; renders a borderless `.tp-origin-link` button `<title> →` or the quoted post text).
`.inf-soc` — `display:flex; gap:7px; margin-top:12px` of `.soc` links.

### 8.8 Trade panel `.tradebox`
`padding:16px` + shared panel skin.
- `.tb-head` — `display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:14px`; left = `.sec-h` (`font-family:var(--disp); font-weight:500; font-size:13px; display:flex; align-items:center; gap:7px`, inline `margin:0`) text `Trade $FERRY`; right = `.tbtn-watch` (see §7.2)
- **Buy/Sell toggle `.sides`** — `display:flex; gap:6px; margin-bottom:14px; padding:4px; background:var(--bg0); border:1px solid rgba(255,255,255,.05); border-radius:11px`
  - `button` — `flex:1; height:38px; border-radius:8px; font-weight:650; font-size:14px; color:var(--muted); border:1px solid transparent; background:transparent; transition: transform .14s cubic-bezier(.2,.7,.3,1), box-shadow .14s, border-color .14s, background .14s, color .14s`
  - hover `color:var(--ink); background:rgba(255,255,255,.03)`; active `transform:scale(.98)`
  - **`.on.b`** `background:linear-gradient(180deg,#b4f86a,#9BF03C); border-color:rgba(155,240,60,.55); color:#0a1400; box-shadow:0 6px 18px -8px rgba(155,240,60,.75), inset 0 1px 0 rgba(255,255,255,.35)`
  - **`.on.s`** `background:linear-gradient(180deg,#ff7584,#FF5C6E); border-color:rgba(255,92,110,.55); color:#1a0206; box-shadow:0 6px 18px -8px rgba(255,92,110,.65), inset 0 1px 0 rgba(255,255,255,.22)`
  - Labels `Buy` / `Sell`; Buy `.on.b` by default
- **Amount field `.fp`** (`margin-bottom:14px`)
  - `.lbl` — `display:flex; justify-content:space-between; font-family:var(--mono); font-size:11.5px; color:var(--muted); margin-bottom:8px`; `b{color:var(--ink); font-weight:600}`. Left `Amount`; right `#bal` — `Balance <span class="dim">Connect wallet</span>` / `Balance <b>1.2345</b> SOL` / `Holdings <b>1,204</b> FERRY` / `Balance <b>—</b> SOL`
  - `.amt` — `display:flex; align-items:center; gap:8px; border:1px solid rgba(255,255,255,.08); border-radius:11px; background:linear-gradient(180deg, rgba(0,0,0,.22), rgba(255,255,255,.015)); padding:11px 13px; box-shadow: inset 0 1px 2px rgba(0,0,0,.35), 0 1px 0 rgba(255,255,255,.03); transition:border-color .16s, box-shadow .16s`; **focus-within** `border-color:rgba(61,224,255,.55); box-shadow: inset 0 1px 2px rgba(0,0,0,.35), 0 0 0 3px rgba(61,224,255,.12), 0 0 18px rgba(61,224,255,.08)`
  - `.amt input` — `flex:1; min-width:0; border:0; background:none; color:var(--ink); font-family:var(--mono); font-size:20px; font-weight:600; padding:0; letter-spacing:-.02em; tabular-nums`; `type=number min=0 step=0.1`, default `1`
  - `.amt .u` (`#amtun`) — `font-family:var(--mono); font-size:12px; color:var(--dim); font-weight:500`; `SOL` on buy, symbol on sell
  - **Presets `.pre`** — `display:flex; gap:5px; margin-top:9px`; `button` — `flex:1; height:30px; border:1px solid rgba(255,255,255,.07); border-radius:8px; font-family:var(--mono); font-size:11.5px; color:var(--muted); background:var(--bg0); transition:transform .12s, border-color .12s, color .12s, background .12s, box-shadow .12s`; hover `border-color:rgba(61,224,255,.4); color:var(--ion); background:rgba(61,224,255,.05)`; active `scale(.97)`; **`.on`** `border-color:rgba(61,224,255,.55); color:var(--ion); background:linear-gradient(180deg, rgba(61,224,255,.16), rgba(61,224,255,.06)); box-shadow: inset 0 0 0 1px rgba(61,224,255,.18), 0 0 14px rgba(61,224,255,.12)`
    Buy set: `0.5 | 1 | 2 | 5 | MAX`; Sell set: `25% | 50% | 75% | 100% | MAX`. (`.pre` reuses the `.presets .mx` accent: `color:var(--ion); border-color:rgba(61,224,255,.3)`.)
- **Slippage / Priority row** — a second `.fp` whose `.lbl` reads `Slippage` (left) / `Priority` (right); body is `display:flex; gap:8px` with two `.pre` groups (`style="margin:0;flex:1"`): `#slipChips` `0.5% | 1%(on) | 5% | Auto`; `#prioChips` `Fast(on) | Turbo`
- **You-receive `.recv`** — `padding:14px 15px; background:linear-gradient(180deg, rgba(61,224,255,.1), rgba(61,224,255,.02)); border:1px solid rgba(61,224,255,.22); border-radius:12px; display:flex; justify-content:space-between; align-items:baseline; margin-bottom:12px; box-shadow: inset 0 1px 0 rgba(255,255,255,.04), 0 12px 28px -22px rgba(61,224,255,.35)`
  - `.recv .k` — `font-family:var(--mono); font-size:10px; letter-spacing:.12em; text-transform:uppercase; color:var(--dim); font-weight:600`, text `You receive`
  - `.recv .v` — `font-family:var(--mono); font-size:19px; font-weight:700; color:var(--ink); letter-spacing:-.02em; tabular-nums; text-shadow:0 0 20px rgba(61,224,255,.15)`; default `—`, then `12,345.6789 FERRY`
  - `.recv-usd` — `display:block; font-size:12px; color:var(--muted); margin-top:4px; font-family:var(--mono)`, `$1,204.55`
- **Mini recap `.mini`** — `display:grid; gap:7px; margin-bottom:14px; padding:11px 12px; border:1px solid rgba(255,255,255,.05); border-radius:11px; background:rgba(0,0,0,.16); box-shadow: inset 0 1px 0 rgba(255,255,255,.025)`; `.r` — `display:flex; justify-content:space-between; font-family:var(--mono); font-size:12px; align-items:center`; first span `color:var(--dim)`, last span `color:var(--ink); tabular-nums`.
  Rows: `Min received` (#minrecv, `—`) · `Price impact` (#impact, `—`; inline colour `#9BF03C` ≤1.5%, `#ffb84c` >1.5%, `#FF5C6E` >5%) · `LP fee` (literal `1.00%`) · `Network` (#netfee, `0.0005 SOL` fast / `0.002 SOL` turbo)
- **Execute `.doit`** — `height:46px; width:100%; border-radius:11px; font-weight:700; font-size:15px; letter-spacing:.01em; background:linear-gradient(180deg,#b4f86a,#9BF03C); color:#0a1400; border:1px solid rgba(155,240,60,.45); box-shadow:0 10px 28px -12px rgba(155,240,60,.75), inset 0 1px 0 rgba(255,255,255,.35); transition:transform .14s cubic-bezier(.2,.7,.3,1), box-shadow .14s, filter .14s`
  - hover `translateY(-1px)` + `0 14px 34px -10px rgba(155,240,60,.85), inset 0 1px 0 rgba(255,255,255,.4)`; active `translateY(0) scale(.985); filter:brightness(.98)`
  - `.doit.s` (sell) `background:linear-gradient(180deg,#ff7584,#FF5C6E); color:#1a0206; border-color:rgba(255,92,110,.45); box-shadow:0 10px 28px -12px rgba(255,92,110,.7), inset 0 1px 0 rgba(255,255,255,.22)`; hover `0 14px 34px -10px rgba(255,92,110,.8), …`
  - **disabled** `opacity:.72; transform:none; filter:none; cursor:not-allowed` (an earlier rule also sets `opacity:.42; box-shadow:none` — the later `.doit:disabled` at line 441 wins)
  - Labels: `Buy $FERRY` / `Sell $FERRY`; transient `Building…` → `Sign & send…` → `Confirming…` → `Confirmed ✓`; disabled on load
- **Fine print `.fine.quote-note`** (#quoteNote) — `padding-top:11px; font-family:var(--mono); font-size:10.5px; color:var(--dim); text-align:center; letter-spacing:.02em`. Messages: `quote only — trading not live` (default) · `Live trading on Layer 3 deploy only` · `Connect wallet to trade` · `Enter an amount` · `Waiting for quote…` · `connect Jupiter for live quotes` · `live route via Jupiter` · on success a Solscan link · on failure the error message.
- **Confirm dialog** (`showSwapConfirm`, 3204) — a `.sheet` at inline `max-width:420px` with `.sh-hd > .sh-t` `Confirm Buy $FERRY`, a `padding:16px 20px; font-size:13px; line-height:1.7` body of four `<span class="dim">label</span> <b>value</b>` rows (Amount / You receive / Price impact / Slippage), and a `.sh-foot` (`display:flex; gap:8px; padding:12px 16px`) with `.wallet-btn#swapCancel` (`flex:1; justify-content:center`) `Cancel` and `.doit.b#swapOk` (`flex:1`) `Sign & send`. ⚠ `.sh-hd` has no CSS rule.

### 8.9 Safety checks `.secbox`
`padding:16px` + shared panel skin.
- `.sec-h` — `font-family:var(--disp); font-weight:500; font-size:13px; margin-bottom:11px; display:flex; align-items:center; gap:7px`, text `Safety checks`
- `.sec` — `display:flex; justify-content:space-between; font-size:12px; padding:8px 0; border-top:1px solid rgba(255,255,255,.05); color:var(--muted)`; `.sec:first-of-type{border-top:none}`
- Value spans: `.ok{color:var(--lime); font-family:var(--mono); font-size:11.5px}` · `.warn{color:#ffb84c; font-family:var(--mono); font-size:11.5px}` · `.dim` for unknown (⚠ **`.dim` has no rule — intended `color:var(--dim)`, `#5A5A62`**)
Four rows, in order:
1. `Mint authority` → `✓ Revoked` / `⚠ Active` / `—`
2. `Freeze authority` → `✓ Revoked` / `⚠ Active` / `—`
3. `LP status` → `✓ Burned` / `⚠ Not burned` / `—`
4. `Top 10 holders` → `24%`; class `ok` when ≤30, `warn` when >30, `dim` when null
Repainted by `refreshTokenEnrichedUI()` / `updateSafetyTop10()` from `/api/safety` and `/api/holders`.
Related but unused: `.trust`/`.tc` trust strip (766–771) and `.leadbadge` (764).

---

# 9. DEPLOY / CREATE SHEET (`openDeploy()` 2877, `openDeployFromViralPost()` 2065, `openDeployForNarrative()` 2142)

Backdrop `.dback` and `.sheet` exactly as §7.1 (max-width **472px**, radius 20).

### 9.1 Header `.sh-top`
`padding:17px 19px; gap:12px; border-bottom:1px solid rgba(255,255,255,.06)`.
- `.sh-top .pbadge` — `38×38px; border-radius:11px; box-shadow: 0 0 0 1px rgba(255,255,255,.08), inset 0 1px 1px rgba(255,255,255,.2)`; svg `18×18`
- `.sh-t` — `--disp 600 17px`, text `Create a coin`
- `.sh-s` — `--mono 11px var(--muted); margin-top:2px`. Three variants: `from a live narrative · +31m before CT` · `from viral post · simulated` · `from narrative cluster · simulated`
- `.sh-x` `✕` (32×32, radius 9, hover `bg var(--bg2)`, `color var(--ink)`)

### 9.2 Body `.sh-body` (`padding:17px 19px; flex column; gap:15px; max-height:64vh; overflow:auto`)
1. **`.src-quote`** — `display:flex; gap:11px; background:var(--bg0); border:1px solid rgba(255,255,255,.05); border-radius:12px; padding:12px`
   - `.src-quote .qthumb` — `42×42px; border-radius:9px; flex:none` (`.ph` gradient + image)
   - `.src-who` — `font-size:12px; font-weight:600; color:var(--ink)`; `.src-who span` — `font-family:var(--mono); font-weight:400; color:var(--muted); margin-left:5px; font-size:11px` (the @handle)
   - `.src-txt` — `font-family:var(--disp); font-weight:400; font-size:13px; line-height:1.4; color:var(--ink); margin-top:4px`, 2-line clamp
2. **`.name-grid`** — `display:grid; grid-template-columns:1fr 132px; gap:10px`
   - `.fl label` — `display:block; font-size:10.5px; color:var(--dim); text-transform:uppercase; letter-spacing:.06em; margin-bottom:7px; font-weight:600`; labels `Coin name` / `Ticker`
   - `.fl input` (#dname, `maxlength=28`) — `width:100%; background:var(--bg0); border:1px solid rgba(255,255,255,.07); border-radius:11px; padding:12px 13px; color:var(--ink); font-family:var(--sans); font-size:14px; outline:none; transition:.15s`; **focus** `border-color:rgba(61,224,255,.55); box-shadow:0 0 0 3px rgba(61,224,255,.1)`
   - `.tickin` — `display:flex; align-items:center; background:var(--bg0); border:1px solid rgba(255,255,255,.07); border-radius:11px; padding:0 13px; transition:.15s`; same focus-within treatment; `span` — `font-family:var(--mono); color:var(--muted)`, literal `$`; `input` (#dtick, `maxlength=10`) — `background:none; border:none; padding:12px 4px; font-family:var(--mono); text-transform:uppercase; font-size:14px`. Sanitised to `[A-Z0-9]` on every keystroke.
3. **Availability line `.coll`** — `font-size:12.5px; padding:10px 13px; border-radius:11px; background:var(--bg0); border:1px solid rgba(255,255,255,.06); color:var(--muted)`; `a{color:var(--ion)}`
   - **default/empty:** base style, `Enter a ticker for your coin.`
   - **`.coll.free`** `color:var(--lime); border-color:rgba(155,240,60,.28); background:rgba(155,240,60,.06)` → `✓ $FERRY is free on Solana — you'd be first to deploy it.`
   - **`.coll.taken`** `color:#ffb84c; border-color:rgba(255,184,76,.3); background:rgba(255,184,76,.06)` → `⚠ $FERRY already exists (Last Horn). Trade it instead →` (link opens the token page) or `⚡ $FERRY is claimed by a pending narrative but not deployed yet — you can still be first.`
4. **Alternate tickers `.alts`** (only when >1 `$TICKER` was extracted) — `display:flex; align-items:center; gap:7px; flex-wrap:wrap`; `.alts-l` — `font-size:11px; color:var(--dim)`, text `also spiking:`; `.achip` — `font-family:var(--mono); font-size:11.5px; color:var(--muted); border:1px solid rgba(255,255,255,.08); border-radius:999px; padding:6px 12px; transition:.12s`; hover `border-color:rgba(61,224,255,.5); color:var(--ion); background:rgba(61,224,255,.05)`
5. **First buy `.buychips`** — label `Your first buy`; `display:grid; grid-template-columns:repeat(4,1fr); gap:5px; background:var(--bg0); border:1px solid rgba(255,255,255,.055); border-radius:12px; padding:4px`
   - `.bchip` — `border:none; border-radius:9px; padding:11px 0; font-family:var(--mono); font-size:12.5px; color:var(--muted); transition:.14s`; hover `color:var(--ink); background:var(--bg2)`; **`.on`** `background:rgba(61,224,255,.12); color:var(--ion); box-shadow: inset 0 0 0 1px rgba(61,224,255,.25)`
   - Values `None | 0.5 SOL | 1 SOL | 2 SOL`; **`0.5 SOL` selected by default**
6. **Fee split `.split`** — `background:var(--bg0); border:1px solid rgba(255,255,255,.06); border-radius:12px; padding:13px`
   - `.split-row` — `display:flex; justify-content:space-between; font-size:12.5px; color:var(--ink)`; `b{font-family:var(--mono); color:var(--lime)}`. Text `Your fee share (creator)` / `3.0%`
   - `.split-bar` — `height:7px; border-radius:4px; background:var(--bg3); margin:9px 0; overflow:hidden; display:flex`; `i` — `height:100%; background:linear-gradient(90deg, var(--lime), #6bd41f)`, inline `width:60%`; `u` — `height:100%; background:var(--ion); opacity:.5`, inline `width:20%`
   - `.split-note` — `font-size:11px; color:var(--muted); line-height:1.45`. Copy: `You earn **3%** of every trade as the deployer · Insidor takes 1% · the bonding curve seeds liquidity automatically.` (the `3%` is inline `color:var(--lime)`)
   - The narrative-cluster variant omits `.alts` and `.split` entirely.

### 9.3 Footer `.sh-foot`
`display:flex; align-items:center; gap:12px; padding:15px 19px; border-top:1px solid rgba(255,255,255,.06); background:linear-gradient(180deg, transparent, rgba(0,0,0,.25))`.
- `.cost` — `display:flex; flex-direction:column`; `span` — `font-size:10px; color:var(--dim); text-transform:uppercase; letter-spacing:.06em; font-weight:600`, text `Cost to launch`; `b` (#dcost) — `font-family:var(--mono); font-size:15px; color:var(--ink)`, value `~` + `(0.52 + firstBuy).toFixed(2)` + ` SOL` → default `~1.02 SOL`
- `.deploy-go` — `margin-left:auto; background:linear-gradient(180deg,#5fe8ff,#3DE0FF); color:#001318; font-weight:600; font-size:14px; border-radius:12px; padding:13px 22px; transition:.15s`; hover `box-shadow:0 0 22px rgba(61,224,255,.5); transform:translateY(-1px)`. Label `Create $<TICK>` (ticker updates live; `—` when the field is empty)

### 9.4 Success state `.done` (replaces `.sheet` innerHTML)
`padding:34px 26px; text-align:center; display:flex; flex-direction:column; align-items:center; gap:8px`.
- `.done-ic` — `56×56px; border-radius:50%; display:grid; place-items:center; font-size:26px; background:rgba(155,240,60,.12); color:var(--lime); border:1px solid rgba(155,240,60,.4); box-shadow:0 0 28px -6px rgba(155,240,60,.5)`, glyph `✓`
- `.done-h` — `font-family:var(--disp); font-weight:600; font-size:23px; margin-top:4px`, text `$FERRY is live`
- `.done-s` — `font-size:13px; color:var(--muted); line-height:1.45; max-width:330px`, text `Last Horn · launched against <source snippet> · first buy 0.5 SOL`
- `.ca-box` — `display:flex; align-items:center; gap:10px; background:var(--bg0); border:1px solid rgba(255,255,255,.07); border-radius:11px; padding:11px 13px; margin-top:10px; font-family:var(--mono); font-size:12.5px`; shows `4mZq5t…9xKpQr`; `.ca-copy` — `color:var(--ion); font-family:var(--sans); font-size:12px; font-weight:600`, label `Copy CA` → `Copied ✓`
- `.done-acts` — `display:flex; gap:10px; margin-top:16px; width:100%`; `.deploy-go` (`margin-left:0; flex:1; text-align:center`) `Trade $FERRY`; `.sh-x2` — `border:1px solid rgba(255,255,255,.09); border-radius:12px; padding:13px 18px; color:var(--muted); transition:.15s`, hover `border-color:rgba(61,224,255,.4); color:var(--ion)`, label `Done`

---

# 10. COMMAND PALETTE (⌘K) — `searchModalHTML()` 3444
Opened by `.navsearch` click or `⌘K` / `Ctrl+K`; toggles closed on repeat; `Esc` closes; `Enter` closes the palette and routes to the full **Search** view; `↑`/`↓` move the selection; clicking outside `.pal` closes.

### 10.1 Backdrop & shell
`.pal-back` — `position:fixed; inset:0; z-index:300; background:rgba(4,4,6,.62); backdrop-filter:blur(6px); display:flex; justify-content:center; align-items:flex-start; padding:12vh 20px 20px; animation:fade .12s ease`.
`.pal` — `width:100%; max-width:560px; background:var(--bg1); border:1px solid rgba(255,255,255,.09); border-radius:16px; overflow:hidden; box-shadow:0 30px 80px rgba(0,0,0,.72); animation:pop .16s ease`.
`.pal.pal-search` — `max-width:min(640px,96vw); max-height:72vh; display:flex; flex-direction:column`.

### 10.2 Input head `.pal-top`
`display:flex; flex-direction:column; gap:10px; padding:15px 17px 12px; border-bottom:1px solid var(--line)`.
- `.pal-top-row` — `display:flex; align-items:center; gap:11px`
  - `.ic` — `color:var(--dim); font-size:18px`, glyph `⌕`
  - `.pal-in` (#searchInput) — `flex:1; background:none; border:none; outline:none; color:var(--ink); font-family:var(--sans); font-size:16px`; placeholder `color:var(--dim)`, text `Narrative, ticker (FERRY), or contract (4mZq…)`
  - `.pal-hint` — `font-family:var(--mono); font-size:10px; color:var(--dim); white-space:nowrap`, text `Enter → results`
  - `kbd` — `font-family:var(--mono); font-size:10px; color:var(--muted); background:var(--bg3); border:1px solid var(--line); border-radius:5px; padding:2px 6px`, text `ESC`
- `.pal-examples` — `display:flex; flex-wrap:wrap; align-items:center; gap:6px; min-height:28px`
  - `.pal-ex-lbl` — `font-family:var(--mono); font-size:10px; color:var(--dim); text-transform:uppercase; letter-spacing:.06em; font-weight:600; margin-right:2px`, text `Try`
  - `.pal-ex` — `font-family:var(--mono); font-size:11px; color:var(--muted); background:var(--bg2); border:1px solid var(--line); border-radius:999px; padding:4px 10px; cursor:pointer; transition:.12s`; hover `color:var(--ion); border-color:rgba(61,224,255,.35); background:rgba(61,224,255,.06)`
  - Six chips (filtered live by the query): `$FERRY` · `plastic plant` · `Harbor horn` · `$PLANT` · `Norway move` · `$STAPLR`

### 10.3 Result list `.pal-list`
`max-height:52vh; overflow:auto; padding:8px`; inside `.pal-search`: `max-height:220px; border-bottom:1px solid var(--line); flex:none`; `:empty{display:none}`.
- `.pal-sec` — `font-size:10px; color:var(--dim); text-transform:uppercase; letter-spacing:.06em; padding:9px 10px 4px; font-weight:600`. Three groups in fixed order: **Candidates** (≤4) · **Tokens** (≤7) · **Narratives** (≤5)
- `.pal-item` — `display:flex; align-items:center; gap:11px; padding:9px 10px; border-radius:10px; cursor:pointer`; **selected** `.pal-item.sel{background:var(--bg2)}` (keyboard-driven; `scrollIntoView({block:'nearest'})`)
- `.pal-ic` — `32×32px; border-radius:9px; display:grid; place-items:center; font-family:var(--disp); font-weight:600; font-size:14px; color:var(--bg0); flex:none; box-shadow: 0 0 0 1px rgba(255,255,255,.08), inset 0 1px 1px rgba(255,255,255,.22)`. Token → inline `background:<SYMCOLOR|#3DE0FF>` + first letter + logo overlay. Candidate → `.pal-ic.pend{background:var(--bg3); color:var(--muted); box-shadow: inset 0 0 0 1px rgba(255,255,255,.08)}`. Narrative → inline `background:var(--bg2); color:var(--ion)` with the letter `N`
- `.pal-tx{flex:1; min-width:0}` → `.pal-nm` `font-size:13.5px; font-weight:500` (`$FERRY` / narrative title) and `.pal-sub` `font-size:11px; color:var(--muted); font-family:var(--mono)`, nowrap ellipsis (token name · `no coin yet · +31m` · `blurb · $HORN`)
- `.pal-r` — `font-family:var(--mono); font-size:11.5px; color:var(--muted); text-align:right` — market cap, tokens only
- **Empty:** `.pal-empty{padding:30px; text-align:center; color:var(--muted); font-size:13px}`, text `No quick matches — press Enter for full results`
- **Loading:** none — external search is debounced 300 ms and re-renders the list in place
- Full-page body variant `.pal-body` (`overflow:auto; flex:1; padding:14px 18px 18px`; `.pal-body .ttable .tk{font-size:12.5px}`) exists for a full-results state but is not mounted by `searchModalHTML()`.

---

# 11. SHARED PARTS

**`.pbadge`** (platform avatar) — `26×26px; border-radius:7px; display:grid; place-items:center; flex:none; background:var(--bg3); border:1px solid var(--line); color:var(--muted)`; `svg 14×14`. Colour by class: `.x, .tt` → `var(--ink)`, `.rd` → `#ff8a4c`, `.fc` → `#a78bfa`, `.tg` → `#4cc4ff`. Size overrides: `.note-top .pbadge` `22×22` / svg `12×12`; `.sh-top .pbadge` `38×38` radius 11 / svg `18×18`. Marks are inline 24×24-viewBox `fill="currentColor"` paths for X, TikTok, Reddit, Farcaster, Telegram (`PLOGO`, line 1305).

**`.badge`** (text platform chip, feed-legacy) — `font-family:var(--mono); font-size:10.5px; font-weight:500; text-transform:uppercase; letter-spacing:.06em; padding:3px 8px; border-radius:6px; background:var(--bg3); color:var(--muted)`; `.x{#e8e8ea}` `.tt{#ff5b9c}` `.rd{#ff8a4c}` `.fc{#a78bfa}` `.tg{#4cc4ff}`.

**`.lc-pill`** (lifecycle) — `font-family:var(--mono); font-size:9.5px; padding:2px 8px; border-radius:999px; border:1px solid rgba(255,255,255,.08); white-space:nowrap`. `.heating{color:var(--lime); border-color:rgba(155,240,60,.35); background:rgba(155,240,60,.08)}` · `.peaking{color:var(--ion); border-color:rgba(61,224,255,.35); background:rgba(61,224,255,.08)}` · `.cooling{color:var(--muted); border-color:rgba(255,255,255,.1); background:rgba(255,255,255,.03)}`.

**`.lead-badge`** — `font-family:var(--mono); font-size:11px; font-weight:600; color:var(--ion); background:rgba(61,224,255,.1); border:1px solid rgba(61,224,255,.35); border-radius:8px; padding:4px 9px; white-space:nowrap`; `.sm{font-size:10px; padding:3px 7px}`. Text `+31m early`. `.lead-dim{font-family:var(--mono); font-size:10.5px; color:var(--dim)}` → `+31m`.

**`.timing-pill`** — `font-family:var(--mono); font-size:11px; font-weight:600; padding:5px 11px; border-radius:9px; border:1px solid`. `.timing-early{color:var(--lime); border-color:rgba(155,240,60,.4); background:rgba(155,240,60,.1)}` · `.timing-mid{color:#ffb84c; border-color:rgba(255,184,76,.4); background:rgba(255,184,76,.08)}` · `.timing-late{color:var(--red); border-color:rgba(255,92,110,.4); background:rgba(255,92,110,.08)}`. Labels `Early` / `Mid` / `Likely late` / `Live`.

**`.risk-pill`** — `font-family:var(--mono); font-size:10.5px; font-weight:600; padding:4px 10px; border-radius:999px; display:inline-block; margin-bottom:10px`; `.low` lime / `.med` `#ffb84c` / `.high` red, each `background: <hue at .1>` and `border:1px solid <hue at .35>`.

**`.narr-live-dot`** — `display:inline-block; 6×6px; border-radius:50%; background:var(--lime); box-shadow:0 0 8px var(--lime); margin-right:5px; vertical-align:middle; animation:pulse 2s infinite`; `.pulse` fires `narrLivePulse .6s` (scale 1→1.35→1, glow 8px→16px→8px).

**Number formatters** (rebuild verbatim): `fmtUSD` `$1.23B / $1.23M / $12.3K / $980`; `fmtP` `$0.0000123` (<0.01, 7dp) else `$1.2345`; `fmtCount` `2.4M` (1dp <10M, 0dp ≥10M) / `980K` (1dp <10K, 0dp ≥10K) / raw; `sign` `+12.4%`; `age` `47m / 4h / 2d`; `shortAddr` `4mZq…8xPq`; `timeAgo` `12s / 4m / 2h`; `fmtPnLD` `+$1,204`; `fmtTokenBal` `1.23B / 12.3M / 1.2K`; `fmtPnlPct` `+412%` / `+12K%`.

---

# 12. THINGS THE ENGINEER MUST RESOLVE (facts, not opinions)

1. **SOL price pill has no markup.** `.solpill` CSS (76–84) and `live.js:renderSolNav()` (`#solPill`, `#solPrice`) exist; the element is absent from `.navright` in every commit. Add `<div class="solpill" id="solPill">SOL <b id="solPrice">—</b><span class="sd"></span></div>` before `#userAuth`.
2. **`.nar-row-meta .nplat` is unsized.** The narrative table emits `.nplat` spans into `.nar-row-meta`, but the only sizing rules are scoped to `.nar-plats` and `.trend-narr-mini .tnr-meta`. Apply `width:16px; height:16px; display:grid; place-items:center; color:var(--ink); opacity:.88` + `svg{width:12px;height:12px}` in the React component.
3. **`.dim` has no CSS rule** in `site/index.html`, but is used as a class in `#bal`, `.tr-empty dim`, the safety-check unknown state, and `.inf-soc` fallback. Intended value: `color: var(--dim)` (`#5A5A62`).
4. **`.pendbanner` container is unstyled** (only its `b` is). Decide a container treatment; the `b` spec is `color:var(--ion); font-family:var(--mono)`.
5. **`.sh-hd`** (swap-confirm dialog header) has no rule; only `.sh-top` does.
6. **Two generations of trade-panel CSS coexist.** The shipped markup uses `.sides / .fp / .amt / .pre / .recv / .mini / .doit / .fine`. The older `.bs / .otabs / .amtwrap / .presets / .adv / .miniChips / .recap / .execbtn / .tokline / .limitrow / .recv-hero` block (486–521, 776–781) is dead. Build only the first set.
7. **Dead chart code:** `.tfrow / .tf`, the `#chart` canvas and `drawChart/tickChart/genCandles/roundRect` are unused — the page mounts a DexScreener iframe. `.chartwrap`, `canvas{...}`, `.tvload` are likewise vestigial except `.chart-empty`.
8. **`.auth-panel / .auth-opt / .auth-err`** are fully styled but never rendered (Privy React owns `#userAuth`).
9. **Rail top offsets are 56px while the nav is 58px** (`.rail{top:56px; height:calc(100vh - 56px)}` vs `.nav{height:58px}`) — a 2px discrepancy that is in the shipped build; reproduce it or fix it deliberately.
10. **Watchlist token/narrative headers omit `.sortable`** — those tables are intentionally unsortable.