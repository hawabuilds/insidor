/**
 * THE ALERT SERVICE'S ONE READ OF THE ENVIRONMENT.
 *
 * ★ NOTIFY IS OFF UNLESS IT IS EXACTLY `on`. Off, the list, the settings and device registration
 * all work and alerts are still written to the list — but the checks do not run and nothing is
 * pushed. On, the price, curve and pipeline checks run on their loops and pushes go out.
 *
 * ★ THE VAPID PRIVATE KEY IS READ HERE AND HANDED TO THE PUSH ADAPTER, NOTHING ELSE. It is never
 * logged; the boot line says only whether push is configured.
 */

export interface NotifyConfig {
  readonly port: number;
  readonly databaseUrl: string;
  readonly appId: string;
  readonly notifyOn: boolean;
  readonly vapid: { readonly publicKey: string | null; readonly privateKey: string | null; readonly subject: string };
  readonly rpcUrl: string | null;
  readonly parseUrl: string | null;
  readonly allowedOrigins: readonly string[];
}

type Env = Readonly<Record<string, string | undefined>>;

const DEFAULT_PORT = 8792;
const DEV_ORIGINS = ['http://localhost:5174', 'http://localhost:5173'];

const trimmed = (env: Env, key: string): string | null => {
  const v = env[key]?.trim();
  return v === undefined || v === '' ? null : v;
};

export function loadNotifyConfig(env: Env): NotifyConfig {
  const databaseUrl = trimmed(env, 'DATABASE_URL_PEOPLE');
  if (databaseUrl === null) throw new Error('DATABASE_URL_PEOPLE is not set: alerts need the people role (pnpm db:migrate creates it).');
  if (databaseUrl === trimmed(env, 'DATABASE_URL')) throw new Error('DATABASE_URL_PEOPLE must be the people role, not the owner.');
  const appId = trimmed(env, 'PRIVY_APP_ID') ?? trimmed(env, 'VITE_PRIVY_APP_ID');
  if (appId === null) throw new Error('PRIVY_APP_ID (or VITE_PRIVY_APP_ID) is not set: nobody could be signed in.');
  const helius = trimmed(env, 'HELIUS_API_KEY');
  const origins = (trimmed(env, 'NOTIFY_ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
  /* NOTIFY_PORT locally, where several services share one .env.local; PORT where a host assigns one (Railway). */
  const port = Number(trimmed(env, 'NOTIFY_PORT') ?? trimmed(env, 'PORT') ?? DEFAULT_PORT);
  return {
    port: Number.isInteger(port) && port > 0 && port < 65_536 ? port : DEFAULT_PORT,
    databaseUrl,
    appId,
    notifyOn: trimmed(env, 'NOTIFY') === 'on',
    vapid: { publicKey: trimmed(env, 'VAPID_PUBLIC_KEY'), privateKey: trimmed(env, 'VAPID_PRIVATE_KEY'), subject: trimmed(env, 'VAPID_SUBJECT') ?? 'mailto:alerts@insidor.app' },
    rpcUrl: helius === null ? null : `https://mainnet.helius-rpc.com/?api-key=${helius}`,
    parseUrl: helius === null ? null : `https://api.helius.xyz/v0/transactions?api-key=${helius}`,
    allowedOrigins: origins.length > 0 ? origins : DEV_ORIGINS,
  };
}
