# Phase 7: everything on Railway and Vercel

Written 2026-10-13. No value appears here: every setting is named, and you paste the value
yourself in Railway or Vercel. Replaces the "web with no backend" setup in
`docs/go-live-plan.md` — sample data no longer exists in either app.

## 0. Before anything: the live site's next build will be refused

`insidor.app` is served today by the Vercel project `insidor-mobile`, built with
`VITE_SAMPLE_DATA=on`. Sample data has been removed, and **both apps now refuse to build while
`VITE_SAMPLE_DATA` is set at all.** The current deploy keeps serving until the next build;
remove `VITE_SAMPLE_DATA` from `insidor-mobile` and `insidor` (Vercel → Project → Settings →
Environment Variables) before deploying again.

## 1. Order

1. **Supabase Pro**: set `PEOPLE_DB_PASSWORD` locally (16+ characters, yours), then run
   `pnpm db:migrate` from your laptop with `DATABASE_URL` pointing at Supabase. It applies
   0043/0044 and creates `insidor_people_user` with your password. It refuses without it.
2. **Railway** (project `adventurous-kindness`): seven services, each from this GitHub repo
   (`hawabuilds/Insidor-layer3`, branch `master`), each with its config file
   (Service → Settings → Config-as-code → Railway config file):

   | Service    | Config file               | Public domain |
   |------------|---------------------------|---------------|
   | read       | `railway/read.json`       | yes |
   | social     | `railway/social.json`     | yes |
   | notify     | `railway/notify.json`     | yes |
   | trade      | `railway/trade.json`      | yes |
   | project    | `railway/project.json`    | no  |
   | chainwatch | `railway/chainwatch.json` | no  |
   | runner     | `railway/runner.json`     | no  |

   Set each service's variables (section 2) **before** its first deploy. Deploy in this
   order, each green before the next: read → project → social → notify → trade → chainwatch →
   runner. Start the runner with `SPEND=dry`, watch one hour, then switch on (section 6).
   For each public service, generate a domain (Settings → Networking → Generate Domain).
3. **Vercel**: projects `insidor-mobile` (root `mobile/`) and `insidor` (root `app/`). Each has
   a `vercel.json` (install, build, the `/api/*` rewrite, the service-worker header). Set the
   variables in section 2, deploy a **preview** first, check it, then promote.
4. **Domain** (section 3), then **Privy** (section 4).

## 2. Variables, by service (names only)

Values marked † are tuning numbers: copy them from `.env.example`.

**read** — `DATABASE_URL_APP`, `DATABASE_URL` (only to refuse running as the owner; set it to
the owner URL), `HELIUS_API_KEY`, `COINGECKO_API_KEY` (optional), `COINGECKO_API_PLAN`
(optional), `MARKET_DATA_URL` (optional), `READ_ALLOWED_ORIGINS` (your Vercel and insidor.app
origins, comma separated).

**social** — `DATABASE_URL_PEOPLE`, `DATABASE_URL` (refusal check, as above), `PRIVY_APP_ID`,
`HELIUS_API_KEY`, `SOCIAL_ALLOWED_ORIGINS`.

**notify** — `DATABASE_URL_PEOPLE`, `DATABASE_URL` (refusal check), `PRIVY_APP_ID`,
`HELIUS_API_KEY`, `NOTIFY` (`on`), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`,
`NOTIFY_ALLOWED_ORIGINS`. Copy the VAPID keys from your `.env.local`.

**trade** — `DATABASE_URL_APP`, `HELIUS_API_KEY`, `TRADING` (`on`), `TRADING_ALLOWLIST` (your
wallet address only), `JUPITER_API_KEY` (optional), `JUPITER_API_URL` (optional),
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TRADE_ALLOWED_ORIGINS`.

**project** — `DATABASE_URL` (owner; the projector writes the board), `HELIUS_API_KEY`,
`COINGECKO_API_KEY` (optional), `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (the same two as
trade: the coin-logo job copies the logos of coins on screen into the launch-metadata bucket
under `coin-logos/`; without them it skips and the app shows each coin's own picture).

**chainwatch** — `DATABASE_URL`, `MINT_STREAM_URL`†, `MINT_FEED_ID`†, `MINT_FEED_CHAIN`†,
`MINT_FEED_TRANSPORT`†, `MINT_OBSERVATION_LAG_S`†, `MINT_STREAM_BUFFER_LIMIT`†,
`MINT_STREAM_STALE_MS`†, `PAGE_LIMIT`†, `POLL_INTERVAL_MS`†, `BACKOFF_BASE_MS`†,
`BACKOFF_MAX_MS`†, `COVERAGE_TOLERANCE_MS`†, `SHUTDOWN_GRACE_MS`†, `HEARTBEAT`†
(+ `HEARTBEAT_BASE_URL`, `HEARTBEAT_SLUG`, `HEARTBEAT_TIMEOUT_MS` if on).
`HEALTH_PORT` and `SINGLETON_LOCK_NAME` are filled by the launcher; leave them unset.

**runner** — `DATABASE_URL`, `SPEND` (`live`), `DISCOVER` (`on`), `DAILY_BUDGET_USD` (`21`),
`X_API_KEY`, `X_API_BASE` (optional), `APIFY_TOKEN`, `TIKTOK_DISCOVERY_ACTOR_ID`,
`TIKTOK_OBSERVE_ACTOR_ID`, `TIKTOK_API_BASE` (optional), `ANTHROPIC_API_KEY`, `JUDGE_MODEL`,
`ANTHROPIC_BASE_URL` (optional), `VOYAGE_API_KEY`, `VOYAGE_API_BASE` (optional),
`HELIUS_API_KEY`, `COINGECKO_API_KEY` (optional), `COINGECKO_API_PLAN` (optional),
`METADATA_GATEWAY` (optional), `DISCOVER_TERMS` (optional), `RANK` (optional),
`REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` / `REDDIT_USER_AGENT` (optional),
`SHUTDOWN_GRACE_MS`†, `HEARTBEAT`† (+ its three if on), `OWNER_WALLET` (optional: set it to
the reference `${{trade.TRADING_ALLOWLIST}}`; whoever signs in with that wallet gets the
supplier warnings at 80% and 95% of a daily line, which are otherwise only logged). `HEALTH_PORT`
and `SINGLETON_LOCK_NAME` are filled by the launcher.

**Vercel `insidor-mobile`** — `VITE_PRIVY_APP_ID`, `VITE_TRADING` (`on` to show Buy/Sell),
`READ_SERVICE_URL`, `TRADE_SERVICE_URL`, `SOCIAL_SERVICE_URL`, `NOTIFY_SERVICE_URL` (each the
Railway public domain, `https://…up.railway.app`), `ENABLE_EXPERIMENTAL_COREPACK` (`1`).
`VITE_COIN_LOGO_BASE` (`<SUPABASE_URL>/storage/v1/object/public/launch-metadata/coin-logos`:
where the app asks for a coin's copied logo first; unset, it uses the coin's own picture).
Leave `VITE_READ_URL`, `VITE_TRADE_URL`, `VITE_SOCIAL_URL`, `VITE_NOTIFY_URL` unset: the app
then calls `/api/*` on its own origin and `api/proxy.js` forwards. Remove `VITE_SAMPLE_DATA`.

**Vercel `insidor`** (desktop) — `READ_SERVICE_URL`, `ENABLE_EXPERIMENTAL_COREPACK` (`1`).
Remove `VITE_SAMPLE_DATA`.

## 3. DNS (Namecheap), for you to add

Already there from the first launch, keep: `A @ 216.150.1.1`, `A @ 216.150.16.1`,
`CNAME www 00ef20b6977e3de5.vercel-dns-016.com.`

- **insidor.app** stays the A records above. In Vercel, assign `insidor.app` and
  `www.insidor.app` to the project that should answer there (today `insidor-mobile`; move them
  to `insidor` for the desktop app at the root).
- **m.insidor.app**: add the domain to `insidor-mobile` in Vercel first (Settings → Domains);
  Vercel then shows the exact target. Add `CNAME m <that target>` — it has the form
  `<id>.vercel-dns-016.com.`; `cname.vercel-dns.com.` also works if Vercel shows that.

## 4. Privy (dashboard.privy.io → your app)

- **Login methods:** X on. **Google off.** (The code asks for X only; turn Google off here too.)
- **Wallets:** Solana embedded wallets on, create on login for users without wallets.
- **External wallets:** Solana on, Phantom (and Solflare, Backpack) listed — for linking, view only.
- **Identity tokens:** on ("return user data in the identity token"); social and notify read it.
- **Allowed domains:** `https://m.insidor.app`, `https://insidor.app`, `https://www.insidor.app`,
  your Vercel preview domains (`https://insidor-mobile-*.vercel.app`, `https://insidor-*.vercel.app`),
  and `http://localhost:5174` for local work.

## 5. Health and today's spend

- Railway shows each service's health (green = `/health` answered 200). `project`'s health
  turns red if the board has not been rebuilt for five minutes.
- `https://<read domain>/health`, `/social` and `/notify` domains `/health`.
- **Today's spend:** the runner prints `spentTodayUsd` at boot and records every call in
  `internal.spend`. From your laptop: `pnpm db:psql` then
  `select vendor, round(sum(usd)::numeric, 2) from internal.spend where at >= date_trunc('day', now() at time zone 'utc') group by vendor;`

## 6. Switch on, and off fast

On, in order: runner `SPEND=dry` (one hour) → `SPEND=live`, `DISCOVER=on`,
`DAILY_BUDGET_USD=21` → notify `NOTIFY=on` → trade `TRADING=on` with your wallet in
`TRADING_ALLOWLIST`.

Off, fastest first:
1. **Spending:** runner `SPEND=dry` (or set `DAILY_BUDGET_USD=0.01`). Railway redeploys on save.
2. **Trading:** trade `TRADING=off` — every trade route answers "trading is off".
3. **Pushes:** notify `NOTIFY=off` — alerts are listed, nothing is pushed.
4. **Everything:** Railway → service → Settings → Remove deployment (or pause the project).
