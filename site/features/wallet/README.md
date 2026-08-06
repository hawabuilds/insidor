# Wallet

Privy Solana wallet connect in nav (`#userAuth`); emits `insidor-wallet` for swap flows.

**What breaks here:** Connect button missing or alert-on-click, address not shown after login, swap/balance in token page never unlocks.

**Tables:** None — client-side session only.

**APIs:** None here; `token-page.js` uses `/api/balance` and `/api/swap` after wallet events.
