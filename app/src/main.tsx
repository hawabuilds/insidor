/**
 * The entry point. Mount the app, load the tokens, compose the wallet, and nothing else.
 *
 * No error boundary at the root on purpose: a white screen with a stack trace in the console
 * is a bug someone fixes, whereas a friendly root-level "something went wrong" is a bug that
 * ships and lives for months. Boundaries belong around the surfaces that can fail
 * independently — a story that will not load, a price that will not come back — and those
 * own their own copy.
 *
 * ★ THIS IS THE ONLY FILE IN THE APP THAT NAMES A WALLET IMPLEMENTATION, AND THAT IS THE
 *   WHOLE POINT OF THE BOUNDARY. Everything under `src/` — every component, every hook, the
 *   shell itself — speaks `Wallet` and `WalletState` from the shared vocabulary and has no
 *   idea what is behind them. Swapping this adapter for a second one is a change to the two
 *   lines below and to nothing that renders.
 *
 *   The adapter lives in its own workspace package rather than in `features/wallet` for a
 *   reason that is enforced rather than agreed: `.dependency-cruiser.cjs` pins that package
 *   to the vocabulary and nothing else, and `wallet/src/dependency-graph.test.ts` fails if
 *   its dependency list ever grows past `@insidor/contracts`. Written inside the app it
 *   would have been governed by neither, and the first chain library anybody reached for
 *   would have landed in the browser bundle without a single check going red.
 *
 * ★ THE REQUIRED NETWORK IS CONFIGURATION AND HAS NO DEFAULT.
 *   `VITE_WALLET_NETWORK` names the network this deployment's venues can trade on. Unset, it
 *   is null, and the adapter then makes NO claim about the network at all: it reports what
 *   the wallet said and never tells anybody they are on the wrong one. That is the honest
 *   behaviour, because the alternative — guessing a plausible name — would tell somebody
 *   with a correctly-configured wallet that they are wrong, which is worse than saying
 *   nothing. It is a build-time variable rather than a constant because which network a
 *   deployment trades on is a deployment fact; it is not a secret, and nothing is derived
 *   from it beyond one string comparison.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { browserWallet, globalDiscovery } from '@insidor/wallet';

import { App } from './App.tsx';
import './shared/ui/tokens.css';

const container = document.getElementById('root');
if (!container) throw new Error('main: #root is missing from index.html');

/* Absent, empty and whitespace-only are the same thing — "nobody told us" — for the reason
   the credential reader in adapters/kit/vendor gives: an operator who left the value blank
   and an operator who never set it made the same decision, and treating a blank string as a
   network name would make every wallet on earth report as the wrong one. */
const configuredNetwork = (import.meta.env?.['VITE_WALLET_NETWORK'] as string | undefined) ?? '';

const wallet = browserWallet({
  discover: globalDiscovery(),
  requiredNetwork: configuredNetwork.trim() === '' ? null : configuredNetwork.trim(),
});

createRoot(container).render(
  <StrictMode>
    <App wallet={wallet} />
  </StrictMode>,
);
