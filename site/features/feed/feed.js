/* Insidor narratives table + live activity feed — extracted from index.html */

/* ============ NARRATIVE CLUSTERS (derived + table + modal) ============ */
function getNarrative(id){return NARRATIVES.find(x=>x.id===id);}
async function ensureNarrative(id){
  const hit=getNarrative(id);
  if(hit)return hit;
  if(window.InsidorLive?.fetchNarrativeById)return await InsidorLive.fetchNarrativeById(id);
  return null;}
function viralItemFromNote(el){
  if(!el)return null;
  const postId=el.dataset.postId;
  const hit=(window.VIRAL_STREAM||[]).find(p=>p.postId===postId);
  if(hit)return hit;
  const txt=el.dataset.postTxt||'';
  if(!txt&&!postId)return null;
  const badge=el.querySelector('.pbadge');
  const plat=badge?.classList.contains('tt')?'tt':'x';
  const who=el.querySelector('.who')?.textContent||'user';
  const at=el.querySelector('.at')?.textContent||('@'+who);
  const readMetric=(k)=>{
    const b=el.querySelector(`[data-post-metric="${k}"]`);
    if(!b)return 0;
    const raw=b.dataset.metricVal;
    if(raw!=null&&raw!==''){const n=Number(raw);if(Number.isFinite(n))return n;}
    return parseCount(b.textContent)||0;};
  return{txt,plat,badge:PLATNAME[plat]||plat,who,at,postId,
    rawViews:readMetric('views'),replies:readMetric('replies'),
    retweets:readMetric('reposts'),likes:readMetric('likes'),quotes:0};}
function findFromPostText(txt){
  const t=(txt||'').trim();
  if(!t)return;
  let tks=extractTickers(t);
  if(!tks.length)tks=[deriveTicker(t)];
  activeTickers=tks;activePostIdx=-1;
  renderTokens();go('tokens');}
function openViralPostItem(p){
  if(!p)return;
  const url=postURL({platform:p.plat,handle:p.at,platformPostId:p.platformPostId,text:p.txt});
  const metrics=postMetrics({plat:p.plat,views:p.rawViews,rawViews:p.rawViews,txt:p.txt,who:p.who,
    replies:p.replies,quotes:p.quotes,retweets:p.retweets,likes:p.likes});
  const mets=metrics.map(([k,v])=>`<div class="pd-stat"><span class="pdv">${fmtCount(v)}</span><span class="pdk">${k}</span></div>`).join('');
  const tks=extractTickers(p.txt||'');
  const chip=SRCLABEL[p.media];
  const thumb=p.mediaUrl?postMediaImg(p,150):(p.narrativeId?narrThumb(getNarrative(p.narrativeId),150):imgTag('meme',pseed(p.txt||''),150));
  const postedMs=toMs(p.postedAt);
  const ageLbl=postedMs?timeAgo(postedMs)+' ago':'';
  const subParts=[PLATNAME[p.plat]||p.badge||'Post',MEDIANAME[p.media]||'Post'];
  if(ageLbl)subParts.push('posted '+ageLbl);
  const preview=url
    ?`<a class="pd-media pd-open" href="${escAttr(url)}" target="_blank" rel="noopener noreferrer" title="Open post on ${PLATNAME[p.plat]||'platform'}" style="${palStyle(p.pal||1)}">${thumb}${chip?`<span class="srcchip-mini">${chip}</span>`:''}</a>`
    :`<div class="pd-media" style="${palStyle(p.pal||1)}">${thumb}${chip?`<span class="srcchip-mini">${chip}</span>`:''}</div>`;
  const root=ensureModalRoot();
  root.innerHTML=`<div class="dback" id="pdback"><div class="sheet pd-sheet" role="dialog" aria-modal="true">
    <div class="sh-top">
      <span class="pbadge ${p.plat||'x'}" title="${escHtml(p.badge||'Post')}">${plogo(p.plat||'x')}</span>
      <div class="sh-kick"><div class="sh-t">${escHtml(p.who||'user')} <span class="pd-at">${escHtml(p.at||'@user')}</span></div>
        <div class="sh-s">${escHtml(subParts.join(' · '))}</div></div>
      <button class="sh-x" id="pdclose" aria-label="Close">✕</button>
    </div>
    <div class="sh-body">
      ${preview}
      <p class="pd-text">${escHtml(p.txt||'')}</p>
      <div class="pd-stats">${mets}</div>
      <div class="pd-tickers"><span class="pd-l">${tks.length?'Tickers in this post':'No coin yet — you could be first'}</span>${tks.length?`<div class="pd-chips">${tks.map(a=>`<span class="achip">$${escHtml(a)}</span>`).join('')}</div>`:''}</div>
    </div>
    <div class="sh-foot">
      <button class="deploy-go" id="pdcreate">Create Coin</button>
      <button class="sh-x2" id="pdsearch">${tks.length?`Search ${tks.length}`:'Search'}</button>
    </div>
  </div></div>`;
  document.body.style.overflow='hidden';
  $('#pdclose').onclick=closeDeploy;
  $('#pdback').onclick=e=>{if(e.target.id==='pdback')closeDeploy();};
  $('#pdcreate').onclick=()=>{closeDeploy();openDeployFromViralPost(p);};
  $('#pdsearch').onclick=()=>{closeDeploy();findFromPostText(p.txt);};}
function narrLive(){return isL3()&&!!window._narrativesLive;}
function narrPostViewSum(n){return(n.posts||[]).reduce((s,p)=>s+(Number(p.views)||0),0);}
function narrCombinedViews(n){
  if(n.combinedViews!=null&&Number(n.combinedViews)>0)return Number(n.combinedViews);
  return narrPostViewSum(n);}
function narrOldestPostMs(n){
  let oldest=null;
  for(const p of n.posts||[]){
    const t=toMs(p.postedAt);
    if(t==null)continue;
    oldest=oldest==null?t:Math.min(oldest,t);}
  if(oldest!=null)return oldest;
  return toMs(n.createdAt)||null;}
function narrAgeMinutes(n){
  const oldest=narrOldestPostMs(n);
  if(oldest!=null)return Math.max(1,Math.round((Date.now()-oldest)/60000));
  return 1;}
function narrAuthorVelocity(n){
  if(n.authorVelocity!=null)return n.authorVelocity;
  return 0;}
function narrViewsVelocity(n){
  if(n.viewsVelocity!=null)return n.viewsVelocity;
  return 0;}
function narrPlatforms(n){
  if(Array.isArray(n.platforms)&&n.platforms.length)return[...new Set(n.platforms)];
  return[...new Set((n.posts||[]).map(p=>p.platform).filter(Boolean))];}
function narrTopPost(n){return n.posts.reduce((a,b)=>a.views>b.views?a:b,n.posts[0]);}
function toMs(v){if(v==null)return null;if(typeof v==='number')return normalizeEpochMs(v);
  const n=Number(v);if(Number.isFinite(n))return normalizeEpochMs(n);
  const t=Date.parse(v);return Number.isFinite(t)?t:null;}
function normalizeEpochMs(v){
  if(v==null)return null;
  const n=typeof v==='number'?v:Number(v);
  if(Number.isFinite(n)){if(n>1e12)return n;if(n>1e9)return n*1000;return null;}
  const t=Date.parse(v);return Number.isFinite(t)?t:null;}
function escAttr(s){return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');}
function postMediaImg(p,size,fallbackKw,fallbackSeed){
  const url=p?.mediaUrl;
  if(url)return `<img class="memeimg" src="${escAttr(url)}" alt="" loading="lazy" onerror="this.remove()">`;
  if(fallbackKw!=null)return imgTag(fallbackKw,fallbackSeed,size);
  return '';}
function tokenLiquidity(tok){
  const n=Number(tok?.liquidity??tok?.liq);
  return Number.isFinite(n)?n:0;}
function tokenHasLiquidity(tok){return tokenLiquidity(tok)>0;}
function visibleTokens(list){return (list||TOKENS).filter(tokenHasLiquidity);}
function registryLiveToken(sym){
  if(!sym)return null;
  const s=String(sym).toUpperCase();
  return TOKENS.find(t=>t.sym===s&&tokenHasLiquidity(t))||null;}
function narrativeLiveCoin(sym){
  if(!sym)return null;
  const s=String(sym).toUpperCase();
  for(const n of NARRATIVES){
    for(const tok of n.tokens||[]){
      if(tok.ticker===s&&tok.mint&&tokenHasLiquidity(tok))return tok;
    }
  }
  return null;}
function tickerIsLive(sym){return!!(registryLiveToken(sym)||narrativeLiveCoin(sym));}
function tokenIsOnChain(tok){return!!(tok?.mint);}
function tokenHasLiveMarket(tok){
  return!!(tok?.mint&&tokenHasLiquidity(tok)&&tok.firstDeployed&&(tok.mcap||0)>0);}
function narrTopToken(n){
  const pool=(n?.tokens||[]).filter(t=>tokenHasLiquidity(t));
  if(!pool.length)return null;
  return pool.reduce((a,b)=>(b.mcap||0)>(a.mcap||0)?b:a,pool[0]);}
function narrCanonicalToken(n){
  const pool=(n?.tokens||[]).filter(t=>tokenHasLiquidity(t));
  if(!pool.length)return null;
  return pool.find(t=>t.canonical)||pool.find(t=>t.endorsedBy)||narrTopToken(n);}
function narrDeployedToken(n){
  const onChain=(n?.tokens||[]).filter(t=>t.mint&&tokenHasLiquidity(t));
  if(!onChain.length)return null;
  return onChain.sort((a,b)=>(b.mcap||0)-(a.mcap||0))[0];}
function narrMcapCell(n){
  const top=narrDeployedToken(n)||narrTopToken(n);
  if(tokenHasLiveMarket(top))return fmtUSD(top.mcap);
  return `<button class="btn-deploy-mini deploy-narr" data-deploy-narr="${n.id}" type="button">Create</button>`;}
function narrTokToRegistry(tok,narr){
  const pairAddr=tok.pairAddress||null;
  return{sym:tok.ticker,name:tok.name||tok.ticker,ca:tok.mint,price:tok.priceUsd||0,mc:tok.mcap||0,liq:tok.liquidity||0,
    vol:tok.vol24h||0,ageM:tok.ageMin||1,c5:0,c1h:0,c24:0,live:true,firstDeployed:!!tok.firstDeployed,
    narrIdx:narr?.narrIdx??-1,
    dex:tok.dexUrl||(pairAddr?`https://dexscreener.com/solana/${pairAddr}`:`https://dexscreener.com/solana/${tok.mint}`),
    pump:tok.pumpUrl||`https://pump.fun/${tok.mint}`,pairAddress:pairAddr,
    mintRevoked:null,freezeRevoked:null,lpBurned:null,top10:null,_liveAt:Date.now()};}
function materializeNarrToken(tok,narr){
  if(!tok?.mint||!tokenHasLiquidity(tok)||typeof TOKENS==='undefined')return null;
  let t=TOKENS.find(x=>x.ca===tok.mint||x.sym===tok.ticker);
  if(t){
    if(tok.mcap!=null)t.mc=tok.mcap;
    if(tok.liquidity!=null)t.liq=tok.liquidity;
    if(tok.vol24h!=null)t.vol=tok.vol24h;
    if(tok.dexUrl)t.dex=tok.dexUrl;
    if(tok.pumpUrl)t.pump=tok.pumpUrl;
    if(tok.pairAddress)t.pairAddress=tok.pairAddress;
    if(tok.firstDeployed!=null)t.firstDeployed=tok.firstDeployed;
    return t;}
  t=narrTokToRegistry(tok,narr);
  TOKENS.push(t);
  return t;}
function resolveToken(symOrMint){
  if(!symOrMint)return null;
  const s=String(symOrMint);
  let t=TOKENS.find(x=>(x.sym===s||x.ca===s)&&tokenHasLiquidity(x));
  if(t)return t;
  for(const n of NARRATIVES){
    for(const tok of n.tokens||[]){
      if(!tokenHasLiquidity(tok))continue;
      if(tok.ticker===s||tok.mint===s)return materializeNarrToken(tok,n);}}
  return null;}
function narrViralGain24h(n){
  if(n.gain24h!=null&&n.gain24h>0)return n.gain24h;
  const s=n.searchSeries||n.viewsSeries;
  if(s&&s.length>=2){
    const start=Math.max(0,s.length-25);
    return Math.max(0,s[s.length-1]-s[start]);}
  return 0;}
function narrSearchSeries(n){return n.searchSeries||n.viewsSeries||[];}
function narrLifecycle(n){
  if(n.lifecycle)return n.lifecycle;
  if(narrLive())return'peaking';
  const s=narrSearchSeries(n);if(!s||s.length<4)return'peaking';
  const r=s.slice(-4),rSlope=(r[r.length-1]-r[0])/Math.max(r[0],1);
  const mid=(s[Math.floor(s.length/2)]-s[0])/Math.max(s[0],1);
  if(rSlope>.12&&mid<.45)return'heating';if(rSlope<-.07)return'cooling';return'peaking';}
function narrThreadMomentum(n){return n.posts.reduce((s,p)=>s+(p.replies||0)+(p.quotes||0),0);}
function narrOldestAt(n){
  const oldest=narrOldestPostMs(n);
  if(oldest!=null)return oldest;
  return toMs(n.createdAt)||NOW;}
function narrAgeMs(n){return Math.max(0,Date.now()-narrOldestAt(n));}
function narrAgeLabel(n){return age(narrAgeMinutes(n));}
function narrThumb(n,s){
  const top=narrTopPost(n);
  if(top?.mediaUrl)return postMediaImg(top,s||120);
  return imgTag(IMGKW[n.imgSeed]||n.title.split(' ')[0],(n.imgSeed+1)*97+13,s||120);}
function narrPlatLogos(n){return narrPlatforms(n).map(p=>`<span class="nplat" title="${PLATNAME[p]||p}">${plogo(p)}</span>`).join('');}
function narrSpreadLabel(n){const plats=narrPlatforms(n);if(plats.length<2)return`Single platform · ${PLATNAME[plats[0]]||plats[0]}`;
  const ord=[...plats].sort((a,b)=>n.posts.findIndex(p=>p.platform===a)-n.posts.findIndex(p=>p.platform===b));
  return'Cross-platform · '+ord.map((p,i)=>(i?' → ':'')+(PLATNAME[p]||p)).join('');}
function narrTiming(n){
  const ageH=narrAgeMs(n)/3600000,canon=narrDeployedToken(n)||narrCanonicalToken(n),mcap=canon?.mcap||0;
  if(narrLive()){
    const views=narrCombinedViews(n),gain=narrViralGain24h(n),vel=narrViewsVelocity(n);
    const bits=[fmtCount(views)+' combined views'];
    if(gain>0)bits.push(fmtCount(gain)+' gained in 24h');
    if(vel>0)bits.push(fmtCount(Math.round(vel))+' views/min');
    if(!canon?.mint||!tokenHasLiquidity(canon))return{phase:'live',label:'Live',reason:bits.join(' · ')+' · no coin deployed yet.'};
    bits.push('top coin '+fmtUSD(mcap));
    return{phase:'live',label:'Live',reason:bits.join(' · ')+'.'};}
  if(!narrDeployedToken(n)){if(ageH<3)return{phase:'early',label:'Early',reason:'Narrative fresh — no coin deployed yet. You could be first.'};
    if(ageH<12)return{phase:'mid',label:'Mid',reason:'Trend has run '+Math.round(ageH)+'h without a canonical coin — window narrowing.'};
    return{phase:'late',label:'Likely late',reason:'Late-stage narrative with no deployed token — likely missed first move.'};}
  const run=mcap>800000?8:mcap>250000?5:mcap>80000?3:mcap>20000?2:1;
  if(run>=6)return{phase:'late',label:'Likely late',reason:'Coin already up ~'+run+'x since the trend broke — exit-liquidity risk.'};
  if(ageH<4&&run<3)return{phase:'early',label:'Early',reason:'Coin exists but mcap still low relative to narrative heat.'};
  if(ageH>16||run>=3)return{phase:'mid',label:'Mid',reason:'Momentum established — mcap '+fmtUSD(mcap)+', narrative age '+narrAgeLabel(n)+'.'};
  return{phase:'early',label:'Early',reason:'Early overlap — narrative and coin both still forming.'};}
function narrSparkSVG(series,tall){if(!series||!series.length)return'';
  const n=series.length,min=Math.min(...series),max=Math.max(...series),rng=max-min||1,W=100,H=tall?44:24;
  const pts=series.map((v,i)=>`${(i/(n-1)*W).toFixed(1)},${(H-((v-min)/rng)*H*.85-H*.075).toFixed(1)}`).join(' ');
  const col='#3DE0FF',fill='rgba(61,224,255,.12)';
  return`<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline points="0,${H} ${pts} ${W},${H}" fill="${fill}" stroke="none"/><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;}
function narrPulseSub(n){
  if(n.trendTerm)return `Google Trends · "${n.trendTerm}"`;
  return narrLive()?'Google Trends · search interest':'Google Trends';}
function narrPulseHTML(n,tall){return`<div class="nm-pulse-block${tall?' tall':''}"><div class="nm-pulse-hd"><span class="nm-pulse-lbl">Google trend</span><span class="nm-pulse-sub">${narrPulseSub(n)}</span></div>${narrSparkSVG(narrSearchSeries(n),tall)}</div>`;}
function narrPulseCell(n){return`<div class="nm-pulse" title="Google Trends search interest">${narrSparkSVG(narrSearchSeries(n),false)}</div>`;}
function narrTrendExplain(n){const timing=narrTiming(n),plats=narrPlatforms(n).map(p=>PLATNAME[p]||p).join(' & ');
  const tok=narrTopToken(n),gain=narrViralGain24h(n),views=narrCombinedViews(n);
  if(!tok)return{line1:`Spreading on ${plats} with ${fmtCount(views)} views and ${fmtCount(gain)} view gain in 24h.`,
    line2:timing.phase==='early'?'No coin live yet — narrative heat is still ahead of the market.':timing.reason};
  return{line1:`${fmtCount(views)} views across ${plats}; top coin $${tok.ticker} at ${fmtUSD(tok.mcap)} mcap.`,
    line2:timing.reason};}
function postURL(p){
  const h=(p.handle||'@user').replace(/^@/,'');
  const realId=p.platformPostId||p.platform_post_id;
  if(p.platform==='x'&&realId)return `https://x.com/i/status/${realId}`;
  const id=pseed(p.text)%1000000000000;
  if(p.platform==='x')return `https://x.com/${h}/status/${id}`;
  if(p.platform==='tt'&&realId)return `https://www.tiktok.com/@${h}/video/${realId}`;
  if(p.platform==='tt')return `https://www.tiktok.com/@${h}/video/${id}`;
  if(p.platform==='rd')return `https://www.reddit.com/comments/${id}/`;
  if(p.platform==='fc')return `https://warpcast.com/${h}/${id}`;
  if(p.platform==='tg')return `https://t.me/${h}/${id%10000}`;
  return '#';
}
function narrCombinedReposts(n){
  if(narrLive())return(n.posts||[]).reduce((s,p)=>s+(Number(p.retweets)||0)+(Number(p.quotes)||0),0);
  return n.posts.reduce((s,p)=>s+(p.quotes||0)+Math.round((p.replies||0)*0.12),0);}
function narrCombinedLikes(n){
  if(narrLive())return(n.posts||[]).reduce((s,p)=>s+(Number(p.likes)||0),0);
  return n.posts.reduce((s,p)=>s+Math.round(p.views*(p.platform==='tt'?0.11:0.048)),0);}
function narrViralWords(n){
  const names=narrPlatforms(n).map(p=>PLATNAME[p]||p);
  if(!names.length)return 'Spreading on social media';
  if(names.length===1)return `Viral on ${names[0]}`;
  if(names.length===2)return `Viral on ${names[0]} and ${names[1]}`;
  return `Viral on ${names.slice(0,-1).join(', ')} and ${names.at(-1)}`;}
function narrAboutText(n){const blurb=n.blurb.charAt(0).toUpperCase()+n.blurb.slice(1);
  const plats=narrPlatforms(n).map(p=>PLATNAME[p]||p).join(' & ');
  const line1=(blurb.endsWith('.')?blurb:blurb+'.')+` ${n.posts.length} posts tracked across ${plats}.`;
  return{line1,line2:narrTiming(n).reason};}
function postPreviewImg(n,p){
  if(p?.mediaUrl)return postMediaImg(p,72);
  return imgTag(IMGKW[n.imgSeed]||'meme',pseed(p.text),72);}
function narrGoogleTrendHTML(n){return`<div class="nm-pulse-block tall"><div class="nm-pulse-hd"><span class="nm-pulse-lbl">Google trend</span><span class="nm-pulse-sub">${narrPulseSub(n)}</span></div>${narrSparkSVG(narrSearchSeries(n),true)}</div>`;}
function leadBadge(min,sm){return`<span class="lead-badge${sm?' sm':''}">+${min}m early</span>`;}
function leadDim(min){return`<span class="lead-dim">+${min}m</span>`;}
function narrOnchainLine(t){if(!t?.safety)return'';const s=t.safety,m=t.smartMoney;
  return[s.mintRevoked?'Mint ✓':'Mint ✗',s.lpBurned?'LP ✓':'LP ✗','Top '+s.topHolderPct+'%',
    m?(m.smartWalletsIn+' smart · '+(m.holderGrowth1h>=0?'+':'')+m.holderGrowth1h+'% 1h'):''].filter(Boolean).join(' · ');}
function embedPostHTML(p,imgSeed){const av=(p.handle||'?').replace('@','')[0].toUpperCase();
  const img=(p.mediaUrl||p.image)?`<div class="embed-post-img">${postMediaImg(p,160,IMGKW[imgSeed]||'meme',pseed(p.text))}</div>`:'';
  return`<div class="embed-post"><div class="embed-post-hd"><span class="av">${av}</span><div><div class="embed-post-who">${p.handle}</div>
    <div class="embed-post-sub">${fmtCount(p.followers)} followers · <span class="pbadge ${p.platform}">${plogo(p.platform)}</span> ${PLATNAME[p.platform]||p.platform}</div></div></div>
    <p class="embed-post-txt">${p.text}</p>${img}<div class="embed-post-meta"><span>${fmtCount(p.views)} views</span><span>${fmtCount(p.replies||0)} replies</span><span>${fmtCount(p.quotes||0)} quotes</span></div></div>`;}
function trendScore(t){
  const volMc=Math.min(t.vol/Math.max(t.mc,1)/3,1);
  const txnsN=Math.min((t.txns||0)/4800,1);
  const priceN=Math.min(Math.max(t.c24,0)/85,1);
  const momN=Math.min(Math.max(t.c1h,0)/55,1);
  return volMc*.4+txnsN*.25+priceN*.2+momN*.15;}
var narrChipSort='trending',narrSort={key:null,dir:-1};
const MIN_INGEST_VIEWS=30000;
var pinnedNarrativeIds=[];
var narrSoundOn=localStorage.getItem('insidor-narr-sound')==='1';
const narrMetricsCache=new Map();
const narrRowDom=new Map();
const narrDisplayCache=new Map();
const narrSortKeyCache=new Map();
let narrDomOrder=[];
let narrTableInitialized=false;
let narrEmptyEl=null;
let narrSortModeSig='';
function narrSortModeSignature(){
  const now=Date.now();
  const pins=pinnedNarrativeIds.filter(p=>p.until>now).map(p=>`${p.id}:${p.until}`).join(',');
  return`${narrChipSort}|${narrSort.key}|${narrSort.dir}|${pins}`;}
function narrRowSortKey(n){
  if(isNarrativePinned(n.id)){
    const p=pinnedNarrativeIds.find(x=>x.id===n.id);
    return`pin:${p?.until||0}`;}
  if(narrSort.key==='views')return narrCombinedViews(n);
  if(narrSort.key==='gain')return narrViralGain24h(n);
  if(narrSort.key==='mcap')return(narrTopToken(n)||{mcap:0}).mcap;
  if(narrSort.key==='age')return narrOldestAt(n);
  if(narrChipSort==='new')return narrOldestAt(n);
  return`${narrAuthorVelocity(n)}:${narrViewsVelocity(n)}`;}
function narrRowDisplayState(n){
  const top=narrTopPost(n);
  return{
    title:n.title,
    blurb:n.blurb,
    thumbKey:top?.mediaUrl||`seed:${n.imgSeed}:${n.title}`,
    pulseSeries:narrSearchSeries(n).join(','),
    plats:narrPlatforms(n).join(','),
    views:narrCombinedViews(n),
    vv:narrViewsVelocity(n),
    gain:narrViralGain24h(n),
    mcapHtml:narrMcapCell(n),
    ageMin:narrAgeMinutes(n),
    pinned:isNarrativePinned(n.id)};}
function resetNarrativesTableState(){
  narrRowDom.forEach(el=>el.remove());
  narrRowDom.clear();narrDisplayCache.clear();narrSortKeyCache.clear();
  narrDomOrder=[];narrTableInitialized=false;narrEmptyEl=null;narrSortModeSig='';}
function buildNarrativeRowEl(n){
  const wrap=document.createElement('div');
  wrap.innerHTML=narrRow(n);
  return wrap.firstElementChild;}
function removeNarrativeRowDom(id){
  const el=narrRowDom.get(id);
  if(el)el.remove();
  narrRowDom.delete(id);narrDisplayCache.delete(id);narrSortKeyCache.delete(id);
  narrMetricsCache.delete(id);
  narrDomOrder=narrDomOrder.filter(x=>x!==id);}
function reconcileNarrativeOrder(desiredIds,container){
  let prev=null;
  for(const id of desiredIds){
    const node=narrRowDom.get(id);
    if(!node)continue;
    if(!node.parentElement){
      if(prev)container.insertBefore(node,prev.nextSibling);
      else container.insertBefore(node,container.firstChild);
    }else if(prev){
      if(node.previousElementSibling!==prev)container.insertBefore(node,prev.nextSibling);
    }else if(container.firstElementChild!==node){
      container.insertBefore(node,container.firstChild);}
    prev=node;}}
function applyNarrativeRowCells(el,n,prev,next){
  if(!prev||prev.title!==next.title){const t=el.querySelector('.nar-title');if(t)t.textContent=n.title;}
  if(!prev||prev.blurb!==next.blurb){const b=el.querySelector('.nar-blurb');if(b)b.textContent=n.blurb;}
  if(!prev||prev.thumbKey!==next.thumbKey){const th=el.querySelector('.nar-thumb');if(th)th.innerHTML=narrThumb(n,80);}
  if(!prev||prev.pulseSeries!==next.pulseSeries){
    const p=el.querySelector('.nm-pulse');
    if(p)p.innerHTML=narrSparkSVG(narrSearchSeries(n),false);}
  if(!prev||prev.plats!==next.plats){const m=el.querySelector('.nar-row-meta');if(m)m.innerHTML=narrPlatLogos(n);}
  const metricsPrev=narrMetricsCache.get(n.id)||{};
  tickMetricCell(el.querySelector('[data-metric="views"]'),metricsPrev.views,next.views,fmtCount);
  const vvEl=el.querySelector('[data-metric="vv"]');
  if(vvEl&&metricsPrev.vv!==next.vv)vvEl.textContent=next.vv>0?fmtCount(Math.round(next.vv))+'/min':'';
  const gainEl=el.querySelector('[data-metric="gain"] .nm-gain');
  if(gainEl&&(metricsPrev.gain!==next.gain||!prev)){
    gainEl.textContent='+'+fmtCount(next.gain);
    gainEl.className='nm-gain '+(next.gain>=150000?'up':'down');}
  if(!prev||prev.mcapHtml!==next.mcapHtml){
    const cols=el.querySelectorAll('.nm-col');
    const mcapCol=cols[cols.length-2];
    if(mcapCol)mcapCol.innerHTML=next.mcapHtml;}
  if(!prev||prev.ageMin!==next.ageMin){
    const cols=el.querySelectorAll('.nm-col');
    const ageCol=cols[cols.length-1];
    if(ageCol)ageCol.textContent=narrAgeLabel(n);}
  if(!prev||prev.pinned!==next.pinned){
    el.classList.toggle('narr-pinned',next.pinned);
    const titleLine=el.querySelector('.nar-title-line');
    if(titleLine){
      let pinEl=titleLine.querySelector('.narr-new-pin');
      if(next.pinned&&!pinEl){
        pinEl=document.createElement('span');pinEl.className='narr-new-pin';pinEl.textContent='NEW';
        const star=titleLine.querySelector('.star');
        titleLine.insertBefore(pinEl,star||null);
      }else if(!next.pinned&&pinEl)pinEl.remove();}}
  narrMetricsCache.set(n.id,{views:next.views,gain:next.gain,vv:next.vv});}
function syncNarrativesTable(opts={}){
  if(isL3()&&!window._narrativesReady)return{changed:false};
  const el=$('#narrRows');if(!el)return{changed:false};
  const reason=opts.reason||'unspecified';
  const source=getNarrativeSourceList();
  const sorted=sortNarratives(source);
  const desiredIds=sorted.map(n=>n.id);
  const desiredSet=new Set(desiredIds);
  const scrollEl=el.closest('.tab-data-wrap')||el.parentElement||el;
  const scrollTop=scrollEl.scrollTop;
  let added=0,removed=0,cellUpdates=0,reordered=false;
  const checkIds=opts.ids?new Set(opts.ids.filter(id=>desiredSet.has(id))):null;
  for(const id of[...narrDomOrder]){
    if(!desiredSet.has(id)){removeNarrativeRowDom(id);removed++;}}
  if(!desiredIds.length){
    if(!narrEmptyEl){
      resetNarrativesTableState();
      narrEmptyEl=document.createElement('div');
      narrEmptyEl.className='noresult';narrEmptyEl.textContent='No narratives yet.';
      el.appendChild(narrEmptyEl);narrTableInitialized=true;}
    const c=$('#narrCount');if(c)c.textContent='0';
    updateNarrSortArrows();
    scrollEl.scrollTop=scrollTop;
    if(removed&&!opts.quiet)console.log(`[live] narr table update (${reason}): -${removed}`);
    return{changed:!!removed,removed};
  }
  if(narrEmptyEl){narrEmptyEl.remove();narrEmptyEl=null;}
  const sortSig=narrSortModeSignature();
  const sortModeChanged=sortSig!==narrSortModeSig;
  if(sortModeChanged)narrSortModeSig=sortSig;
  let sortKeysChanged=sortModeChanged||!!opts.forceReorder;
  for(const n of sorted){
    const sk=narrRowSortKey(n);
    const prevSk=narrSortKeyCache.get(n.id);
    if(prevSk!==sk)sortKeysChanged=true;
    narrSortKeyCache.set(n.id,sk);
    if(checkIds&&!checkIds.has(n.id)&&narrRowDom.has(n.id))continue;
    const displayState=narrRowDisplayState(n);
    const displayKey=JSON.stringify(displayState);
    let rowEl=narrRowDom.get(n.id);
    if(!rowEl){
      rowEl=buildNarrativeRowEl(n);
      narrRowDom.set(n.id,rowEl);
      narrDisplayCache.set(n.id,displayKey);
      narrMetricsCache.set(n.id,{views:displayState.views,gain:displayState.gain,vv:displayState.vv});
      added++;
    }else{
      const prevKey=narrDisplayCache.get(n.id);
      if(prevKey!==displayKey){
        applyNarrativeRowCells(rowEl,n,prevKey?JSON.parse(prevKey):null,displayState);
        narrDisplayCache.set(n.id,displayKey);
        cellUpdates++;}}}
  if(added||removed||sortKeysChanged){
    const before=narrDomOrder.join(',');
    reconcileNarrativeOrder(desiredIds,el);
    narrDomOrder=[...desiredIds];
    reordered=before!==narrDomOrder.join(',');
    if(!narrTableInitialized&&narrRowDom.size){
      narrTableInitialized=true;
      if(!opts.quiet)console.log(`[live] narr table initial build: ${narrRowDom.size} rows (${reason})`);}}
  scrollEl.scrollTop=scrollTop;
  const c=$('#narrCount');if(c)c.textContent=desiredIds.length;
  updateNarrSortArrows();
  const changed=added||removed||cellUpdates||reordered;
  if(changed&&!opts.quiet){
    const parts=[];
    if(added)parts.push(`+${added}`);
    if(removed)parts.push(`-${removed}`);
    if(cellUpdates)parts.push(`~${cellUpdates} cells`);
    if(reordered)parts.push('reordered');
    console.log(`[live] narr table update (${reason}): ${parts.join(', ')}`);}
  return{changed,added,removed,cellUpdates,reordered};}
window.syncNarrativesTable=syncNarrativesTable;
function getNarrativeSourceList(){return NARRATIVES;}
window.NARRATIVES_ALL=[];
window.getNarrativeSourceList=getNarrativeSourceList;
function isNarrativePinned(id){return pinnedNarrativeIds.some(p=>p.id===id&&p.until>Date.now());}
function pinNarrative(id,ms=300000){
  pinnedNarrativeIds=pinnedNarrativeIds.filter(p=>p.id!==id);
  pinnedNarrativeIds.unshift({id,until:Date.now()+ms});}
function playNarrArrivalSound(){
  if(!narrSoundOn)return;
  try{
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    const o=ctx.createOscillator();const g=ctx.createGain();
    o.type='sine';o.frequency.value=880;o.connect(g);g.connect(ctx.destination);
    g.gain.setValueAtTime(0.07,ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.4);
    o.start(ctx.currentTime);o.stop(ctx.currentTime+0.42);
    const o2=ctx.createOscillator();const g2=ctx.createGain();
    o2.type='sine';o2.frequency.value=1175;o2.connect(g2);g2.connect(ctx.destination);
    g2.gain.setValueAtTime(0.05,ctx.currentTime+0.12);
    g2.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.55);
    o2.start(ctx.currentTime+0.12);o2.stop(ctx.currentTime+0.55);
  }catch(e){}}
function bumpNarrNewBadge(){}
function clearNarrNewBadge(){}
function syncNarrSoundToggle(){
  const btn=$('#narrSoundToggle');if(!btn)return;
  btn.classList.toggle('on',narrSoundOn);
  btn.setAttribute('aria-pressed',narrSoundOn?'true':'false');
  btn.title=narrSoundOn?'Alert sound on — new narratives':'Alert sound off';}
function tickMetricCell(cell,prevVal,newVal,render){
  if(!cell||prevVal===newVal)return;
  const valEl=cell.querySelector('.nm-val')||cell;
  valEl.textContent=render(newVal);
  cell.classList.remove('nm-tick-up','nm-tick-down');
  void cell.offsetWidth;
  cell.classList.add(newVal>(prevVal??0)?'nm-tick-up':'nm-tick-down');
  setTimeout(()=>cell.classList.remove('nm-tick-up','nm-tick-down'),900);}
function patchNarrativeRow(n){
  return syncNarrativesTable({ids:[n.id],reason:'cell patch',quiet:true})?.changed;}
window.patchNarrativeRow=patchNarrativeRow;
window.onNarrativeArrival=function(id){
  pinNarrative(id);
  if(window.InsidorLive?.flashNarrativeRows)InsidorLive.flashNarrativeRows(id);
  else document.querySelectorAll(`[data-narrative="${CSS.escape(id)}"]`).forEach(el=>{
    el.classList.remove('narr-flash');void el.offsetWidth;el.classList.add('narr-flash');});
  bumpNarrNewBadge();
  playNarrArrivalSound();
  if(window.InsidorLive?.pulseLiveIndicator)InsidorLive.pulseLiveIndicator();
  syncNarrativesTable({ids:[id],reason:'narrative arrival',forceReorder:true});};
function sortNarratives(list){const a=[...list];
  if(narrSort.key){const k=narrSort.key,d=narrSort.dir;
    a.sort((x,y)=>{let xv,yv;
      if(k==='views'){xv=narrCombinedViews(x);yv=narrCombinedViews(y);}
      else if(k==='gain'){xv=narrViralGain24h(x);yv=narrViralGain24h(y);}
      else if(k==='mcap'){xv=(narrTopToken(x)||{mcap:0}).mcap;yv=(narrTopToken(y)||{mcap:0}).mcap;}
      else if(k==='age'){xv=narrOldestAt(x);yv=narrOldestAt(y);return(xv-yv)*d;}
      return((xv??0)-(yv??0))*d;});
  }else if(narrChipSort==='new')a.sort((x,y)=>narrOldestAt(y)-narrOldestAt(x));
  else a.sort((x,y)=>{
    const av=narrAuthorVelocity(y)-narrAuthorVelocity(x);
    if(av!==0)return av;
    return narrViewsVelocity(y)-narrViewsVelocity(x);
  });
  const now=Date.now();
  const pinOrder=pinnedNarrativeIds.filter(p=>p.until>now).map(p=>p.id);
  if(!pinOrder.length)return a;
  const pinSet=new Set(pinOrder);
  const pinned=pinOrder.map(id=>a.find(x=>x.id===id)).filter(Boolean);
  return[...pinned,...a.filter(x=>!pinSet.has(x.id))];}
function updateNarrSortArrows(){$$('#nthd .sortable').forEach(s=>{const on=narrSort.key===s.dataset.ncol;
  s.classList.toggle('on',on);const i=s.querySelector('.sar');if(i)i.textContent=on?(narrSort.dir<0?' ▼':' ▲'):'';});}
function narrRow(n){const top=narrTopToken(n),views=narrCombinedViews(n),gain=narrViralGain24h(n),vv=narrViewsVelocity(n);
  const gainCls=gain>=150000?'up':'down';
  const mcapCell=narrMcapCell(n);
  const pinned=isNarrativePinned(n.id);
  const pinBadge=pinned?'<span class="narr-new-pin">NEW</span>':'';
  return`<div class="ntk${pinned?' narr-pinned':''}" data-narrative="${n.id}">
    <div class="nar-cell"><span class="nar-thumb">${narrThumb(n,80)}</span>
      <div class="nar-meta"><div class="nar-title-line"><div class="nar-title">${n.title}</div>${pinBadge}${starNarr(n.id)}</div><div class="nar-blurb">${n.blurb}</div>
        <div class="nar-row-meta">${narrPlatLogos(n)}</div></div></div>
    ${narrPulseCell(n)}
    <div class="nm-col" data-metric="views"><span class="nm-val">${fmtCount(views)}</span><span class="nm-vv" data-metric="vv">${vv>0?fmtCount(Math.round(vv))+'/min':''}</span></div>
    <div class="nm-col" data-metric="gain"><span class="nm-gain ${gainCls}">+${fmtCount(gain)}</span></div>
    <div class="nm-col">${mcapCell}</div>
    <div class="nm-col">${narrAgeLabel(n)}</div></div>`;}
function setNarrativesLoading(msg='Loading narratives…'){
  const el=$('#narrRows');
  if(el){resetNarrativesTableState();el.innerHTML=`<div class="noresult narr-loading">${msg}</div>`;}
  const tn=$('#trendNarr');if(tn)tn.innerHTML=`<div class="noresult narr-loading">${msg}</div>`;
  const c=$('#narrCount');if(c)c.textContent='…';
}
window.setNarrativesLoading=setNarrativesLoading;
function renderNarratives(opts){
  const o=typeof opts==='object'&&opts?opts:{};
  if(o.forceReorder==null&&typeof opts!=='object')o.forceReorder=!!opts;
  syncNarrativesTable({reason:o.reason||'renderNarratives',forceReorder:!!o.forceReorder});}
function openDeployFromPostText(txt){openDeployFromViralPost({txt:txt||''});}
function openDeployFromViralPost(p){
  const body=(p?.txt||'').trim();
  if(!body&&!p)return;
  const plat=p.plat||'x';
  const badge=p.badge||PLATNAME[plat]||'X';
  const who=p.who||'user';
  const at=p.at||('@'+who);
  const pal=p.pal||((pseed(body||'')%6)+1);
  const tks=extractTickers(body);
  const primary=tks[0]||deriveTicker(body||'MEME');
  const nameDef=titlecase(primary);
  const alts=tks.length?tks:[primary];
  deployIdx=-1;deployBuy=0.5;
  deployCluster={title:body.slice(0,40),narrIdx:-1};
  const thumbHtml=p.mediaUrl?postMediaImg(p,160):imgTag('meme',pseed(body||''),160);
  const root=ensureModalRoot();
  root.innerHTML=`
   <div class="dback" id="dback">
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sh-top">
        <span class="pbadge ${plat}" title="${badge}">${plogo(plat)}</span>
        <div class="sh-kick"><div class="sh-t">Create a coin</div><div class="sh-s">from viral post · simulated</div></div>
        <button class="sh-x" id="dclose" aria-label="Close">✕</button>
      </div>
      <div class="sh-body">
        <div class="src-quote"><span class="qthumb ph" style="${palStyle(pal)}">${thumbHtml}</span>
          <div><div class="src-who">${escHtml(who)}<span>${escHtml(at)}</span></div><p class="src-txt">${escHtml(body)}</p></div></div>
        <div class="name-grid">
          <div class="fl"><label>Coin name</label><input id="dname" value="${nameDef}" maxlength="28"></div>
          <div class="fl"><label>Ticker</label><div class="tickin"><span>$</span><input id="dtick" value="${primary}" maxlength="10"></div></div>
        </div>
        <div class="coll" id="dcoll"></div>
        ${alts.length>1?`<div class="alts"><span class="alts-l">also spiking:</span>${alts.map(a=>`<button class="achip" data-alt="${a}">$${a}</button>`).join('')}</div>`:''}
        <div class="fl"><label>Your first buy</label>
          <div class="buychips" id="dbuychips">${[0,0.5,1,2].map(v=>`<button class="bchip${v===0.5?' on':''}" data-buy2="${v}">${v===0?'None':v+' SOL'}</button>`).join('')}</div></div>
        <div class="split">
          <div class="split-row"><span>Your fee share (creator)</span><b>3.0%</b></div>
          <div class="split-bar"><i style="width:60%"></i><u style="width:20%"></u></div>
          <div class="split-note">You earn <b style="color:var(--lime)">3%</b> of every trade as the deployer · Insidor takes 1% · the bonding curve seeds liquidity automatically.</div>
        </div>
      </div>
      <div class="sh-foot">
        <div class="cost"><span>Cost to launch</span><b id="dcost">~1.02 SOL</b></div>
        <button class="deploy-go" id="dgo">Create $<span id="dgotick">${primary}</span></button>
      </div>
    </div>
   </div>`;
  const recheck=()=>{const tv=($('#dtick').value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    $('#dtick').value=tv;$('#dgotick').textContent=tv||'—';
    const hit=registryLiveToken(tv)||narrativeLiveCoin(tv),pend=PENDING[tv],c=$('#dcoll');
    if(!tv){c.className='coll';c.textContent='Enter a ticker for your coin.';return;}
    if(hit){const nm=hit.name||hit.ticker;c.className='coll taken';c.innerHTML=`⚠ <b>$${tv}</b> already exists (${nm}). <a href="#" id="cfind">Trade it instead →</a>`;
      const a=$('#cfind');if(a)a.onclick=e=>{e.preventDefault();closeDeploy();openToken(tv);};}
    else if(pend){c.className='coll taken';c.innerHTML=`⚡ <b>$${tv}</b> is claimed by a pending narrative but not deployed yet — you can still be first.`;}
    else{c.className='coll free';c.innerHTML=`✓ <b>$${tv}</b> is free on Solana — you'd be first to deploy it.`;}};
  $('#dtick').oninput=recheck;
  root.querySelectorAll('[data-alt]').forEach(b=>b.onclick=()=>{$('#dtick').value=b.dataset.alt;recheck();});
  recheck();
  $('#dbuychips').onclick=e=>{const b=e.target.closest('[data-buy2]');if(!b)return;deployBuy=+b.dataset.buy2;
    root.querySelectorAll('#dbuychips .bchip').forEach(x=>x.classList.remove('on'));b.classList.add('on');
    $('#dcost').textContent='~'+(0.52+deployBuy).toFixed(2)+' SOL';};
  $('#dclose').onclick=closeDeploy;
  $('#dback').onclick=e=>{if(e.target.id==='dback')closeDeploy();};
  $('#dgo').onclick=deployFiled;
  document.body.style.overflow='hidden';
  setTimeout(()=>$('#dtick')&&$('#dtick').focus(),40);}
function escHtml(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function findFromNarrative(id,fallbackTxt){
  return ensureNarrative(id).then(nar=>{
    if(!nar){findFromPostText(fallbackTxt);return;}
    const tok=narrDeployedToken(nar);
    if(tok?.mint){const t=materializeNarrToken(tok,nar);if(t){openToken(t.sym);return;}}
    let tks=(nar.tokens||[]).filter(tokenHasLiquidity).map(t=>t.ticker);
    if(!tks.length)tks=[deriveTicker(nar.title)];
    activeTickers=tks;activePostIdx=nar.narrIdx>=0?nar.narrIdx:-1;
    renderTokens();go('tokens');
  });}
function openDeployForNarrative(id,fallbackTxt,fallbackPost){
  return ensureNarrative(id).then(nar=>{
    if(!nar){
      if(fallbackPost)openDeployFromViralPost(fallbackPost);
      else if(fallbackTxt)openDeployFromViralPost({txt:fallbackTxt});
      return;}
    if(nar.narrIdx>=0){openDeploy(nar.narrIdx);return;}
    deployIdx=-1;deployBuy=0.5;deployCluster=nar;
  const top=narrTopPost(nar),tick=deriveTicker(nar.title),name=titlecase(tick),pal=(nar.imgSeed%6)+1;
  const root=ensureModalRoot();
  root.innerHTML=`<div class="dback" id="dback"><div class="sheet" role="dialog" aria-modal="true">
    <div class="sh-top"><span class="pbadge ${top.platform}" title="${PLATNAME[top.platform]}">${plogo(top.platform)}</span>
      <div class="sh-kick"><div class="sh-t">Create a coin</div><div class="sh-s">from narrative cluster · simulated</div></div>
      <button class="sh-x" id="dclose" aria-label="Close">✕</button></div>
    <div class="sh-body">
      <div class="src-quote"><span class="qthumb ph" style="${palStyle(pal)}">${narrThumb(nar,160)}</span>
        <div><div class="src-who">${nar.title}<span>${top.handle}</span></div><p class="src-txt">${top.text}</p></div></div>
      <div class="name-grid"><div class="fl"><label>Coin name</label><input id="dname" value="${name}" maxlength="28"></div>
        <div class="fl"><label>Ticker</label><div class="tickin"><span>$</span><input id="dtick" value="${tick}" maxlength="10"></div></div></div>
      <div class="coll" id="dcoll"></div>
      <div class="fl"><label>Your first buy</label><div class="buychips" id="dbuychips">${[0,0.5,1,2].map(v=>`<button class="bchip${v===0.5?' on':''}" data-buy2="${v}">${v===0?'None':v+' SOL'}</button>`).join('')}</div></div>
    </div>
    <div class="sh-foot"><div class="cost"><span>Cost to launch</span><b id="dcost">~1.02 SOL</b></div>
      <button class="deploy-go" id="dgo">Create $<span id="dgotick">${tick}</span></button></div></div></div>`;
  deployIdx=nar.narrIdx; // may be -1 — deployFiled uses NARR[deployIdx] only if valid
  const recheck=()=>{const tv=($('#dtick').value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    $('#dtick').value=tv;$('#dgotick').textContent=tv||'—';
    const hit=registryLiveToken(tv)||narrativeLiveCoin(tv),c=$('#dcoll');
    if(!tv){c.className='coll';c.textContent='Enter a ticker for your coin.';return;}
    if(hit){const nm=hit.name||hit.ticker;c.className='coll taken';c.innerHTML=`⚠ <b>$${tv}</b> already exists.`;}
    else{c.className='coll free';c.innerHTML='✓ <b>$'+tv+'</b> is free — you would be first.';}};
  $('#dtick').oninput=recheck;recheck();
  $('#dbuychips').onclick=e=>{const b=e.target.closest('[data-buy2]');if(!b)return;deployBuy=+b.dataset.buy2;
    root.querySelectorAll('#dbuychips .bchip').forEach(x=>x.classList.remove('on'));b.classList.add('on');
    $('#dcost').textContent='~'+(0.52+deployBuy).toFixed(2)+' SOL';};
  $('#dclose').onclick=closeDeploy;$('#dback').onclick=e=>{if(e.target.id==='dback')closeDeploy();};
  $('#dgo').onclick=()=>{deployCluster=nar;deployFiled();};
  document.body.style.overflow='hidden';
  });}
function openNarrative(id){
  if(palOpen())closePalette();
  const nar=getNarrative(id);
  if(nar){renderNarrativeModal(nar);return;}
  void ensureNarrative(id).then(n=>{if(n)renderNarrativeModal(n);});}
function renderNarrativeModal(nar){
  if(!nar)return;
  const id=nar.id;
  const top=narrTopPost(nar),topTok=narrDeployedToken(nar),views=narrCombinedViews(nar);
  const reposts=narrCombinedReposts(nar),likes=narrCombinedLikes(nar),about=narrAboutText(nar);
  const root=ensureModalRoot();
  const postTxt=top.text.length>100?top.text.slice(0,98)+'…':top.text;
  const coinBlock=topTok&&topTok.mint?`<div class="nm-coin-mini">
      <div class="nm-coin-l"><div class="nm-coin-mini-lbl">Top token</div><div class="nm-coin-tick">$${topTok.ticker}</div></div>
      <div class="nm-coin-r">
        <div class="nm-coin-stat"><span>Mcap</span><b>${fmtUSD(topTok.mcap||0)}</b></div>
        <div class="nm-coin-stat"><span>Age</span><b>${age(topTok.ageMin||1)}</b></div>
      </div></div>`
    :`<div class="nm-coin-mini empty"><div class="nm-coin-l"><div class="nm-coin-mini-lbl">Top token</div><div class="nm-coin-empty">No coin deployed yet</div></div></div>`;
  const footBtn=topTok&&topTok.mint?`<button class="deploy-go" id="nmbuy" type="button">Buy $${topTok.ticker}</button>`
    :`<button class="deploy-go" id="nmdeployFoot" type="button">Create coin</button>`;
  root.innerHTML=`<div class="dback" id="nmbback"><div class="sheet pd-sheet nm-sheet" role="dialog" aria-modal="true">
    <div class="sh-top"><div class="sh-kick"><div class="sh-t">Narrative</div></div>
      <button class="tbtn-watch ${WATCH_NARR.has(id)?'on':''}" id="nmwatch" type="button">${WATCH_NARR.has(id)?'★ Watching':'☆ Watch'}</button>
      <button class="sh-x" id="nmclose" aria-label="Close">✕</button></div>
    <div class="sh-body"><div class="nm-prem">
      <h2 class="nm-title">${nar.title}</h2>
      <a class="nm-post-link" href="${postURL(top)}" target="_blank" rel="noopener noreferrer">
        <div class="nm-post-card">
          <div class="nm-post-img">${postPreviewImg(nar,top)}</div>
          <div class="nm-post-body">
            <div class="nm-post-plat"><span class="pbadge ${top.platform}" title="${PLATNAME[top.platform]}">${plogo(top.platform)}</span>${PLATNAME[top.platform]||top.platform} · ${top.handle}</div>
            <p class="nm-post-txt">${postTxt}</p>
            <div class="nm-post-views">${fmtCount(top.views)} views · open post ↗</div>
          </div>
        </div>
      </a>
      <div class="nm-cluster">
        <div class="nm-viral-words">${narrViralWords(nar)}</div>
        <div class="nm-total-metrics">
          <div class="nm-metric"><b>${fmtCount(views)}</b><span>Views</span></div>
          <div class="nm-metric"><b>${fmtCount(reposts)}</b><span>Reposts</span></div>
          <div class="nm-metric"><b>${fmtCount(likes)}</b><span>Likes</span></div>
          <div class="nm-metric"><b>${narrAgeLabel(nar)}</b><span>Age</span></div>
        </div>
      </div>
      <div class="nm-about"><p class="nm-about-1">${about.line1}</p><p class="nm-about-2">${about.line2}</p></div>
      <div class="nm-bottom">
        ${narrGoogleTrendHTML(nar)}
        ${coinBlock}
      </div>
    </div></div>
    <div class="sh-foot nm-foot-buy">${footBtn}</div></div></div>`;
  document.body.style.overflow='hidden';
  $('#nmclose').onclick=closeDeploy;$('#nmbback').onclick=e=>{if(e.target.id==='nmbback')closeDeploy();};
  const nw=$('#nmwatch');if(nw)nw.onclick=()=>{toggleWatchNarr(id);const on=WATCH_NARR.has(id);
    nw.classList.toggle('on',on);nw.textContent=on?'★ Watching':'☆ Watch';};
  const df=$('#nmdeployFoot');if(df)df.onclick=()=>{closeDeploy();openDeployForNarrative(id);};
  const buy=$('#nmbuy');if(buy)buy.onclick=()=>{closeDeploy();const t=resolveToken(topTok.mint)||resolveToken(topTok.ticker);if(t)openToken(t.sym);};
  const liveTok=topTok?resolveToken(topTok.mint)||resolveToken(topTok.ticker):null;
  if(liveTok?.ca&&window.InsidorLive?.lazyEnrich)InsidorLive.lazyEnrich(liveTok.ca);}

/* ---- viral post detail: hover/click a post image for full narrative + metrics ---- */
const MEDIANAME={photo:'Photo',video:'Video',link:'Link',reply:'Reply',none:'Text'};
function openPostDetail(idx){const n=NARR[idx];if(!n)return;const tks=extractTickers(n.txt);const root=ensureModalRoot();
  const mets=postMetrics(n).map(([k,v])=>`<div class="pd-stat"><span class="pdv">${fmtCount(v)}</span><span class="pdk">${k}</span></div>`).join('');
  root.innerHTML=`<div class="dback" id="pdback"><div class="sheet pd-sheet" role="dialog" aria-modal="true">
    <div class="sh-top">
      <span class="pbadge ${n.plat}" title="${n.badge}">${plogo(n.plat)}</span>
      <div class="sh-kick"><div class="sh-t">${n.who} <span class="pd-at">${n.at}</span></div>
        <div class="sh-s">${PLATNAME[n.plat]||n.badge} · ${MEDIANAME[n.media]||'Post'} · flagged ${n.lead} before CT</div></div>
      <button class="sh-x" id="pdclose" aria-label="Close">✕</button>
    </div>
    <div class="sh-body">
      <div class="pd-media" style="${palStyle(n.pal)}">${memeThumb(idx)}</div>
      <p class="pd-text">${n.txt}</p>
      <div class="pd-stats">${mets}
        <div class="pd-stat"><span class="pdv">${n.posts}</span><span class="pdk">posts</span></div>
        <div class="pd-stat"><span class="pdv">${n.accts}</span><span class="pdk">accounts</span></div>
        <div class="pd-stat"><span class="pdv">${n.peak}</span><span class="pdk">peak</span></div>
        <div class="pd-stat"><span class="pdv">${n.vel}</span><span class="pdk">velocity</span></div>
      </div>
      <div class="pd-tickers"><span class="pd-l">${tks.length?'Tickers in this post':'No coin yet — you could be first'}</span>${tks.length?`<div class="pd-chips">${tks.map(a=>`<span class="achip">$${a}</span>`).join('')}</div>`:''}</div>
    </div>
    <div class="sh-foot">
      <button class="deploy-go" id="pdcreate">Create Coin</button>
      <button class="sh-x2" id="pdsearch">${tks.length?`Search ${tks.length}`:'Search'}</button>
    </div>
  </div></div>`;
  document.body.style.overflow='hidden';
  $('#pdclose').onclick=closeDeploy;$('#pdback').onclick=e=>{if(e.target.id==='pdback')closeDeploy();};
  $('#pdcreate').onclick=()=>{closeDeploy();openDeploy(idx);};
  $('#pdsearch').onclick=()=>{closeDeploy();findFromPost(idx);};
}

/* ============ LIVE ACTIVITY RAIL (Trades · Launches · Viral) ============ */
const FEED_PLATS=['x','tt'];
var railMode='viral';
var streamPool=[];
var tapePool=[];
window.VIRAL_STREAM=[];
function streamLiveCard(p,animate=false){
  const nar=p.narrativeId?getNarrative(p.narrativeId):null;
  const chip=SRCLABEL[p.media];
  const url=postURL({platform:p.plat,handle:p.at,platformPostId:p.platformPostId,text:p.txt});
  const metrics=postMetrics({plat:p.plat,views:p.rawViews,rawViews:p.rawViews,txt:p.txt,who:p.who,
    replies:p.replies,quotes:p.quotes,retweets:p.retweets,likes:p.likes});
  const thumb=p.mediaUrl?postMediaImg(p,48):(nar?narrThumb(nar,48):imgTag('meme',pseed(p.txt||''),48));
  const narrAttr=p.narrativeId?` data-narrative="${p.narrativeId}"`:'';
  const postAttr=p.postId?` data-post-id="${p.postId}"`:'';
  const enterCls=animate?' note-enter':'';
  const deployBtn=p.narrativeId
    ?`<button class="pbtn deploy" data-deploy-narr="${p.narrativeId}" type="button">Create Coin</button>`
    :`<button class="pbtn deploy" data-deploy-post="${p.postId||''}" type="button">Create Coin</button>`;
  const findBtn=p.narrativeId
    ?`<button class="pbtn find" data-find-narr="${p.narrativeId}" type="button">Search</button>`
    :`<button class="pbtn find" data-find-post="" type="button">Search</button>`;
  const postedMs=toMs(p.postedAt);
  const ageLbl=postedMs?timeAgo(postedMs):'';
  const leadBadges=[];
  if(ageLbl)leadBadges.push(`<span class="lead lead-age" title="Posted on platform">${ageLbl} ago</span>`);
  const leadRow=leadBadges.length?`<div class="note-leads">${leadBadges.join('')}</div>`:'';
  return`<div class="note${enterCls}"${narrAttr}${postAttr} data-post-txt="${escAttr(p.txt||'')}">
    <div class="note-card">
      <div class="note-top">
        <span class="pbadge ${p.plat}" title="${p.badge}">${plogo(p.plat)}</span>
        <div class="note-id"><span class="who">${p.who}</span><span class="at">${p.at}</span></div>
        ${leadRow}
      </div>
      <div class="note-mid">
        <span class="qthumb ph" title="View post stats" style="${palStyle(p.pal)}">${thumb}${chip?`<span class="srcchip-mini">${chip}</span>`:''}</span>
        <p class="note-text">${p.txt}</p>
      </div>
      <div class="note-foot">
        <div class="qmeta">${metrics.map(([k,v])=>`<span>${k} <b data-post-metric="${k}" data-metric-val="${v}">${fmtCount(v)}</b></span>`).join('')}</div>
        <div class="note-acts">${deployBtn}${findBtn}</div>
      </div>
    </div>
  </div>`;
}
function rebuildStreamFromNarratives(){
  if(!isL3()||typeof NARRATIVES==='undefined'||!NARRATIVES.length)return 0;
  if(window._viralStreamReady){
    if(railMode==='viral')renderStream();
    return(window.VIRAL_STREAM||[]).length;}
  const items=[];
  for(const n of NARRATIVES){
    for(const p of n.posts||[]){
      if(!FEED_PLATS.includes(p.platform))continue;
      const posted=toMs(p.postedAt);
      const maxAge=(p.platform==='tt'?(window.VIRAL_FEED_MAX_AGE_MS_TT||86400000):(window.VIRAL_FEED_MAX_AGE_MS_X||86400000));
      if(!posted||posted<Date.now()-maxAge)continue;
      const leadMin=n.leadTimeMin!=null?n.leadTimeMin:Math.max(1,Math.round((Date.now()-posted)/60000));
      items.push({
        live:true,
        narrativeId:n.id,
        plat:p.platform,
        badge:PLATNAME[p.platform]||p.platform,
        txt:p.text,
        rawViews:p.views||0,
        replies:p.replies,
        quotes:p.quotes,
        retweets:p.retweets,
        likes:p.likes,
        who:(p.handle||'').replace(/^@/,''),
        at:p.handle||'@user',
        lead:'+'+leadMin+'m'+(n.leadTimeMin!=null?' early':''),
        pal:((n.imgSeed??pseed(n.id))%6)+1,
        media:p.mediaType==='video'||p.mediaType==='gif'?'video':(p.mediaUrl||p.image?'photo':'none'),
        mediaUrl:p.mediaUrl||null,
        mediaType:p.mediaType||null,
        platformPostId:p.platformPostId,
        postedAt:posted,
      });
    }
  }
  items.sort((a,b)=>(b.postedAt||0)-(a.postedAt||0));
  if(!items.length)return 0;
  streamPool=items.slice(0,14);
  if(railMode==='viral')renderStream();
  return streamPool.length;
}
window.rebuildStreamFromNarratives=rebuildStreamFromNarratives;
const viralAnnounceAt=new Map();
const viralAnnouncedEver=new Set();
function persistViralAnnounced(postId){
  if(!postId)return;
  viralAnnouncedEver.add(postId);}
window.markViralInventorySeen=function(items){
  (items||[]).forEach(p=>{if(p?.postId)persistViralAnnounced(p.postId);});};
const viralAnnounceQueue=[];
const viralAnnounceQueued=new Set();
let viralAnnounceDraining=false;
const VIRAL_ANNOUNCE_GAP_MS=1800;
window.updateViralFeedStatus=function(){
  const el=$('#streamStatus');if(!el||!isL3())return;
  const pool=window.VIRAL_STREAM||[];
  const n=pool.length;
  el.textContent=n?`${Math.min(n,24)} live`:'0 live';
  el.title=n?`${n} recent viral posts`:'No posts in the last 24h';
  el.classList.toggle('hot',n>=1);
};
window.renderViralStream=function(opts={}){
  if(railMode!=='viral')return;
  const box=$('#stream'),title=$('#railTitle'),cnt=$('#streamCount');
  if(!box)return;
  if(title)title.textContent='Live viral feed';
  const pool=window.VIRAL_STREAM||[];
  if(isL3()&&!window._viralStreamReady){
    box.innerHTML='<div class="noresult narr-loading">Loading live feed…</div>';
    if(cnt)cnt.textContent='…';
    return;}
  if(!opts.full&&pool.length>0&&box.querySelector('[data-post-id]')){
    if(cnt)cnt.textContent=pool.length?`${Math.min(pool.length,24)} live`:'0 live';
    if(typeof window.updateViralFeedStatus==='function')window.updateViralFeedStatus();
    return;}
  const sorted=pool.slice().sort((a,b)=>(b.postedAt||0)-(a.postedAt||0));
  const visible=sorted.slice(0,24);
  box.innerHTML=visible.map(p=>streamLiveCard(p,false)).join('')||
    '<div class="noresult">No recent viral posts.<br><span style="color:var(--dim);font-size:12px">New ingests slide in here in real time.</span></div>';
  if(cnt)cnt.textContent=pool.length?`${Math.min(pool.length,24)} live`:'0 live';
  if(typeof window.updateViralFeedStatus==='function')window.updateViralFeedStatus();};
window.insertViralPostSilent=function(p){
  if(railMode!=='viral'||!p?.postId)return;
  if(typeof window.isViralIngestAlert==='function'&&!window.isViralIngestAlert(p))return;
  const box=$('#stream');if(!box||box.querySelector('.narr-loading'))return;
  if(box.querySelector(`[data-post-id="${CSS.escape(p.postId)}"]`))return;
  persistViralAnnounced(p.postId);
  const html=streamLiveCard(p,false);
  const posted=toMs(p.postedAt)||0;
  const siblings=[...box.querySelectorAll('.note[data-post-id]')];
  let placed=false;
  for(const el of siblings){
    const peer=(window.VIRAL_STREAM||[]).find(x=>x.postId===el.dataset.postId);
    const peerPosted=toMs(peer?.postedAt)||0;
    if(posted>peerPosted){
      el.insertAdjacentHTML('beforebegin',html);
      placed=true;
      break;
    }
  }
  if(!placed)box.insertAdjacentHTML('beforeend',html);
  trimViralStreamDOM(24);
  const cnt=$('#streamCount');if(cnt)cnt.textContent=`${Math.min((window.VIRAL_STREAM||[]).length,24)} live`;};
window.prependViralPostCard=function(p){
  if(railMode!=='viral'||!p?.postId)return;
  if(viralAnnouncedEver.has(p.postId))return;
  const box=$('#stream');if(!box||box.querySelector('.narr-loading'))return;
  if(box.querySelector(`[data-post-id="${CSS.escape(p.postId)}"]`))return;
  persistViralAnnounced(p.postId);
  box.insertAdjacentHTML('afterbegin',streamLiveCard(p,true));
  trimViralStreamDOM(24);
  const cnt=$('#streamCount');if(cnt)cnt.textContent=`${Math.min((window.VIRAL_STREAM||[]).length,24)} live`;};
window.removeViralPostCard=function(postId){
  if(!postId)return;
  document.querySelector(`.note[data-post-id="${CSS.escape(postId)}"]`)?.remove();};
window.trimViralStreamDOM=function(max=24){
  const box=$('#stream');if(!box)return;
  while(box.querySelectorAll('.note[data-post-id]').length>max&&box.lastElementChild){
    box.removeChild(box.lastElementChild);}};
window.unmarkViralAnnounced=function(postId){
  if(!postId)return;
  viralAnnouncedEver.delete(postId);
  viralAnnounceAt.delete(postId);
  viralAnnounceQueued.delete(postId);};
function performViralPostAnnounce(p){
  if(railMode!=='viral')setRail('viral');
  if(!p?.postId||viralAnnouncedEver.has(p.postId))return;
  const box=$('#stream');
  if(!box||box.querySelector('.narr-loading'))return;
  if(box.querySelector(`[data-post-id="${CSS.escape(p.postId)}"]`)){
    persistViralAnnounced(p.postId);
    return;
  }
  persistViralAnnounced(p.postId);
  box.insertAdjacentHTML('afterbegin',streamLiveCard(p,true));
  trimViralStreamDOM(24);
  const cnt=$('#streamCount');if(cnt)cnt.textContent=`${Math.min((window.VIRAL_STREAM||[]).length,24)} live`;
  if(typeof window.updateViralFeedStatus==='function')window.updateViralFeedStatus();
}
function drainViralAnnounceQueue(){
  if(viralAnnounceDraining||!viralAnnounceQueue.length)return;
  viralAnnounceDraining=true;
  const p=viralAnnounceQueue.shift();
  if(p?.postId)viralAnnounceQueued.delete(p.postId);
  if(p?.postId){
    viralAnnounceAt.set(p.postId,Date.now());
    performViralPostAnnounce(p);
  }
  setTimeout(()=>{
    viralAnnounceDraining=false;
    drainViralAnnounceQueue();
  },VIRAL_ANNOUNCE_GAP_MS);
}
window.announceViralPost=function(p){
  if(!p?.postId||!window._viralStreamReady||!window._pageLiveReady)return;
  if(typeof window.isViralIngestAlert==='function'&&!window.isViralIngestAlert(p))return;
  if(viralAnnouncedEver.has(p.postId)||viralAnnounceQueued.has(p.postId))return;
  viralAnnounceQueued.add(p.postId);
  viralAnnounceQueue.push(p);
  if(!viralAnnounceDraining)drainViralAnnounceQueue();
};
window.patchViralPostCard=function(postId,views,item){
  const el=document.querySelector(`.note[data-post-id="${CSS.escape(postId)}"]`);
  if(!el)return false;
  const readMetricVal=function(b){
    if(!b)return 0;
    const raw=b.dataset.metricVal;
    if(raw!=null&&raw!==''){const n=Number(raw);if(Number.isFinite(n))return n;}
    return parseCount(b.textContent);};
  const writeMetricVal=function(b,v){
    b.dataset.metricVal=String(v);
    b.textContent=fmtCount(v);};
  if(item){
    const metrics=postMetrics({plat:item.plat,views:item.rawViews,rawViews:item.rawViews,txt:item.txt,
      replies:item.replies,quotes:item.quotes,retweets:item.retweets,likes:item.likes});
    let changed=false;
    for(const [k,v] of metrics){
      const b=el.querySelector(`[data-post-metric="${k}"]`);
      if(!b)continue;
      const prev=readMetricVal(b);
      if(v<prev)continue;
      if(v===prev)continue;
      writeMetricVal(b,v);
      changed=true;
    }
    return changed;}
  const b=el.querySelector('[data-post-metric="views"]');
  if(!b)return false;
  const prev=readMetricVal(b);
  if(views<prev)return true;
  if(views===prev)return true;
  writeMetricVal(b,views);
  return true;};
function streamCard(n){
  const tks=extractTickers(n.txt);
  const idx=NARR.findIndex(x=>x.txt===n.txt);
  const chip=SRCLABEL[n.media];
  const thumbMedia=n.media==='video'
    ? '<span class="play-mini"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>'
    : '';
  const find=`<button class="pbtn find" data-find="${idx}">Search</button>`;
  return`<div class="note" data-posttxt="${encodeURIComponent(n.txt)}">
    <div class="note-card">
      <div class="note-top">
        <span class="pbadge ${n.plat}" title="${n.badge}">${plogo(n.plat)}</span>
        <div class="note-id"><span class="who">${n.who}</span><span class="at">${n.at}</span></div>
      </div>
      <div class="note-mid">
        <span class="qthumb ph" data-post-detail="${idx}" title="View post detail" style="${palStyle(n.pal)}">${memeThumb(idx)}${thumbMedia}${chip?`<span class="srcchip-mini">${chip}</span>`:''}</span>
        <p class="note-text">${n.txt}</p>
      </div>
      <div class="note-foot">
        <div class="qmeta">${qmetaHTML(n)}</div>
        <div class="note-acts"><button class="pbtn deploy" data-deploy="${idx}">Create Coin</button>${find}</div>
      </div>
    </div>
  </div>`;
}
/* --- Trades tape --- */
function genTape(){if(!TOKENS.length)return null;const t=TOKENS[Math.floor(Math.random()*TOKENS.length)];const buy=Math.random()>0.45;
  const sol=+(Math.random()*6+0.05).toFixed(2);return{sym:t.sym,buy,sol,t:Date.now(),fresh:!!t.justDeployed};}
function tapeCard(x){const col=SYMCOLOR[x.sym]||'#3DE0FF',tk=TOKENS.find(z=>z.sym===x.sym);
  return`<div class="tape-row" data-token="${x.sym}">
    <div class="tape-ic" style="background:${col}">${x.sym[0]}${tk?tkLogo(tk):''}</div>
    <div class="tape-mid"><div class="tape-sym">$${x.sym}${x.fresh?'<span class="tape-tag">NEW</span>':''}</div>
      <div class="tape-act ${x.buy?'b':'s'}">${x.buy?'Bought':'Sold'} ${x.sol} SOL</div></div>
    <div class="tape-r"><div class="tape-sol">${(x.sol*solSpot()).toFixed(0)} $</div><div class="tape-t">${timeAgo(x.t)}</div></div>
  </div>`;}
/* --- Launches --- */
function launchCard(t){const col=SYMCOLOR[t.sym]||'#3DE0FF';
  return`<div class="tape-row" data-token="${t.sym}">
    <div class="tape-ic" style="background:${col}">${t.sym[0]}${tkLogo(t)}</div>
    <div class="tape-mid"><div class="tape-sym">$${t.sym}${t.justDeployed?'<span class="tape-tag">NEW</span>':''}</div>
      <div class="tape-act b">${t.name}</div></div>
    <div class="tape-r"><div class="tape-sol">${fmtUSD(t.mc)}</div><div class="tape-t">${age(t.ageM)} old</div></div>
  </div>`;}
function launchPendCard(sym){return`<div class="tape-row" data-post="${PENDING[sym].narrIdx}">
    <div class="tape-ic" style="background:var(--bg3);color:var(--dim)">${sym[0]}</div>
    <div class="tape-mid"><div class="tape-sym">$${sym}</div><div class="tape-act s">awaiting launch</div></div>
    <div class="tape-r"><div class="tape-t">${PENDING[sym].lead} lead</div></div></div>`;}
function renderStream(){const box=$('#stream'),title=$('#railTitle'),cnt=$('#streamCount');if(!box)return;
  if(railMode==='viral'){
    if(isL3()){
      if(title)title.textContent='Live viral feed';
      if(window.renderViralStream){renderViralStream();return;}
      if(!window._narrativesReady){box.innerHTML='<div class="noresult narr-loading">Loading posts…</div>';if(cnt)cnt.textContent='…';return;}
    }else if(title)title.textContent='Live viral feed';
    box.innerHTML=streamPool.map(n=>n.live?streamLiveCard(n):streamCard(n)).join('');
    if(cnt)cnt.textContent=streamPool.length?String(streamPool.length):'streaming';
    return;}
  if(railMode==='launches'){if(title)title.textContent='New launches';
    const live=[...TOKENS].sort((a,b)=>a.ageM-b.ageM);
    box.innerHTML=Object.keys(PENDING).map(launchPendCard).join('')+live.map(launchCard).join('');return;}
  if(title)title.textContent='Live trades';
  if(!tapePool.length)tapePool=Array.from({length:14},genTape).filter(Boolean).sort((a,b)=>b.t-a.t);
  box.innerHTML=tapePool.map(tapeCard).join('');}
function pushStream(){const box=$('#stream');if(!box)return;
  if(railMode==='viral'){
    if(isL3())return;
    const pool=NARR.filter(n=>FEED_PLATS.includes(n.plat));
    const base=pool[Math.floor(Math.random()*pool.length)];
    const n={...base,views:(Math.random()*2+0.2).toFixed(1)+'M',posts:(Math.floor(Math.random()*7000)+800).toLocaleString(),
      lead:'+'+(Math.floor(Math.random()*50)+12)+'m'};
    streamPool.unshift(n);if(streamPool.length>14)streamPool.pop();
    box.insertAdjacentHTML('afterbegin',streamCard(n));
    while(box.children.length>14)box.removeChild(box.lastChild);return;}
  if(railMode==='launches')return; // launches change on deploy, not per tick
  const x=genTape();if(!x)return;tapePool.unshift(x);if(tapePool.length>14)tapePool.pop();
  box.insertAdjacentHTML('afterbegin',tapeCard(x));
  while(box.children.length>14)box.removeChild(box.lastChild);}
function setRail(m){railMode=m;$$('#railTabs button').forEach(b=>b.classList.toggle('on',b.dataset.rail===m));renderStream();}
function setRailCollapsed(v){railCollapsed=!!v;updateRailLayout();}

/* ============ INIT ============ */
function restoreViralFeedCacheEarly(){
  if(!isL3())return;
  try{
    const raw=sessionStorage.getItem('insidor_viral_feed_v1');
    if(!raw)return;
    const parsed=JSON.parse(raw);
    if(!parsed?.items?.length||Date.now()-parsed.at>30*60*1000)return;
    const minX=Number(window.MEME_MIN_X)||0.7;
    const minTt=Number(window.MEME_MIN_TT)||0.75;
    const eligible=parsed.items.filter(p=>{
      const score=Number(p.memeScore);
      if(!Number.isFinite(score))return false;
      return score>=(p.plat==='tt'?minTt:minX);
    });
    if(!eligible.length)return;
    window.VIRAL_STREAM=eligible;
    window._viralStreamReady=true;
  }catch(_){}}
if(isL3()){
  window._narrativesReady=false;
  streamPool=[];
  restoreViralFeedCacheEarly();
  setNarrativesLoading();
  renderTokens();
  setView('trending');
  setRail('viral');
  syncNarrSoundToggle();
}
setInterval(pushStream,2600); // live rail keeps streaming on every tab
