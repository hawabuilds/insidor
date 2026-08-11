/**
 * The entry point. Mount the app, load the tokens, and nothing else.
 *
 * No error boundary at the root on purpose: a white screen with a stack trace in the console
 * is a bug someone fixes, whereas a friendly root-level "something went wrong" is a bug that
 * ships and lives for months. Boundaries belong around the surfaces that can fail
 * independently — a story that will not load, a quote that will not come back — and those
 * own their own copy.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import './shared/ui/tokens.css';

const container = document.getElementById('root');
if (!container) throw new Error('main: #root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
