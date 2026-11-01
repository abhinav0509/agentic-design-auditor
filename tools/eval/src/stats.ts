// Wilson score interval: a 95% interval for a rate that stays sensible at small n and at 0 or 1.
export type Rate = {
  k: number;
  n: number;
  rate: number | null;
  low: number | null;
  high: number | null;
};

export function wilson(k: number, n: number, z = 1.96): Rate {
  if (n === 0) return { k, n, rate: null, low: null, high: null };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { k, n, rate: p, low: Math.max(0, center - half), high: Math.min(1, center + half) };
}
