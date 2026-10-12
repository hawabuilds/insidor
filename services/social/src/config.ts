/**
 * THE SOCIAL SERVICE'S ONE READ OF THE ENVIRONMENT.
 *
 * ★ ITS OWN DATABASE ROLE, NEVER THE OWNER'S. `DATABASE_URL_PEOPLE` is `insidor_people_user`
 * (0043): it writes the `people` schema and reads the public projection. The service refuses to
 * start on the owner URL, for the read service's reason — a privilege nobody tests locally is a
 * privilege nobody knows production has.
 *
 * ★ NO CHAIN, NO LIKES. Likes are checked against the voter's holdings on the chain; without an
 * RPC the like route says so rather than letting anyone like.
 */

export interface SocialConfig {
  readonly port: number;
  readonly databaseUrl: string;
  /** The sign-in provider's app id: the audience every identity token must carry. */
  readonly appId: string;
  readonly rpcUrl: string | null;
  readonly parseUrl: string | null;
  readonly allowedOrigins: readonly string[];
}

type Env = Readonly<Record<string, string | undefined>>;

const DEFAULT_PORT = 8791;
const DEV_ORIGINS = ['http://localhost:5174', 'http://localhost:5173'];

const trimmed = (env: Env, key: string): string | null => {
  const v = env[key]?.trim();
  return v === undefined || v === '' ? null : v;
};

export function loadSocialConfig(env: Env): SocialConfig {
  const databaseUrl = trimmed(env, 'DATABASE_URL_PEOPLE');
  if (databaseUrl === null) throw new Error('DATABASE_URL_PEOPLE is not set: the social service needs the people role (pnpm db:migrate creates it).');
  if (databaseUrl === trimmed(env, 'DATABASE_URL')) throw new Error('DATABASE_URL_PEOPLE must be the people role, not the owner.');
  const appId = trimmed(env, 'PRIVY_APP_ID') ?? trimmed(env, 'VITE_PRIVY_APP_ID');
  if (appId === null) throw new Error('PRIVY_APP_ID (or VITE_PRIVY_APP_ID) is not set: nobody could be signed in.');
  const helius = trimmed(env, 'HELIUS_API_KEY');
  const origins = (trimmed(env, 'SOCIAL_ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
  const port = Number(trimmed(env, 'SOCIAL_PORT') ?? DEFAULT_PORT);
  return {
    port: Number.isInteger(port) && port > 0 && port < 65_536 ? port : DEFAULT_PORT,
    databaseUrl,
    appId,
    rpcUrl: helius === null ? null : `https://mainnet.helius-rpc.com/?api-key=${helius}`,
    parseUrl: helius === null ? null : `https://api.helius.xyz/v0/transactions?api-key=${helius}`,
    allowedOrigins: origins.length > 0 ? origins : DEV_ORIGINS,
  };
}
