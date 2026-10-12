/**
 * A simulation reply, recorded 2026-10-12: an unsigned curve buy of 0.01 SOL of NAPS for a fresh,
 * unfunded wallet, run against mainnet. Nothing was signed or sent.
 */
export const UNFUNDED_BUY = {
 "jsonrpc": "2.0",
 "id": 1,
 "result": {
  "context": {
   "slot": 456119616
  },
  "value": {
   "err": "AccountNotFound",
   "logs": [],
   "unitsConsumed": 0
  }
 }
};
