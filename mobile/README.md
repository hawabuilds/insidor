# @insidor/mobile — the phone app

A separate web app for phones, next to the desktop app in `app/`. Same wall: it may import
`@insidor/contracts`, `@insidor/wallet` and `@insidor/wallet-embedded` (sign-in with X or Google) and
nothing else, and it reads data only from the read service (`services/read`).

```bash
pnpm dev:mobile          # http://localhost:5174
```

With no `VITE_READ_URL` it serves its own fixtures behind a permanent **Sample data** bar.

## Against the read service

```bash
echo 'VITE_READ_URL=http://localhost:8787' > mobile/.env.local     # gitignored
READ_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5174 pnpm dev:read
pnpm dev:mobile
```

`READ_ALLOWED_ORIGINS` matters: the read service matches origins exactly and defaults to the
desktop app's `:5173` only, so without it every request from `:5174` fails as a CORS error.

The feed reads `GET /board/default` — `default` is the one view the projector writes;
`/board/main` is a 404 — and `GET /story/:id` for each row's lead post and for story pages.
The Sample data bar stays while the board's provenance is `seeded` or unstated and disappears
when the server says the board is `observed`.

## What is real and what is sample

| Screen | Data |
|---|---|
| For you (feed) | the read service, or dev fixtures |
| Narrative page, from the feed | the read service, or dev fixtures |
| Narratives list and its pages | `GET /narratives/default`, or dev fixtures |
| Token page | the coin's fields from the wire; price history, trades and curve progress from `GET /coin/:id/market` |
| Create coin | a form; the button says Coming soon |
| Wallet | sign in with X; shows your embedded Solana wallet's address |
| Search, Calls | Coming soon |

Buy, Sell and Create do nothing but show "Coming soon". `submitTrade` is unimplemented and
nothing calls it; `src/screen-rules.test.ts` fails if anything does.

## The wallet and the trading flag

| Variable | What it does |
|---|---|
| `VITE_PRIVY_APP_ID` | Sign-in with X or Google and an embedded Solana wallet. Unset: the Wallet tab says sign-in isn't set up. The app's id only; there is no secret in the browser. The vendor's dashboard must list each origin the app is served from and have X and Google sign-in enabled. |
| `VITE_TRADING` | Exactly `on` lets the app ask to trade. Unset or anything else: no trade path at all. Even on, the server decides who may trade and how much. |
| `VITE_TRADE_URL` | The trade service (`services/trade`). Unset: every trade call says trading is not connected, and nothing touches the network. |

Signing in changes no other screen: a connected wallet never makes a button appear. No key is
ever imported, exported or seen — there is no screen for either.
