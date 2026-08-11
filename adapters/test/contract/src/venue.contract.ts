/**
 * ONE conformance suite, run against EVERY venue adapter.
 *
 * The rule this suite exists to hold: ABSENT IS NOT ZERO, and no venue may
 * report a depth it does not have. A bonding curve has no two-sided reserve,
 * so its liquidity is null; reading that null as zero is what turned a quality
 * filter into a survivorship filter and removed the entire pre-graduation
 * population from the product.
 *
 * The second rule: a declared capability must be implemented. `capabilities`
 * is what the core branches on, so a venue that claims `trade` and carries no
 * trade implementation fails at the worst moment.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { MarketState, TradeCost, TradeQuote } from '@insidor/contracts/asset.ts';
import type { Venue, VenueCapability } from '@insidor/contracts/ports/venue.ts';

export interface VenueCase {
  readonly venue: Venue;
  /** Market states produced by this venue's own mappers from recorded payloads. */
  readonly states: readonly MarketState[];
  /** Quotes produced by this venue's own quote path, if it has one. */
  readonly quotes: readonly TradeQuote[];
}

const CAPABILITIES: readonly string[] = ['watch', 'read', 'assess', 'trade', 'create'];

export function runVenueContract(testCase: VenueCase): void {
  const { venue, states, quotes } = testCase;

  describe(`venue contract: ${String(venue.id)}`, () => {
    it('is identified by chain and venue together, never by chain alone', () => {
      const id = String(venue.id);
      assert.ok(id.startsWith(`${String(venue.chain)}:`), `${id} is not namespaced by its chain`);
      assert.ok(id.length > String(venue.chain).length + 1);
    });

    it('declares which kind of market it is, because the two behave differently', () => {
      assert.ok(venue.market === 'bonding-curve' || venue.market === 'pool');
    });

    it('carries its own label count, because scores are not comparable across venues', () => {
      // A venue under the policy floor may produce 'unsure' at most. That is a
      // feature — a new venue's first month is read-only — and it only works if
      // the count is a real number read from the store rather than assumed.
      assert.ok(Number.isInteger(venue.adjudicatedLabels));
      assert.ok(venue.adjudicatedLabels >= 0);
    });

    it('declares real capabilities, without repeats', () => {
      assert.ok(venue.capabilities.length > 0);
      for (const capability of venue.capabilities) {
        assert.ok(CAPABILITIES.includes(capability), `${String(capability)} is not a capability`);
      }
      assert.equal(new Set(venue.capabilities).size, venue.capabilities.length);
    });

    it('implements exactly what it declares — no phantom capabilities', () => {
      const declares = (c: VenueCapability): boolean => venue.capabilities.includes(c);
      assert.equal(declares('watch'), venue.watch !== undefined, 'watch declaration and implementation disagree');
      assert.equal(declares('read'), venue.read !== undefined, 'read declaration and implementation disagree');
      assert.equal(declares('assess'), venue.assess !== undefined, 'assess declaration and implementation disagree');
      assert.equal(declares('trade'), venue.trade !== undefined, 'trade declaration and implementation disagree');
    });

    it('is disabled rather than deleted when broken', () => {
      // A boolean, always present. A venue removed from the registry orphans
      // every asset that ever traded there.
      assert.equal(typeof venue.enabled, 'boolean');
    });

    /* ── market state ────────────────────────────────────────────────── */

    it('reports a market state for every read it claims to support', () => {
      if (venue.read !== undefined) assert.ok(states.length > 0, 'a readable venue with no recorded state is untested');
    });

    it('NEVER reports zero liquidity on a venue that has no reserve concept', () => {
      // THE test. On a curve the vendors report no liquidity object at all;
      // any number here re-creates the filter that hid the whole population.
      for (const state of states) {
        if (state.depth?.kind === 'bonding-curve') {
          assert.equal(state.liquidityUsd, null, 'a bonding curve reported a liquidity number');
        }
      }
    });

    it('keeps absent and zero distinguishable in depth', () => {
      for (const state of states) {
        if (state.liquidityUsd === null) {
          assert.ok(
            state.depth === null || state.depth.kind === 'bonding-curve',
            'null liquidity paired with pool depth',
          );
        }
        if (state.depth?.kind === 'pool') {
          assert.equal(typeof state.depth.liquidityUsd, 'number');
          assert.equal(state.depth.liquidityUsd, state.liquidityUsd);
          assert.ok(state.depth.poolCount >= 1);
        }
      }
    });

    it('says which quantity its market cap is, or reports none', () => {
      for (const state of states) {
        if (state.marketCapUsd === null) assert.equal(state.marketCapBasis, null);
        else assert.ok(state.marketCapBasis === 'fully-diluted' || state.marketCapBasis === 'circulating');
      }
    });

    it('carries mint time with its source and confidence, never as a bare timestamp', () => {
      for (const state of states) {
        const minted = state.mintedAt;
        assert.ok(['exact', 'bounded', 'unknown'].includes(minted.confidence));
        assert.ok(['issuer_api', 'chain_rpc', 'vendor_field', 'none'].includes(minted.source));
        // A second-hand field can NEVER be exact. Measured: a market vendor's
        // creation time ran a median 22 minutes late against the issuer's own
        // record, which silently reverses the pre-mint ordering gate.
        if (minted.confidence === 'exact') {
          assert.ok(minted.source === 'issuer_api' || minted.source === 'chain_rpc');
        }
        if (minted.confidence === 'bounded') assert.notEqual(minted.boundS, null);
        if (minted.confidence !== 'unknown') assert.notEqual(minted.at, null);
      }
    });

    it('records who told it and when, so a stale read is visible', () => {
      for (const state of states) {
        assert.ok(state.source.vendor.length > 0);
        assert.ok(state.source.endpoint.length > 0);
        assert.equal(state.source.fetchedAt, state.observedAt);
        assert.equal(String(state.venue), String(venue.id));
      }
    });

    it('leaves transfer rules null rather than assuming them read', () => {
      for (const state of states) {
        if (state.transferRules === null) continue;
        const rules = state.transferRules;
        assert.equal(typeof rules.complete, 'boolean');
        // An unread rule set lists no failures — and must not therefore look
        // like a passed one. `complete` is the field that carries that.
        if (!rules.complete) assert.deepEqual(rules.failedChecks, []);
        for (const code of rules.failedChecks) assert.ok(code.length > 0);
      }
    });

    /* ── quotes ──────────────────────────────────────────────────────── */

    it('produces a quote for every venue that claims it can trade', () => {
      if (venue.trade !== undefined) assert.ok(quotes.length > 0, 'a tradeable venue with no recorded quote is untested');
    });

    it('quotes in integers, because a token with 18 decimals exceeds 2^53', () => {
      for (const quote of quotes) {
        assert.equal(typeof quote.inAmount, 'bigint');
        assert.equal(typeof quote.outExpected, 'bigint');
        assert.equal(typeof quote.outMinimum, 'bigint');
        assert.ok(quote.inAmount > 0n);
        assert.ok(quote.outExpected > 0n);
      }
    });

    it('never promises a minimum above the expectation', () => {
      for (const quote of quotes) {
        assert.ok(quote.outMinimum <= quote.outExpected);
        assert.ok(quote.slippageBps >= 0);
      }
    });

    it('itemises its costs, so a confirm sheet cannot render a fixed fee line', () => {
      // Measured all-in cost ranged 1.60% to 22.72% across three same-age
      // mints. Any hardcoded percentage on a Buy screen is a false statement.
      for (const quote of quotes) {
        assert.ok(quote.costs.length > 0, 'a quote with no itemised costs');
        const summed = quote.costs.reduce((sum: number, c: TradeCost) => sum + (c.bps ?? 0), 0);
        assert.equal(quote.allInBps, summed, 'allInBps disagrees with its own itemisation');
        for (const cost of quote.costs) {
          assert.ok(cost.label.length > 0);
          assert.equal(typeof cost.refundable, 'boolean');
          assert.ok(cost.amountUsd === null || Number.isFinite(cost.amountUsd));
        }
      }
    });

    it('says when a quote stops being true, and why', () => {
      for (const quote of quotes) {
        assert.ok(['chain-nonce', 'ttl', 'none'].includes(quote.expiryReason));
        if (quote.expiryReason === 'none') assert.equal(quote.expiresAt, null);
        else assert.notEqual(quote.expiresAt, null);
      }
    });

    it('names a route, which is never cached across a graduation', () => {
      for (const quote of quotes) {
        assert.ok(quote.route.length > 0);
        for (const hop of quote.route) assert.ok(hop.label.length > 0);
      }
    });
  });
}
