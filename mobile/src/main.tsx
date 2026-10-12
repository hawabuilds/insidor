/**
 * The phone app's entry point. Mount the shell and load the tokens, nothing else.
 *
 * No root error boundary, for the desktop app's reason: a white screen with a stack trace is
 * a bug somebody fixes, and a friendly root-level apology is a bug that ships.
 *
 * The wallet is composed here: sign-in with X and an embedded Solana wallet, through
 * @insidor/wallet-embedded, when the build carries `VITE_PRIVY_APP_ID`. Without it the wallet is
 * `unavailable` and the Wallet tab says so. Screens get the port (shared/wallet.tsx), never the
 * vendor.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { EmbeddedWalletProvider, embeddedWallet } from '@insidor/wallet-embedded';

import { App } from './App.tsx';
import { toBase64 } from './features/trade/order-flow.ts';
import { sendSigned } from './shared/api/index.ts';
import { WalletProvider } from './shared/wallet.tsx';
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

const appId = (import.meta.env.VITE_PRIVY_APP_ID ?? '').trim();
/* The wallet signs; the trade service sends what it signed (features/trade). */
const { wallet, bridge } = embeddedWallet({ broadcast: (signed) => sendSigned(toBase64(signed)) });
const app = (
  <WalletProvider wallet={wallet}>
    <App />
  </WalletProvider>
);

createRoot(container).render(
  <StrictMode>{appId === '' ? app : <EmbeddedWalletProvider appId={appId} bridge={bridge}>{app}</EmbeddedWalletProvider>}</StrictMode>,
);
