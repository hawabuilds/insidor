/**
 * THE ONE WAY SAMPLE DATA REACHES A PRODUCTION BUILD: `VITE_SAMPLE_DATA=on`, set on purpose.
 *
 * A dev build with no `VITE_READ_URL` serves the fixtures by itself; a production build
 * never did, so a site with no backend showed an error rather than the app. This switch is
 * for exactly that — a public site that is honestly a demonstration — and it is held to
 * three rules, checked by `vite.config.ts` before anything is built:
 *
 *   1. It is a BUILD-TIME literal, never a runtime flag. Nothing a visitor or a URL can do
 *      turns sample data on; a deploy has to be configured to.
 *   2. It CANNOT be set together with `VITE_READ_URL`. Sample data and a real read service
 *      in one build is how invented numbers end up beside real ones; the build fails.
 *   3. It is `on` or absent. Any other value — `true`, `yes`, `ON ` — fails the build rather
 *      than being guessed at, because a typo here decides what the public sees.
 *
 * With it on, the permanent "sample data" bar is shown, exactly as in a dev build.
 */

export const SAMPLE_SWITCH = 'VITE_SAMPLE_DATA';

/** What is wrong with this build's environment, or null when it may be built. */
export function sampleSwitchProblem(env: Readonly<Record<string, string | undefined>>): string | null {
  const raw = env[SAMPLE_SWITCH];
  if (raw === undefined || raw === '') return null;
  if (raw !== 'on') return `${SAMPLE_SWITCH} is ${JSON.stringify(raw)}; it must be exactly "on", or unset.`;
  const readUrl = env['VITE_READ_URL'];
  if (readUrl !== undefined && readUrl.trim() !== '') {
    return `${SAMPLE_SWITCH}=on and VITE_READ_URL are both set. A build serves sample data or reads the read service, never both.`;
  }
  return null;
}
