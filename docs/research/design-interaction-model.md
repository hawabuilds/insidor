# INSIDOR PROTOTYPE — INTERACTION & STATE MODEL

Source files: `/Users/zainkhaliq/Desktop/Claude_Cowork/Insidor/site/index.html` (markup lines 1023–1252; inline app script lines 1253–3671; Privy ES-module script lines 3673–3848), `/Users/zainkhaliq/Desktop/Claude_Cowork/Insidor/site/live.js`, `/Users/zainkhaliq/Desktop/Claude_Cowork/Insidor/site/tokenpage.js`, `/Users/zainkhaliq/Desktop/Claude_Cowork/Insidor/site/config.js`. Target model: `/Users/zainkhaliq/Desktop/Claude_Cowork/Insidor/docs/product/insidor-flow.html`. Planned comment layer: `/Users/zainkhaliq/Desktop/Claude_Cowork/Insidor/docs/reference/insidor-social.html`.

---

## 1. ROUTING MAP

### 1.1 The router (index.html:3528–3540)

```js
const VIEWS=['trending','new','narratives','tokens','search','watchlist','token'];
let viewStack=['trending'];
function setView(v){ ... }
function go(v){if(viewStack[viewStack.length-1]!==v)viewStack.push(v);setView(v);}
function stepBack(){if(viewStack.length>1){viewStack.pop();setView(viewStack[viewStack.length-1]);}}
```

**There is no URL, no hash, no `history.pushState`.** Every view is a `<section class="view" id="v-<name}">` that already exists in the DOM (index.html:1040–1234); `setView` toggles the `.on` class on exactly one of them. Consequences for the rebuild:

* A page refresh always lands on `trending`. No view is linkable or shareable.
* The browser Back button exits the app entirely; `stepBack()` is the only back.
* `viewStack` is push-only except for `stepBack`; `go()` de-dupes only *consecutive* repeats, so the stack grows unbounded (Trending → Tokens → Trending → Tokens… all retained).

### 1.2 What `setView` does beyond visibility (index.html:3531–3538)

| Step | Effect |
|---|---|
| `VIEWS.forEach(... classList.toggle('on', x===v))` | shows one section |
| `$$('.navlink').forEach(... toggle('active', b.dataset.view===v))` | nav highlight — note `search` and `token` have **no** navlink, so nav goes blank on those views |
| `.shell` gets/loses `token-view` class | enables the collapsible rail layout |
| `if(v==='new'){updateSortArrows();renderNew();}` | lazy render |
| `if(v==='watchlist')renderWatch();` | lazy render |
| `if(v==='narratives'){clearNarrNewBadge();renderNarratives();}` | lazy render (`clearNarrNewBadge` is a no-op stub, index.html:1991) |
| `if(v==='search')renderSearchTab();` | lazy render |
| `if(v!=='token')stopTokenPagePolls();` | tears down `feedTimer` + `tradesPollTimer` |
| `updateRailLayout(); window.scrollTo(0,0);` | layout |

**`trending` and `tokens` are deliberately NOT re-rendered on entry.** They are only repainted when data changes (`InsidorLive.rerender()`, `refreshWatchStars()`, `deployFiled()`). This is a real behaviour difference to preserve or consciously fix.

### 1.3 Navigation entry points

| Trigger | Handler | Destination |
|---|---|---|
| Top nav buttons (`.navlink[data-view]`, markup 1026–1030) | `$$('.navlink').forEach(b=>b.onclick=()=>go(b.dataset.view))` (3543) | `trending`/`new`/`narratives`/`tokens`/`watchlist` |
| `#navSearch` button / `⌘K` | `openPalette()` (3545, 3624) | opens palette modal, not a view |
| Enter in palette | `openSearchPage()` (3453–3461) → `go('search')` | `search` |
| Any `[data-token]` or `[data-buy]` element | `openToken(sym)` (3281) → `go('token')` at 3373 | `token` |
| `#tpback` on token page | `wireToken` → `stepBack()` (3385) | previous view |
| `Escape` with no modal open | `stepBack()` (3633) | previous view |
| "Search" / "Find" buttons | `findFromPost`, `findFromPostText`, `findFromNarrative` → `renderTokens(); go('tokens')` (2869, 1509, 2140) | `tokens` (filtered) |
| Palette candidate row with no narrIdx | `activeTickers=[sym]; renderTokens(); go('tokens')` (3472) | `tokens` |
| Deploy success → "Trade $TICK" | `openToken(tick)` or filtered `go('tokens')` (2968–2969) | `token` or `tokens` |

### 1.4 Sub-view state that is NOT in the router

These behave like routes to the user but are separate module-scope variables:

* **`trendSub`** (`'narratives' | 'tokens'`, index.html:2269) — `setTrendSub()` (2270–2274) toggles `.on` on `#trendNarr` / `#trendTok`. Wired at 3544.
* **`railMode`** (`'trades' | 'launches' | 'viral'`, index.html:2329) — `setRail()` (2643). Wired at 3546.
* **`curTab`** (`'trades' | 'traders' | 'holders' | 'info'`, index.html:3025) — token-page tab, wired in `wireToken` (3388–3391); switching to `traders` lazily fires `openTradersTab()`.
* **`railCollapsed`** (index.html:2676) — `setRailCollapsed()` (2644), only has visual effect on the token view.

### 1.5 Modals / overlays

**Every modal mounts into a single lazily-created div**:

```js
function ensureModalRoot(){let r=$('#modalRoot');if(!r){r=document.createElement('div');r.id='modalRoot';document.body.appendChild(r);}return r;}
function closeDeploy(){const r=$('#modalRoot');if(r)r.innerHTML='';document.body.style.overflow='';}
```
(index.html:2875–2876)

Because there is one root and each opener does `root.innerHTML=...`, **opening any modal destroys any modal already open**. `closeDeploy()` is the universal close for all of them (misleading name).

| Modal | Opener | Root element id | Closed by |
|---|---|---|---|
| Create Coin (from `NARR` post) | `openDeploy(idx)` 2877–2934 | `#dback` | `#dclose`, backdrop, Esc |
| Create Coin (from live viral post) | `openDeployFromViralPost(p)` 2065–2130 | `#dback` | same |
| Create Coin (from narrative cluster) | `openDeployForNarrative(id,txt,post)` 2142–2180 | `#dback` | same |
| Launch success | `deployFiled()` 2956 — replaces `.sheet` innerHTML **in place**, not a new modal | (inside `#dback`) | `#ddone` |
| Post detail (mock `NARR`) | `openPostDetail(idx)` 2296–2325 | `#pdback` | `#pdclose`, backdrop |
| Post detail (live viral item) | `openViralPostItem(p)` 1510–1549 | `#pdback` | same |
| Narrative cluster modal | `openNarrative(id)` 2181 → `renderNarrativeModal(nar)` 2186–2241 | `#nmbback` | `#nmclose`, backdrop |
| Swap confirm | `showSwapConfirm({...})` 3204–3224 — returns a `Promise<boolean>` | `#swapConfirmBack` | Cancel / backdrop resolve `false`, `#swapOk` resolves `true` |
| Search palette (⌘K) | `openPalette(initial)` 3507–3524 | `#palBack` | `closePalette()` 3525, Esc, backdrop |
| Privy wallet modal | Privy React SDK, mounted into `#userAuth` (markup 1034; module script 3673–3848) | own portal | Privy internal |

Global overlay side effects: `document.body.style.overflow='hidden'` on open, cleared in `closeDeploy`/`closePalette`.

Keyboard routing (index.html:3623–3635):
```
⌘K/Ctrl-K  → toggle palette
palette open: ArrowDown/Up → palMove, Enter → openSearchPage, Esc → closePalette
otherwise Esc → if #modalRoot has innerHTML, closeDeploy(); else stepBack()
```

---

## 2. STATE INVENTORY

Everything below lives in the top-level scope of the inline `<script>` (a single script-tag closure) or on `window`. Nothing is componentised.

### 2.1 Data collections

| Name | Where | What it is | Mutated by | Read by | Persist? |
|---|---|---|---|---|---|
| `NARR` | 1258–1269, `const` array of 10 | Hard-coded mock viral posts (Layer-2 demo data). | Never mutated (elements copied in `pushStream`). | `narrCard`, `streamCard`, `openPostDetail`, `openDeploy`, `findFromPost`, `candidateRow`, `renderInfo`, `deployFiled` | **Delete** — replaced by real `Post` rows |
| `TOKENS` | 1334–1345, `const` array | Token registry. **Mutated in place**: `TOKENS.length=0` + push in `live.js applyPairs` (227–228), `TOKENS.unshift(nt)` in `deployFiled` (2948), `TOKENS.push(t)` in `materializeNarrToken` (1650) and `live.js upsertTokenFromLookup`, and per-field `Object.assign` in `refreshPrices` (264). | `applyPairs`, `refreshPrices`, `deployFiled`, `materializeNarrToken`, `fetchHoldersPanel`, `fetchSafetyPanel`, `linkNarrativesToTokens` | every render fn, `resolveToken`, `sortTokens`, `searchTokenMatches`, `genTape` | Server-owned; must become a query, not a mutable array |
| `PENDING` | 1346, `const {}` | Candidate tickers with no coin. Only ever *deleted* from (`delete PENDING[tick]`, 2950). **Nothing ever writes to it** in the current code — a dead-but-rendered branch. | `deployFiled` (delete only) | `renderTokens`, `renderNew`, `searchTokenMatches`, `launchPendCard`, `buildPalPreview`, deploy ticker `recheck` | Server-owned (`Story` with 0 coins) |
| `NARRATIVES` | 1367–1413, `const` array of 14 | Narrative clusters. Mutated in place by `live.js`: `NARRATIVES.length=0` + push, `Object.assign` per row, `NARRATIVES.splice` on realtime DELETE, `NARRATIVES.push` in `fetchNarrativeById` (live.js:1990–1992). | `live.js loadNarratives`/realtime handlers, `syncNarTokens` (1415), `deployFiled` (2952), `linkNarrativesToTokens` | `getNarrative`, `sortNarratives`, `renderNarratives`, `renderTrending`, `searchNarratives`, `renderWatch`, `narrativeForToken` | Server-owned |
| `window.NARRATIVES_ALL` | index.html:1969 `window.NARRATIVES_ALL=[]` | All pipeline narratives incl. display-ineligible ones. Written only by `live.js loadPipelineNarratives` (1422–1431) and realtime upserts. **Never read by any renderer.** | `live.js` | nothing in index.html | Dead — drop or make it a real "all stories" query |
| `window.VIRAL_STREAM` | index.html:2332 `window.VIRAL_STREAM=[]` | The live viral post feed backing the rail. Reassigned wholesale in `live.js` (`setViralStream`, `mergeViralFeedSilently`, `upsertViralStreamItem`, `removeViralStreamPost`). | `live.js` viral fns | `renderViralStream`, `viralItemFromNote`, `insertViralPostSilent`, stream counters | Cached in `sessionStorage['insidor_viral_feed_v1']` (live.js:1191; restored index.html:3637–3654) |
| `streamPool` | index.html:2330, `let` | Layer-2 fake rail pool, seeded `NARR.filter(plat in ['x','tt'])`. `unshift`/`pop` in `pushStream` (2636), rebuilt by `rebuildStreamFromNarratives` (2410), emptied at boot if L3 (3657). | `pushStream`, `rebuildStreamFromNarratives` | `renderStream` | Ephemeral, fine |
| `tapePool` | index.html:2331, `let []` | Fake trade tape, 14 entries, refilled by `genTape()`. | `pushStream`, `renderStream` | `renderStream` | Delete (see §6) |

### 2.2 Watchlist — **the flagged persistence gap**

```js
const WATCH_TOKENS=new Set();   // index.html:2666
const WATCH_NARR=new Set();     // index.html:2667
```

* Mutated only by `toggleWatchToken(sym)` / `toggleWatchNarr(id)` (2671–2672), each of which calls `refreshWatchStars()`.
* Read by `starTok`, `starNarr`, `renderWatch` (2852–2860), the token page watch button (`#tWatch`, 3339/3386), the narrative modal watch button (`#nmwatch`, 2204/2236).
* **Never written to `localStorage`/`sessionStorage`/server.** The UI even admits it: the Watchlist view subtitle says *"saved for this session"* (markup line 1200), and the section headers say "N saved".
* Every star toggle triggers `refreshWatchStars()` (2670) which re-renders **six views at once**: `renderTrending(); renderNarratives(); renderTokens(); renderSearchTab(); renderNew(); renderWatch();`. In React this is a single subscription to one store.

**Must be persisted.** `docs/product/insidor-flow.html` object 5 is `Follow` — "targets a story *or* a coin — never silently converts", with "nine feeders" into the You tab and auto-follow on every buy and every launch. The two Sets are the entire current implementation of that object. Rebuild target: a `follow` table keyed by `(user_id, target_type, target_id)`, read into a React store, with optimistic toggle.

### 2.3 Sort / filter state

| Name | Where | Values | Mutated by | Read by | Persist? |
|---|---|---|---|---|---|
| `curSort` | 2665 | `'trending'\|'gainers'\|'new'` | `bindSortChips` (3592) | `sortTokens` | Session-nice-to-have (URL param) |
| `colSort` | 2674 | `{key,dir}` — **shared by `#thd` and `#searchThd`** | `bindThdSort` (3601), reset to `{key:null,dir:-1}` by chip click | `sortTokens`, `updateSortArrows` | URL param |
| `newColSort` | 2675 | `{key,dir}` for New Pairs only | `bindThdSort($('#newThd'),...,{col:newColSort})` (3608) | `sortNewList`, `updateSortArrows` | URL param |
| `narrChipSort` | 1793 | `'new'\|'trending'` | `#narrChips` handler (3610–3613) | `sortNarratives`, `narrRowSortKey` | URL param |
| `narrSort` | 1793 | `{key,dir}` for narrative columns | `#nthd` handler (3618–3622) | `sortNarratives`, `narrRowSortKey`, `narrSortModeSignature` | URL param |
| `trendSub` | 2269 | `'narratives'\|'tokens'` | `setTrendSub` | `renderTrending` | no |
| `searchQuery` | 2665 | string | `#pageSearchInput` input (3609), `openPalette`, `openSearchPage`, `closePalette` | `renderSearchTab`, `renderSearchNarratives`, `paintSearchResults` | URL param `?q=` |
| `activeTickers` / `activePostIdx` | 2673 | `string[] \| null` / `number` | `findFromPost`, `findFromPostText`, `findFromNarrative`, `clearFilter`, `deployFiled` (2951) | `renderTokens` (2817–2829) | URL param |

### 2.4 Narrative-table incremental-render caches (index.html:1795–1804)

`pinnedNarrativeIds` (array of `{id,until}`), `narrMetricsCache`, `narrRowDom`, `narrDisplayCache`, `narrSortKeyCache`, `narrDomOrder`, `narrTableInitialized`, `narrEmptyEl`, `narrSortModeSig`.

This is a hand-rolled virtual DOM: `syncNarrativesTable()` (1895–1967) diffs desired vs actual, `reconcileNarrativeOrder()` (1847–1859) reorders nodes, `applyNarrativeRowCells()` (1860–1894) patches individual cells, `tickMetricCell()` (1997) animates changes. **All of this is deleted in a React rebuild** — it exists purely to avoid `innerHTML` blowing away scroll position and animation state. The only genuinely stateful piece is `pinnedNarrativeIds` (a 5-minute "NEW" pin set by `pinNarrative(id, ms=300000)` at 1972, applied in `narrRowSortKey` and `sortNarratives`), which becomes a `Map<id, expiresAt>` in a store or a derived `firstSeenAt < 5min` rule.

### 2.5 Deploy-modal state

`deployIdx` (`-1`), `deployBuy` (`0.5`), `deployCluster` (`null`) — index.html:2874. Set by `openDeploy`/`openDeployFromViralPost`/`openDeployForNarrative`, read by `deployFiled` (2935–2971), reset after use. These are pure modal-local state → React `useState` inside a `<CreateCoinModal>`.

### 2.6 Token-page state (index.html:2974–3031)

| Name | Purpose |
|---|---|
| `chartToken` | The token currently open. Used as a **staleness guard** everywhere: `if(chartToken?.ca!==t.ca)return;` in `fetchTradesPanel`, `fetchTopTradersPanel`, `fetchHoldersPanel`, `updateTokenQstats`, `refreshTokenEnrichedUI` |
| `chartTF`, `candles`, `lastPrice`, `CG`, `hoverIdx`, `hoverY` | Legacy canvas chart — dead once `InsidorTokenPage.mountChart` (DexScreener iframe) is used |
| `curSide` (`'b'\|'s'`), `curOT`, `slip`, `prio`, `curTab` | Trade-form state |
| `trades`, `tradesLoading`, `tradesCache` (Map, 20 s TTL) | Transactions tab |
| `tokTraders`, `tokAccumulating`, `tradersLoading`, `tradersFetchedAt`, `tradersStale`, `tradersLabel`, `tradersCaption`, `tradersSessionFetched` (Set) | Top-traders tab (fetched once per mint per session) |
| `tokHolders` | Holders tab |
| `traderFilter`, `traderTrades` | "show only this wallet's trades" filter |
| `lastQuote`, `quoteTimer` | Jupiter quote + 250 ms debounce (`debouncedQuote`, 3203) |
| `walletBalance` `{sol,token}` | From `/api/balance` |
| `feedTimer`, `tradesPollTimer` | `setInterval` handles, cleared by `stopTokenPagePolls` (3081) |

All of this is per-token-page and dies on navigate — in React it is `useState` + TanStack Query inside `<CoinPage>`, with the `chartToken?.ca!==t.ca` guards replaced by query keys.

### 2.7 Palette state

`palSel` (highlighted index), `palItems` (array of `{run()}` closures — index.html:3423, built in `buildPalPreview` 3463–3486), `extSearchReq` / `extSearchTimer` (300 ms debounce + request-sequence guard for `InsidorLive.searchAndMergeTokens`, 3425–3435). `palItems` holding *closures* is the thing to change: in React these become typed result objects with a discriminated `kind` and the navigation happens in the click handler.

### 2.8 Persisted today

| Key | Store | Set by | Read by |
|---|---|---|---|
| `insidor-narr-sound` | `localStorage` | `#narrSoundToggle` handler (3616) | `narrSoundOn` init (1796) |
| `insidor_viral_feed_v1` | `sessionStorage` | `live.js saveViralFeedCache` (1191) | `restoreViralFeedCacheEarly` (3637) + `live.js restoreViralFeedCache` (1195) |

That is **the entire persistence surface**. Watchlists, sorts, search query, rail mode, rail collapse, and the current view are all lost on refresh.

### 2.9 Cross-module globals (the actual "API" between index.html and live.js)

Set by `live.js`, read by index.html: `window._narrativesReady`, `window._narrativesLive` (gates `narrLive()` at 1550, which changes how `postMetrics` and `narrViralGain24h` compute), `window._viralStreamReady`, `window._viralStreamHydrated`, `window._pageLiveReady`, `window._pageLiveAt`, `window._scoringPaused`, `window.SOL_PRICE` (read by `solSpot()` 3026), `window.MIN_INGEST_VIEWS`, `window.MEME_MIN_X/TT`, `window.VIRAL_FEED_MAX_AGE_MS_X/TT`, `window.InsidorLive` (live.js:2001–2013).

Set by index.html, called by `live.js`: `window.patchNarrativeRow`, `window.onNarrativeArrival`, `window.setNarrativesLoading`, `window.rebuildStreamFromNarratives`, `window.renderViralStream`, `window.insertViralPostSilent`, `window.prependViralPostCard`, `window.removeViralPostCard`, `window.trimViralStreamDOM`, `window.announceViralPost`, `window.patchViralPostCard`, `window.markViralInventorySeen`, `window.unmarkViralAnnounced`, `window.updateViralFeedStatus`, `window.isViralIngestAlert`.

Set by the Privy module: `window.InsidorWallet` `{ready, authenticated, address, logout, sendVersionedTransaction}` + a `insidor-wallet` DOM event (3756–3777). Also `insidor-sol-price` event from `live.js:101`.

**These 30-odd `window` handles are the boundary the rebuild replaces**: `InsidorLive` → a data layer (Supabase client + TanStack Query + realtime subscriptions), the `window.render*`/`window.*Card` callbacks → store updates that React re-renders from, `window.InsidorWallet` → a wallet context.

### 2.10 Global timers

* `setInterval(pushStream, 2600)` (3667) — fake rail tick, always running.
* `setInterval(... '#tokUpd' → 'now', 4000)` (3670).
* `tradesPollTimer = setInterval(fetchTradesPanel, 10000)` (3381), only on token page.
* `live.js`: `refreshTimer` (30 s DexScreener refresh), `viralPollTimer` (20 s), `fallbackPollTimer` (60 s narrative poll when realtime is down), `pipelineStatePollTimer` (60 s).

---

## 3. EVENT / FLOW MAP

### 3.1 The one delegated click handler

`document.addEventListener('click', …)` at index.html:3551–3588 handles **all** row/card interaction via `closest()` on data attributes, in this order (first match wins, most `stopPropagation()`):

| Selector | Handler | Data change | Renders |
|---|---|---|---|
| `[data-soc]` | none — `stopPropagation`, let the link open | — | — |
| `[data-post-detail]` | `openPostDetail(+idx)` | — | post-detail modal |
| `[data-star]` | `toggleWatchToken(sym)` | `WATCH_TOKENS` | `refreshWatchStars()` → 6 views |
| `[data-star-narr]` | `toggleWatchNarr(id)` | `WATCH_NARR` | `refreshWatchStars()` → 6 views |
| `[data-deploy]` | `openDeploy(+idx)` | `deployIdx/deployBuy/deployCluster` | deploy modal |
| `[data-find]` | `findFromPost(+i)` | `activeTickers`, `activePostIdx` | `renderTokens()` → `go('tokens')` |
| `[data-find-narr]` | `findFromNarrative(id, txt)` (async) | may `materializeNarrToken`, sets `activeTickers` | `openToken()` **or** `renderTokens()+go('tokens')` |
| `[data-buy]` | `openToken(sym)` | full token-page state reset | token page + `go('token')` |
| `[data-token]` | `openToken(sym)` | same | same |
| `[data-deploy-narr]` | `openDeployForNarrative(id, txt, viralItemFromNote(note))` (async) | `deployCluster` | deploy modal |
| `[data-deploy-post]` | `openDeployFromViralPost(viralItemFromNote(...))` | `deployIdx=-1` | deploy modal |
| `[data-find-post]` | `findFromPostText(txt)` | `activeTickers` | `renderTokens()+go('tokens')` |
| `#stream .note[data-post-id]` (not on a button) | `openViralPostItem(viralItemFromNote(el))` | — | post-detail modal |
| `[data-narrative]` (not on a button/`a.qthumb`) | `ensureNarrative(id)` → `renderNarrativeModal` (falls back to `openViralPostItem`) | may push into `NARRATIVES` | narrative modal |
| `[data-post]` | `findFromPost(+idx)` | `activeTickers` | tokens view |
| `[data-posttxt]` | `findFromPost(NARR.findIndex(...))` | `activeTickers` | tokens view |

Note `viralItemFromNote()` (1483–1502) **reads state back out of the DOM** — `el.dataset.postTxt`, `.who` textContent, `[data-post-metric][data-metric-val]` — when the item isn't in `VIRAL_STREAM`. That pattern disappears entirely once rows carry a real object.

### 3.2 Star a token

`click [data-star]` → `toggleWatchToken(sym)` (2671) → `WATCH_TOKENS.add/delete` → `refreshWatchStars()` (2670) → `renderTrending()`, `renderNarratives()`, `renderTokens()`, `renderSearchTab()`, `renderNew()`, `renderWatch()` — six full `innerHTML` rebuilds for one boolean. `renderSearchTab()` additionally re-runs `paintSearchResults` **and** `scheduleExternalSearch`, so starring can fire a network search. React: one store write, memoised rows.

### 3.3 Create Coin (the fake launch)

1. `openDeploy(idx)` (2877) sets `deployIdx=idx, deployBuy=0.5, deployCluster=null`, renders the sheet with `primary = extractTickers(n.txt)[0] || deriveTicker(n.txt)`.
2. `recheck()` (2916–2923) runs on every keystroke of `#dtick`: uppercases + strips non-alphanumerics, then classifies against `registryLiveToken(tv) || narrativeLiveCoin(tv)` → "already exists"; `PENDING[tv]` → "claimed but not deployed"; else "free on Solana".
3. `[data-alt]` chips set the ticker; `#dbuychips [data-buy2]` sets `deployBuy` and rewrites `#dcost` to `~(0.52+deployBuy) SOL`.
4. `#dgo` → `deployFiled()` (2935–2971):
   * `ca = genCA(...)` — **fabricated 44-char base58 string**, not a mint.
   * If the ticker isn't in `TOKENS`, build `mkToken(...)`, override `ageM=0`, `holders=1+(deployBuy>0?1:0)`, `justDeployed=true`, and if `deployBuy>0` set `mc = deployBuy*solSpot()*1000`, `liq = deployBuy*solSpot()*2`, `vol = deployBuy*solSpot()`. `TOKENS.unshift(nt)`.
   * `delete PENDING[tick]`; append to `activeTickers`; copy mcap/name into any matching `NARRATIVES[].tokens[]`.
   * `renderTokens(); renderNew(); renderTrending(); renderNarratives(); if(railMode!=='viral')renderStream();`
   * Replaces the sheet body with the `.done` panel; `#dcopy` → clipboard, `#dtrade` → `openToken(tick)`, `#ddone` → `closeDeploy()`.

### 3.4 Open a token page

`openToken(symOrMint)` (3281–3383):
1. `closePalette()` if open, `closeDeploy()`.
2. `resolveToken()` (1652) — looks in `TOKENS` (liquidity > 0 required), else scans `NARRATIVES[].tokens[]` and **side-effects a new entry into `TOKENS` via `materializeNarrToken`**. Returns `null` → silently no-op.
3. Reset: `chartToken=t; lastPrice; lastQuote=null; curSide='b'; curOT='market'; slip=1; prio='fast'; curTab = isL3()?'trades':'holders'; traderFilter=null; trades=[]; tokHolders=[]; tokTraders=[]`.
4. `startTokenPageFetches(t)` (3120) → `stopTokenPagePolls()`, then `fetchTradesPanel` (L3 only), `setTimeout(100)` → `fetchHoldersPanel` + `fetchSafetyPanel`, `fetchWalletBalance` (L3 only).
5. One giant template literal into `#tokenPage`, then `go('token')`.
6. `requestAnimationFrame(async …)`: `InsidorLive.resolveTokenPair(t)` → `updateTokenQstats` → `InsidorTokenPage.mountChart($('#dexChart'), t)` → `renderTrades/renderTopTraders/renderHolders/renderInfo` → `wireToken(t)` → `buildPresets()` → `refreshQuote(t)` → `positionRailControls()` → start the 10 s trades poll.

Note the ordering hazard: `go('token')` happens *before* the chart mounts, and every panel render reads module-scope arrays rather than props.

### 3.5 Quote / swap

`#amt` input · side toggle · slippage chip · priority chip · preset → `debouncedQuote(t)` (250 ms) → `refreshQuote(t)` (3173) → sets `InsidorTokenPage.CFG.DEFAULT_SLIPPAGE_BPS = slipVal()*100` → `InsidorTokenPage.getQuote()` → Jupiter via `/api/quote` if L3, else `estimateQuote` (price × amount) → writes `#recv`, `#recvUsd`, `#minrecv`, `#impact` (colour-coded at >1.5 % / >5 %), `#quoteNote`, `#netfee` → `lastQuote=q` → `updateExecButton(t,q)` (3087, disables unless L3 + wallet + `q.source==='jupiter'` + amt>0).

`#exec` → `executeSwap(t)` (3226–3255) → `showSwapConfirm()` promise → `POST /api/swap` → dynamic-import `@solana/web3.js` → `w.sendVersionedTransaction` → `confirmTransaction` → Solscan link → `fetchWalletBalance` + `fetchTrades` + `debouncedQuote`. **This path is real.**

### 3.6 Live viral post arrives (L3)

`live.js` realtime/poll → `upsertViralStreamItem` → `window.announceViralPost(p)` (index.html:2526) → dedupe against `viralAnnouncedEver` / `viralAnnounceQueued` → push to `viralAnnounceQueue` → `drainViralAnnounceQueue()` drains one item per `VIRAL_ANNOUNCE_GAP_MS` (1800 ms) → `performViralPostAnnounce(p)` (2497) → forces `setRail('viral')`, `insertAdjacentHTML('afterbegin', streamLiveCard(p, true))`, `trimViralStreamDOM(24)`, update `#streamCount` and `#streamStatus`. Metric updates go through `window.patchViralPostCard(postId, views, item)` (2534), which is **monotonic** — it refuses to write a lower value.

The 1.8 s announce-gap queue is genuine product behaviour (staggered slide-in) and must survive the rebuild — as a queue in a store, not a DOM append loop.

### 3.7 New narrative arrives (L3)

`live.js` → `window.onNarrativeArrival(id)` (2008–2016) → `pinNarrative(id, 300000)` → `InsidorLive.flashNarrativeRows(id)` → `bumpNarrNewBadge()` (no-op) → `playNarrArrivalSound()` (2975 — WebAudio two-oscillator chime, gated on `narrSoundOn`) → `InsidorLive.pulseLiveIndicator()` → `syncNarrativesTable({ids:[id], forceReorder:true})`.

### 3.8 Search

Two independent surfaces sharing `searchQuery`:
* Palette: `#searchInput` `oninput` → `renderPalExamples` + `renderPalPreview` + `scheduleExternalSearch` (300 ms, sequence-guarded).
* Search view: `#pageSearchInput` `input` → `searchQuery = value; renderSearchTab()` → `paintSearchResults()` + `scheduleExternalSearch()` → `renderSearchNarratives()`.

`searchTokenMatches(q)` (2739–2779) has an important side effect: it calls `materializeNarrToken()` on matching narrative tickers, i.e. **searching mutates `TOKENS`**.

---

## 4. SORTING AND FILTERING MODEL

### 4.1 Token chips — `#sortChips` and `#searchSortChips` (markup 1096–1098, 1139–1141)

Both bound by `bindSortChips(root, renderFn)` (3589–3594), which sets `curSort = chip.dataset.sort` **and resets `colSort={key:null,dir:-1}`**.

`sortTokens(list)` (2677–2681):
```js
if(colSort.key){k=colSort.key;d=colSort.dir; a.sort((x,y)=>((x[k]??0)-(y[k]??0))*d); return a;}
if(curSort==='gainers') a.sort((x,y)=>y.c24-x.c24);
else if(curSort==='new') a.sort((x,y)=>x.ageM-y.ageM);
else                     a.sort((x,y)=>y.vol-x.vol);   // 'trending' → volume desc
```
Note: `curSort`/`colSort` are **shared between the Tokens view and the Search view** — changing sort on one changes the other.

### 4.2 Token column headers — `#thd`, `#searchThd`, `#newThd`

`bindThdSort(root, renderFn, cfg)` (3595–3603): clicking the same key flips `dir *= -1`; a different key sets `{key, dir:-1}`. It also strips `.active` from the chips (so the chip row goes blank). Sortable keys, identical in all three tables (markup 1105–1113, 1147–1155, 1180–1188):

`price`, `c5`, `c1h`, `c24`, `vol`, `liq`, `mc`, `ageM`.

**One comparator for all of them**: `(x[k] ?? 0) - (y[k] ?? 0)) * dir`. `Last 24h` (sparkline) is not sortable. `#thd` and `#searchThd` share `colSort`; `#newThd` uses `newColSort`.

`sortNewList(list)` (2682–2684): `newColSort.key` if set, else **`x.ageM - y.ageM`** (newest first) — the "New pairs" default is a hard-coded sort, not a chip.

Arrow glyphs: `updateSortArrows()` (2685–2689) writes `' ▼'` for `dir<0`, `' ▲'` for `dir>0` into `.sar`.

### 4.3 Narrative chips — `#narrChips` (markup 1065–1066): `New`, `Trending` (default)

Handler at 3610–3613 sets `narrChipSort` and resets `narrSort={key:null,dir:-1}`.

### 4.4 Narrative columns — `#nthd` (markup 1077–1080)

Sortable `data-ncol`: `views`, `gain`, `mcap`, `age`. Handler 3618–3622 (same flip logic, strips chip `.active`, `updateNarrSortArrows()` 2037).

`sortNarratives(list)` (2017–2036) — the full precedence:

```js
if(narrSort.key){
  views → narrCombinedViews(x)                     desc/asc × dir
  gain  → narrViralGain24h(x)                      × dir
  mcap  → (narrTopToken(x)||{mcap:0}).mcap         × dir
  age   → narrOldestAt(x)   // returns (xv-yv)*d — raw timestamp, so dir:-1 = oldest first
}
else if(narrChipSort==='new')  a.sort((x,y)=>narrOldestAt(y)-narrOldestAt(x));   // newest first
else /* 'trending' */          a.sort((x,y)=>{
                                 const av=narrAuthorVelocity(y)-narrAuthorVelocity(x);
                                 if(av!==0)return av;                 // primary: authors/min
                                 return narrViewsVelocity(y)-narrViewsVelocity(x); // tiebreak: views/min
                               });
// then: pinned narratives (pinnedNarrativeIds, until>now) are hoisted to the top in pin order
```

Supporting comparator inputs:
* `narrCombinedViews(n)` (1552) — `n.combinedViews` if > 0, else sum of `posts[].views`.
* `narrViralGain24h(n)` (1662) — `n.gain24h` if > 0; else `series[last] - series[max(0,len-25)]` clamped ≥ 0; else (non-live) **`combinedViews * 0.14`** — a fabricated number.
* `narrAuthorVelocity` / `narrViewsVelocity` (1567–1572) — pass-through of `n.authorVelocity` / `n.viewsVelocity`, **`0` when absent**, so on mock data the Trending sort is a no-op and the array order is whatever `NARRATIVES` literal order is.
* `narrOldestAt(n)` (1679) — oldest `posts[].postedAt`, falling back to `createdAt`, falling back to `NOW`.
* `narrTopToken(n)` (1613) — max `mcap` among tokens with `liquidity>0`.

### 4.5 Trending view sorts (`renderTrending`, 2275–2292)

Not user-controllable. Narratives: same author-velocity-then-views-velocity comparator, `.slice(0,10)`. Tokens: `trendScore(b)-trendScore(a)`, `.slice(0,10)` where

```js
trendScore(t) = min(t.vol/max(t.mc,1)/3,1)*0.40
              + min((t.txns||0)/4800,1)*0.25
              + min(max(t.c24,0)/85,1)*0.20
              + min(max(t.c1h,0)/55,1)*0.15    // index.html:1787-1792
```

### 4.6 Watchlist sorts (`renderWatch`, 2852–2860)

Fixed: narratives by `narrViralGain24h` desc; tokens by `t.vol` desc.

### 4.7 Other fixed sorts

* Search narratives: `searchNarratives()` (2737) sorts by `narrViralGain24h` desc; empty query shows top 4 by the same key.
* Palette narratives with empty query: top 5 by `narrViralGain24h`.
* Rail "Launches": `[...TOKENS].sort((a,b)=>a.ageM-b.ageM)` (2624).
* Viral feed: `(b.postedAt||0)-(a.postedAt||0)`, capped at 24 (2448–2449).

### 4.8 Filters (as distinct from sorts)

| Filter | Predicate | Where |
|---|---|---|
| Liquidity gate | `tokenHasLiquidity(t)` → `Number(liquidity ?? liq) > 0` | `visibleTokens()` (1595) wraps **every** token list |
| Ticker filter from a post | `activeTickers` array-includes on `sym`; non-matching symbols render as `candidateRow` | `renderTokens` 2817–2829 |
| Search text | `normalizeSearchQ` = trim + lowercase + strip leading `$`; token match on `sym`/`ca`/`name` substring; narrative match on `title`/`blurb`/`id`/ticker/mint/`deriveTicker(title)` | 2727–2743 |
| Rail platform filter | `FEED_PLATS=['x','tt']` | 2328, 2380 |
| Viral ingest floor | `views >= MIN_INGEST_VIEWS (30000)` and `memeScore >= 0.6` (X) / `0.75` (TikTok) | index.html:1794, 3644–3650; live.js:386, 390–391 |
| Feed age window | `postedAt >= now - 24h` per platform | 2382–2383 |
| DexScreener floor | `liq>=5000 && vol24>=10000 && ageM<=20160 && price>0` | live.js:215–217 |

---

## 5. DATA DEPENDENCIES (the API/query shape)

### 5.1 Canonical object shapes today

**Token** (union of `mkToken` 1326–1332, `live.js toToken` 174–213, `narrTokToRegistry` 1629–1636, plus fields patched in later):

```
sym, name, ca, price, c5, c1h, c24, vol, liq, mc, ageM, txns,
holders, top10, mintRevoked, freezeRevoked, lpBurned,
socials{web,x,tg}, dex, pump, pairAddress, pairUrl, logo, decimals,
narrIdx, lead, live, justDeployed, canonical, firstDeployed,
riskLabel, risks, _liveAt, _enrichedAt, _holdersTruncated
```

**Narrative** (`mkNar` 1365–1366 + `live.js mapNarrativeRow` ~770–809):

```
id, title, blurb, image/imgSeed, createdAt, narrIdx,
searchSeries[], viewsSeries[], leadTimeMin, organicScore,
combinedViews, viewsVelocity, authorVelocity, distinctAuthors,
tickerProposals, ctPickup, accel, engagementVelocity, lifecycle,
boughtReach, ageMin, firstSeenAt, gain24h, displayEligible, gateReason,
platforms[], crossPlatform, mediaUrl, mediaType,
posts: Post[], tokens: NarrativeTicker[]
```

**Post** (`seedPost` 1358–1360 / `live.js mapPostRow` 523–549):

```
platform, platformPostId, handle, followers, text, image,
mediaUrl, mediaType, views, replies, quotes, likes, retweets,
notable, sampleReplies[], postedAt, firstSeenAt
```

**NarrativeTicker** (`seedTok` 1361–1364 / `live.js mapTickerRow` 562+):

```
ticker, name, mcap, liquidity, vol24h, holders, ageMin, mint,
firstDeployed, endorsedBy, canonical, priceUsd, pairAddress, dexUrl, pumpUrl,
safety{...}, smartMoney{...}
```

**ViralStreamItem** (`live.js mapViralStreamItem` 1046–1082 / `rebuildStreamFromNarratives` 2385–2405):

```
live, postId, narrativeId, plat, badge, txt, rawViews,
replies, quotes, retweets, likes, who, at, pal, media, mediaUrl,
mediaType, platformPostId, postedAt, firstSeenAt,
filterLabel, suggestedTicker, memeScore
```

### 5.2 Per-view field requirements

**Trending → narrative rows** (`trendNarrRow` 2246–2258): `id, title, imgSeed | posts[0].mediaUrl, posts[].text, posts[].views, combinedViews, gain24h | searchSeries, platforms | posts[].platform, oldest postedAt (age), tokens[] (mcap, mint, liquidity, firstDeployed)`, plus `WATCH_NARR.has(id)`.

**Trending → token rows** (`trendTokRow` 2259–2268): `sym, name, logo, ca, ageM, narrIdx, c24, vol, liq, mc, socials{web,x,tg}, dex, pump`, plus `WATCH_TOKENS.has(sym)`. And `vol, mc, txns, c24, c1h` for `trendScore`.

**Narratives table** (`narrRow` 2039–2052 + `narrRowDisplayState` 1819–1832): `id, title, blurb, imgSeed, top post mediaUrl, searchSeries[], platforms[], combinedViews, viewsVelocity, authorVelocity, gain24h, tokens[] → {mcap, mint, liquidity, firstDeployed}, oldest postedAt`, plus pin state and watch state.

**Tokens / New pairs / Search / Watchlist token tables** (`liveRow` 2714–2726): `sym, name, logo, ca, ageM, narrIdx, justDeployed, price, c5, c1h, c24, vol, liq, mc, socials, dex, pump` + `sparkSVG` needs `ca.charCodeAt(1)`, `ageM`, `c24`.
`candidateRow` (2697–2706): `sym`, `NARR[narrIdx].txt` (first 34 chars), `narrIdx` (for the Create button).

**Search → narrative rows** (`searchNarrRow` 2780–2785): `id, title, blurb, combinedViews, top post mediaUrl/imgSeed, narrDeployedToken → {ticker, mcap, mint}`.

**Narrative modal** (`renderNarrativeModal` 2186–2241): everything above **plus** `posts[]` full set (for `narrCombinedReposts` = Σ`retweets`+`quotes`, `narrCombinedLikes` = Σ`likes`, `narrViralWords`, `narrAboutText`, `postURL(top)`), `searchSeries[]` (tall sparkline), `narrDeployedToken → {ticker, mcap, ageMin, mint}`, `narrAgeLabel`.

**Post detail modal** (`openViralPostItem` 1510–1549): `plat, badge, who, at, txt, media, mediaUrl, pal, postedAt, platformPostId, rawViews, replies, quotes, retweets, likes` + `extractTickers(txt)`.

**Live rail — viral** (`streamLiveCard` 2333–2371): the full `ViralStreamItem` plus `getNarrative(narrativeId)` for the thumbnail fallback.
**Live rail — launches** (`launchCard` 2602–2608): `sym, name, mc, ageM, justDeployed, logo`.
**Live rail — trades** (`tapeCard` 2594–2600): fabricated (`genTape`) — needs `{sym, side, solAmount, usdAmount, ts, wallet}` from a real trade stream.

**Token page** (`openToken` 3288–3372): `sym, name, ca, price, c5, c1h, c24, mc, liq, vol, holders, top10, mintRevoked, freezeRevoked, lpBurned, justDeployed, _liveAt, logo, socials, dex, pump, pairAddress, decimals` + `tokenOriginStrip(t)` needs `narrativeForToken(t)` → narrative `title` + top post `text`/media.
* Transactions tab (`renderTrades` 3126–3138) ← `/api/trades?mint=&limit=50` → `{side, ts, wallet, tokenAmount, solAmount, usd, tx}`.
* Top traders (`renderTopTraders` 3144–3160) ← `/api/toptraders?mint=` → `{traders:[{rank,wallet,short,buyUsd,buys,sellUsd,sells,pnl,unrealized,balance,netTokens}], accumulating:[...], fetchedAt, stale, label, caption}`.
* Holders (`renderHolders` 3139–3143) ← `/api/holders?mint=` → `{holders, top10Pct, top:[{wallet,short,pct}], truncated}`.
* Safety (`fetchSafetyPanel` 3105) ← `/api/safety?mint=` → `{mintRevoked, freezeRevoked, lpBurned, top10}`.
* Info tab (`renderInfo` 3161–3170): `ca, ageM, mc, liq`, hard-coded `1,000,000,000` supply, origin narrative.
* Trade box: `/api/quote`, `/api/swap`, `/api/balance?owner=&mint=`, `window.SOL_PRICE`.

### 5.3 Gap vs. the intended object model

`docs/product/insidor-flow.html` §03 specifies **eight objects**: Story, Post, Poster, Coin, Follow, Holding, Launch, Payout. The prototype implements Story (`NARRATIVES`), Post (`NARRATIVES[].posts`), Coin (`TOKENS` / `narrative_tickers`), and Follow *only as two in-memory Sets*. **Poster, Holding, Launch and Payout do not exist in any form** — there is no `You` view, no position, no `minutes_early_when_you_bought`, no fee split (the deploy modal hard-codes "3.0% creator / Insidor 1%" as static markup at index.html:2905–2907, while the flow doc specifies maker 50 / poster 40 / Insidor 10).

The social doc (`docs/reference/insidor-social.html`) adds a ninth: `comment`, attached to **story_id only** (never post, never coin), with denormalised snapshot columns `snap_views, snap_coin_count, snap_age_min, snap_top_mcap, snap_position_lamports, snap_position_mint` and a `status` enum. Its rail addition is a fourth mode, `Chatter`, alongside the existing `railMode` values.

---

## 6. FAKED BEHAVIOURS AND WHAT REPLACES EACH

| # | What is faked | Where | Replace with |
|---|---|---|---|
| 1 | **Trade tape.** `genTape()` picks a random `TOKENS` entry, `Math.random()>0.45` for buy/sell, `Math.random()*6+0.05` SOL, `t:Date.now()`, no wallet. Driven by `setInterval(pushStream,2600)`. | 2592–2593, 2640, 3667 | Real swap stream — Helius/Birdeye websocket or the existing `/api/trades` polled per-mint aggregated across watched mints. Rows must carry a destination (flow doc: "Every live-rail row has a named destination"). |
| 2 | **Simulated deploy / launch.** `deployFiled()` fabricates a contract address with `genCA()`, invents `mc/liq/vol` from `deployBuy*SOL_PRICE`, and `unshift`s into `TOKENS`. No transaction, no wallet, no cost. | 2935–2971, 1324–1325 | Real pump.fun/bonding-curve launch tx signed by `InsidorWallet`, returning a real mint; then a `Launch` row + optimistic UI. The "Cost to launch ~1.02 SOL" line (2911, `0.52+deployBuy`) becomes a real quoted fee. |
| 3 | **Generated holders.** Layer-2 `mkToken` sets `holders: 340+seed*57` and `top10: 18+seed%22`; `mkSafety()` invents `topHolderPct/devHoldingPct/sniperPct/bundledPct/devSelling/riskLabel`. | 1328, 1332, 1354–1355 | `/api/holders` + `/api/safety` (already wired for L3 at 3097–3112) as the *only* source; `null` renders `—` via `fmtHolders`/`fmtTop10`/`secBool` — the null-safe formatters already exist. |
| 4 | **Smart money / top traders.** `mkSmartMoney()` produces `smartWalletsIn: 10+seed*4`, `holderGrowth1h`, and fake handles `@alpha7 / @whale9` with `+7700 SOL` PnL. | 1356–1357 | `/api/toptraders` (already real for L3, 3047–3057). Delete `mkSmartMoney` entirely. |
| 5 | **Google Trends sparkline.** `mkSeries(seed,trend)` — a sine-wave + modulo walk labelled "search interest index over ~3h". Rendered as `narrSparkSVG` under the header **"Google trend"** (1719–1720, markup 1076). | 1350–1353 | Real Google Trends / X search-volume series, or **remove the label**. Currently the UI asserts a data source that does not exist. |
| 6 | **Token price sparkline** in every token row. `sparkSVG(t)` seeds from `t.ca.charCodeAt(1)+t.ageM%13` and walks with `Math.sin` noise — it is not price history. | 2690–2696 | Real OHLCV (`/api/ohlcv` exists) or a 24 h price series from DexScreener. |
| 7 | **Canvas candle chart.** `genCandles(tf,base)` random-walks 60 candles; `tickChart()` drifts the last candle with `Math.random()` and randomly rolls a new one. `drawChart()`/`CG`/`hoverIdx` support it. | 2974–3024 | Already superseded on the token page by `InsidorTokenPage.mountChart` (DexScreener iframe, tokenpage.js:54–77). **This whole block is dead code** — delete `genCandles`, `tickChart`, `drawChart`, `roundRect`, `CG`, `candles`, `chartTF`, `hoverIdx`, `hoverY`, `feedTimer`. |
| 8 | **Post engagement metrics.** When `narrLive()` is false, `postMetrics()` derives reposts/replies/shares/saves from `views * 0.006 / 0.004 / 0.009 / 0.013` with a deterministic jitter from `pseed(txt+who)`. | 1293–1302 | Real `retweets/quotes/replies/likes` from `post_snapshots` (the live path at 1301–1302 already does this). |
| 9 | **Gain 24h fallback.** `narrViralGain24h` returns `combinedViews * 0.14` when there is no series and no `gain24h`. This number drives the Gain column, the up/down colour threshold (`>=150000`), and the sort order of Search/Watchlist/palette narratives. | 1662–1669 | A real 24 h view delta from snapshots; render `—` when unavailable rather than inventing. |
| 10 | **Lead time.** `NARR[].lead` is a literal string (`'+31m'`), `narrIdx` maps posts to tokens by array index, and `deployFiled` writes `lead:'simulated'`. The Trending card prints "`+31m` before CT". | 1259–1268, 2939, 1457 | The flow doc's rule: *"Lead time is one number owned by the story"* — a single `minutes_early` on Story, everything else arithmetic on it. Must be allowed to be **negative** and displayed as such. |
| 11 | **Meme images.** `imgURL()` hits `loremflickr.com` keyed on `IMGKW[narrIdx]` with a `picsum.photos` fallback; `narrThumb`, `tkLogo`, `memeThumb` all route through it. | 1437–1443, 1685–1688 | Real post media (`mediaUrl` from `extractPostMedia`, live.js:474–501) and real token logos (`logoForPair`, live.js:116). The fallback should be a generated placeholder, not a third-party photo API. |
| 12 | **Post permalinks.** `postURL(p)` (1727–1739) uses `platformPostId` when present, otherwise **synthesises** `pseed(p.text)%1000000000000` as a post id. | 1727–1739 | Require a real `platform_post_id`; hide the link when absent. The flow doc calls the permalink "the proof — the lead-time claim is unfalsifiable without it". |
| 13 | **`NARR` / `NARRATIVES` / `TOKENS` seed literals** — 10 mock posts, 14 mock clusters, 10 mock tokens. Still the live data source on Layer 2 and the fallback whenever Supabase is unreachable (`setNarrativesFallback`, live.js:837–855, which flips the banner to "using sample data"). | 1258–1345, 1367–1413 | Server queries. Keep an explicit "sample data" mode flag, but it should not be the same array the renderers mutate. |
| 14 | **`PENDING` candidate tickers.** The Tokens view banner ("detected in a viral post but has no coin yet"), the New-pairs candidate rows, and the palette "Candidates" section all read `PENDING` — which is **never populated**. | 1346; read at 2744, 2806, 2832, 2848, 3471 | This is the flow doc's `No coin yet` chip and the "story with zero coins" state. Should be derived: `stories where coin_count = 0`. |
| 15 | **"1,000,000,000" total supply** hard-coded in the Info tab. | 3169 | Real mint supply. |
| 16 | **Fee split panel** — "Your fee share (creator) 3.0%", bar widths `60%`/`20%`, "Insidor takes 1%". Static markup, no computation. | 2905–2907 | Real `Payout` object (flow doc: maker 50 / poster 40 / Insidor 10). |
| 17 | **`updated <span id="tokUpd">now</span>`** — a `setInterval` that writes the literal string `'now'` every 4 s. | 3670, markup 1100 | Real `dataUpdatedAt` from the query. |
| 18 | **Trade-form fixed values** — "LP fee 1.00%" hard-coded; network fee is `prio==='turbo'?0.002:0.0005` SOL. | 3358, 3200 | Real route fees from the Jupiter quote, real priority-fee estimate. |
| 19 | **`estimateQuote`** — when Jupiter is unavailable (Layer 2), quotes are `amount × price` with `priceImpactPct: null`. Honestly labelled ("price estimate — routed quote needs Jupiter") but still shown in the same slot as a real quote. | tokenpage.js:83–105 | Either a real quote or an explicit disabled state. |
| 20 | **`narrTiming` / `narrAboutText` / `narrViralWords` / `narrTrendExplain`** — prose generated from thresholds (`mcap>800000?8:mcap>250000?5:…`) and presented as analysis. | 1693–1726, 1746–1758 | Server-computed story-state text driven by the flow doc's four states (Just spotted / Spreading / Cooling off / Over) with their stated thresholds (<15 min; posts-per-5-min rising 3 checks; <60 % of peak; <15 % of peak for an hour). The prototype has only the implicit boolean the doc calls out as the bug. |

### Also-dead / also-notable

* `bumpNarrNewBadge()` and `clearNarrNewBadge()` (1990–1991) are empty function bodies still called from `setView` and `onNarrativeArrival`.
* `window.NARRATIVES_ALL` is populated by `live.js` and read by nobody.
* `curOT` (`'market'`) is set and reset but never read — a removed limit-order feature; `#limitp` is wired at 3404 but the element never exists.
* `activePostIdx` is written in four places and read only once (2823), as a fallback `narrIdx` for candidate rows.
* `mkSafety`'s `sniperPct`, `bundledPct`, `devSelling`, `devHoldingPct` and `mkSmartMoney`'s entire output are generated but never rendered anywhere.