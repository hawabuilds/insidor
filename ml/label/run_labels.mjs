/**
 * The nightly outcome labeller. JavaScript, unattended, no Python.
 *
 * WHY IT IS NOT IN ml/train/: labelling runs every night, forever, without a
 * human. Anything on a schedule must be in the one runtime, or the "Python never
 * runs in production" property is a wish. Labelling is a SQL job with a
 * threshold on top; it needs no library that only exists in Python.
 *
 * WHAT IT DOES: walks `internal.labels` rows whose window has closed and
 * resolves each into exactly one of four states. Getting the third one wrong is
 * the classic error and here it would be severe.
 *
 *   resolved / positive    window closed, threshold cleared
 *   resolved / negative    window closed, nothing happened, AND WE WATCHED THE
 *                          WHOLE WINDOW. That last clause is only assertable
 *                          against a coverage log of the mint stream.
 *   pending                now() < resolves_at. EXCLUDED from training, NEVER
 *                          coerced to negative. With a six-day median to peak the
 *                          pending population is large relative to the resolved
 *                          one for months.
 *   censored               the mint stream had a gap over the window, or the post
 *                          was deleted, or the counter went stale. Excluded from
 *                          training but COUNTED — a rising censoring rate is the
 *                          earliest sign the label pipeline is rotting.
 *
 * `first_signal_at` is written the moment the first matching mint appears, even
 * while the row is still pending. It costs one column today and is unrecoverable
 * tomorrow: it is what gives the empirical delay distribution P(delay <= t), and
 * in six months that is what makes the delayed-feedback correction possible.
 *
 * Run: node ml/label/run_labels.mjs --dry-run
 */

// eslint-disable-next-line no-unused-vars -- shape documentation, wired in step 7 of the build order
const LABEL_STATES = ['pending', 'resolved', 'censored', 'unresolvable'];

/**
 * NOT YET WIRED. This file is deliberately a named, empty seat rather than a
 * plausible implementation, because the peak-multiple query it must run is the
 * best artefact in the previous build and is carried across verbatim — it takes
 * the graduation price from the first post-migration trade at or above $10,
 * sidestepping bonding-curve price artefacts, and counts trades within 90% of
 * max price as a wash-trade guard. Reimplementing it from memory here would
 * produce a labeller that looks right and grades differently.
 *
 * Depends on: store/src/repo/labels.ts, and the mint coverage log that makes
 * "we watched the whole window" assertable.
 */
export async function runLabels() {
  throw new Error(
    'NotImplemented: ml/label/run_labels.mjs. Port worker/backtest/dune-peak-multiples.sql ' +
      'verbatim and drive it from store/src/repo/labels.ts. Do not rewrite the query.',
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runLabels();
}
