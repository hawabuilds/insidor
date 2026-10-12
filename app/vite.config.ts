/**
 * Vite config. Deliberately almost empty — a bundler is the only thing this package needs
 * that the rest of the repository does not, and every extra line here is a thing that can
 * differ between a preview build and production.
 *
 * ★ `/api/read` IS FORWARDED ON THIS MACHINE ONLY. With `VITE_READ_URL` unset the client asks
 * its own origin at `/api/read` (src/shared/api/read-path.ts, shared with client.ts), which
 * is what the deploy proxies to the read service. The local dev and preview servers do the same thing, to the
 * read service on localhost, so an unconfigured local build reads the real service rather
 * than failing every request. The proxy only ever points at localhost: a deployed build is
 * static files with no server, so nothing here can reach production through a rewrite.
 *
 * ★ THE BUILD REFUSES `VITE_SAMPLE_DATA`. That switch used to put invented posts, stories and
 * coins in front of the public. Sample data no longer exists in this app, so a deploy that
 * still sets the switch is a deploy whose owner expects something that will not happen; it
 * fails in its build log, loudly, rather than going live and being misread as a demo. Any
 * value at all is refused, including `off`, so the line gets deleted rather than edited.
 */

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

import { SAME_ORIGIN_READ_PATH } from './src/shared/api/read-path.ts';

/** The read service's default local port (services/read/src/config.ts). */
const LOCAL_READ_PORT = 8787;

const LOCAL_READ = {
  [SAME_ORIGIN_READ_PATH]: {
    target: `http://127.0.0.1:${LOCAL_READ_PORT}`,
    changeOrigin: true,
    rewrite: (path: string) => path.slice(SAME_ORIGIN_READ_PATH.length) || '/',
  },
};

const config = {
  plugins: [react()],
  build: {
    /* The board is a table of numbers; a source map is what makes a production bug in the
       ordering machine debuggable at all, and it costs nothing at this bundle size. */
    sourcemap: true,
    target: 'es2022',
  },
  server: {
    port: 5173,
    proxy: LOCAL_READ,
  },
  preview: {
    proxy: LOCAL_READ,
  },
};

/** The retired switch's name, spelled once. */
const RETIRED_SWITCH = 'VITE_SAMPLE_DATA';

export default defineConfig(({ mode }) => {
  /* loadEnv reads the .env files; the deploy's own environment is checked as well, because a
     hosting dashboard sets process.env and never writes a file. */
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  if (env[RETIRED_SWITCH] !== undefined || process.env[RETIRED_SWITCH] !== undefined) {
    throw new Error(
      `build refused: ${RETIRED_SWITCH} is set. Sample data no longer exists in this app; ` +
        'every screen reads the read service. Remove the variable from this deploy.',
    );
  }
  return config;
});
