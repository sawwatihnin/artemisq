export interface DistributionSummary {
  mean: number;
  variance: number;
  stdDev: number;
  p10: number;
  p50: number;
  p90: number;
  min: number;
  max: number;
  histogram: Array<{ binStart: number; binEnd: number; count: number }>;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function summarizeDistribution(samples: number[], bins: number = 8): DistributionSummary {
  const finiteSamples = samples.filter((sample) => Number.isFinite(sample));
  if (!finiteSamples.length) {
    return {
      mean: 0,
      variance: 0,
      stdDev: 0,
      p10: 0,
      p50: 0,
      p90: 0,
      min: 0,
      max: 0,
      histogram: [],
    };
  }

  const sorted = [...finiteSamples].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, sample) => sum + sample, 0) / sorted.length;
  const variance = sorted.reduce((sum, sample) => sum + (sample - mean) ** 2, 0) / sorted.length;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const width = Math.max((max - min) / Math.max(bins, 1), 1e-9);

  const histogram = Array.from({ length: bins }, (_, index) => ({
    binStart: min + index * width,
    binEnd: min + (index + 1) * width,
    count: 0,
  }));

  for (const sample of sorted) {
    const bucket = Math.min(histogram.length - 1, Math.floor((sample - min) / width));
    histogram[bucket].count += 1;
  }

  return {
    mean,
    variance,
    stdDev: Math.sqrt(variance),
    p10: quantile(sorted, 0.1),
    p50: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    min,
    max,
    histogram,
  };
}
