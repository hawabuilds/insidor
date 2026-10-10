# @insidor/mobile — the phone app

A separate web app for phones, next to the desktop app in `app/`. Same wall: it may import
`@insidor/contracts` and `@insidor/wallet` and nothing else, and it reads data only from the
read service (`services/read`).

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
| Narratives list and its pages | sample only — there is no read route yet. Absent from a production build |
| Token page | the coin's fields from the wire; price history, trades and curve progress are sample only and say "not available yet" against the read service |
| Create coin | a form; the button says Coming soon |
| Search, Calls, Wallet | Coming soon |

Buy, Sell and Create do nothing but show "Coming soon". `submitTrade` is unimplemented and
nothing calls it; `src/screen-rules.test.ts` fails if anything does.
