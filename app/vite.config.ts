/**
 * Vite config. Deliberately almost empty — a bundler is the only thing this package needs
 * that the rest of the repository does not, and every extra line here is a thing that can
 * differ between a preview build and production.
 *
 * No proxy, no server-side anything: `src/shared/api/` reads a public HTTP surface directly,
 * and the read endpoint is a build-time environment variable rather than a rewrite rule, so
 * a preview deployment cannot accidentally point at production data through a proxy nobody
 * remembered to configure.
 */

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

import { sampleSwitchProblem } from './src/shared/api/sample-switch.ts';

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
  },
};

export default defineConfig(({ mode }) => {
  /* The sample-data switch is checked here, before anything is built, so a misconfigured
     deploy fails in its build log rather than going live. loadEnv reads the .env files
     and the deploy's own environment. */
  const problem = sampleSwitchProblem(loadEnv(mode, process.cwd(), 'VITE_'));
  if (problem !== null) throw new Error(`build refused: ${problem}`);
  return config;
});
