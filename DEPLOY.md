# Deploying — Vercel, Supabase, and the one piece that needs a real process

**You do not need Docker.** It appears in `SETUP.md` for one reason: to give you a
Postgres on a laptop. If you already have a hosted Postgres, skip it entirely.

---

## 1. Point at your own Postgres

Only `pnpm db:up` uses Docker. Every other command reads `DATABASE_URL` and does not
care where the database lives.

In `.env.local`:

```
DATABASE_URL=postgresql://postgres:PASSWORD@db.xxxx.supabase.co:5432/postgres
DATABASE_URL_SERVICE=postgresql://postgres:PASSWORD@db.xxxx.supabase.co:5432/postgres
DATABASE_URL_INTERNAL=postgresql://postgres:PASSWORD@db.xxxx.supabase.co:5432/postgres
```

Then, **skipping `db:up`**:

```bash
pnpm db:migrate     # 21 migrations
pnpm db:seed
pnpm db:project && pnpm db:sources
```

### Two things that can bite on a hosted Postgres

**`create extension vector`** — migration `0002` needs pgvector. Supabase has it;
enable it in Database → Extensions if the migration complains.

**`create role`** — migration `0001` creates three NOLOGIN group roles, and
`db:migrate` then creates the login user `insidor_app_user`. Supabase's `postgres`
user can do this. If it fails, that is the cause.

★ **Do not skip the roles to get past an error.** They are the security boundary:
the read service connects as `insidor_app_user`, which has no access to `internal.*`
at all. A query that would leak our internal scoring gets `permission denied` from
Postgres rather than rendering. Running everything as `postgres` silently removes
that guarantee.

`DATABASE_URL_APP` must point at `insidor_app_user`, never at `postgres`:

```
DATABASE_URL_APP=postgresql://insidor_app_user:insidor_app@db.xxxx.supabase.co:5432/postgres
```

★ **Not the transaction-mode pooler (port 6543).** It releases session advisory locks
between statements, which silently stops `withAdvisoryLock` guarding anything.
`store/src/client.ts` refuses that URL rather than let it happen. Use port 5432.

---

## 2. What fits Vercel, and what does not

| Piece | Vercel? | Why |
|---|---|---|
| `app/` — the React UI | ✅ ideal | a static build, exactly what Vercel is for |
| every `db:*` command | ✅ **Vercel Cron** | each is one-shot: connect, do the work, exit |
| `services/read` | ⚠️ adaptable | long-lived today — see below |
| `services/chainwatch` | ❌ **needs a real process** | holds a websocket open |

### The `db:*` commands are cron jobs

Each runs once and exits, which is the shape Vercel Cron wants. A reasonable cadence:

```
pnpm db:market      every 5 min    prices        (free, no key)
pnpm db:project     every 1 min    rebuild the board
pnpm db:pairs       every 5 min
pnpm db:sources     every 5 min    source health
pnpm db:decide      every 5 min    run the stages, write decisions
pnpm db:label       hourly         grade outcomes whose window has closed
```

`db:decide` **cannot spend money** — it declares `SPEND=dry` and `DISCOVER=off` for
itself, so it decides over rows already in the database and contacts nobody.

### `services/read` — adaptable, with one loss

It is a plain `node:http` server that holds a Postgres `LISTEN` and pushes Server-Sent
Events, so the board updates without a refresh. Serverless cannot hold either.

Two options:

- **Run it as a real process** (Railway / Fly / Render — all have free tiers). Keeps
  the live board.
- **Port the three routes to serverless functions** and drop the live channel. The app
  already polls for the launches rail, so it degrades to polling everywhere. You lose
  instant updates, nothing else.

★ If you port it, keep the credential rule: the functions must connect as
`insidor_app_user`. `services/read/src/config.ts` refuses to start if
`DATABASE_URL_APP` is missing **or equal to `DATABASE_URL`**, and that refusal is the
whole reason a bug in that service cannot leak.

### `services/chainwatch` — the genuine mismatch

It holds one long-lived websocket to the mint stream and writes every mint as it
happens. Serverless cannot hold a socket open, so this needs somewhere always-on.

★ **And it is not just "run it somewhere".** Its value is the *coverage log*: every
disconnect, restart and buffer overflow writes a row saying "we could not answer for
this window". Running it as repeated short-lived invocations would produce a gap on
every single start, which is honest but useless.

Options:

1. **One small always-on host.** A free tier is enough — it is one socket and a small
   write rate.
2. **Implement the `poll` transport.** `MINT_FEED_TRANSPORT=poll` exists in the config
   and is deliberately `NotImplemented`. A polled listing over a cursor would fit cron
   at the cost of missing mints between polls — and the coverage log would need to
   record those windows honestly rather than pretending continuity.

---

## 3. The order that will not surprise you

```
1. Postgres first        DATABASE_URL → migrate → seed → project
2. The app on Vercel     VITE_READ_URL → wherever the read service ends up
3. The read service      a real process, or ported to functions
4. Cron for the db: jobs
5. chainwatch last       always-on host, or the poll transport
```

Everything above is **free**. No API key is needed for any of it: prices come from
DexScreener and mints from the public stream, neither of which has a signup.

★ The shipped defaults are `SPEND=dry` and `DISCOVER=off`, so **nothing contacts a paid
vendor until both are deliberately turned on** — even with a key pasted in. See the
cost section at the top of `.env.example` before changing either.
