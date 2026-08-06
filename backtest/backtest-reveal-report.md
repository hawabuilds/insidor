# Backtest Reveal Report

Generated: 2026-07-29T19:38:10.820Z
Outcome thresholds: **RAN** ≥ 5× peak · **FIZZLED** < 2× · middle = 2×–5×
Joined rows: 150

## Outcome breakdown (all rows)

| Outcome | Count |
| --- | ---: |
| RAN (≥5×) | 12 |
| Middle (2×–5×) | 24 |
| FIZZLED (<2×) | 114 |
| Unknown peak | 0 |

## Comparison 1 — Does viral origin matter at all?

Split: rows **with** `post_url` vs **without**. No judgement columns needed.

| Group | n | Median peak× | Median ATH mcap | % RAN |
| --- | ---: | ---: | ---: | ---: |
| Has post_url (viral origin) | 32 | 1.37× | $54,773 | 9.4% |
| No post_url | 118 | 1.21× | $45,281 | 7.6% |

> **Descriptive, not statistically significant.** Viral-origin subset: 32 rows → RAN 3 vs FIZZLED 22. Every feature row flags RAN n<5. Only large gaps are worth treating as signal.

## Comparison 2 — Among viral-origin coins, what separated winners?

Viral-origin rows: **32** · RAN **3** · FIZZLED **22** · middle **7**

Hand-label yes-rates (excludes `unclear` / blank):

| Feature | RAN (n=?) | yes-rate | FIZZLED (n=?) | yes-rate | difference | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| one_word_name | 3 | 66.7% | 20 | 90.0% | -23.3 pts | RAN usable <5; excluded unclear: RAN 0, FIZZ 2 |
| has_character | 3 | 100.0% | 20 | 75.0% | +25.0 pts | RAN usable <5; excluded unclear: RAN 0, FIZZ 2 |
| works_as_photo | 3 | 100.0% | 20 | 90.0% | +10.0 pts | RAN usable <5; excluded unclear: RAN 0, FIZZ 2 |
| funny_not_serious | 3 | 100.0% | 19 | 36.8% | +63.2 pts | RAN usable <5; excluded unclear: RAN 0, FIZZ 3 |
| others_copying_it | 3 | 100.0% | 20 | 30.0% | +70.0 pts | RAN usable <5; excluded unclear: RAN 0, FIZZ 2 |
| crypto_noticed | 3 | 100.0% | 20 | 65.0% | +35.0 pts | RAN usable <5; excluded unclear: RAN 0, FIZZ 2 |
| ticker_in_replies | — | — | — | — | — | column not present |

### Timing & metadata (viral-origin only)

| Metric | RAN | FIZZLED |
| --- | ---: | ---: |
| hours_post_to_launch (median) | 19.4 | 5.7 |
| media_type | video: 1 · (blank): 1 · image: 1 | image: 8 · video: 8 · text: 3 · (blank): 3 |
| origin_platform | tiktok: 1 · reddit: 1 · x: 1 | x: 16 · youtube: 2 · (blank): 2 · reddit: 1 · instagram: 1 |

### author_followers (clean signal)

Median followers (X/syndication rows only, n=1/17): **RAN 5,703,588** vs **FIZZLED 191,585**. TikTok/Reddit/YouTube rows excluded.

A 500-follower account going viral is a different event from a 2M-follower account posting the same content — bucket breakdown:

| Bucket | RAN | FIZZLED |
| --- | ---: | ---: |
| small (<10k) | 0 | 6 |
| mid (10k–100k) | 0 | 2 |
| large (≥100k) | 1 | 9 |

Small-account X viral hits among RAN rows (<10k followers):
- None with follower data

---
*views_now / replies_now / reposts_now in enriched file are contaminated post-launch metrics — not used here.*
