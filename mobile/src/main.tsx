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

const container = document.getElementById('root');
if (!container) throw new Error('main: #root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
