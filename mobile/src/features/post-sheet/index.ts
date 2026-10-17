/**
 * The post sheet's one way in. The feed and the token page import from here and nothing else in
 * this folder, so the sheet's insides can change without either screen noticing.
 */

export { PostSheet, type PostSheetProps } from './PostSheet.tsx';
/* The narrative page draws the same chart, coin row, Choose coin and Buy ticket (features/narrative). */
export { GainChart, type ChartMarker } from './GainChart.tsx';
export { CHART_INTERVALS, GAIN_INTERVALS, LAST_WORDS, buckets, firstWords, hm, lastGain, launchTime, plus, sparkInterval, smoothPath, type ChartInterval, type GainInterval, type GainSlots } from './gain-chart.ts';
export { pctText } from './mc-change.ts';
export { useMcChange } from './useMcChange.ts';
export { ChooseCoin } from './ChooseCoin.tsx';
export { CoinLine } from './CoinLine.tsx';
export { BuyOpen, SheetToast, type SheetNote } from './BuyOpen.tsx';
export type { Reading } from './sheet-view.ts';
