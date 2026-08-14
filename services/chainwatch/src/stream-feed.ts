/**
 * A push transport wearing the pull contract.
 *
 * The socket runs continuously and appends to a bounded buffer; `read()` drains
 * up to `limit` of it and describes the interval honestly. Nothing about the
 * supervision above changes — same cursor, same backoff, same coverage
 * arithmetic — because the only thing this file does is answer the four
 * questions a page answers, for a source that arrives instead of replying.
 *
 * THE FOUR ANSWERS, AND THE ONE THAT IS EASY TO GET WRONG.
 *
 *   `from` is where the previous window ended: the feed's own memory of the last
 *   successful read, falling back to the DURABLE cursor's `readAt` on the first
 *   read after a restart, and only then to now. That fallback order matters. Using
 *   `now` on a warm start would silently move the window's start forward past the
 *   restart, which erases the one window a restart is guaranteed to have missed.
 *
 *   `to` is the instant the drain completed, forced strictly past `from`. The
 *   coverage row it becomes carries `check (window_to > window_from)`, and a read
 *   that completes inside the same millisecond it started would otherwise fail
 *   the INSERT — turning a fast cycle into an error, and an error into a gap we
 *   invented.
 *
 *   `pageFull` is a statement about this PAGE, not about the buffer. See below.
 *
 *   `blind` is the windows we were not listening to. This is the field the whole
 *   file exists for.
 *
 * ★ WHY `read()` THROWS WHILE THE SOCKET IS DOWN, rather than returning an empty
 * page. An empty page is a successful read. It extends the watermark, advances
 * the durable cursor, writes a coverage row over the window, and — through
 * `state.lastSuccessAt` — keeps the health endpoint answering 200. A process
 * whose socket died an hour ago would report itself healthy while writing an
 * hour of coverage rows claiming it watched a stream it was not connected to.
 * That is the seven-hour failure wearing a green tick, which health.ts names as
 * the thing it exists to prevent. Throwing costs nothing that matters: the
 * buffered events are not dropped, they are still in the buffer and go out on the
 * first read that succeeds, and main.ts's catch does exactly the right thing by
 * NOT extending the watermark, so the silence is measured by the next success.
 *
 * ★ WHY A RECONNECT DOES NOT THROW, and this is the other half of the same rule.
 * If the socket dropped and recovered between two reads, both reads succeed on
 * time and there is no silence for `coverage.observed()` to find — a twelve
 * second outage under a sixty second tolerance is invisible to every mechanism
 * except the transport that lived through it. So the window is reported as
 * `blind` and recorded precisely, the buffered mints flow on the same cycle, and
 * nothing stalls. Throwing here instead would work, but it would record the hole
 * as the whole read-to-read interval — censoring time we did watch — and it
 * would leave the mints sitting in a bounded buffer while the socket flaps,
 * which is how a reconnect loop turns into a dropped one.
 */

import type { Millis } from '@insidor/contracts';

import type { Gap } from './coverage.ts';
import type { MintCursor } from './cursor.ts';
import type { MintFeed, MintFeedPage } from './feed.ts';
import type { MintStream } from './stream.ts';

export interface StreamFeedOptions {
  readonly feedId: string;
  readonly stream: MintStream;
  readonly now: () => Millis;
  /** Nothing here is silent. A drop nobody logged is a drop nobody noticed. */
  readonly note: (msg: string, fields: Readonly<Record<string, unknown>>) => void;
}

export function createStreamFeed(opts: StreamFeedOptions): MintFeed {
  /** Where the previous successful read's window ended. Null until one has. */
  let lastReadTo: Millis | null = null;
  /**
   * The restart window is declared once, on the first read that succeeds. It is
   * a fact about this process starting, not about this read, so a second copy on
   * the second read would be the same hole counted twice.
   */
  let startupDeclared = false;
  let shutdownWired = false;

  return {
    id: opts.feedId,

    /*
     * Hardcoded, and not read from configuration. The field's job is to make the
     * log line and the port agree with what is actually running; taking it from
     * config would let a mislabelled environment variable make this object claim
     * to be a poller. wiring.ts is what decides which transport gets built.
     */
    transport: 'stream',

    read(cursor: MintCursor, limit: number, signal: AbortSignal): Promise<MintFeedPage> {
      /*
       * The signal handed to `read` is the process's shutdown controller. A
       * socket and its reconnect timer are exactly the kind of handle that keeps
       * a Node process alive after the loop has ended, and main.ts answers that
       * with a grace timer that calls `process.exit(1)` — leaving an open run row
       * that reads as a process which died mid-cycle. So shutdown is bound here,
       * once, on whichever read happens first.
       */
      if (!shutdownWired) {
        shutdownWired = true;
        if (signal.aborted) opts.stream.stop();
        else signal.addEventListener('abort', () => opts.stream.stop(), { once: true });
      }

      if (signal.aborted) {
        return Promise.reject(new Error('shutting down; refusing to start a read'));
      }

      const nowMs = opts.now();
      const from = lastReadTo ?? cursor.readAt ?? nowMs;

      if (!opts.stream.live()) {
        // See the header. This is a failed cycle on purpose, and the failure is
        // accurate: we are not watching, so we cannot claim to have watched.
        return Promise.reject(
          new Error(
            'mint stream is not connected; refusing to report a window we were not listening to',
          ),
        );
      }

      const drain = opts.stream.drain(limit);
      // Strictly forward, always. See the header.
      const to = Math.max(nowMs, from + 1);

      const blind: Gap[] = [];

      /*
       * ★ THE RESTART WINDOW. Between the last window the previous process
       * closed and the moment this one's socket became live, nobody was
       * listening — and unlike a poll, there is no cursor to go back and fetch
       * it with, because what arrived while we were away is gone.
       *
       * `coverage.observed()` would also catch this, but only when it exceeds
       * the tolerance, and the tolerance is a statement about read CADENCE
       * jitter: it exists so an ordinary poll running three seconds late does
       * not fill the log with noise. A four-second redeploy is genuinely under
       * that tolerance and genuinely lost four seconds of mints. So it is
       * declared here as the fact it is, and the two mechanisms overlap rather
       * than compete — the coverage row they both land on merges on
       * `(chain, window_from)` and keeps its gap flag.
       *
       * A COLD cursor declares nothing. `readAt` null means this chain has never
       * been watched, so there is no earlier window to have missed, and an
       * unbounded "we were not watching since the beginning of time" row would
       * be true and useless.
       */
      if (!startupDeclared) {
        startupDeclared = true;
        const liveSince = opts.stream.liveSince();
        if (cursor.readAt !== null && liveSince !== null && liveSince > cursor.readAt) {
          blind.push({
            kind: 'not_watching',
            fromMs: cursor.readAt,
            toMs: liveSince,
            detail:
              `mint stream was not connected between the previous run's last read and ` +
              `${liveSince - cursor.readAt}ms later, when this one came live`,
          });
        }
      }

      for (const outage of drain.outages) {
        // Not trusted from the far side of a port. A zero-width or backwards
        // window fails the coverage row's `window_to > window_from` check, and
        // one bad window would fail the whole cycle — including the mints.
        if (!(outage.toMs > outage.fromMs)) {
          opts.note('discarding a stream outage with no width', { ...outage });
          continue;
        }
        blind.push({
          kind: 'not_watching',
          fromMs: outage.fromMs,
          toMs: outage.toMs,
          detail: outage.detail,
        });
      }

      /*
       * ★ `pageFull`, and the two very different things that set it.
       *
       * `dropped > 0` is real loss: the buffer was full, events were destroyed,
       * and we will never have them. That is precisely "there may be mints in
       * this window we did not see", which is what the field means and what the
       * `page_overflow` row it produces says.
       *
       * `limited` is not loss — the rest are still in the buffer and go out next
       * cycle. It sets the flag anyway, because `pageFull` is a statement about
       * whether THIS PAGE can prove it covers its window, and a page that handed
       * over exactly as many as it was asked for cannot. The cost is a coverage
       * row that censors a window we did in fact cover, once per storm; the
       * alternative is a transport that decides for itself when a hole does not
       * count, and that decision does not belong in a feed. Over-censoring is
       * recoverable by anyone reading the log. Under-censoring is not, because
       * nothing downstream can tell a window we missed from a quiet minute.
       */
      const pageFull = drain.limited || drain.dropped > 0;
      if (drain.dropped > 0) {
        opts.note('mint buffer overflowed; events were lost', {
          dropped: drain.dropped,
          fromMs: from,
          toMs: to,
        });
      }

      lastReadTo = to;

      return Promise.resolve({
        from,
        to,
        mints: drain.events,
        pageFull,
        blind,
        cursor: {
          feedId: opts.feedId,
          position: opts.stream.position(),
          // Never null: cursors.save refuses a cursor with no read instant, and
          // it is right to — a cursor with no instant closes no window.
          readAt: to,
        },
      });
    },
  };
}
