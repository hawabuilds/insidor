/**
 * KEEPS A FRESH FOMO LOGIN FOR THE CHART'S THESES (theses.ts), WITHOUT A PERSON IN THE LOOP.
 *
 * fomo signs in through Privy: the API takes a 1-hour access token (the `privy-token` cookie), and a
 * long-lived refresh token (30 days) mints a new access token when the old one expires. fomo's own
 * site does this every hour in the browser; here the read service does it, so the owner sets the
 * refresh token ONCE instead of copying a cookie every hour (the owner, 2026-11-07: "build the
 * auto-renewal", with the fomo team's leave to read theses on their own account).
 *
 * ★ THE REFRESH TOKEN IS THE OWNER'S, SET AS `FOMO_REFRESH_TOKEN` ON RAILWAY, NEVER BY CODE AND NEVER
 * LOGGED. It is this module's only secret; it is held in memory, swapped for the rotated one Privy
 * returns on each refresh, and never written to a reply, a log line or the database (the read role is
 * read-only by design — services/read config.ts). A restart falls back to the env token; if Privy
 * rotates refresh tokens and one rotated since it was set, the fallback is stale and the owner is
 * told to set a fresh one (health-bars `fomoTheses`). Railway restarts only on a deploy, so this is
 * rare; with rotation off the env token lasts its 30 days.
 *
 * ★ EVERY WAY IT CAN FAIL IS A TYPED REASON, NEVER A WRONG LOGIN. Not configured (no refresh token),
 * the refresh refused (the token expired or was revoked), or Privy unreachable: `null` with why, so
 * theses.ts shows the bubbles as unavailable rather than drawing an empty chart.
 *
 * What breaks if changed carelessly: the access token is read back from the JWT's own `exp`, and
 * renewed a minute before it, so a slow clock never sends an expired cookie; and the refresh request
 * carries the `origin` Privy demands (its own "missing_origin" refusal) — dropping it breaks renewal.
 */

import type { Logger } from './log.ts';

/** Privy's browser session endpoint; `FOMO_PRIVY_URL` overrides it. */
const DEFAULT_PRIVY_URL = 'https://auth.privy.io/api/v1/sessions';
/** fomo's Privy app id (the `aud` of its access token); `FOMO_PRIVY_APP_ID` overrides it. */
export const DEFAULT_FOMO_APP_ID = 'cm6h485o300n3zj9yl6vpedq7';
/** The origin Privy requires on a session call; fomo's own. `FOMO_PRIVY_ORIGIN` overrides it. */
const DEFAULT_ORIGIN = 'https://fomo.family';
/** Renew this long before the access token's own expiry, so a slow clock never sends a dead cookie. */
const RENEW_BEFORE_MS = 60_000;
const TIMEOUT_MS = 8_000;

export type SessionWhy = 'not_configured' | 'login_expired' | 'unavailable';
export type SessionResult = { readonly cookie: string } | { readonly cookie: null; readonly why: SessionWhy };

/** The `exp` of a JWT in ms, or null when it has none we can read. The signature is never checked here — Privy issued it. */
export function jwtExpiryMs(jwt: string): number | null {
  const part = jwt.split('.')[1];
  if (part === undefined) return null;
  try {
    const json = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as { exp?: unknown };
    return typeof json.exp === 'number' && Number.isFinite(json.exp) ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** The access token out of a Privy session reply: the first JWT-shaped field, else a Set-Cookie token. */
function accessTokenOf(body: Record<string, unknown>, setCookie: string | null): string | null {
  for (const k of ['token', 'privy_access_token', 'access_token']) {
    const v = body[k];
    if (typeof v === 'string' && v.split('.').length === 3) return v;
  }
  return setCookie?.match(/privy-(?:access-)?token=([^;]+)/)?.[1] ?? null;
}

/** The rotated refresh token out of a reply: its field, else a `privy-refresh-token` Set-Cookie; null keeps the one we have. */
function refreshTokenOf(body: Record<string, unknown>, setCookie: string | null): string | null {
  for (const k of ['refresh_token', 'privy_refresh_token']) {
    const v = body[k];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return setCookie?.match(/privy-refresh-token=([^;]+)/)?.[1] ?? null;
}

export interface FomoSessionConfig {
  /** The owner's refresh token (`FOMO_REFRESH_TOKEN`); null: not configured, nothing is asked. */
  readonly refreshToken: string | null;
  readonly appId: string;
  readonly privyUrl: string;
  readonly origin: string;
}

/** Reads the session config from the environment; the Privy defaults are fomo's unless overridden. */
export function readFomoSessionConfig(env: Readonly<Record<string, string | undefined>>): FomoSessionConfig {
  const t = (k: string): string | null => { const v = env[k]; return v === undefined || v.trim() === '' ? null : v.trim(); };
  return {
    refreshToken: t('FOMO_REFRESH_TOKEN'),
    appId: t('FOMO_PRIVY_APP_ID') ?? DEFAULT_FOMO_APP_ID,
    privyUrl: t('FOMO_PRIVY_URL') ?? DEFAULT_PRIVY_URL,
    origin: t('FOMO_PRIVY_ORIGIN') ?? DEFAULT_ORIGIN,
  };
}

export interface FomoSessionDeps {
  readonly cfg: FomoSessionConfig;
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => number;
  readonly log: Pick<Logger, 'info'>;
}

/** The cookie fomo's API takes: the fresh access token, plus the static session marker fomo's site sends. */
const cookieFor = (accessToken: string): string => `privy-token=${accessToken}; privy-session=privy.fomo.family`;

/**
 * A live fomo login. `cookie()` returns the current access token as a cookie, renewing it through
 * Privy when it is within a minute of expiry; renewal rotates the refresh token in memory. Renewals
 * never overlap: a second caller during one awaits the same result. Pure of I/O until asked.
 */
export function createFomoSession(deps: FomoSessionDeps): { cookie: () => Promise<SessionResult> } {
  let refreshToken = deps.cfg.refreshToken;
  let accessToken: string | null = null;
  let accessExpMs = 0;
  let inFlight: Promise<SessionResult> | null = null;

  async function refresh(): Promise<SessionResult> {
    if (refreshToken === null) return { cookie: null, why: 'not_configured' };
    try {
      /* Privy moved the refresh token from localStorage to an httpOnly cookie, so the renewal sends it
         BOTH as that cookie and in the body: whichever Privy reads, it works (the owner, 2026-11-07,
         confirmed the cookie is `privy-refresh-token` on fomo's Privy domain). */
      const res = await deps.fetch(deps.cfg.privyUrl, {
        method: 'POST',
        headers: {
          'privy-app-id': deps.cfg.appId,
          origin: deps.cfg.origin,
          'content-type': 'application/json',
          accept: 'application/json',
          cookie: `privy-refresh-token=${refreshToken}`,
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 401 || res.status === 403) {
        deps.log.info('fomo login: the refresh token was refused; set a fresh FOMO_REFRESH_TOKEN', { status: res.status });
        return { cookie: null, why: 'login_expired' };
      }
      if (!res.ok) {
        deps.log.info('fomo login: Privy did not answer', { status: res.status });
        return { cookie: null, why: 'unavailable' };
      }
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const setCookie = res.headers.get('set-cookie');
      const token = accessTokenOf(body, setCookie);
      if (token === null) {
        /* The names only, never a value, so a changed reply shape can be seen from the logs. */
        deps.log.info('fomo login: Privy answered with no access token we could read', { fields: Object.keys(body) });
        return { cookie: null, why: 'unavailable' };
      }
      accessToken = token;
      accessExpMs = jwtExpiryMs(token) ?? deps.now() + 3_600_000;
      /* Privy rotates the refresh token on each use; keep the new one so the next renewal still works. */
      refreshToken = refreshTokenOf(body, setCookie) ?? refreshToken;
      return { cookie: cookieFor(token) };
    } catch (e) {
      deps.log.info('fomo login: Privy unreachable', { err: e instanceof Error ? e.message : String(e) });
      return { cookie: null, why: 'unavailable' };
    }
  }

  return {
    async cookie() {
      if (refreshToken === null) return { cookie: null, why: 'not_configured' };
      if (accessToken !== null && deps.now() < accessExpMs - RENEW_BEFORE_MS) return { cookie: cookieFor(accessToken) };
      /* One renewal at a time; everyone waiting shares its result. */
      if (inFlight === null) inFlight = refresh().finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}
