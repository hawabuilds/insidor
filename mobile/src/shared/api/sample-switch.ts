/**
 * SAMPLE DATA NO LONGER EXISTS IN THE PHONE APP — and a build that asks for it is refused.
 *
 * `VITE_SAMPLE_DATA=on` used to ship sample stories behind a notice. The owner removed sample
 * data from the app and the demo build entirely (2026-10-13), so a deploy still carrying the old
 * switch would believe it was getting a demonstration and get the live app instead. vite.config.ts
 * calls this before building and fails with the reason, rather than ignoring a setting someone
 * set on purpose.
 */

export const SAMPLE_SWITCH = 'VITE_SAMPLE_DATA';

/** What is wrong with this build's environment, or null when it may be built. */
export function sampleSwitchProblem(env: Readonly<Record<string, string | undefined>>): string | null {
  const raw = env[SAMPLE_SWITCH];
  if (raw === undefined || raw === '') return null;
  return `${SAMPLE_SWITCH} is set, but sample data no longer exists in this app. Remove the setting; the app shows live data or an honest empty state.`;
}
