/* Insidor shared API helpers — extracted from token-page.js */
async function fetchJson(url,ms=15000){const ac=new AbortController(),t=setTimeout(()=>ac.abort(),ms);
  try{const r=await fetch(url,{signal:ac.signal});return await r.json();}catch(_){return null;}finally{clearTimeout(t);}}
