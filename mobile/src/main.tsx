/**
 * The phone app's entry point. Mount the shell and load the tokens, nothing else.
 *
 * No root error boundary, for the desktop app's reason: a white screen with a stack trace is
 * a bug somebody fixes, and a friendly root-level apology is a bug that ships.
 *
 * No wallet is composed here, unlike `app/src/main.tsx`. The phone app has no wallet screen
 * yet — the Wallet tab says so — and a wallet constructed with nothing to show it would be a
 * connection the user could not see or end.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import './shared/ui/tokens.css';

/* The service worker is registered in production builds only. Registering is not asking —
   it shows no prompt — but in dev it would sit between Vite and the page and serve a stale
   shell after every edit. See public/sw.js for what it does and, mostly, what it refuses to. */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error: unknown) => {
      console.warn('service worker registration failed', error);
    });
  });
}

const container = document.getElementById('root');
if (!container) throw new Error('main: #root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
