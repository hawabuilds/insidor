/**
 * TRACK is not built yet. These are the claims its implementation has to satisfy,
 * written down now while the reasons are fresh — a todo test is a specification that
 * shows up in the test output, which a comment in a document does not.
 */

import { test } from 'node:test';

test('a read that is not yet due is held, not dropped', { todo: 'track/stage.ts' });

test('a held-back item stays on the full grid whatever it scores', { todo: 'track/stage.ts' });

test('budget backpressure sheds the top tier first and never probation', {
  todo: 'track/shed.ts',
});

test('tracking never stops early because an item looked cold', { todo: 'track/schedule.ts' });
