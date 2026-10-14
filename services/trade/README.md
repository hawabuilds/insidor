# services/trade

Quotes and **unsigned** buy and sell transactions for launchpad coins. Each transaction is
simulated before the person is asked to sign it. A coin on its bonding curve is traded with
pump.fun's own instructions; a coin that bonded is routed through Jupiter. The person's wallet
signs; this service then sends what they signed. It never holds a key.

## Off unless all three are set

| variable | meaning |
|---|---|
| `TRADING` | exactly `on`. Anything else: every trade route answers "Trading is off." |
| `TRADING_ALLOWLIST` | comma-separated wallet addresses allowed to trade, or exactly `*` for every wallet. Empty: nobody. `*` mixed with addresses refuses to start. |
| `HELIUS_API_KEY` | the RPC for curve state, simulation and sending. |
| `JUPITER_API_KEY` | optional. Without it Jupiter is keyless and rate limited. |
| `TRADE_ALLOWED_ORIGINS` | the phone app's origins. Default: the local dev origins. |
| `PORT` | default 8790. |

The per-trade cap (0.05 SOL a buy), slippage limits and the platform fee (off) are in
`contracts/src/policy.ts` under `trade`.

## Routes

`GET /venue/:mint`, `GET /quote`, `POST /build`, `POST /send`, `GET /balance`. See `src/routes.ts`.

## Run locally

```
pnpm --filter @insidor/trade dev
```
