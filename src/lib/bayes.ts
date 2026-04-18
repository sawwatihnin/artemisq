export interface BayesianRiskSample {
  risk?: number;
  unsafe?: boolean;
  success?: boolean;
  cost?: number;
}

export interface RiskPrior {
  alpha: number;
  beta: number;
  priorRisk: number;
  confidence: number;
  evidenceCount: number;
}

export interface RiskObservation {
  radiationReading?: number;
  communicationOpen?: boolean;
  commSignalStrength?: number;
  anomalySignals?: Array<string | { type?: string; severity?: number; confidence?: number }>;
}

export interface BayesianRiskUpdate {
  priorRisk: number;
  posteriorRisk: number;
  confidenceShift: number;
  likelihood: number;
  posterior: RiskPrior;
  evidence: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function confidenceFromCounts(alpha: number, beta: number): number {
  return clamp(1 - Math.exp(-(alpha + beta) / 12), 0, 1);
}

function inferSampleRisk(sample: BayesianRiskSample): number {
  if (typeof sample.risk === 'number') return clamp(sample.risk, 0, 1.5) / 1.5;
  if (sample.unsafe != null) return sample.unsafe ? 0.85 : 0.15;
  if (sample.success != null) return sample.success ? 0.2 : 0.8;
  if (typeof sample.cost === 'number') return clamp(sample.cost / Math.max(sample.cost + 1000, 1), 0.1, 0.9);
  return 0.5;
}

function anomalySignalContribution(signal: string | { type?: string; severity?: number; confidence?: number }): number {
  if (typeof signal === 'string') {
    const normalized = signal.toUpperCase();
    if (normalized.includes('COMM')) return 0.16;
    if (normalized.includes('PROP')) return 0.2;
    if (normalized.includes('RADIATION')) return 0.24;
    return 0.08;
  }

  const severity = clamp(signal.severity ?? 0.5, 0, 1.5);
  const confidence = clamp(signal.confidence ?? 0.6, 0, 1);
  const type = signal.type?.toUpperCase() ?? 'GENERIC';
  const typeWeight = type.includes('RADIATION') ? 0.28 : type.includes('PROP') ? 0.22 : type.includes('COMM') ? 0.18 : 0.1;
  return typeWeight * severity * (0.65 + 0.35 * confidence);
}

export function initializeRiskPrior(samples: BayesianRiskSample[]): RiskPrior {
  if (!samples.length) {
    const alpha = 1.5;
    const beta = 3.5;
    return {
      alpha,
      beta,
      priorRisk: alpha / (alpha + beta),
      confidence: confidenceFromCounts(alpha, beta),
      evidenceCount: 0,
    };
  }

  const inferred = samples.map(inferSampleRisk);
  const meanRisk = inferred.reduce((sum, value) => sum + value, 0) / inferred.length;
  const pseudoCount = Math.max(4, Math.min(40, samples.length * 0.35));
  const alpha = 1 + meanRisk * pseudoCount;
  const beta = 1 + (1 - meanRisk) * pseudoCount;

  return {
    alpha,
    beta,
    priorRisk: alpha / (alpha + beta),
    confidence: confidenceFromCounts(alpha, beta),
    evidenceCount: samples.length,
  };
}

export function updateRiskPosterior(prior: RiskPrior, observation: RiskObservation): BayesianRiskUpdate {
  const evidence: string[] = [];
  let likelihood = prior.priorRisk;

  if (typeof observation.radiationReading === 'number') {
    const normalizedRadiation = clamp(observation.radiationReading / 1.1, 0, 1.6);
    likelihood += 0.32 * normalizedRadiation;
    if (normalizedRadiation > 0.8) evidence.push('elevated radiation telemetry');
  }

  if (observation.communicationOpen === false) {
    likelihood += 0.18;
    evidence.push('communication outage');
  }

  if (typeof observation.commSignalStrength === 'number') {
    likelihood += 0.14 * (1 - clamp(observation.commSignalStrength, 0, 1));
    if (observation.commSignalStrength < 0.55) evidence.push('reduced communication margin');
  }

  for (const signal of observation.anomalySignals ?? []) {
    likelihood += anomalySignalContribution(signal);
  }
  if ((observation.anomalySignals?.length ?? 0) > 0) {
    evidence.push('fault-detection anomaly evidence');
  }

  likelihood = clamp(likelihood, 0.02, 0.98);
  const posteriorAlpha = prior.alpha + likelihood;
  const posteriorBeta = prior.beta + (1 - likelihood);
  const posteriorRisk = posteriorAlpha / (posteriorAlpha + posteriorBeta);
  const nextConfidence = confidenceFromCounts(posteriorAlpha, posteriorBeta);

  return {
    priorRisk: prior.priorRisk,
    posteriorRisk,
    confidenceShift: nextConfidence - prior.confidence,
    likelihood,
    posterior: {
      alpha: posteriorAlpha,
      beta: posteriorBeta,
      priorRisk: posteriorRisk,
      confidence: nextConfidence,
      evidenceCount: prior.evidenceCount + 1,
    },
    evidence,
  };
}
