# Rescore threshold analysis

Generated: 2026-08-03T21:38:52.560Z
Source: validation cache · **629** narratives (v2 coinability prompt)

> Scores cluster at 0.7–0.85 (model rarely outputs higher). The big coined-rate jump is **below vs above 0.7**, not between 0.7 and 0.8.

## Score bands — all narratives

| Score band | Narratives | Coined | Coin rate |
| --- | ---: | ---: | ---: |
| 0.0–0.3 | 321 | 4 | 1.2% |
| 0.3–0.5 | 98 | 1 | 1.0% |
| 0.5–0.6 | 0 | 0 | n/a |
| 0.6–0.7 | 3 | 3 | 100.0% |
| 0.7–0.8 | 76 | 54 | 71.1% |
| 0.8–0.9 | 131 | 97 | 74.0% |
| 0.9–1.0 | 0 | 0 | n/a |

### Where the jump is

At **≥ 0.70**: 72.9% coined (207 narratives)
Below **0.70**: 1.9% coined (422 narratives)
Gap: **+71.1 pts**

Within the pass range, coin rate is flat (~71–74%) from 0.7 through 0.85 — raising above 0.7 mostly drops volume without improving precision.

### TikTok-only caveat

TT-only narratives in this cache (n=82) mostly scored **0.4** (thumbnail cap / no vision rescore) — not usable for TT threshold calibration. Keep **MEME_MIN_TT=0.75** until TT vision rescores are in the validation set.

## Cumulative coin rate from threshold

| Threshold (≥) | Would pass | Coined | Coin rate | Δ rate vs prior |
| --- | ---: | ---: | ---: | ---: |
| **0.50** | 210 | 154 | **73.3%** | — |
| **0.55** | 210 | 154 | **73.3%** | +0.0 pts |
| **0.60** | 210 | 154 | **73.3%** | +0.0 pts |
| **0.65** | 210 | 154 | **73.3%** | +0.0 pts |
| **0.70** | 207 | 151 | **72.9%** | -0.4 pts |
| **0.75** | 199 | 147 | **73.9%** | +0.9 pts |
| **0.80** | 131 | 97 | **74.0%** | +0.2 pts |
| **0.85** | 91 | 67 | **73.6%** | -0.4 pts |

## Volume tradeoff

| MEME_MIN | Pass count | Pass % of sample | Coined among pass | Coin rate |
| ---: | ---: | ---: | ---: | ---: |
| 0.60 | 210 | 33.4% | 154 | 73.3% |
| 0.70 | 207 | 32.9% | 151 | 72.9% |
| 0.75 | 199 | 31.6% | 147 | 73.9% |
| 0.80 | 131 | 20.8% | 97 | 74.0% |

| Change | Effect |
| --- | --- |
| 0.60 → 0.70 | −3 passes (1.4% of current 0.6 passes), coin rate ~flat |
| 0.70 → 0.80 | −76 passes (36.7% of 0.7 passes), +0.1 pts coin rate |

## Recommended defaults

| Setting | Old default | New default | Why |
| --- | ---: | ---: | --- |
| MEME_MIN_X | 0.60 | **0.70** | Elbow: ~2% coined below vs ~73% at/above |
| MEME_MIN_TT | 0.75 | **0.75** | Unchanged — TT not calibrated in this cache |

```env
MEME_MIN_X=0.70
MEME_MIN_TT=0.75
```

