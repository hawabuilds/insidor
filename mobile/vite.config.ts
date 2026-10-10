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
 * No proxy, for the desktop app's reason: the read endpoint is a build-time variable, so a
 * preview deployment cannot reach production data through a rewrite nobody remembered.
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: true,
    target: 'es2022',
  },
  server: {
    port: 5174,
    strictPort: true,
  },
});
