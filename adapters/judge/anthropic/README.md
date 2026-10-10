# @insidor/judge-anthropic

The coinability judge. It answers one question — is there a nameable subject in these posts — and
returns evidence. Whether a story qualifies is decided in `core/qualify`.

Prompts live in `prompts/*.txt`, never in code. They are hashed at load and the hash goes into the
decider string on every decision the judge contributes to.

News, events and arguments are "no subject", taught as worked pairs in `subject-vs-story.txt`.
`fixtures/news-contrasts.json` lists each pair, the answer it should get, and the prompt lines
that teach it; `src/news-contrasts.test.ts` fails if a prompt edit drops one. The fixture answers
are hand-written, not recorded — see the follow-ups in `docs/meme-score-comparison.md`.

## Configuration and money

`ANTHROPIC_API_KEY` and `JUDGE_MODEL` (no default; it must be a model in `src/prices.ts`). With
neither set the judge is dormant; with only the model it can price a dry run; with only the
key the boot fails. Every call is estimated first (`estimate()`, no I/O), checked by the meter
against the daily cap and the vendor line, and recorded at what the token counts say it cost.
Retries, timeouts and the output ceiling are in `Policy.judge`. `src/client.ts` is the only
file that touches the network.

## What breaks here

- **A prompt moving into a template literal.** It stops being diffable, stops being the instruction
  sheet a human labeller works from, and stops surviving the model.
- **A prompt edit with no hash change reaching the log.** Then every judgement before and after the
  edit looks identical, and no past decision can be audited.
- **Filling in a missing judgement.** An unasked question and a negative answer are different
  populations; merging them poisons every recall number downstream.
- **Counting the call only when the parse succeeded.** That is the live bug the meter's `finally`
  exists to prevent — the error path was billed and invisible.
- **Adding `cache_control`.** The minimum cacheable prefix on this model is 4,096 tokens and the
  instruction set is smaller, so it silently does nothing.
- **Optimising the "not coinable" rate upward.** 50–70% coming back not coinable is the correct
  outcome, not a tuning target — pushing it down reintroduces the wrong-coin bug.
