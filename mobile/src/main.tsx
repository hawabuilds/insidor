/**
 * The phone app's entry point. Mount the shell and load the tokens, nothing else.
 *
 * ★ A CRASH IS NEVER A BLACK SCREEN. Without a root boundary React unmounts everything on a
 * render error, and the phone shows only the page's background: that is what Buy and Create did
 * when the wallet vendor's approve window threw (2026-10-14), and nobody could tell what happened.
 * So the root catches it and says it plainly: the error's own words (so it can be sent and fixed,
 * not apologised away) and a Reload button. It is the last net, not a fix: the cause still gets
 * fixed where it is.
 *
 * The wallet is composed here: sign-in with X and an embedded Solana wallet, through
 * @insidor/wallet-embedded, when the build carries `VITE_PRIVY_APP_ID`. Without it the wallet is
 * `unavailable` and the Portfolio tab says so. Screens get the port (shared/wallet.tsx), never the
 * vendor.
 *
 * ★ THE WALLET CODE NEVER HOLDS UP THE FIRST PAINT. The vendor's provider and SDK are their own
 * chunk (wallet-vendor.tsx), drawn beside the app rather than around it. A returning person's app
 * paints first (shared/sign-in.ts lets them in while the session comes back) and the chunk starts
 * loading once the first screen has drawn its answer (shared/preload.ts); at the door, where Join now needs it, it starts
 * at once. Until it arrives the port says `unavailable`, exactly as while the vendor starts.
 */

import { Component, StrictMode, Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

/* The port alone (no SDK): the vendor's code arrives later, in wallet-vendor.tsx. */
import { embeddedWallet } from '@insidor/wallet-embedded/store.ts';
import { hasEntered } from './features/landing/entered.ts';
import { takeInviteLink } from './features/invites/invite-code.ts';
import { afterFirstScreen } from './shared/preload.ts';
import { listenForNewVersion } from './shared/new-version.ts';

import { App } from './App.tsx';
import { listenForOpens, settleLaunch, tapInHand } from './features/alerts/push-open.ts';
import { trackHistory } from './shared/nav.ts';
import { noteBeforeMoves } from './shared/entry-scroll.ts';
import { followVisibleScreen, holdZoom } from './shared/viewport.ts';
import { toBase64 } from './features/trade/order-flow.ts';
import { sendSigned } from './shared/api/index.ts';
import { WalletProvider } from './shared/wallet.tsx';
import './shared/ui/tokens.css';

/* The service worker is registered in production builds only. Registering is not asking —
   it shows no prompt — but in dev it would sit between Vite and the page and serve a stale
   shell after every edit. See public/sw.js for what it does and, mostly, what it refuses to. */
/* A tapped notification: its screen, with For You under it (features/alerts/push-open.ts). Before the
   first frame, so the router reads the settled address. */
settleLaunch();
/* An invite link (insidor.app/i/<CODE>): the code kept for the door, the address put back to the app's own (features/invites/invite-code.ts). */
takeInviteLink(window.location, (url) => history.replaceState(history.state, '', url));
/* The scroll of the screen being left, noted as the address changes and before nav.ts moves on (shared/entry-scroll.ts). */
noteBeforeMoves();
/* Every history entry numbered from here, so a Back with nothing of ours under it still leads somewhere (shared/nav.ts). */
trackHistory();
listenForOpens();
/* An iPhone never zooms the page in on a small text box, which left the tab bar sliding with every
   scroll until the app was closed (shared/viewport.ts). Before the first frame. */
holdZoom();
/* The bottom bars follow the visible screen when the page box drifts from it mid-scroll (shared/viewport.ts). */
followVisibleScreen();
/* iPhone Safari draws a pressed (:active) state only on a page that listens for touches (tokens.css). */
document.addEventListener('touchstart', () => undefined, { passive: true });

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  /* A newer build seen while the kept one stood in: taken at the next return to the app, unless that return is a tapped notification opening its screen. */
  listenForNewVersion(tapInHand);
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

const WalletVendor = lazy(() => import('./wallet-vendor.tsx'));
/** How long after the page has loaded the wallet code may wait for a quiet moment, at most. */
const VENDOR_WAIT_MS = 2_000;

/** The vendor's part, mounted after the first paint (see the header). */
function LaterWallet() {
  const [go, setGo] = useState(() => !hasEntered());
  useEffect(() => {
    if (go) return;
    const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (n: number) => void };
    let idle = 0;
    let timer = 0;
    const cancel = afterFirstScreen(() => {
      if (typeof w.requestIdleCallback === 'function') idle = w.requestIdleCallback(() => setGo(true), { timeout: VENDOR_WAIT_MS });
      else timer = window.setTimeout(() => setGo(true), 200);
    });
    return () => {
      cancel();
      w.cancelIdleCallback?.(idle);
      window.clearTimeout(timer);
    };
  }, [go]);
  if (!go) return null;
  return (
    <Suspense fallback={null}>
      <WalletVendor appId={appId} bridge={bridge} />
    </Suspense>
  );
}

/** The last net (see the header): the error in its own words and a way back, never a black page. */
class Crashed extends Component<{ children: ReactNode }, { error: string | null }> {
  override state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  override componentDidCatch(e: unknown) {
    console.error('app crashed', e);
  }
  override render() {
    if (this.state.error === null) return this.props.children;
    return (
      <div role="alert" style={{ minHeight: '100dvh', padding: '48px 16px', display: 'flex', flexDirection: 'column', gap: 16, background: 'var(--bg, #0b0b0f)', color: 'var(--text-1, #fff)', fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>Something broke on this screen</h1>
        <p style={{ margin: 0, opacity: 0.8 }}>The error was:</p>
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, opacity: 0.9 }}>{this.state.error}</pre>
        <button type="button" onClick={() => location.reload()} style={{ alignSelf: 'flex-start', padding: '12px 20px', borderRadius: 12, border: 0, background: 'var(--brand, #9945FF)', color: '#fff', fontSize: 16 }}>
          Reload
        </button>
      </div>
    );
  }
}

createRoot(container).render(
  <StrictMode>
    <Crashed>
      {app}
      {appId === '' ? null : <LaterWallet />}
    </Crashed>
  </StrictMode>,
);
