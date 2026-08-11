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

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
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
});
