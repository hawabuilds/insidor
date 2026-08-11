# The blind labelling protocol

Carried over from the previous build, where it was the best thing in the
repository, and upgraded in exactly two places.

Our design documents specified how to test *code* and said nothing about how to
evaluate a *claim* without fooling ourselves. This protocol filled that gap. It
is the reason we know the previous results were unstable — without it we would
have had three waves of numbers and no way to notice that three of the four
"strongest" features flipped sign between wave 2 and wave 3.

Keep it whatever else changes.

---

## The steps

1. **Draw the sample and declare its population.** `buildBlindSheet` refuses a
   blank population. The last backtest failed because its population was
   graduated coins — about 107 a day against roughly 30,000 mints — while its
   claim was about coinability in general. Labelling another 2,000 graduated
   coins would have produced the same nothing; the null was a selection
   artefact, not a power problem.

2. **Exclude units from earlier waves by id.** This is what makes cross-wave
   replication checkable at all.

3. **Shuffle with the seed.** 42, by tradition. Every wave regenerates exactly
   from its seed, forever. Keep the earlier, wronger waves on disk — their
   survival is what made the sign flip visible.

4. **Write two files to two places.** The sheet goes to the labeller. The answer
   file goes somewhere the labeller does not open, ideally not the same machine.
   Line one of the answer file is the warning.

5. **Label every row.** Booleans only. Stopping when the pattern looks clear
   turns a wave into a story about the rows someone felt like doing, which is why
   `reveal` refuses a partial sheet rather than reporting on what it has.

6. **Reveal, once, as a separate command.** The join is the moment blindness
   ends. It should be an event, not a side effect of opening a spreadsheet.

7. **Read the distribution, not the headline.** Cells with fewer than five
   observations are flagged and must not be read. A result that does not
   replicate across waves is not a result.

---

## What was upgraded, and why

The old split was real: the blind file genuinely omitted the outcome column, and
the answers went to a separate CSV with a do-not-open banner on line one.

**But the sheet carried the coin's page URL and its raw mint address.** One click
showed the full price history, and a ≥10× winner is unmistakable next to a <1.5×
loser. There was no positive evidence of peeking — origins were actually found
slightly *more* often among losers, the opposite of what motivated peeking
produces — but the design could not prove its own blindness, and it did not have
to be that way.

**Upgrade 1 — blindness is enforced, not requested.** `redact.ts` holds a field
allowlist and a value-level scan. The scan reads values rather than key names,
because a leak nested inside an object is exactly what a key allowlist waves
through. A violation fails when the sheet is BUILT, loudly, not when a reviewer
notices a column six weeks later.

**Upgrade 2 — the join is structurally unavailable.** Each row carries an opaque
`caseKey`: a digest of the unit id under a salt that exists only in the answer
file. Holding the sheet and the entire production database is not enough to
rebuild the join. Previously the sheet carried the identifiers and the separation
was procedural.

---

## The residual, stated rather than glossed

**A labeller can paste the post text into a search engine.** No artefact prevents
that, and pretending otherwise would be the same mistake as the URL column —
claiming a guarantee the instrument does not provide.

So it is a commitment the person makes, in writing, before the wave starts, and
it is written here rather than implied:

> I will not search for, look up, or otherwise seek the outcome of any case on
> this sheet until the wave is revealed. If I do, I will say so, and the wave
> will be discarded rather than corrected.

A discarded wave costs a day. A wave that was quietly contaminated costs every
decision that cites it.
