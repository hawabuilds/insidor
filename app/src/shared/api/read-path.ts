/**
 * WHERE THE APP ASKS FOR THE READ SERVICE WHEN NO ENDPOINT IS CONFIGURED.
 *
 * One constant, in its own file, because two programs must agree on it and neither may own
 * it: the browser bundle (`client.ts`) asks this same-origin path when `VITE_READ_URL` is
 * unset, and the local dev and preview servers (`vite.config.ts`) forward it to the read
 * service on this machine. The deploy forwards the same path to the deployed service. If
 * the two copies drifted apart, an unconfigured build would ask a path nothing answers and
 * every screen would sit in its "couldn't read" state with nothing actually wrong.
 *
 * There is deliberately no fallback beyond this. An unconfigured build reads the real service
 * through its own origin or says it could not; it never serves anything else.
 */

/** The same-origin path the deploy and the local servers forward to the read service. */
export const SAME_ORIGIN_READ_PATH = '/api/read';
