/**
 * THE TRADE SERVICE'S ONE READ OF THE ENVIRONMENT.
 *
 * ★ OFF UNLESS SAID OTHERWISE, IN THREE INDEPENDENT WAYS. `TRADING` must be exactly `on`; the
 * allowlist must name at least one wallet; and an RPC must be configured. Any one missing and
 * the service answers every trade route with "trading is off" — there is no partial mode where
 * quotes work but builds do not, or where an empty allowlist means "everyone".
 *
 * What breaks if changed carelessly: reading `TRADING` as truthy rather than as the exact word
 * `on` would let `TRADING=off` (a non-empty string) turn it on.
 */

export interface TradeConfig {
  readonly port: number;
  readonly trading: boolean;
  /** Wallet addresses allowed to trade. Empty means nobody. */
  readonly allowlist: ReadonlySet<string>;
  readonly rpcUrl: string | null;
  readonly jupiter: { readonly baseUrl: string; readonly apiKey: string | null };
  readonly allowedOrigins: readonly string[];
}

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
  const bad = list.filter((a) => !ADDRESS.test(a));
  if (bad.length > 0) throw new Error(`TRADING_ALLOWLIST holds ${bad.length} entr${bad.length === 1 ? 'y' : 'ies'} that are not wallet addresses`);
  const heliusKey = trimmed(env, 'HELIUS_API_KEY');
  const jupiterKey = trimmed(env, 'JUPITER_API_KEY');
  const origins = (trimmed(env, 'TRADE_ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
  const port = Number(trimmed(env, 'PORT') ?? DEFAULT_PORT);
  return {
    port: Number.isInteger(port) && port > 0 && port < 65_536 ? port : DEFAULT_PORT,
    trading: trimmed(env, 'TRADING') === 'on',
    allowlist: new Set(list),
    rpcUrl: heliusKey === null ? null : `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`,
    /* One host, key or not (Trador's finding, and lite-api answered 503 on 2026-10-12): keyless
       is served but rate limited, so JUPITER_API_KEY is recommended for more than one person. */
    jupiter: { baseUrl: trimmed(env, 'JUPITER_API_URL') ?? 'https://api.jup.ag', apiKey: jupiterKey },
    allowedOrigins: origins.length > 0 ? origins : DEV_ORIGINS,
  };
}

/** True only when every one of the three is in place. */
export function tradingOpen(cfg: Pick<TradeConfig, 'trading' | 'allowlist' | 'rpcUrl'>): boolean {
  return cfg.trading && cfg.allowlist.size > 0 && cfg.rpcUrl !== null;
}
