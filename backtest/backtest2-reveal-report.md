# Backtest2 Reveal Report

Generated: 2026-07-30T12:04:52.969Z
Joined rows: **436** (218 winners · 218 losers)

> **Descriptive only — not statistically significant.** Case-control design (218 vs 218). Small subgroups (especially viral-origin n=38) cannot support strong inference. Cells flagged ⚠ when usable n<5.

## 1. Viral origin vs outcome group

Viral origin = row has a non-empty `post_url`. Base rate in this sample: **50%** winners (218/436).

| Metric | Value |
| --- | --- |
| Rows with viral origin | 39 (8.9% of 436) — 38 have judgement labels |
| └ X platform | 28 |
| └ Other platform | 11 |
| Viral + WINNER | **20** (51.3% of viral) |
| Viral + LOSER | **19** (48.7% of viral) |
| vs 50% base rate | +1.3 pts winner share |

For context — non-viral rows:
- No post_url + winner: 198
- No post_url + loser: 199

## 2. Judgement yes-rates — winners vs losers

Excludes `unclear` and blank. **Judgement columns were only filled where an origin was found** (38 rows with yes/no labels: 19 winners · 19 losers). Non-viral rows have blank judgements.

*Note: `one_word_name`, `ticker_in_replies` were truncated in the Google Sheets export header and are not available in the filled file.*

| Feature | Winners yes-rate | n | Losers yes-rate | n | Δ (win−lose) |
| --- | ---: | ---: | ---: | ---: | ---: |
| has_character | 78.9% | 19 | 78.9% | 19 | +0.0 pts |
| works_as_photo | 78.9% | 19 | 94.7% | 19 | -15.8 pts |
| funny_not_serious | 47.4% | 19 | 36.8% | 19 | +10.5 pts |
| others_copying_it | 52.6% | 19 | 47.4% | 19 | +5.3 pts |
| crypto_noticed | 73.7% | 19 | 52.6% | 19 | +21.1 pts |

### Viral-origin only (same 38 rows — only rows with judgements filled)

| Feature | Winner yes-rate | n | Loser yes-rate | n | Δ |
| --- | ---: | ---: | ---: | ---: | ---: |
| has_character | 78.9% | 19 | 78.9% | 19 | +0.0 pts |
| works_as_photo | 78.9% | 19 | 94.7% | 19 | -15.8 pts |
| funny_not_serious | 47.4% | 19 | 36.8% | 19 | +10.5 pts |
| others_copying_it | 52.6% | 19 | 47.4% | 19 | +5.3 pts |
| crypto_noticed | 73.7% | 19 | 52.6% | 19 | +21.1 pts |

## 3. Timing & platform splits

*`hours_post_to_launch` was not collected in the filled backtest2 sheet — median not available.*
*`media_type` was not collected in the filled backtest2 sheet — split not available.*

### origin_platform (all rows)

| Platform | Winners | Losers |
| --- | ---: | ---: |
| instagram | 2 ⚠ n<5 | 1 ⚠ n<5 |
| tiktok | 5 | 3 ⚠ n<5 |
| x | 13 | 15 |
| (no platform) | 198 | 199 |

---
*Peak multiples and ATH mcap from Dune dex trades (v2 logic). Groups assigned at build time (strict winners vs sampled losers).*
