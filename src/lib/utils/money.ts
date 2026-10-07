export function usd(n: number, dp = 4): string {
  return `$${n.toFixed(dp).replace(/0+$/, '').replace(/\.$/, '')}`;
}

export function round(n: number, dp = 5): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
