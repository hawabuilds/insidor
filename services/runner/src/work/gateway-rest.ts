/**
 * A REST FOR A CONTENT GATEWAY THAT SAID "TOO MANY REQUESTS": the coin metadata reader (wiring.ts) skips a
 * gateway for `restMs` after it answers 429, and asks nothing at all while every gateway is resting.
 *
 * Why it exists: every coin's metadata is read through the gateways in turn, by the universe loop and the
 * coin-link finder at once. Before this, a 429 was followed by the next coin's request to the same gateway
 * a moment later, and the next pass's again — the runner itself kept both public gateways over their limit.
 * On 9 Nov 2026 from about 22:30 UTC every read failed with 429 for over half an hour, and the coins whose
 * links tie them to posts waited the whole time. A rest lets the gateway's window clear; a coin asked while
 * all are resting fails at once and is tried again later, exactly as a refused read already was.
 *
 * What breaks if changed carelessly: resting on errors that are not the gateway's limit. A missing document
 * (404) or a timeout on one coin says nothing about the gateway, and resting on it would stop every other
 * coin's read for a minute over one bad link.
 */

export interface GatewayRest {
  /** Whether this gateway may be asked now. */
  readonly usable: (gateway: string) => boolean;
  /** Rest it after a 429. */
  readonly rest: (gateway: string) => void;
}

export function gatewayRest(restMs: number, now: () => number): GatewayRest {
  const until = new Map<string, number>();
  return {
    usable: (gateway) => (until.get(gateway) ?? 0) <= now(),
    rest: (gateway) => {
      until.set(gateway, now() + restMs);
    },
  };
}

/** A gateway's answer that means its limit: the error carries HTTP 429. */
export const isRateLimit = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { status?: unknown }).status === 429;
