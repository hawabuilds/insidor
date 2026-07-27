## 5. AUTH AND SECURITY

Identity is a Solana wallet, held by Privy. It is not a Supabase Auth user, and it never
will be. Everything below follows from that one fact and from a second one that is easy
to state and expensive to forget: **Supabase chooses a Postgres role by reading the
literal `role` claim out of the presented JWT, and falls back to `anon` when it is
absent.** Privy's access token has a closed claim set — `sid`, `sub`, `iss`, `aud`,
`iat`, `exp` — and no documented claim-injection hook. A Privy token handed to PostgREST
does not fail; it succeeds *as `anon`*, returns HTTP 200 with zero rows, and renders a
portfolio page reading `$0` for a user who is holding. That is the silent-wrongness
shape this whole document exists to prevent, so it is designed against rather than
discovered.

### 5.1 The decision: server-side writes on the service role

**v1: every write goes through a Next.js Route Handler that verifies the Privy token
itself and then writes with the service role.** Supabase third-party auth via `jwks_url`
is phase 2, not v1.

Four reasons, in order of weight.

1. **There is no `authenticated` principal to authorise against.** Privy meets
   Supabase's stated third-party requirement (asymmetric keys with a `kid`;
   `https://auth.privy.io/api/v1/apps/<app_id>/jwks.json` returns EC P-256 / `ES256`),
   and Supabase's `POST /v1/projects/{ref}/config/auth/third-party-auth` accepts a
   generic `jwks_url` — the five named providers are guides, not an allow-list. Note
   `jwks_url`, **not** `oidc_issuer_url`: `auth.privy.io` serves no
   `/.well-known/openid-configuration` (404). None of that helps, because the token
   still carries no `role`.
2. **The `sub` is the wrong type.** Privy's `sub` is a DID (`did:privy:cl…`);
   `app_user.id` is a `uuid`. Even with claim injection, a policy written
   `user_id::text = auth.jwt() ->> 'sub'` compiles, runs, and evaluates FALSE forever.
   **`0011_rls.sql` as merged contains exactly that expression in six places.** It is
   corrected in 5.4 below, and it is the single most important correction in this
   section.
3. **The highest-volume follower class is anonymous device follows**, which have no
   principal at all. No policy can distinguish the owner of a `device_id` from anyone
   who guesses one, so that path is server-routed regardless of what the authenticated
   path does.
4. **Every write has an invariant that requires a server-side READ.** The comment stamp
   needs a Helius balance call. The launch needs a fresh `count(confirmed) = 0` at
   submit. The trade needs a SOL price captured server-side. A direct client insert
   cannot satisfy any of them, so a client insert path would have to be forbidden
   anyway — which means building it buys nothing and adds a second way in.

**What we give up** is one hop of latency and the use of PostgREST as a write API.
Neither is load-bearing: no write in this product sits on the board's 2-second path.

**The migration path, and it is not the obvious one.** Phase 2 is *not* persuading Privy
to inject `role`. It is **minting our own Supabase JWT** in the route that already
verifies the Privy token: import a signing key into Supabase, mint
`{ sub: <app_user.id>, role: 'authenticated', exp: now + 15m }`, hand it to the browser,
and let PostgREST enforce the owner policies directly. The DID→uuid problem disappears
because we choose the `sub`. The precondition is that `current_app_user()` already
accepts **both** shapes, which is why it is written the way it is below — phase 2 then
becomes a config change plus a token endpoint, with zero policy edits and zero schema
change. Two things to settle first: whether a self-minted JWT counts against Supabase's
third-party MAU meter at $0.00325 (ask billing), and a 15-minute TTL with a silent
refresh so a stale tab does not 401 mid-scroll.

### 5.2 The flow end to end

A user lands, connects a wallet, and forty minutes later posts a comment.

```
 1  GET /story/<id>          RSC renders with the ANON key through RLS. No session.
                             Browser holds: nothing.
 2  Connect wallet           Privy modal -> embedded or external wallet.
                             Privy issues an ACCESS TOKEN (~1h, JWT, ES256) and an
                             IDENTITY TOKEN. Both live in Privy's own cookie/memory.
                             We store neither ourselves.
 3  First authed call        client: await getAccessToken()   <- ALWAYS re-read, never
                             cached in our own state; the SDK refreshes near expiry.
                             POST /api/comments
                               Authorization: Bearer <privy access token>
                               body: { storyId, body }        <- NO wallet address.
 4  Route: verify            jose.jwtVerify(token, JWKS, { issuer, audience })
                             JWKS cached in module scope, remote-refetched on unknown
                             kid. Failure of ANY kind -> 401. Never a fallback path.
 5  Route: resolve           did -> app_user (upsert on first sight).
                             wallet address read from PRIVY'S API using the app secret,
                             never from the request body. Bound once, frozen forever.
 6  Route: establish facts   Helius: does this wallet hold this story's top coin?
                             coin_match: confirmed count, unsure count.
                             story: age, views, top mcap.
                             -> the eleven snap_* columns, computed SERVER-SIDE.
 7  Route: write             SERVICE-ROLE client constructed from env in-process.
                             insert into comment (..., user_id = <resolved uuid>, ...)
                             DB triggers: tier gate, address gate, 3/60s speed limit.
 8  Database: broadcast      AFTER INSERT trigger, status='visible' only ->
                             realtime.send(sanitised row, 'insert', 'story:<id>', true)
 9  Every browser on         one ref-counted socket receives the frame. Token refresh
    that story               loop keeps the socket alive past the hour (5.6).
```

Step 5 is where forged input dies. The wallet address is **never** a request field. It is
fetched from Privy server-side with `PRIVY_APP_SECRET`, written once into
`app_user.wallet_address`, and frozen by the `app_user_freeze` trigger already in `0007`
(`freeze_columns('privy_did','wallet_address')`) with a `UNIQUE` constraint on top. One
address, one DID, permanently. A client that posts `{ wallet: <someone else's> }` is
posting a field nothing reads.

Step 7 has a trap worth naming because it is the mistake that will be made: **never
construct the Supabase client from a forwarded `Authorization` header.** Supabase's
documentation is unambiguous that it adheres to the RLS policy of the signed-in user
even when the client was initialised with the service key. Since the route has already
verified a Privy token, forwarding it is the natural thing to type — and it silently
demotes the route off the service role, at which point every write fails closed and
every read returns empty. The factories in 5.5 make it impossible to type.

**Token lifetime.** Privy access tokens live about an hour. The client calls
`getAccessToken()` immediately before every request and never stores the string; the SDK
handles refresh. The server treats `exp` as absolute — no clock skew allowance beyond
jose's default, no "recently expired is fine" branch.

### 5.3 The verification code

We verify with `jose` and `createRemoteJWKSet` rather than through
`@privy-io/node`'s helper. That is a deliberate choice against the SDK: we need to
assert `iss` and `aud` explicitly and to control the failure taxonomy, and this project
has already been burned once by a helper whose error handling was assumed rather than
read (the retry that only retried 429). `jose` is also the library that mints the
phase-2 Supabase JWT, so it is one dependency, not two.

```ts
// apps/web/src/features/wallet/server/verify.ts
import 'server-only';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { serverEnv } from '@insidor/env';

/** Privy's per-app JWKS. NO /.well-known/openid-configuration exists (404), so the
 *  URL is constructed, not discovered.
 *  ⚠ VERIFY: that this path is a supported public contract (open item U8), and that
 *  `iss` is literally "privy.io" on a live token. Read a real token before trusting
 *  either. Both are asserted below, so a change breaks loudly, not silently. */
const JWKS = createRemoteJWKSet(
  new URL(`https://auth.privy.io/api/v1/apps/${serverEnv.NEXT_PUBLIC_PRIVY_APP_ID}/jwks.json`),
  { cacheMaxAge: 10 * 60_000, timeoutDuration: 4_000 },
);

export type PrivyClaims = JWTPayload & { sub: string; sid: string };

export class AuthError extends Error {
  constructor(readonly reason: string) { super(reason); }
}

export async function verifyPrivyToken(authorization: string | null): Promise<PrivyClaims> {
  const raw = authorization?.startsWith('Bearer ') === true ? authorization.slice(7) : null;
  if (raw === null || raw.length === 0) throw new AuthError('missing_bearer');

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(raw, JWKS, {
      issuer: 'privy.io',
      audience: serverEnv.NEXT_PUBLIC_PRIVY_APP_ID,
      algorithms: ['ES256'],          // pinned. `none` and HS* are unrepresentable.
      clockTolerance: 0,
    }));
  } catch (e) {
    // EVERY failure is 401. There is no branch here that continues on error, and no
    // catch that returns a default principal. This is the shape of the safety-endpoint
    // defect: a read that could not establish a fact must not report the safe answer.
    throw new AuthError(e instanceof Error ? e.name : 'verify_failed');
  }

  if (typeof payload.sub !== 'string' || !payload.sub.startsWith('did:privy:')) {
    throw new AuthError('sub_not_a_privy_did');
  }
  if (typeof payload.sid !== 'string') throw new AuthError('missing_sid');
  return payload as PrivyClaims;
}
```

```ts
// apps/web/src/features/wallet/server/principal.ts
import 'server-only';
import { serviceClient } from '@insidor/db';
import { serverEnv } from '@insidor/env';
import { verifyPrivyToken, AuthError } from './verify';

export type Principal = { userId: string; did: string; wallet: string };

/** The wallet address comes from PRIVY, never from the request. Privy's ACCESS token
 *  carries no linked accounts — only the identity token does, and a client-supplied
 *  identity token is a client-supplied wallet. So we ask Privy directly.
 *  ⚠ VERIFY on the day this is written: endpoint path, the `privy-app-id` header, and
 *  Basic auth = base64(app_id:app_secret). Documented, not yet called by us. */
async function privyWallet(did: string): Promise<string> {
  const res = await fetch(`https://auth.privy.io/api/v1/users/${encodeURIComponent(did)}`, {
    headers: {
      authorization: `Basic ${Buffer.from(
        `${serverEnv.NEXT_PUBLIC_PRIVY_APP_ID}:${serverEnv.PRIVY_APP_SECRET}`,
      ).toString('base64')}`,
      'privy-app-id': serverEnv.NEXT_PUBLIC_PRIVY_APP_ID,
    },
    signal: AbortSignal.timeout(4_000),
  });
  // Any non-2xx throws. A 402, a 403 and a 500 are all failures — the old build's
  // retry helper retried only 429 and let a 402 vanish for two days.
  if (!res.ok) throw new AuthError(`privy_user_http_${res.status}`);
  const user = (await res.json()) as { linked_accounts?: { type: string; chain_type?: string; address?: string }[] };
  const w = user.linked_accounts?.find(
    (a) => a.type === 'wallet' && a.chain_type === 'solana' && typeof a.address === 'string',
  );
  if (w?.address === undefined) throw new AuthError('no_solana_wallet_linked');
  return w.address;
}

/** The ONE function every authed route starts with. */
export async function requirePrincipal(req: Request): Promise<Principal> {
  const { sub: did } = await verifyPrivyToken(req.headers.get('authorization'));
  const db = serviceClient();

  const existing = await db.from('app_user')
    .select('id, wallet_address').eq('privy_did', did).maybeSingle();
  if (existing.error !== null) throw existing.error;
  if (existing.data !== null && existing.data.wallet_address !== null) {
    void db.from('app_user').update({ last_seen_at: new Date().toISOString() }).eq('id', existing.data.id);
    return { userId: existing.data.id, did, wallet: existing.data.wallet_address };
  }

  const wallet = await privyWallet(did);
  const up = await db.from('app_user')
    .upsert({ privy_did: did, wallet_address: wallet }, { onConflict: 'privy_did' })
    .select('id, wallet_address').single();
  // 23505 on wallet_address means this address is already bound to another DID.
  // That is a takeover attempt or a Privy account merge; it is a 409, never a rebind.
  if (up.error !== null) throw up.error;
  return { userId: up.data.id, did, wallet: up.data.wallet_address! };
}
```

```ts
// apps/web/src/app/api/comments/route.ts — 12 lines, inside the 40-line cap.
export { POST } from '@server/discussion';
```

```ts
// apps/web/src/features/discussion/server/comments.handler.ts (abridged to the auth path)
import 'server-only';
import { CommentInput } from '@insidor/contracts';
import { requirePrincipal, AuthError } from '@server/wallet';
import { pgStatus } from './pg-error';

export async function POST(req: Request): Promise<Response> {
  let p;
  try { p = await requirePrincipal(req); }
  catch (e) {
    if (e instanceof AuthError) return Response.json({ error: e.reason }, { status: 401 });
    throw e;
  }
  const parsed = CommentInput.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: 'invalid' }, { status: 422 });

  const stamp = await buildStamp(parsed.data.storyId, p.wallet); // Helius + coin_match, server-side
  const ins = await serviceClient().from('comment').insert({
    story_id: parsed.data.storyId,
    user_id: p.userId,               // resolved, never from the body
    author_wallet: p.wallet,         // bound, never from the body
    body: parsed.data.body,
    ...stamp,
  }).select('id').single();

  if (ins.error !== null) return pgStatus(ins.error);   // 23505->409, IR429->429, 23514->422
  return Response.json({ id: ins.data.id }, { status: 201 });
}
```

### 5.4 RLS — the read path, and the correction to `0011`

The policies are almost entirely SELECT policies. They exist to make the coinability
tier and the moderation state unbypassable on the half a browser can actually reach.
`0011` gets them right in structure and wrong in the predicate: six policies compare
`user_id::text` to the raw `sub`, which under a Privy token is a DID and never a uuid.
Nothing has been applied to any database yet (open item 1), so **the fix lands in `0011`
itself**; if any environment has already applied it, the identical block ships as
`0016_auth_principal.sql`, since a merged-and-applied migration is immutable.

```sql
-- Replaces the six `user_id::text = ... ->> 'sub'` predicates in 0011.
--
-- Accepts BOTH principal shapes deliberately:
--   * a Privy DID  -> resolved through app_user.privy_did      (phase 1, inert)
--   * a uuid       -> our own app_user.id                      (phase 2, live)
-- so switching to server-minted Supabase JWTs is a config change, not a policy rewrite.
--
-- nullif() is not decoration: PostgREST sets request.jwt.claims to the EMPTY STRING on
-- some paths, and ''::jsonb raises INSIDE the policy — failing the entire query rather
-- than filtering a row. The CASE guard around ::uuid is the same discipline: WHERE-clause
-- evaluation order is not guaranteed, so the regex cannot protect the cast from there.
CREATE OR REPLACE FUNCTION public.current_app_user() RETURNS uuid
LANGUAGE sql STABLE AS $$
  WITH claim AS (
    SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub' AS sub
  ), norm AS (
    SELECT sub,
           CASE WHEN sub ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN sub::uuid END AS sub_uuid
      FROM claim
  )
  SELECT u.id FROM public.app_user u, norm n
   WHERE u.privy_did = n.sub OR u.id = n.sub_uuid
   LIMIT 1
$$;

-- Owner-scoped reads. Note `(select public.current_app_user())`, not a bare call: the
-- subselect form is evaluated ONCE as an InitPlan instead of per row. On `holding` that
-- is the difference between one app_user lookup and one per position.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['holding','trade','notification','notification_prefs',
                           'push_subscription','follow'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_read', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
        USING (user_id = (SELECT public.current_app_user()))
    $f$, t || '_owner_read', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS comment_author_read ON public.comment;
CREATE POLICY comment_author_read ON public.comment FOR SELECT TO authenticated
  USING (user_id = (SELECT public.current_app_user()));

DROP POLICY IF EXISTS follow_owner_write ON public.follow;
CREATE POLICY follow_owner_write ON public.follow FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT public.current_app_user()) AND device_id IS NULL);
DROP POLICY IF EXISTS follow_owner_delete ON public.follow;
CREATE POLICY follow_owner_delete ON public.follow FOR DELETE TO authenticated
  USING (user_id = (SELECT public.current_app_user()));

-- FORCE, not just ENABLE. Without FORCE, a table's OWNER bypasses its own policies —
-- and the owner is the role the migrations run as.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['story','post','coin','coin_match','comment','holding','trade',
                           'follow','app_user','notification','launch'] LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
```

`launch`, `comment` and `trade` INSERT are deliberately not granted even to
`authenticated`, permanently — the stamp needs a chain read, the launch needs a fresh
confirmed-count, the trade needs a server-captured SOL price. The route is the only path.

**An invariant test, because a policy nobody exercises is a comment.**

```sql
-- supabase/tests/invariants.sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"did:privy:notarealuser"}', true);
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.holding) = 0, 'unknown DID must see zero holdings';
END $$;
SELECT set_config('request.jwt.claims', format('{"sub":"%s"}', (SELECT privy_did FROM public.app_user LIMIT 1)), true);
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.holding) > 0, 'a known DID must see its own holdings — '
    'this is the assertion that catches the DID/uuid mismatch that returns 200 with zero rows';
END $$;
RESET ROLE;
```

### 5.5 The service-role boundary

Three factories, three files, one of which is firewalled. The names differ so a wrong
import reads wrong.

```ts
// packages/db/src/browser.ts — anon key. Ships to the browser. This is fine.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types.generated';
import { clientEnv } from '@insidor/env';

let singleton: ReturnType<typeof createClient<Database>> | undefined;
export function browserClient() {
  singleton ??= createClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false }, realtime: { params: { eventsPerSecond: 4 } } },
  );
  return singleton;
}
```

```ts
// packages/db/src/server.ts — anon key, request-scoped, for RSC reads through RLS.
import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types.generated';
import { serverEnv } from '@insidor/env';

/** Reads only. If you are here to write, you want serviceClient() in a route handler. */
export function requestClient(accessToken?: string) {
  return createClient<Database>(
    serverEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: accessToken === undefined ? {} : { headers: { Authorization: `Bearer ${accessToken}` } },
    },
  );
}
```

```ts
// packages/db/src/service.ts
// THE ONLY FILE IN THE REPOSITORY THAT NAMES SUPABASE_SERVICE_ROLE_KEY.
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types.generated';
import { serverEnv } from '@insidor/env';

let singleton: SupabaseClient<Database> | undefined;

/** Bypasses RLS. Takes NO arguments — in particular it cannot be handed a request or a
 *  header, because the failure mode this signature exists to prevent is a caller
 *  "helpfully" forwarding the user's Authorization header, which demotes the client off
 *  the service role and silently returns zero rows on every read and denies every write. */
export function serviceClient(): SupabaseClient<Database> {
  singleton ??= createClient<Database>(
    serverEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { 'x-insidor-role': 'service' } } },
  );
  return singleton;
}
```

What structurally prevents the key reaching the browser, in firing order:

| Layer | Mechanism | Failure mode it removes |
|---|---|---|
| Env schema | `SUPABASE_SERVICE_ROLE_KEY` exists only in `packages/env`'s **server** schema and is outside the `NEXT_PUBLIC_` namespace. Next inlines nothing else. | Even a bundled import evaluates to `undefined`, not a key. |
| Module | `import 'server-only'` on line 1 of `service.ts`. | A `'use client'` graph reaching it fails the **build**, not a lint. |
| Signature | `serviceClient()` takes no parameters. | The forwarded-header demotion is untypeable. |
| Lint | ui/ and hooks/ may not name `@insidor/db`, `@insidor/env`, `server-only` or `next/headers` (§2, layer 2). | Direct imports from client segments. |
| Graph | dependency-cruiser `service-key-firewall` with `reachable: true`, from anything outside `features/*/server/` and `apps/pipeline/src/`. | **Transitive** reach — a client component importing a barrel that re-exports a repo. This is the one that actually catches it. |
| Database | `service_role` is the only role holding INSERT/UPDATE/DELETE on any table. | A leaked *anon* key writes nothing. |

Two additions specific to this section:

```js
// eslint.config.mjs — appended. process.env has exactly one legal home.
{
  files: ['apps/**/*.{ts,tsx}', 'packages/**/*.ts'],
  ignores: ['packages/env/src/**', '**/*.config.{ts,js,mjs}'],
  rules: {
    'no-restricted-properties': ['error',
      { object: 'process', property: 'env',
        message: 'packages/env is the only module that reads process.env. No defaults, no ' +
                 'fallbacks: `process.env.X ?? "…"` is the same shape as the token lookup that ' +
                 'returned age 0 — failing OPEN on the axis the product sells.' }],
    'no-restricted-syntax': ['error',
      { selector: 'Literal[value=/^(eyJ|sb_secret_|service_role)/]',
        message: 'That looks like a Supabase key literal. Keys come from @insidor/env.' }],
  },
},
```

A CI grep is the last line, and it is not redundant with the graph rule — it catches the
key arriving in a bundle by a path that is not an import at all (an env var
misconfigured into `NEXT_PUBLIC_`, an inlined literal, a source map):

```bash
# .github/workflows/ci.yml, after `next build`
if grep -rlE '(sb_secret_|"role" *: *"service_role")' apps/web/.next/static/ ; then
  echo '::error::service-role material found in a client chunk'; exit 1
fi
```

### 5.6 Realtime auth

The failure everyone predicts: Realtime caches channel authorisation for the connection
lifetime and closes the socket when the JWT expires, Privy tokens live about an hour, so
without a refresh loop every user silently drops off the live feed after sixty minutes —
values freeze, nothing errors, and the board looks slow rather than broken.

The sharper version of the fix is to be deliberate about *which* token the socket
carries. In v1 there is no `authenticated` role, so the browser connects with the **anon
key** and never with a Privy token — handing Realtime a Privy token would both run as
`anon` anyway and add an hourly disconnect for no benefit. That means `0013`'s private
channels need a policy that lets `anon` read the sharded topics:

```sql
-- 0016_auth_principal.sql. Private channels authorise against realtime.messages.
-- The payloads are already sanitised (broadcast_comment returns early unless
-- status='visible') and carry nothing not already public through 0011, so anon read on
-- these three topic families is the same disclosure the REST path already permits.
CREATE POLICY realtime_public_topics ON realtime.messages FOR SELECT TO anon, authenticated
  USING (realtime.topic() ~ '^(story|coin|board):');
-- Nobody may WRITE a broadcast frame: every frame originates from a SECURITY DEFINER
-- trigger or from the pipeline on the service role. There is no INSERT policy, so a
-- browser cannot inject a fake `match` event and flip a Create button into a Buy.
```

The loop ships anyway, written and tested now, because phase 2 turns the token into a
15-minute Supabase JWT and the loop must already exist on that day. One socket, ref
counted, one token source:

```ts
// apps/web/src/shared/realtime/client.ts
'use client';
import { browserClient } from '@shared/db';

/** Phase 1 returns the anon key (long-lived). Phase 2 returns a 15-minute minted
 *  Supabase JWT. The loop below does not care which, and that is the point: the day the
 *  token becomes short-lived, nothing else changes. */
type TokenSource = () => Promise<string>;

const REFRESH_MS = 50 * 60_000;   // < Privy's ~1h and < any minted TTL we would choose.
let refs = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let getToken: TokenSource | undefined;

async function pushToken(): Promise<void> {
  if (getToken === undefined) return;
  try {
    // setAuth re-sends access_token on EVERY joined channel; it does not re-subscribe,
    // so no frames are lost and no re-authorisation round trip is paid per channel.
    // ⚠ VERIFY: whether setAuth returns a promise in the installed supabase-js. Await
    // works either way; a non-promise resolves immediately.
    await browserClient().realtime.setAuth(await getToken());
  } catch {
    // Never leave a stale token in place silently. A failed refresh retries in 30s and
    // surfaces as the amber `polling fallback` rail state if it keeps failing.
    setTimeout(() => void pushToken(), 30_000);
  }
}

/** A pure interval is NOT sufficient. A laptop asleep for three hours fires its timers
 *  late, by which time the socket is already closed by the server. These two listeners
 *  are the difference between "works in a demo" and "works after lunch". */
function onWake() { void pushToken(); }

export function acquireRealtime(source: TokenSource) {
  getToken = source;
  if (refs++ === 0) {
    void pushToken();
    timer = setInterval(() => void pushToken(), REFRESH_MS);
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('online', onWake);
  }
  return () => {
    if (--refs === 0) {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('online', onWake);
    }
  };
}
```

```ts
// apps/web/src/shared/realtime/__tests__/refresh.test.ts
it('re-mints before the token can expire', async () => {
  vi.useFakeTimers();
  const source = vi.fn().mockResolvedValue('t');
  acquireRealtime(source);
  await vi.advanceTimersByTimeAsync(59 * 60_000);
  // 1 initial + 1 at 50 minutes. If this is ever 1, every user drops off at the hour.
  expect(source).toHaveBeenCalledTimes(2);
});
```

### 5.7 Rate limiting

Two layers, because they catch different things and neither subsumes the other.

**Edge**, before a function holding a service key starts. This is what bounds the
metered-vendor bill: an `/api/order` that reaches the handler has already spent a Jupiter
call. `checkRateLimit` needs a `request` object, which is the concrete reason every money
endpoint is a Route Handler and never a Server Action.

```ts
// apps/web/src/features/wallet/server/limit.ts
import 'server-only';
import { checkRateLimit } from '@vercel/firewall';

/** ⚠ VERIFY: the return shape of @vercel/firewall's checkRateLimit and that a rule with
 *  this id exists in the project firewall config. A missing rule must not read as
 *  "allowed" — hence the fail-closed default below. */
export async function edgeLimit(req: Request, id: string, key: string): Promise<Response | null> {
  try {
    const { rateLimited } = await checkRateLimit(id, { request: req, rateLimitKey: key });
    return rateLimited ? new Response(null, { status: 429, headers: { 'retry-after': '10' } }) : null;
  } catch {
    // A money endpoint whose limiter is unreachable is CLOSED, not open. This is the
    // rule the RugCheck defect broke in the other direction.
    return new Response(null, { status: 503 });
  }
}
```

**Database**, because edge counters are regional. Vercel's rate limit is enforced per
region; a client that spreads requests across regions — trivially, by resolving the
anycast address from several networks — gets N times the cap. A global cap has to live
somewhere global, and the only globally consistent thing in this architecture is
Postgres. It also survives two tabs, two devices and a retry spanning a deploy.

```sql
-- 0016_auth_principal.sql
CREATE TABLE IF NOT EXISTS insidor.rate_bucket (
  scope        text        NOT NULL,
  key          text        NOT NULL,
  window_start timestamptz NOT NULL,
  n            integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, key, window_start)
);

-- Fixed windows via date_bin: no read-modify-write race, one atomic upsert, and the
-- count is returned by the same statement that increments it.
CREATE OR REPLACE FUNCTION insidor.rate_take(p_scope text, p_key text, p_limit integer, p_window interval)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_n integer;
BEGIN
  INSERT INTO insidor.rate_bucket AS b (scope, key, window_start, n)
  VALUES (p_scope, p_key, date_bin(p_window, now(), timestamptz 'epoch'), 1)
  ON CONFLICT (scope, key, window_start) DO UPDATE SET n = b.n + 1
  RETURNING b.n INTO v_n;
  IF v_n > p_limit THEN
    -- A DISTINCT SQLSTATE. 23514 (check_violation) would be mapped to 422 by the route,
    -- and a rate limit reported as "invalid input" is a bug report we cannot action.
    RAISE EXCEPTION 'rate limit: % per % for %', p_limit, p_window, p_scope USING ERRCODE = 'IR429';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION insidor.launch_rate_limit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM insidor.rate_take('launch', NEW.signer_wallet, 3, interval '1 hour');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS launch_rate_limit ON public.launch;
CREATE TRIGGER launch_rate_limit BEFORE INSERT ON public.launch
  FOR EACH ROW EXECUTE FUNCTION insidor.launch_rate_limit();

CREATE OR REPLACE FUNCTION insidor.trade_rate_limit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM insidor.rate_take('order', NEW.wallet, 20, interval '1 minute');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trade_rate_limit ON public.trade;
CREATE TRIGGER trade_rate_limit BEFORE INSERT ON public.trade
  FOR EACH ROW EXECUTE FUNCTION insidor.trade_rate_limit();

-- A janitor, because an unbounded counter table is a slow outage.
DELETE FROM insidor.rate_bucket WHERE window_start < now() - interval '1 day';
```

The comment limit already exists in `0007` (`comment_speed_limit`, 3 per wallet per 60s)
and stays as written — it counts real rows on an existing index and therefore cannot
disagree with the table it protects.

```ts
// apps/web/src/features/discussion/server/pg-error.ts
const MAP: Record<string, number> = {
  '23505': 409,  // unique violation — a duplicate submission, never a retry
  '23514': 422,  // check violation — address gate, body length, tier
  'IR429': 429,  // rate_take
  '42501': 403,  // insufficient privilege — a policy or grant, not a user error
};
export function pgStatus(e: { code?: string; message: string }): Response {
  const status = MAP[e.code ?? ''] ?? 500;
  return Response.json({ error: e.code ?? 'unknown', message: status === 500 ? 'server error' : e.message }, { status });
}
```

### 5.8 Wallet-signed actions

Buys and mints are signed in the user's wallet. The server's job is to be unable to
believe a client.

**The server must never trust:** that a swap succeeded, the output amount, the signature,
the wallet address, the fee bps, the SOL/USD price, the mint, the decimals, the story
attribution, or the confirmed-coin count the page was rendered with. Every one of those
is either read from a vendor response server-side or read from the chain.

**Can a client claim a swap succeeded?** It can POST anything it likes. It cannot make
that claim load-bearing, for four structural reasons.

1. **The signature does not come from the client.** `/api/execute` receives the *signed
   transaction bytes* and calls Jupiter's `/execute` itself. The signature in
   `trade.signature` is the one Jupiter returns. There is no code path that accepts a
   signature as an input field.
2. **The transaction we broadcast is the transaction we issued.** `/api/order` stores
   `sha256(message_bytes)` on the trade row at `ORDERING`; `/api/execute` recomputes it
   from the submitted bytes and refuses on mismatch. Without that check we are a willing
   relay for any transaction a compromised page hands us, under a UI that says "Buy".
3. **`holding` is written from a chain read, never from a response body.** The confirm
   step fetches the transaction and derives the amount from the token-balance delta for
   the *bound wallet and the requested mint*. A missing or ambiguous delta writes nothing
   and leaves the trade `submitted` — absent is not zero.
4. **Nobody but `service_role` can insert into `holding` or `trade`** (5.4), and
   `trade.request_id` and `trade.signature` are both `UNIQUE`, so a replay is a `23505`
   and therefore a **409**, never a second fill.

```ts
// apps/web/src/features/trading/server/execute.handler.ts (the trust boundary only)
import { createHash } from 'node:crypto';

const bytes = Buffer.from(input.signedTransactionBase64, 'base64');
const tx = VersionedTransaction.deserialize(bytes);

// (a) It is the transaction we issued for THIS request_id.
const digest = createHash('sha256').update(tx.message.serialize()).digest('hex');
if (digest !== trade.order_message_sha256) return json({ error: 'transaction_mismatch' }, 409);

// (b) It is signed by the wallet we bound to this principal — not by whoever the
//     client says. Fee payer is staticAccountKeys[0] by construction.
const feePayer = tx.message.staticAccountKeys[0]!;
if (feePayer.toBase58() !== principal.wallet) return json({ error: 'wrong_signer' }, 403);
if (!nacl.sign.detached.verify(tx.message.serialize(), tx.signatures[0]!, feePayer.toBytes())) {
  return json({ error: 'bad_signature' }, 400);
}

// (c) WE broadcast. The signature is Jupiter's answer, not the client's assertion.
const res = await jupiter.execute({ signedTransaction: input.signedTransactionBase64, requestId: trade.request_id });
await db.from('trade').update({ status: 'submitted', signature: res.signature, submitted_at: now }).eq('id', trade.id);
```

```ts
// apps/web/src/features/trading/server/confirm.ts — the ONLY writer of a holding row.
const tx = await helius.getTransaction(signature, { maxSupportedTransactionVersion: 0 });
if (tx === null) return { state: 'still_confirming' };          // NOT failed. NOT zero.
if (tx.meta?.err != null) return { state: 'reverted' };

const pre  = tx.meta.preTokenBalances ?.find((b) => b.mint === trade.mint && b.owner === trade.wallet);
const post = tx.meta.postTokenBalances?.find((b) => b.mint === trade.mint && b.owner === trade.wallet);
if (post === undefined) return { state: 'unreadable' };          // renders `—`, never 0
const deltaRaw = BigInt(post.uiTokenAmount.amount) - BigInt(pre?.uiTokenAmount.amount ?? '0');
if (deltaRaw <= 0n) return { state: 'unreadable' };
// out_amount_raw is deltaRaw. The client's number, if it sent one, was never read.
```

Launches carry the same shape plus one rule the browser cannot enforce: the mint keypair
is generated and persisted encrypted **before** the first signature (`0008`,
`launch.mint_keypair_enc`, frozen), so a retry reuses it and a late confirmation fails
with "account already in use" instead of minting twice. `/api/launch/confirm` re-runs
`count(confirmed) = 0` server-side at submit, so nobody pays gas to duplicate a coin the
page was already hiding, and the tier gate is a composite foreign key
(`launch_requires_normal_tier`) rather than a check anyone can skip.

### 5.9 Secrets

| Secret | Lives in | Read by | Rotation |
|---|---|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | Vercel, per-environment | browser + web server | Not secret. Changes only with a new Privy app. |
| `PRIVY_APP_SECRET` | Vercel (Production / Preview scoped separately) | `features/wallet/server` only | Privy dashboard rotate → set `_NEXT` → deploy → promote → delete old. Quarterly. |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel + Fly | `packages/db/src/service.ts`, pipeline | Supabase issues a second key; deploy both apps; revoke. **Full audit of `.next/static` after** (5.5 grep). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel | browser | Rotates with the project JWT secret; forces every open socket to reconnect. Do it in a maintenance window or the whole board reloads. |
| `SUPABASE_JWT_SIGNING_KEY` (phase 2) | Vercel | the token endpoint only | Supabase supports two active keys; overlap is the rotation. |
| `LAUNCH_KEYPAIR_ENC_KEY` | Vercel | `features/launch/server` | **Cannot be rotated naively** — it decrypts historical `mint_keypair_enc`. Rotation is re-encrypt-then-swap, or it destroys the ability to retry any in-flight launch. |
| `DEVICE_COOKIE_SECRET` | Vercel | watchlist route | Rotate freely; the cost is anonymous device follows becoming unclaimable. Two-key verify. |
| `JUPITER_API_KEY`, `HELIUS_API_KEY` | Vercel + Fly | adapters | Quarterly, rehearsed on Helius first (open item 18). |
| `MIGRATOR_DATABASE_URL` | GitHub Environment `production` only | `release.yml` | With the `migrator` role password. |

`packages/env` is the only module permitted to read `process.env`, with no defaults and
no fallbacks, and no secret is ever scoped to "All Environments" in Vercel —
`scripts/check-vercel-env-scopes.mjs` fails the PR. The rotation column is new; open item
18 recorded that key rotation was unaddressed, and the answer is the two-key overlap
pattern everywhere except `LAUNCH_KEYPAIR_ENC_KEY`, which is called out because rotating
it the obvious way silently orphans every prepared launch.

Anonymous device follows are a real principal with no identity, so the `device_id` is not
a client-chosen string:

```ts
// apps/web/src/features/watchlist/server/device.ts
import { createHmac, timingSafeEqual } from 'node:crypto';
const sign = (id: string) => createHmac('sha256', serverEnv.DEVICE_COOKIE_SECRET).update(id).digest('base64url');

export function readDevice(req: Request): string | null {
  const raw = cookieFrom(req, 'idv');                       // "<uuid>.<mac>"
  const [id, mac] = raw?.split('.') ?? [];
  if (id === undefined || mac === undefined) return null;
  const want = Buffer.from(sign(id)), got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}
```

Without the MAC, `follow_device_id_shape` in `0007` accepts any 16–64 hex string and a
scraper can enumerate other devices' watchlists. HttpOnly, `SameSite=Lax`, 400 days.

### 5.10 Abuse

A wallet costs a fraction of a cent, so wallet-gating is not sybil resistance and is not
claimed as any. The defence is that the two things worth attacking are structurally
expensive or structurally unreachable.

**The ranking has no user-supplied input at all.** `PostHeat` is arithmetic over
engagement counts on X and TikTok; `CoinHeat` is arithmetic over Jupiter's market data.
Follows, watchlists, comments and clicks appear in **no term of either formula**, and
story attachment is a filter and a tiebreak rather than a multiplier — deliberately, so
that gaming the matcher, the 0.97-precision-critical component, buys nothing. There is
therefore no sybil attack on the board, because there is no input to sybil. Any future
proposal to add an engagement term to the ranking reopens this section; that is the
review trigger.

**Match reports are advisory, not actuating.** A report (5/day per principal) enqueues a
matcher re-run and never retracts a match. Retraction is the matcher's own verdict. A
hundred wallets reporting a correct match achieve one re-run.

**Comments are shaped so volume does not pay.** Three defences already in the schema, one
new.

- The discussion sort key is `(story_id, snap_views, created_at)` — earliest means
  *written when the story was smallest*. That ordering cannot be farmed by posting more;
  it can only be earned by being early on a story that later mattered, which requires
  being right. Volume moves nobody up.
- The position stamp is a server-side chain read. A `holds` badge is a claim about the
  author's money and `comment_position_holds_needs_amount` refuses the row without the
  lamports and the mint, so a credible-looking comment costs a real position.
- The address gate blocks every base58 run of 32–44 characters, including this story's
  own mints. The payload of comment spam on a memecoin terminal is a contract address;
  there is nothing a user can say with one that they cannot say with `$KANG`, which is
  already auto-linked.
- **New, and the only thing here that raises cost rather than removing reward:** a
  principal whose wallet has no confirmed `trade` and no on-chain history is capped at
  one comment per story per hour and its rows enter `status = 'held'` above a per-story
  volume threshold, promoted by the moderation ladder rather than blocked. Held is
  invisible to everyone but the author (`comment_author_read`), so a farm sees its own
  comments and nobody else does — a spammer who cannot observe the failure does not
  iterate against it.

**The sybil entry point is account creation, not commenting.** Every new DID is a Privy
MAU we pay for, so `requirePrincipal`'s first-sight upsert carries its own edge limit
keyed on IP with a lower per-ASN ceiling, and a first-sight rate above baseline writes
`ops_event(kind='auth_signup_burst', severity='page')`. That is the one abuse signal that
costs money the moment it starts, so it pages rather than warns.

**Everything auth rejects is counted.** `verifyPrivyToken` failures increment an
`ops_sli_sample` by reason. A step change in `sub_not_a_privy_did` or
`privy_user_http_*` is either an attack or a Privy API change, and the two are
indistinguishable from the application's point of view — which is exactly why the alarm
is on the rate rather than on any interpretation of it.
