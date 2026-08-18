/**
 * THE FOUR HANDLERS, in one place, so that the rule they encode can be tested rather than
 * trusted.
 *
 * ★ WHY THIS IS A FUNCTION AND NOT FOUR LINES INSIDE App.tsx. The rule below is the one the
 * previous build broke, and a comment above an inline object literal is not a rule — it is a
 * hope. Written here, `createLiveHandlers` is the exact code App.tsx runs AND the exact code
 * wiring.test.ts asserts against, so "a subscribe transition triggers an authoritative
 * refetch" is a property with a test behind it instead of a paragraph next to it.
 *
 * ★ THE RULE. Broadcast has no replay. A live channel that drops for thirty seconds does not
 * come back to a queue of missed frames; those frames are gone, and every row that changed
 * inside the window is silently wrong on screen until something re-reads the board. The
 * previous build resumed its subscription, cancelled its fallback poll, and issued no
 * refetch — so rows sat there being confidently wrong. Two things repair that and both are
 * wired below:
 *
 *   onSubscribed  → refetch, on EVERY subscribe. Not just the first. Not conditionally.
 *   a tick gap    → refetch, because a hole in the sequence means frames were published
 *                   that this client never received. The store detects it and calls `onGap`;
 *                   App.tsx points `onGap` at the same refetch.
 *
 * ★ THE DECODERS RUN HERE AND ARE NOT WRAPPED. `onTick` and `onPatch` receive the parsed
 * message body as `unknown` — the transport never decodes, deliberately — and this is where
 * it becomes a wire object, which is also where `decodeBoardTick` throws `WireLeakError` if
 * the projection leaked internal vocabulary. That throw is allowed to escape. decode.ts is
 * explicit that swallowing it "would make the client complicit in the leak", and a try/catch
 * here to protect the socket is exactly how it would get swallowed.
 */

import { decodeBoardTick, decodeRowPatch } from '../decode.ts';
import type { LiveHandlers } from './channel.ts';
import type { BoardStore } from './boardStore.ts';

/**
 * Build the handlers for one board store.
 *
 * `refetch` is called, not returned — the caller owns what an authoritative read means (an
 * abort signal, a view id, what to do on failure) and this owns only WHEN one is owed.
 */
export function createLiveHandlers(store: BoardStore, refetch: () => void): LiveHandlers {
  return {
    onTick: (raw) => store.tick(decodeBoardTick(raw)),
    onPatch: (raw) => store.patch(decodeRowPatch(raw)),
    onSubscribed: () => {
      store.setConnected(true);
      /* ★ Unconditional. Every subscribe is a subscribe we may have missed frames before,
         including the fiftieth reconnect of a bad afternoon. An `if (firstTime)` here would
         reinstate the exact bug this file is named after. */
      refetch();
    },
    onDropped: () => store.setConnected(false),
  };
}
