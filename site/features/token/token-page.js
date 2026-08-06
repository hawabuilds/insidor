/* Insidor token detail page — extracted from index.html */
function narrativeForToken(t){
  const withTok=NARRATIVES.filter(n=>n.tokens.some(tok=>tok.ticker===t.sym));
  if(withTok.length)return withTok.find(n=>n.tokens.some(tok=>tok.ticker===t.sym&&tok.canonical))||withTok[0];
  if(t.narrIdx==null)return null;
  if(t.narrIdx>=0)return NARRATIVES.find(n=>n.narrIdx===t.narrIdx)||null;
  return null;}
function tokenOriginStrip(t){
  const nar=narrativeForToken(t);if(!nar)return'';
  const post=narrTopPost(nar),txt=post.text.length>88?post.text.slice(0,86)+'…':post.text;
  return`<button type="button" class="tp-origin" data-narrative="${nar.id}">
    <span class="tp-origin-thumb">${postPreviewImg(nar,post)}</span>
    <span class="tp-origin-body">
      <span class="tp-origin-kicker"><span class="pbadge ${post.platform}" title="${PLATNAME[post.platform]}">${plogo(post.platform)}</span> Source post · ${nar.title}</span>
      <span class="tp-origin-txt">“${txt}”</span>
    </span>
    <span class="tp-origin-link">View narrative →</span>
  </button>`;}

function positionRailControls(){
  const sh=document.querySelector('.shell');
  if(!sh?.classList.contains('token-view'))return;
  const chart=$('#v-token .chart-top');const rail=$('.rail');
  const gutter=$('#railToggle');const reopen=$('#railReopen');
  if(!chart||!rail)return;
  const cr=chart.getBoundingClientRect();const mid=cr.top+cr.height/2;
  if(gutter&&!sh.classList.contains('rail-collapsed')){
    const rr=rail.getBoundingClientRect();
    gutter.style.top=Math.max(80,mid-rr.top-gutter.offsetHeight/2)+'px';}
  if(reopen&&sh.classList.contains('rail-collapsed')){
    reopen.style.top=Math.max(72,mid-reopen.offsetHeight/2)+'px';}}

/* ============ TOKEN PAGE + CANVAS CHART ============ */
let chartToken=null,chartTF='5m',feedTimer=null,candles=[],lastPrice=0;
function genCandles(tf,base){const n=60,out=[];let p=base;
  const vm={'1m':0.004,'5m':0.009,'1h':0.02,'24h':0.05}[tf];
  for(let i=0;i<n;i++){const o=p,drift=(Math.random()-0.46)*vm*p,c=Math.max(p+drift,base*0.3);
    const hi=Math.max(o,c)*(1+Math.random()*vm*0.6),lo=Math.min(o,c)*(1-Math.random()*vm*0.6);
    out.push({o,h:hi,l:lo,c,vol:Math.random()*100+20});p=c;}return out;}
let CG=null,hoverIdx=null,hoverY=null;
function roundRect(x,X,Y,w,h,r){x.beginPath();x.moveTo(X+r,Y);x.arcTo(X+w,Y,X+w,Y+h,r);x.arcTo(X+w,Y+h,X,Y+h,r);x.arcTo(X,Y+h,X,Y,r);x.arcTo(X,Y,X+w,Y,r);x.closePath();}
function drawChart(){const cv=$('#chart');if(!cv)return;
  const dpr=window.devicePixelRatio||1,W=cv.clientWidth,H=380;
  cv.width=W*dpr;cv.height=H*dpr;const x=cv.getContext('2d');x.scale(dpr,dpr);x.clearRect(0,0,W,H);
  const padR=66,padB=50,top=10,cw=W-padR,ch=H-padB-top;
  let hi=-Infinity,lo=Infinity,mv=0;candles.forEach(c=>{hi=Math.max(hi,c.h);lo=Math.min(lo,c.l);mv=Math.max(mv,c.vol);});
  const pad=(hi-lo)*0.08;hi+=pad;lo-=pad;const Y=p=>top+ch-((p-lo)/(hi-lo))*ch;
  const bw=cw/candles.length;CG={cw,ch,top,bw,hi,lo,H};
  x.strokeStyle='#17171d';x.fillStyle='#5A5A62';x.font='10px "JetBrains Mono",monospace';x.lineWidth=1;
  for(let i=0;i<=4;i++){const gy=top+(ch/4)*i;x.beginPath();x.moveTo(0,gy);x.lineTo(cw,gy);x.stroke();
    const pv=hi-((hi-lo)/4)*i;x.fillText(fmtP(pv).replace('$',''),cw+6,gy+3);}
  candles.forEach((c,i)=>{const vh=(c.vol/mv)*42,bx=i*bw;
    x.fillStyle=c.c>=c.o?'rgba(155,240,60,.16)':'rgba(255,92,110,.16)';x.fillRect(bx+bw*0.14,top+ch-vh+2,bw*0.72,vh);});
  candles.forEach((c,i)=>{const bx=i*bw+bw/2,green=c.c>=c.o;
    x.strokeStyle=green?'#9BF03C':'#FF5C6E';x.fillStyle=green?'#9BF03C':'#FF5C6E';
    x.beginPath();x.moveTo(bx,Y(c.h));x.lineTo(bx,Y(c.l));x.stroke();
    const yo=Y(c.o),yc=Y(c.c),bh=Math.max(Math.abs(yc-yo),1);x.fillRect(bx-bw*0.32,Math.min(yo,yc),bw*0.64,bh);});
  lastPrice=candles[candles.length-1].c;const ly=Y(lastPrice);
  x.strokeStyle='#3DE0FF';x.setLineDash([4,4]);x.beginPath();x.moveTo(0,ly);x.lineTo(cw,ly);x.stroke();x.setLineDash([]);
  x.fillStyle='#3DE0FF';x.fillRect(cw,ly-9,padR,18);x.fillStyle='#001318';x.font='600 10px "JetBrains Mono",monospace';
  x.fillText(fmtP(lastPrice).replace('$',''),cw+5,ly+3);
  x.fillStyle='#5A5A62';x.font='10px "JetBrains Mono",monospace';
  const labels={'1m':['-60m','-45m','-30m','-15m','now'],'5m':['-5h','-3.7h','-2.5h','-1.2h','now'],'1h':['-60h','-45h','-30h','-15h','now'],'24h':['-60d','-45d','-30d','-15d','now']}[chartTF];
  labels.forEach((l,i)=>x.fillText(l,(cw/4)*i,H-30));
  if(hoverIdx!=null&&hoverIdx>=0&&hoverIdx<candles.length){const c=candles[hoverIdx];const bx=hoverIdx*bw+bw/2;
    x.strokeStyle='rgba(244,245,247,.22)';x.setLineDash([3,3]);
    x.beginPath();x.moveTo(bx,top);x.lineTo(bx,top+ch);x.stroke();
    if(hoverY!=null&&hoverY>=top&&hoverY<=top+ch){x.beginPath();x.moveTo(0,hoverY);x.lineTo(cw,hoverY);x.stroke();
      const pv=lo+(1-(hoverY-top)/ch)*(hi-lo);x.setLineDash([]);
      x.fillStyle='#26262e';x.fillRect(cw,hoverY-9,padR,18);x.fillStyle='#F4F5F7';
      x.font='10px "JetBrains Mono",monospace';x.fillText(fmtP(pv).replace('$',''),cw+5,hoverY+3);}
    x.setLineDash([]);
    const green=c.c>=c.o,tw=152,th=52;
    x.fillStyle='rgba(12,12,14,.94)';x.strokeStyle='#26262e';x.lineWidth=1;roundRect(x,8,8,tw,th,7);x.fill();x.stroke();
    x.font='10px "JetBrains Mono",monospace';x.fillStyle='#8A8A93';
    x.fillText('O '+fmtP(c.o).replace('$',''),17,24);x.fillText('H '+fmtP(c.h).replace('$',''),17,38);
    x.fillText('L '+fmtP(c.l).replace('$',''),88,24);
    x.fillStyle=green?'#9BF03C':'#FF5C6E';x.fillText('C '+fmtP(c.c).replace('$',''),88,38);
    const chg=((c.c-c.o)/c.o*100);x.fillText((chg>=0?'+':'')+chg.toFixed(2)+'%',17,50);}}
function tickChart(){const last=candles[candles.length-1],base=chartToken.price;
  const drift=(Math.random()-0.48)*0.006*base;last.c=Math.max(last.c+drift,base*0.3);
  last.h=Math.max(last.h,last.c);last.l=Math.min(last.l,last.c);last.vol=Math.min(last.vol+Math.random()*6,140);
  if(Math.random()>0.82){candles.shift();candles.push({o:last.c,h:last.c,l:last.c,c:last.c,vol:Math.random()*40+15});}
  drawChart();const pc=$('#livePrice');if(pc)pc.textContent=fmtP(lastPrice);const cp=$('#chartPrice');if(cp)cp.textContent=fmtP(lastPrice);}
let curSide='b',curOT='market',slip=1,prio='fast',curTab='trades';
function solSpot(){return window.SOL_PRICE||0;}
let trades=[],tokHolders=[],tokTraders=[],traderFilter=null,traderTrades=[];
let tradesPollTimer=null,lastQuote=null,walletBalance={sol:null,token:null};
let tradesLoading=false,tradersLoading=false,tradersFetchedAt=null,tradersStale=false,tradersLabel='',tradersCaption='',tokAccumulating=[];
const tradesCache=new Map();
const tradersSessionFetched=new Set();
function cacheHit(map,mint,maxAge){const hit=map.get(mint);return hit&&Date.now()-hit.at<maxAge?hit.data:null;}
function cacheSet(map,mint,data){map.set(mint,{data,at:Date.now()});}
async function fetchTradesPanel(t,{silent=false,force=false}={}){if(!isL3()||!t?.ca||chartToken?.ca!==t.ca)return;
  if(!force){const c=cacheHit(tradesCache,t.ca,20000);if(c){trades=c.map(normTrade);
    if(traderFilter)traderTrades=trades.filter(x=>x.wallet===traderFilter);
    tradesLoading=false;renderTrades();return;}}
  if(!silent){tradesLoading=true;renderTrades();}
  const j=await fetchJson(`/api/trades?mint=${encodeURIComponent(t.ca)}&limit=50`,12000);
  if(chartToken?.ca!==t.ca)return;
  trades=(!j||j.error)?[]:(j.trades||[]).map(normTrade);
  if(traderFilter)traderTrades=trades.filter(x=>x.wallet===traderFilter);
  if(j?.trades)cacheSet(tradesCache,t.ca,j.trades);
  tradesLoading=false;renderTrades();}
async function fetchTopTradersPanel(t){if(!isL3()||!t?.ca||chartToken?.ca!==t.ca)return;
  const j=await fetchJson(`/api/toptraders?mint=${encodeURIComponent(t.ca)}`,8000);
  if(chartToken?.ca!==t.ca)return;
  tokTraders=(!j||j.error&&!j.traders?.length)?[]:(j.traders||[]);
  tokAccumulating=Array.isArray(j?.accumulating)?j.accumulating:[];
  tradersFetchedAt=j?.fetchedAt||Date.now();
  tradersStale=!!j?.stale;
  tradersLabel=j?.label||'';
  tradersCaption=j?.caption||'';
  tradersLoading=false;
  renderTopTraders();}
function tradersSkeletonRows(){return Array.from({length:10},(_,i)=>`<div class="ttr-row ttr-skel" aria-hidden="true">
    <span class="rk sk"></span><span class="wal sk"></span>
    <span class="r sk"></span><span class="r sk"></span><span class="r sk"></span><span class="r sk"></span><span class="r sk"></span></div>`).join('');}
function fmtTraderSide(usd,txns){if(usd==null&&txns==null)return '—';const p=[];if(usd!=null)p.push(fmtUSDn(usd));if(txns!=null)p.push(txns+' tx');return p.join(' · ');}
function fmtTokenBal(n){if(n==null||!Number.isFinite(n))return '—';const a=Math.abs(n);if(a>=1e9)return (n/1e9).toFixed(2)+'B';if(a>=1e6)return (n/1e6).toFixed(1)+'M';if(a>=1e3)return (n/1e3).toFixed(1)+'K';return n.toLocaleString(undefined,{maximumFractionDigits:0});}
function fmtPnlPct(pnl,buyUsd){if(pnl==null||!Number.isFinite(pnl)||!buyUsd||buyUsd<=0)return '';const pct=(pnl/buyUsd)*100;if(Math.abs(pct)>=1000)return (pct>=0?'+':'')+Math.round(pct/1000)+'K%';return (pct>=0?'+':'')+pct.toFixed(0)+'%';}
function fmtPnlCell(pnl,buyUsd){if(pnl==null||!Number.isFinite(pnl))return '—';const pct=fmtPnlPct(pnl,buyUsd);return pct?`${fmtPnLD(pnl)}<span class="pnl-sub">${pct}</span>`:fmtPnLD(pnl);}
function fmtUpdatedAgo(ts){if(!ts)return '';const m=Math.max(0,Math.floor((Date.now()-ts)/60000));
  if(m<1)return 'updated just now';if(m<60)return 'updated '+m+'m ago';return 'updated '+Math.floor(m/60)+'h ago';}
function openTradersTab(t){if(!isL3()||!t?.ca)return;
  if(tradersSessionFetched.has(t.ca)){renderTopTraders();return;}
  tradersSessionFetched.add(t.ca);
  tradersLoading=true;
  renderTopTraders();
  fetchTopTradersPanel(t);}
function buildPresets(){const el=$('#presets');if(!el)return;
  el.innerHTML=curSide==='b'
    ?[0.5,1,2,5].map(p=>`<button data-amt="${p}">${p}</button>`).join('')+'<button data-amt="max" class="mx">MAX</button>'
    :[25,50,75,100].map(p=>`<button data-pct="${p}">${p}%</button>`).join('')+'<button data-amt="max" class="mx">MAX</button>';}
function shortAddr(w){if(!w)return '—';return w.length>10?w.slice(0,4)+'…'+w.slice(-4):w;}
function timeAgo(ts){const s=Math.max(0,Math.floor((Date.now()-ts)/1000));return s<60?s+'s':s<3600?Math.floor(s/60)+'m':Math.floor(s/3600)+'h';}
function fmtPnLD(n){if(n==null||!Number.isFinite(n))return '—';const s=n>=0?'+':'';return s+'$'+Math.abs(n).toLocaleString(undefined,{maximumFractionDigits:0});}
function normTrade(row){return{buy:row.side==='buy',ts:row.ts,wallet:row.wallet,toks:row.tokenAmount,sol:row.solAmount,usd:row.usd,tx:row.tx};}
function stopTokenPagePolls(){clearInterval(feedTimer);clearInterval(tradesPollTimer);
  feedTimer=null;tradesPollTimer=null;}
function updateBalDisplay(t){const el=$('#bal');if(!el)return;const w=window.InsidorWallet;
  if(!w?.authenticated||!w?.address){el.innerHTML='Balance <span class="dim">Connect wallet</span>';return;}
  if(curSide==='b')el.innerHTML=walletBalance.sol!=null?`Balance <b>${walletBalance.sol.toFixed(4)}</b> SOL`:'Balance <b>—</b> SOL';
  else el.innerHTML=walletBalance.token!=null?`Holdings <b>${walletBalance.token.toLocaleString(undefined,{maximumFractionDigits:4})}</b> ${t.sym}`:`Holdings <b>—</b> ${t.sym}`;}
function updateExecButton(t,q){const ex=$('#exec'),note=$('#quoteNote');if(!ex)return;const w=window.InsidorWallet,amt=parseFloat($('#amt')?.value)||0;
  ex.className='doit'+(curSide==='s'?' s':' b');ex.textContent=(curSide==='b'?'Buy $':'Sell $')+t.sym;
  if(!isL3()){ex.disabled=true;if(note)note.textContent='Live trading on Layer 3 deploy only';return;}
  if(!w?.authenticated||!w?.address){ex.disabled=true;if(note)note.textContent='Connect wallet to trade';return;}
  if(!q||q.source!=='jupiter'||amt<=0){ex.disabled=true;
    if(note)note.textContent=q?.source==='estimate'?'connect Jupiter for live quotes':(amt<=0?'Enter an amount':'Waiting for quote…');return;}
  ex.disabled=false;if(note)note.textContent='live route via Jupiter';}
function updateSafetyTop10(t){const secbox=$('.secbox');if(!secbox)return;const secs=secbox.querySelectorAll('.sec');
  if(secs[3]){const el=secs[3].lastElementChild;el.className=t.top10==null?'dim':t.top10>30?'warn':'ok';el.textContent=fmtTop10(t.top10);}}
async function fetchTrades(t){return fetchTradesPanel(t,{force:true});}
async function fetchHoldersPanel(t){if(!t?.ca)return;
  try{const j=await fetch(`/api/holders?mint=${encodeURIComponent(t.ca)}`).then(r=>r.json()).catch(()=>null);
    if(!j)return;
    if(j.holders!=null)t.holders=j.holders;
    if(j.top10Pct!=null)t.top10=j.top10Pct;
    tokHolders=(j.top||[]).map(h=>({w:h.short||shortAddr(h.wallet),wallet:h.wallet,p:h.pct}));
    t._holdersTruncated=!!j.truncated;
    if(chartToken?.ca===t.ca){renderHolders(t);updateSafetyTop10(t);updateTokenQstats(t);}}catch(_){}}
async function fetchSafetyPanel(t){if(!t?.ca)return;
  try{const j=await fetch(`/api/safety?mint=${encodeURIComponent(t.ca)}`).then(r=>r.json()).catch(()=>null);
    if(!j||j.error)return;
    if(j.mintRevoked!=null)t.mintRevoked=j.mintRevoked;
    if(j.freezeRevoked!=null)t.freezeRevoked=j.freezeRevoked;
    if(j.lpBurned!=null)t.lpBurned=j.lpBurned;
    if(j.top10!=null&&t.top10==null)t.top10=j.top10;
    if(chartToken?.ca===t.ca)refreshTokenEnrichedUI(t);}catch(_){}}
async function fetchWalletBalance(t){if(!isL3()){walletBalance={sol:null,token:null};updateBalDisplay(t);updateExecButton(t,lastQuote);return;}
  const w=window.InsidorWallet;
  if(!w?.authenticated||!w?.address){walletBalance={sol:null,token:null};updateBalDisplay(t);updateExecButton(t,lastQuote);return;}
  try{const qs=new URLSearchParams({owner:w.address});if(t?.ca)qs.set('mint',t.ca);
    const j=await fetch(`/api/balance?${qs}`).then(r=>r.json()).catch(()=>null);
    walletBalance={sol:j?.sol??null,token:j?.token??null};}catch(_){walletBalance={sol:null,token:null};}
  updateBalDisplay(t);updateExecButton(t,lastQuote);}
function startTokenPageFetches(t){stopTokenPagePolls();trades=[];tokHolders=[];traderFilter=null;traderTrades=[];
  tokTraders=[];tradersLoading=false;tradersFetchedAt=null;tradersStale=false;tradersLabel='';tradersCaption='';tokAccumulating=[];
  tradesLoading=isL3();
  if(isL3())fetchTradesPanel(t);
  setTimeout(()=>{fetchHoldersPanel(t);fetchSafetyPanel(t);},100);
  if(isL3())fetchWalletBalance(t);}
function renderTrades(){const el=$('#tab-trades');if(!el||!chartToken)return;const s=chartToken.sym,list=traderFilter?traderTrades:trades;
  const banner=traderFilter?`<div class="trfilter">Showing trades by <b>${shortAddr(traderFilter)}</b><a href="#" id="clrTrader">clear ✕</a></div>`:'';
  const rows=list.length?list.slice(0,50).map(x=>{
    const tm=x.tx?`<a href="https://solscan.io/tx/${x.tx}" target="_blank" rel="noopener">${timeAgo(x.ts)}</a>`:timeAgo(x.ts);
    return `<div class="trrow"><span class="tm">${tm}</span>
      <span class="ty ${x.buy?'b':'s'}">${x.buy?'Buy':'Sell'}</span>
      <span class="r">${Number.isFinite(x.sol)?x.sol.toFixed(4):'—'}</span>
      <span class="r">${Number.isFinite(x.toks)?x.toks.toLocaleString(undefined,{maximumFractionDigits:0}):'—'}</span>
      <span class="r">${Number.isFinite(x.usd)?fmtUSDn(x.usd):'—'}</span>
      <span class="r wal${x.you?' you':''}"${x.you?'':` data-trader="${x.wallet}"`}>${x.you?'you':shortAddr(x.wallet)}</span></div>`;
  }).join(''):(tradesLoading?'<div class="tr-empty dim panel-loading">Loading trades…</div>':'<div class="tr-empty dim">No recent trades</div>');
  el.innerHTML=banner+`<div class="trhd"><span>Age</span><span>Type</span><span class="r">SOL</span><span class="r">${s}</span><span class="r">USD</span><span class="r">Trader</span></div>`+rows;
  const c=$('#clrTrader');if(c)c.onclick=e=>{e.preventDefault();traderFilter=null;traderTrades=[];renderTrades();};}
function renderHolders(t){const el=$('#tab-holders');if(!el)return;const topCls=t.top10==null?'':t.top10>30?'down':'up';
  const foot=t._holdersTruncated?'<div class="hld-foot">top 5,000 accounts</div>':'';
  const bars=tokHolders.length?tokHolders.map(h=>`<div class="hld"><span class="hld-w">${h.w}</span>
      <div class="hld-bar"><i style="width:${Math.min(h.p??0,100)}%"></i></div><span class="hld-p">${Number(h.p??0).toFixed(2)}%</span></div>`).join(''):'<div class="tr-empty dim">No holder data</div>';
  el.innerHTML=`<div class="hld-sum"><span><b>${fmtHolders(t.holders)}</b> holders</span><span>Top 10 hold <b class="${topCls}">${fmtTop10(t.top10)}</b></span></div>`+bars+foot;}
function renderTopTraders(){const el=$('#tab-traders');if(!el)return;
  const hdr=`<div class="ttr-hd"><span>#</span><span>Trader</span><span class="r">Bought</span><span class="r">Sold</span><span class="r">Realised</span><span class="r">Unreal.</span><span class="r">Balance</span></div>`;
  const rows=tradersLoading?tradersSkeletonRows():tokTraders.length?tokTraders.map(x=>`<div class="ttr-row" data-trader="${x.wallet}"><span class="rk">${x.rank}</span><span class="wal">${x.short||shortAddr(x.wallet)}</span>
      <span class="r">${fmtTraderSide(x.buyUsd,x.buys)}</span><span class="r">${fmtTraderSide(x.sellUsd,x.sells)}</span>
      <span class="r ${x.pnl>=0?'up':'down'}">${fmtPnlCell(x.pnl,x.buyUsd)}</span>
      <span class="r ${x.unrealized>=0?'up':x.unrealized<0?'down':''}">${x.unrealized!=null?fmtPnLD(x.unrealized):'—'}</span>
      <span class="r">${fmtTokenBal(x.balance??x.netTokens)}</span></div>`).join(''):'<div class="tr-empty dim">No ranked traders with sells in this window</div>';
  const accHdr=tokAccumulating.length?`<div class="ttr-acc-hd">Accumulating · no sells in window</div>
    <div class="ttr-hd"><span></span><span>Trader</span><span class="r">Bought</span><span class="r">Sold</span><span class="r">Status</span><span class="r">Unreal.</span><span class="r">Balance</span></div>`:'';
  const accRows=tokAccumulating.map(x=>`<div class="ttr-row acc" data-trader="${x.wallet}"><span class="rk">·</span><span class="wal">${x.short||shortAddr(x.wallet)}</span>
      <span class="r">${fmtTraderSide(x.buyUsd,x.buys)}</span><span class="r">—</span>
      <span class="r acc-tag">accumulating</span>
      <span class="r ${x.unrealized>=0?'up':x.unrealized<0?'down':''}">${x.unrealized!=null?fmtPnLD(x.unrealized):'—'}</span>
      <span class="r">${fmtTokenBal(x.balance??x.netTokens)}</span></div>`).join('');
  const labelLine=!tradersLoading&&tradersLabel?`<div class="ttr-stale">${tradersLabel}${tradersStale?' · '+fmtUpdatedAgo(tradersFetchedAt):''}</div>`:'';
  const capLine=!tradersLoading&&tradersCaption?`<div class="ttr-cap">${tradersCaption}</div>`:'';
  el.innerHTML=hdr+rows+accHdr+accRows+labelLine+capLine;}
function renderInfo(t){const el=$('#tab-info');if(!el)return;
  const nar=narrativeForToken(t),post=nar?narrTopPost(nar):null,postTxt=post?.text||(t.narrIdx!=null&&t.narrIdx>=0?NARR[t.narrIdx]?.txt:'')||'—';
  el.innerHTML=`<div class="inf-grid">
    <div class="inf"><span class="k">Contract</span><span class="v mono">${t.ca.slice(0,6)}…${t.ca.slice(-6)}<button class="ca-mini" data-copy="${t.ca}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button></span></div>
    <div class="inf"><span class="k">Created</span><span class="v">${t.ageM==null?'—':age(t.ageM)+' ago'}</span></div>
    <div class="inf"><span class="k">Market cap</span><span class="v">${fmtUSDn(t.mc)}</span></div>
    <div class="inf"><span class="k">Liquidity</span><span class="v">${fmtUSDn(t.liq)}</span></div>
    <div class="inf"><span class="k">Total supply</span><span class="v">1,000,000,000</span></div>
    <div class="inf" style="grid-column:1/-1"><span class="k">Origin narrative</span><span class="v">${nar?`<button type="button" class="tp-origin-link" data-narrative="${nar.id}" style="border:0;background:none;padding:0;cursor:pointer">${nar.title} →</button>`:`“${postTxt}”`}</span></div>
  </div><div class="inf-soc">${socLinks(t)||'<span class="dim">—</span>'}</div>`;}
let quoteTimer=null;
function slipVal(){return slip==='auto'?1:(typeof slip==='number'?slip:parseFloat(slip)||1);}
async function refreshQuote(t){
  if(!t||!window.InsidorTokenPage)return;
  const amt=parseFloat($('#amt')?.value)||0;
  const side=curSide==='s'?'sell':'buy';
  const decimals=t.decimals??6;
  if(InsidorTokenPage.CFG)InsidorTokenPage.CFG.DEFAULT_SLIPPAGE_BPS=Math.round(slipVal()*100);
  const q=await InsidorTokenPage.getQuote(t,side,amt,solSpot(),decimals);
  const f=InsidorTokenPage.fmtQuote(q);
  const recv=$('#recv'),recvUsd=$('#recvUsd'),impact=$('#impact'),minrecv=$('#minrecv'),note=$('#quoteNote');
  if(recv)recv.textContent=f.out;
  if(recvUsd)recvUsd.textContent=f.usd;
  if(minrecv){
    let minTxt='—';
    if(q?.raw?.otherAmountThreshold){
      const outDec=side==='buy'?decimals:9;
      const minOut=Number(q.raw.otherAmountThreshold)/10**outDec;
      minTxt=minOut>=1?minOut.toLocaleString(undefined,{maximumFractionDigits:4})+' '+(q.outSymbol||''):minOut.toPrecision(4)+' '+(q.outSymbol||'');
    }
    minrecv.textContent=minTxt;
  }
  if(impact){
    impact.textContent=f.impact;
    const pi=q?.priceImpactPct;
    if(pi!=null){impact.style.color=Math.abs(pi)>5?'#FF5C6E':Math.abs(pi)>1.5?'#ffb84c':'#9BF03C';}
    else impact.style.color='';
  }
  if(note)note.textContent=f.note||'quote only — trading not live';
  const nf=$('#netfee');if(nf)nf.textContent=(prio==='turbo'?0.002:0.0005)+' SOL';
  lastQuote=q;updateExecButton(t,q);
}
function debouncedQuote(t){clearTimeout(quoteTimer);quoteTimer=setTimeout(()=>refreshQuote(t),250);}
function showSwapConfirm({side,sym,amt,amtUnit,out,usd,impact,slipPct}){
  return new Promise(resolve=>{
    const root=ensureModalRoot();
    root.innerHTML=`<div class="dback" id="swapConfirmBack"><div class="sheet" role="dialog" aria-modal="true" style="max-width:420px">
      <div class="sh-hd"><div class="sh-t">Confirm ${side} $${sym}</div></div>
      <div style="padding:16px 20px;font-size:13px;line-height:1.7">
        <div><span class="dim">Amount</span> <b>${amt} ${amtUnit}</b></div>
        <div><span class="dim">You receive</span> <b>${out}</b> <span class="dim">(${usd})</span></div>
        <div><span class="dim">Price impact</span> <b>${impact}</b></div>
        <div><span class="dim">Slippage</span> <b>${slipPct}%</b></div>
      </div>
      <div class="sh-foot" style="display:flex;gap:8px;padding:12px 16px">
        <button type="button" class="wallet-btn" id="swapCancel" style="flex:1;justify-content:center">Cancel</button>
        <button type="button" class="doit b" id="swapOk" style="flex:1">Sign &amp; send</button>
      </div></div></div>`;
    document.body.style.overflow='hidden';
    const close=v=>{closeDeploy();resolve(v);};
    $('#swapCancel').onclick=()=>close(false);
    $('#swapConfirmBack').onclick=e=>{if(e.target.id==='swapConfirmBack')close(false);};
    $('#swapOk').onclick=()=>close(true);
  });}
function b64ToU8(b64){const bin=atob(b64),u8=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);return u8;}
async function executeSwap(t){
  if(!isL3())return;
  const q=lastQuote,amt=parseFloat($('#amt')?.value)||0,w=window.InsidorWallet;
  if(!w?.authenticated||!w?.address||!q||q.source!=='jupiter'||amt<=0)return;
  const side=curSide==='s'?'Sell':'Buy',f=InsidorTokenPage.fmtQuote(q);
  const impact=q.priceImpactPct!=null?q.priceImpactPct.toFixed(2)+'%':'—';
  const ok=await showSwapConfirm({side,sym:t.sym,amt,amtUnit:curSide==='b'?'SOL':t.sym,out:f.out,usd:f.usd,impact,slipPct:slipVal()});
  if(!ok)return;
  const ex=$('#exec'),note=$('#quoteNote');
  try{
    ex.disabled=true;ex.textContent='Building…';
    const r=await fetch('/api/swap',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({userPublicKey:w.address,quoteResponse:q.raw})});
    const j=await r.json();
    if(j.error)throw new Error(j.error);
    ex.textContent='Sign & send…';
    const {VersionedTransaction,Connection}=await import('https://esm.sh/@solana/web3.js@1');
    const tx=VersionedTransaction.deserialize(b64ToU8(j.swapTransaction));
    const conn=new Connection('https://api.mainnet-beta.solana.com','confirmed');
    const sig=await w.sendVersionedTransaction(tx,conn);
    ex.textContent='Confirming…';
    await conn.confirmTransaction({signature:sig,blockhash:tx.message.recentBlockhash,lastValidBlockHeight:j.lastValidBlockHeight},'confirmed');
    ex.textContent='Confirmed ✓';
    if(note)note.innerHTML=`<a href="https://solscan.io/tx/${sig}" target="_blank" rel="noopener">View on Solscan →</a>`;
    fetchWalletBalance(t);fetchTrades(t);debouncedQuote(t);
  }catch(e){
    ex.textContent=(curSide==='b'?'Buy $':'Sell $')+t.sym;
    if(note)note.textContent=e.message||'Swap failed';
    updateExecButton(t,lastQuote);
  }}
function updateTokenQstats(t){
  if(!t||!chartToken||chartToken.ca!==t.ca)return;
  const setV=(id,txt,cls)=>{const el=$(id);if(!el)return;el.textContent=txt;if(cls!=null)el.className='v '+cls;};
  setV('#qsC5',fmtChg(t.c5),chgCls(t.c5));
  setV('#qsC1h',fmtChg(t.c1h),chgCls(t.c1h));
  setV('#qsC24',fmtChg(t.c24),chgCls(t.c24));
  setV('#qsMcap',fmtUSDn(t.mc));
  setV('#qsLiq',fmtUSDn(t.liq));
  setV('#qsVol',fmtUSDn(t.vol));
  setV('#qsHolders',fmtHolders(t.holders));}
function refreshTokenEnrichedUI(t){
  if(!t||!chartToken||chartToken.ca!==t.ca)return;
  updateTokenQstats(t);
  renderHolders(t);
  const secbox=$('.secbox');if(!secbox)return;
  const secs=secbox.querySelectorAll('.sec');
  if(secs[0])secs[0].lastElementChild.innerHTML=secBool(t.mintRevoked,'✓ Revoked','⚠ Active');
  if(secs[1])secs[1].lastElementChild.innerHTML=secBool(t.freezeRevoked,'✓ Revoked','⚠ Active');
  if(secs[2])secs[2].lastElementChild.innerHTML=secBool(t.lpBurned,'✓ Burned','⚠ Not burned');
  if(secs[3]){
    const el=secs[3].lastElementChild;
    el.className=t.top10==null?'dim':t.top10>30?'warn':'ok';
    el.textContent=fmtTop10(t.top10);
  }
}
function openToken(symOrMint){if(palOpen())closePalette();closeDeploy();const t=resolveToken(symOrMint);if(!t)return;
  const sym=t.sym;
  chartToken=t;lastPrice=t.price||0;lastQuote=null;
  curSide='b';curOT='market';slip=1;prio='fast';curTab=isL3()?'trades':'holders';traderFilter=null;traderTrades=[];
  trades=[];tokHolders=[];tokTraders=[];
  startTokenPageFetches(t);
  const originStrip=tokenOriginStrip(t);
  $('#tokenPage').innerHTML=`
    <button class="tpback" id="tpback">← back</button>
    <div class="tp2" id="tp2">
      <div class="tp2-main">
        <div class="tid">
          <div class="tkico" style="background:${SYMCOLOR[sym]||'#3DE0FF'}">${sym[0]}${tkLogo(t)}</div>
          <div class="tid-meta">
            <div class="tid-top"><h1>$${t.sym}</h1><span class="tid-name">${t.name||'—'}</span>${t.justDeployed?'<span class="newbadge">NEW</span>':''}${isLiveFresh(t)?'<span class="live-dot">live</span>':''}</div>
            <div class="tid-sub">
              <button class="ca-mini" data-copy="${t.ca}" title="Copy contract">${t.ca.slice(0,4)}…${t.ca.slice(-4)}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button>
              ${socLinks(t)}
            </div>
          </div>
          <div class="tid-price">
            <div class="p" id="livePrice">${fmtPn(t.price)}</div>
            <div class="chg ${chgCls(t.c24)}">${fmtChg(t.c24)} <small>24h</small></div>
          </div>
        </div>
        ${originStrip}
        <div class="qstats">
          <div class="qs"><span class="k">5m</span><span class="v ${chgCls(t.c5)}" id="qsC5">${fmtChg(t.c5)}</span></div>
          <div class="qs"><span class="k">1h</span><span class="v ${chgCls(t.c1h)}" id="qsC1h">${fmtChg(t.c1h)}</span></div>
          <div class="qs"><span class="k">24h</span><span class="v ${chgCls(t.c24)}" id="qsC24">${fmtChg(t.c24)}</span></div>
          <div class="qs"><span class="k">Mkt cap</span><span class="v" id="qsMcap">${fmtUSDn(t.mc)}</span></div>
          <div class="qs"><span class="k">Liquidity</span><span class="v" id="qsLiq">${fmtUSDn(t.liq)}</span></div>
          <div class="qs"><span class="k">24h vol</span><span class="v" id="qsVol">${fmtUSDn(t.vol)}</span></div>
          <div class="qs"><span class="k">Holders</span><span class="v" id="qsHolders">${fmtHolders(t.holders)}</span></div>
        </div>
        <div class="chartcard">
          <div class="chart-top">
            <div class="chart-price"><b id="chartPrice">${fmtPn(t.price)}</b><span class="chg ${chgCls(t.c24)}">${fmtChg(t.c24)}</span><span class="tv-tag">DexScreener</span></div>
          </div>
          <div class="tvchart" id="dexChart"></div>
        </div>
        <div class="tp-tabs" id="tpTabs">
          ${isL3()?'<button class="tpt on" data-tab="trades">Transactions</button>':''}
          ${isL3()?'<button class="tpt" data-tab="traders">Top traders</button>':''}
          <button class="tpt${isL3()?'':' on'}" data-tab="holders">Holders</button>
          <button class="tpt" data-tab="info">Info</button>
        </div>
        <div class="tp-tabbody">
          ${isL3()?'<div id="tab-trades" class="tppane on"></div>':''}
          ${isL3()?'<div id="tab-traders" class="tppane"></div>':''}
          <div id="tab-holders" class="tppane${isL3()?'':' on'}"></div>
          <div id="tab-info" class="tppane"></div>
        </div>
      </div>
      <aside class="tp2-side">
        <div class="tradebox">
          <div class="tb-head">
            <span class="sec-h" style="margin:0">Trade $${t.sym}</span>
            <button class="tbtn-watch ${WATCH_TOKENS.has(t.sym)?'on':''}" id="tWatch">${WATCH_TOKENS.has(t.sym)?'★ Watching':'☆ Watch'}</button>
          </div>
          <div class="sides" id="bsToggle"><button class="on b" data-side="b">Buy</button><button data-side="s">Sell</button></div>
          <div class="fp">
            <div class="lbl"><span>Amount</span><span class="bal" id="bal">Balance <span class="dim">Connect wallet</span></span></div>
            <div class="amt"><input id="amt" type="number" value="1" min="0" step="0.1"><span class="u" id="amtun">SOL</span></div>
            <div class="pre" id="presets"></div>
          </div>
          <div class="fp">
            <div class="lbl"><span>Slippage</span><span>Priority</span></div>
            <div style="display:flex;gap:8px">
              <div class="pre" id="slipChips" style="margin:0;flex:1">${[0.5,1,5].map(s=>`<button data-slip="${s}"${s===1?' class="on"':''}>${s}%</button>`).join('')}<button data-slip="auto">Auto</button></div>
              <div class="pre" id="prioChips" style="margin:0;flex:1"><button data-prio="fast" class="on">Fast</button><button data-prio="turbo">Turbo</button></div>
            </div>
          </div>
          <div class="recv"><span class="k">You receive</span><span class="v" id="recv">—</span><span class="recv-usd" id="recvUsd"></span></div>
          <div class="mini">
            <div class="r"><span>Min received</span><span id="minrecv">—</span></div>
            <div class="r"><span>Price impact</span><span id="impact">—</span></div>
            <div class="r"><span>LP fee</span><span>1.00%</span></div>
            <div class="r"><span>Network</span><span id="netfee">0.0005 SOL</span></div>
          </div>
          <button class="doit b" id="exec" type="button" disabled>Buy $${t.sym}</button>
          <div class="fine quote-note" id="quoteNote">quote only — trading not live</div>
        </div>
        <div class="secbox">
          <div class="sec-h">Safety checks</div>
          <div class="sec"><span>Mint authority</span>${secBool(t.mintRevoked,'✓ Revoked','⚠ Active')}</div>
          <div class="sec"><span>Freeze authority</span>${secBool(t.freezeRevoked,'✓ Revoked','⚠ Active')}</div>
          <div class="sec"><span>LP status</span>${secBool(t.lpBurned,'✓ Burned','⚠ Not burned')}</div>
          <div class="sec"><span>Top 10 holders</span><span class="${t.top10==null?'dim':t.top10>30?'warn':'ok'}">${fmtTop10(t.top10)}</span></div>
        </div>
      </aside>
    </div>`;
  go('token');
  requestAnimationFrame(async()=>{
    if(window.InsidorLive?.resolveTokenPair)await InsidorLive.resolveTokenPair(t);
    updateTokenQstats(t);
    if(window.InsidorTokenPage)InsidorTokenPage.mountChart($('#dexChart'),t);
    if(isL3())renderTrades();
    renderTopTraders();renderHolders(t);renderInfo(t);
    wireToken(t);buildPresets();refreshQuote(t);positionRailControls();
    if(isL3())tradesPollTimer=setInterval(()=>fetchTradesPanel(t,{silent:true,force:true}),10000);
  });
}
function wireToken(t){
  $('#tpback').onclick=()=>stepBack();
  const tw=$('#tWatch');if(tw)tw.onclick=()=>{toggleWatchToken(t.sym);const on=WATCH_TOKENS.has(t.sym);
    tw.classList.toggle('on',on);tw.textContent=on?'★ Watching':'☆ Watch';};
  $('#tpTabs').onclick=e=>{const b=e.target.closest('[data-tab]');if(!b)return;curTab=b.dataset.tab;
    $$('#tpTabs .tpt').forEach(x=>x.classList.remove('on'));b.classList.add('on');
    ['trades','traders','holders','info'].forEach(k=>$('#tab-'+k).classList.toggle('on',k===curTab));
    if(curTab==='traders'&&chartToken&&isL3())openTradersTab(chartToken);};
  $('#bsToggle').onclick=e=>{const b=e.target.closest('[data-side]');if(!b)return;curSide=b.dataset.side;
    $$('#bsToggle button').forEach(x=>x.classList.remove('on','b','s'));b.classList.add('on',curSide);
    $('#amtun').textContent=curSide==='b'?'SOL':t.sym;
    updateBalDisplay(t);
    $('#amt').value=curSide==='b'?1:Math.floor((walletBalance.token??0)*0.25);buildPresets();
    const ex=$('#exec');if(ex){ex.className='doit'+(curSide==='s'?' s':' b');ex.textContent=(curSide==='b'?'Buy $':'Sell $')+t.sym;}
    updateExecButton(t,lastQuote);debouncedQuote(t);};
  $('#presets').onclick=e=>{const b=e.target.closest('[data-amt],[data-pct]');if(!b)return;
    $$('#presets button').forEach(x=>x.classList.remove('on'));b.classList.add('on');
    if(b.dataset.pct)$('#amt').value=Math.floor((walletBalance.token??0)*(+b.dataset.pct)/100);
    else if(b.dataset.amt==='max')$('#amt').value=curSide==='b'?(walletBalance.sol??0):Math.floor(walletBalance.token??0);
    else $('#amt').value=b.dataset.amt;debouncedQuote(t);};
  const lp=$('#limitp');if(lp)lp.oninput=()=>debouncedQuote(t);
  $('#slipChips').onclick=e=>{const b=e.target.closest('[data-slip]');if(!b)return;slip=b.dataset.slip==='auto'?1:+b.dataset.slip;
    $$('#slipChips button').forEach(x=>x.classList.remove('on'));b.classList.add('on');debouncedQuote(t);};
  $('#prioChips').onclick=e=>{const b=e.target.closest('[data-prio]');if(!b)return;prio=b.dataset.prio;
    $$('#prioChips button').forEach(x=>x.classList.remove('on'));b.classList.add('on');debouncedQuote(t);};
  $('#amt').oninput=()=>debouncedQuote(t);
  const ex=$('#exec');if(ex)ex.onclick=()=>executeSwap(t);
  $('#tokenPage').onclick=e=>{
    const c=e.target.closest('[data-copy]');
    if(c){try{navigator.clipboard.writeText(c.dataset.copy);}catch(_){}c.classList.add('copied');setTimeout(()=>c.classList.remove('copied'),1000);return;}
    const tr=e.target.closest('[data-trader]');
    if(tr){traderFilter=tr.dataset.trader;traderTrades=trades.filter(x=>x.wallet===traderFilter);curTab='trades';
      $$('#tpTabs .tpt').forEach(x=>x.classList.remove('on'));const tab=document.querySelector('#tpTabs .tpt[data-tab="trades"]');if(tab)tab.classList.add('on');
      ['trades','traders','holders','info'].forEach(k=>$('#tab-'+k).classList.toggle('on',k==='trades'));
      renderTrades();window.scrollTo({top:0});}
  };
}

window.addEventListener('resize',()=>positionRailControls());
document.querySelector('.main')?.addEventListener('scroll',()=>positionRailControls(),{passive:true});
window.addEventListener('insidor-sol-price',()=>{if($('#v-token')?.classList.contains('on')&&chartToken)debouncedQuote(chartToken);});
window.addEventListener('insidor-wallet',()=>{if(chartToken&&isL3())fetchWalletBalance(chartToken);});
