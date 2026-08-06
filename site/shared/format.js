/* Insidor shared formatting — extracted from index.html */
/* ---- platform-specific impression metrics shown on each viral post ---- */
function parseCount(s){if(typeof s==='number')return s;s=(''+s).trim().replace(/,/g,'');const m=s.match(/([\d.]+)\s*([kmb]?)/i);if(!m)return 0;let v=parseFloat(m[1]);const u=(m[2]||'').toLowerCase();if(u==='k')v*=1e3;else if(u==='m')v*=1e6;else if(u==='b')v*=1e9;return Math.round(v);}
function fmtCount(n){n=Math.round(n);if(n>=1e6)return(n/1e6).toFixed(n>=1e7?0:1).replace(/\.0$/,'')+'M';if(n>=1e3)return(n/1e3).toFixed(n>=1e4?0:1).replace(/\.0$/,'')+'K';return''+n;}
function pseed(str){let x=0;str=''+str;for(let i=0;i<str.length;i++)x=(x*31+str.charCodeAt(i))>>>0;return x;}
function postEngagement(p){
  return{
    views:Number(p.rawViews??p.views)||0,
    replies:Number(p.replies)||0,
    quotes:Number(p.quotes)||0,
    retweets:Number(p.retweets)||0,
    likes:Number(p.likes)||0,
  };}
function postMetrics(n){
  const e=postEngagement(n);
  const views=e.views||(typeof n.views==='number'?n.views:parseCount(n.views)||0);
  if(n.plat==='tt')return[['shares',e.retweets],['likes',e.likes],['views',views]];
  return[['reposts',e.retweets+e.quotes],['replies',e.replies],['views',views]];}
function qmetaHTML(n){return postMetrics(n).map(([k,v])=>`<span>${k} <b>${fmtCount(v)}</b></span>`).join('');}
const titlecase=s=>s?s.charAt(0)+s.slice(1).toLowerCase():s;
const deriveTicker=txt=>{const w=txt.toUpperCase().match(/[A-Z]{3,10}/g)||['COIN'];return w.sort((a,b)=>b.length-a.length)[0].slice(0,8);};
const fmtUSD=n=>n>=1e9?'$'+(n/1e9).toFixed(2)+'B':n>=1e6?'$'+(n/1e6).toFixed(2)+'M':n>=1e3?'$'+(n/1e3).toFixed(1)+'K':'$'+n.toFixed(0);
const fmtP=p=>p<0.01?'$'+p.toFixed(7):'$'+p.toFixed(4);
const fmtHolders=n=>n==null?'—':n.toLocaleString();
const fmtTop10=n=>n==null?'—':n+'%';
const fmtUSDn=n=>n==null?'—':fmtUSD(n);
const fmtPn=p=>p==null||!(p>0)?'—':fmtP(p);
const fmtChg=v=>v==null?'—':sign(v);
const chgCls=v=>v==null?'':cls(v);
const fmtAgeM=m=>m==null?'—':age(m);
const isLiveFresh=t=>!!(t&&t._liveAt&&Date.now()-t._liveAt<120000);
const secBool=(v,ok,bad)=>v==null?'<span class="dim">—</span>':v?`<span class="ok">${ok}</span>`:`<span class="warn">${bad}</span>`;
const sign=n=>(n>=0?'+':'')+n.toFixed(1)+'%';
const cls=n=>n>=0?'up':'down';
const age=m=>m>=1440?Math.floor(m/1440)+'d':m>=60?Math.floor(m/60)+'h':m+'m';
const heat=v=>{const t=v/100,lo=[42,42,48],hi=[61,224,255];const c=lo.map((l,i)=>Math.round(l+(hi[i]-l)*t));return`rgb(${c[0]},${c[1]},${c[2]})`;};
const extractTickers=txt=>{const m=txt.match(/\$[A-Z]{2,10}/g)||[];return [...new Set(m.map(t=>t.slice(1)))];};
