#!/usr/bin/env node
'use strict';
require('../lib/env').loadEnvLocal();
const key = process.env.DUNE_API_KEY;
const sql = process.argv[2] || `SELECT account_mint, call_block_time FROM pumpdotfun_solana.pump_call_withdraw WHERE call_block_time >= NOW() - INTERVAL '2' DAY LIMIT 5`;

async function run() {
  const r = await fetch('https://api.dune.com/api/v1/sql/execute', {
    method: 'POST',
    headers: { 'X-Dune-Api-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, performance: 'small' }),
  });
  const { execution_id } = await r.json();
  for (let i = 0; i < 30; i++) {
    await new Promise(x => setTimeout(x, 2500));
    const st = await (await fetch(`https://api.dune.com/api/v1/execution/${execution_id}/status`, {
      headers: { 'X-Dune-Api-Key': key },
    })).json();
    if (st.state === 'QUERY_STATE_COMPLETED') {
      const res = await (await fetch(`https://api.dune.com/api/v1/execution/${execution_id}/results`, {
        headers: { 'X-Dune-Api-Key': key },
      })).json();
      console.log(JSON.stringify(res.result?.rows || res.rows, null, 2));
      return;
    }
    if (st.state === 'QUERY_STATE_FAILED') {
      console.log('FAIL', JSON.stringify(st.error, null, 2));
      return;
    }
  }
}
run().catch(e => console.error(e.message));
