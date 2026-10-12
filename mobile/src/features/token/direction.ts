/**
 * Up, down or flat over a price series — what colours the price chart: green when it ended
 * above where it started, red when below. Price is the one line on screen allowed those colours;
 * view sparklines stay purple.
 */
export function directionOf(series: readonly number[]): 'up' | 'down' | 'flat' {
  const first = series[0];
  const last = series[series.length - 1];
  if (first === undefined || last === undefined || first === last) return 'flat';
  return last > first ? 'up' : 'down';
}
