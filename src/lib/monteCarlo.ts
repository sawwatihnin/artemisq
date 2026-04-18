export interface UncertaintyModel {
  fuelSigmaFraction?: number;
  radiationSigmaFraction?: number;
  communicationSpread?: number;
  maxFuelDeviation?: number;
  maxRadiationDeviation?: number;
  communicationOutageProbability?: number;
  replanSuccessSigmaFraction?: number;
  costSigmaFraction?: number;
  healthRiskSigmaFraction?: number;
  solarEventProbability?: number;
  acuteSpikeMultiplier?: [number, number];
}

export interface MissionUncertaintySample {
  fuelScale: number;
  radiationScale: number;
  communicationScale: number;
  outagePenalty?: number;
  replanSuccessScale?: number;
  costScale?: number;
  healthRiskScale?: number;
  solarEvent?: boolean;
  acuteSpikeScale?: number;
}

export interface MonteCarloRun<TMetrics> {
  index: number;
  sample: MissionUncertaintySample;
  cost: number;
  success: boolean;
  metrics: TMetrics;
}

export interface MonteCarloSummary<TMetrics> {
  runs: number;
  expectedCost: number;
  variance: number;
  successProbability: number;
  samples: MonteCarloRun<TMetrics>[];
}

export interface DecisionOptionMonteCarloSummary<TMetrics> {
  optionName: string;
  expectedMissionCost: number;
  expectedCrewRisk: number;
  variance: number;
  probabilityUnsafe: number;
  probabilityOfSuccessfulCompletion: number;
  samples: MonteCarloRun<TMetrics>[];
}

function gaussianRandom(): number {
  let u = 0;
  let v = 0;

  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();

  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function sampleMissionUncertainty(model: UncertaintyModel = {}): MissionUncertaintySample {
  const fuelSigmaFraction = model.fuelSigmaFraction ?? 0.08;
  const radiationSigmaFraction = model.radiationSigmaFraction ?? 0.12;
  const communicationSpread = model.communicationSpread ?? 0.18;
  const maxFuelDeviation = model.maxFuelDeviation ?? 0.22;
  const maxRadiationDeviation = model.maxRadiationDeviation ?? 0.35;
  const communicationOutageProbability = model.communicationOutageProbability ?? 0.1;
  const replanSuccessSigmaFraction = model.replanSuccessSigmaFraction ?? 0.08;
  const costSigmaFraction = model.costSigmaFraction ?? 0.12;
  const healthRiskSigmaFraction = model.healthRiskSigmaFraction ?? 0.1;
  const solarEventProbability = model.solarEventProbability ?? 0.18;
  const acuteSpikeMultiplier = model.acuteSpikeMultiplier ?? [1.08, 1.45];
  const solarEvent = Math.random() < solarEventProbability;
  const acuteSpikeScale = solarEvent
    ? acuteSpikeMultiplier[0] + Math.random() * (acuteSpikeMultiplier[1] - acuteSpikeMultiplier[0])
    : 1;

  return {
    fuelScale: clamp(1 + gaussianRandom() * fuelSigmaFraction, 1 - maxFuelDeviation, 1 + maxFuelDeviation),
    radiationScale: clamp(1 + gaussianRandom() * radiationSigmaFraction, 1 - maxRadiationDeviation, 1 + maxRadiationDeviation),
    communicationScale: clamp(1 + (Math.random() * 2 - 1) * communicationSpread, 0.55, 1.3),
    outagePenalty: Math.random() < communicationOutageProbability ? 1.2 : 1,
    replanSuccessScale: clamp(1 + gaussianRandom() * replanSuccessSigmaFraction, 0.75, 1.25),
    costScale: clamp(1 + gaussianRandom() * costSigmaFraction, 0.65, 1.5),
    healthRiskScale: clamp(1 + gaussianRandom() * healthRiskSigmaFraction, 0.75, 1.35),
    solarEvent,
    acuteSpikeScale,
  };
}

export function runMonteCarlo<TMetrics>(
  runs: number,
  evaluate: (sample: MissionUncertaintySample, index: number) => { cost: number; success: boolean; metrics: TMetrics },
  model: UncertaintyModel = {},
): MonteCarloSummary<TMetrics> {
  const safeRuns = Math.max(1, runs);
  const samples: MonteCarloRun<TMetrics>[] = [];

  for (let i = 0; i < safeRuns; i++) {
    const sample = sampleMissionUncertainty(model);
    const result = evaluate(sample, i);
    samples.push({
      index: i,
      sample,
      cost: result.cost,
      success: result.success,
      metrics: result.metrics,
    });
  }

  const expectedCost = samples.reduce((sum, sample) => sum + sample.cost, 0) / safeRuns;
  const variance = samples.reduce((sum, sample) => sum + (sample.cost - expectedCost) ** 2, 0) / safeRuns;
  const successProbability = samples.filter((sample) => sample.success).length / safeRuns;

  return {
    runs: safeRuns,
    expectedCost,
    variance,
    successProbability,
    samples,
  };
}

export function runDecisionOptionMonteCarlo<TMetrics>(
  optionName: string,
  runs: number,
  evaluate: (
    sample: MissionUncertaintySample,
    index: number,
  ) => { cost: number; success: boolean; unsafe: boolean; crewRisk: number; metrics: TMetrics },
  model: UncertaintyModel = {},
): DecisionOptionMonteCarloSummary<TMetrics> {
  const safeRuns = Math.max(1, runs);
  const samples: MonteCarloRun<TMetrics>[] = [];
  let unsafeCount = 0;
  let crewRiskSum = 0;

  for (let i = 0; i < safeRuns; i++) {
    const sample = sampleMissionUncertainty(model);
    const result = evaluate(sample, i);
    crewRiskSum += result.crewRisk;
    if (result.unsafe) unsafeCount++;
    samples.push({
      index: i,
      sample,
      cost: result.cost,
      success: result.success,
      metrics: result.metrics,
    });
  }

  const expectedMissionCost = samples.reduce((sum, sample) => sum + sample.cost, 0) / safeRuns;
  const variance = samples.reduce((sum, sample) => sum + (sample.cost - expectedMissionCost) ** 2, 0) / safeRuns;
  const probabilityOfSuccessfulCompletion = samples.filter((sample) => sample.success).length / safeRuns;

  return {
    optionName,
    expectedMissionCost,
    expectedCrewRisk: crewRiskSum / safeRuns,
    variance,
    probabilityUnsafe: unsafeCount / safeRuns,
    probabilityOfSuccessfulCompletion,
    samples,
  };
}
