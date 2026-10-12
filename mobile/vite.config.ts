/**
 * Vite config for the phone app. Almost empty, for the reason `app/vite.config.ts` gives: a
 * bundler is the only thing this package needs that the rest of the repository does not, and
 * every extra line here is a thing that can differ between a preview build and production.
 *
 * ★ PORT 5174, AND STRICT. The desktop app owns 5173 and the read service's CORS list names
 * origins exactly (`services/read/src/config.ts`). If this server drifted to whatever port was
 * free, the read service would refuse it with a CORS error that looks like an outage. Strict
 * means a taken port fails at startup, in the terminal, where it is obvious. To read real data
 * the read service must be started with this origin on its list:
 *
 *   READ_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5174 pnpm dev:read
 *
 * ★ SETTINGS COME FROM THE REPOSITORY'S ROOT `.env.local`, the same file every service reads, so
 * there is one place to put them. Vite hands the page only the variables named `VITE_…`; the
 * server keys in that file never reach the browser.
 *
 * ★ ONE ORIGIN FOR A PHONE, LOCAL ONLY. On this machine's dev and preview servers, `/api/read`,
 * `/api/trade`, `/api/social` and `/api/notify` are forwarded to the services on localhost, so
 * one tunnel URL (`pnpm tunnel`) reaches the app and everything behind it, and the phone needs no
 * CORS. The proxy exists only in these local servers and only points at localhost: a deployed
 * build is static files with no server, so it cannot reach anything through a rewrite nobody
 * remembered — the endpoints are still the build-time VITE_*_URL variables.
 */

import { fileURLToPath } from 'node:url';

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

import { sampleSwitchProblem } from './src/shared/api/sample-switch.ts';

/* The repository root: where `.env.local` lives for every package. */
const ENV_DIR = fileURLToPath(new URL('..', import.meta.url));

/** `/api/<name>/…` on this server → the service on localhost, prefix removed. */
const LOCAL_SERVICES = Object.fromEntries(
  ([['read', 8787], ['trade', 8790], ['social', 8791], ['notify', 8792]] as const).map(([name, port]) => [
    `/api/${name}`,
    { target: `http://127.0.0.1:${port}`, changeOrigin: true, rewrite: (path: string) => path.slice(`/api/${name}`.length) || '/' },
  ]),
);

const config = {
  envDir: ENV_DIR,
  plugins: [react()],
  build: {
    sourcemap: true,
    target: 'es2022',
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: LOCAL_SERVICES,
    /* A free Cloudflare tunnel's random name: the phone opens the app through it. */
    allowedHosts: ['.trycloudflare.com'],
  },
  preview: {
    port: 5174,
    strictPort: true,
    proxy: LOCAL_SERVICES,
    allowedHosts: ['.trycloudflare.com'],
  },
};

export default defineConfig(({ mode }) => {
  /* The sample-data switch is checked before anything is built, so a misconfigured deploy
     fails in its build log rather than going live. */
  const problem = sampleSwitchProblem(loadEnv(mode, ENV_DIR, 'VITE_'));
  if (problem !== null) throw new Error(`build refused: ${problem}`);
  return config;
});
