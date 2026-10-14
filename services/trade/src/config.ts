/**
 * THE TRADE SERVICE'S ONE READ OF THE ENVIRONMENT.
 *
 * ★ OFF UNLESS SAID OTHERWISE, IN THREE INDEPENDENT WAYS. `TRADING` must be exactly `on`; the
 * allowlist must name at least one wallet, or be exactly `*`; and an RPC must be configured. Any
 * one missing and the service answers every trade route with "trading is off" — there is no
 * partial mode where quotes work but builds do not.
 *
 * ★ EVERYONE IS SAID, NEVER IMPLIED. `TRADING_ALLOWLIST=*` (that single token and nothing else)
 * lets any wallet trade — the owner opened trading to everyone on 2026-10-15. An EMPTY allowlist
 * still means nobody: a variable lost in a deploy must close trading, not open it to the world.
 * `*` mixed with addresses is refused at start, so a typo cannot widen a list by accident.
 * Opening it to everyone changes who may ask, not what is built: every transaction is still
 * unsigned and simulated before it is offered for signing.
 *
 * What breaks if changed carelessly: reading `TRADING` as truthy rather than as the exact word
 * `on` would let `TRADING=off` (a non-empty string) turn it on. And checking the allowlist with
 * `Set.has` instead of `isAllowed` would refuse everyone once it is `*`.
 */

export interface TradeConfig {
  readonly port: number;
  readonly trading: boolean;
  /** Wallet addresses allowed to trade, or 'everyone' (`TRADING_ALLOWLIST=*`). Empty means nobody. */
  readonly allowlist: Allowlist;
  readonly rpcUrl: string | null;
  readonly jupiter: { readonly baseUrl: string; readonly apiKey: string | null };
  readonly allowedOrigins: readonly string[];
  /** Creating coins: where their metadata is stored, and the database role that records them. Any null: no create path. */
  readonly launch: { readonly storageUrl: string; readonly storageKey: string; readonly databaseUrl: string } | null;
  /** The app role's database, where every trade is recorded (public.trade, 0062). Null: nothing is recorded. */
  readonly recordsDatabaseUrl: string | null;
}

export type Allowlist = ReadonlySet<string> | 'everyone';

type Env = Readonly<Record<string, string | undefined>>;

const DEFAULT_PORT = 8790;
const DEV_ORIGINS = ['http://localhost:5174', 'http://localhost:5173'];
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const trimmed = (env: Env, key: string): string | null => {
  const v = env[key]?.trim();
  return v === undefined || v === '' ? null : v;
};

export function loadTradeConfig(env: Env): TradeConfig {
  const list = (trimmed(env, 'TRADING_ALLOWLIST') ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
  const everyone = list.length === 1 && list[0] === '*';
  const bad = everyone ? [] : list.filter((a) => !ADDRESS.test(a));
  if (bad.length > 0) throw new Error(`TRADING_ALLOWLIST holds ${bad.length} entr${bad.length === 1 ? 'y' : 'ies'} that are not wallet addresses`);
  const heliusKey = trimmed(env, 'HELIUS_API_KEY');
  const jupiterKey = trimmed(env, 'JUPITER_API_KEY');
  const origins = (trimmed(env, 'TRADE_ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
  const port = Number(trimmed(env, 'PORT') ?? DEFAULT_PORT);
  return {
    port: Number.isInteger(port) && port > 0 && port < 65_536 ? port : DEFAULT_PORT,
    trading: trimmed(env, 'TRADING') === 'on',
    allowlist: everyone ? 'everyone' : new Set(list),
    rpcUrl: heliusKey === null ? null : `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`,
    /* One host, key or not (Trador's finding, and lite-api answered 503 on 2026-10-12): keyless
       is served but rate limited, so JUPITER_API_KEY is recommended for more than one person. */
    jupiter: { baseUrl: trimmed(env, 'JUPITER_API_URL') ?? 'https://api.jup.ag', apiKey: jupiterKey },
    allowedOrigins: origins.length > 0 ? origins : DEV_ORIGINS,
    recordsDatabaseUrl: trimmed(env, 'DATABASE_URL_APP'),
    launch: (() => {
      const storageUrl = trimmed(env, 'SUPABASE_URL');
      const storageKey = trimmed(env, 'SUPABASE_SERVICE_ROLE_KEY');
      const databaseUrl = trimmed(env, 'DATABASE_URL_APP');
      return storageUrl === null || storageKey === null || databaseUrl === null ? null : { storageUrl, storageKey, databaseUrl };
    })(),
  };
}

/** True only when every one of the three is in place. */
export function tradingOpen(cfg: Pick<TradeConfig, 'trading' | 'allowlist' | 'rpcUrl'>): boolean {
  return cfg.trading && (cfg.allowlist === 'everyone' || cfg.allowlist.size > 0) && cfg.rpcUrl !== null;
}

/** Whether this wallet may trade. Open to everyone, it must still be a wallet address. */
export function isAllowed(allowlist: Allowlist, wallet: string): boolean {
  return allowlist === 'everyone' ? ADDRESS.test(wallet) : allowlist.has(wallet);
}
