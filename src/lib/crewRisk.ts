export type CrewRiskClassification = 'SAFE' | 'MONITOR' | 'HIGH_RISK' | 'DO_NOT_EMBARK';
export type EmbarkationDecision = 'SAFE_TO_EMBARK' | 'PROCEED_WITH_CAUTION' | 'DO_NOT_EMBARK';

export interface RadiationSamplePoint {
  t: number;
  nodeId: string;
  nodeName: string;
  radiation: number;
}

export interface CrewRadiationParams {
  timestepHours?: number;
  shieldingFactor?: number;
  crewSensitivity?: number;
  unsafeDoseRateThreshold?: number;
  acuteDoseRateThreshold?: number;
  alpha?: number;
  beta?: number;
  gamma?: number;
  normalizationDenominator?: number;
  strongerShieldingFactor?: number;
  delayedLaunchRadiationScale?: number;
}

export interface CrewRadiationReadiness {
  cumulativeDose: number;
  peakExposure: number;
  unsafeDuration: number;
  riskScore: number;
  classification: CrewRiskClassification;
  embarkationDecision: EmbarkationDecision;
  rawScore: number;
  missionDuration: number;
  dominantSegment: {
    nodeId: string;
    nodeName: string;
    contributionDose: number;
    share: number;
  };
  segmentContributions: Array<{
    nodeId: string;
    nodeName: string;
    contributionDose: number;
    unsafeHours: number;
  }>;
  assumptions: string[];
  limitations: string[];
}

export interface CrewRiskCounterfactual {
  name: string;
  riskScore: number;
  classification: CrewRiskClassification;
  deltaRisk: number;
  summary: string;
}

export interface CrewRiskValidationReport {
  passedConsistencyChecks: boolean;
  consistencyChecks: Array<{ name: string; passed: boolean; note: string }>;
  monotonicityChecks: Array<{ name: string; passed: boolean; note: string }>;
  thresholdTrace: string;
  dominantRiskDriver: string;
  counterfactuals: CrewRiskCounterfactual[];
  confidenceNote: string;
  limitations: string[];
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function classifyRisk(score: number): CrewRiskClassification {
  if (score <= 0.3) return 'SAFE';
  if (score <= 0.6) return 'MONITOR';
  if (score <= 1.0) return 'HIGH_RISK';
  return 'DO_NOT_EMBARK';
}

function embarkationFromClassification(classification: CrewRiskClassification): EmbarkationDecision {
  if (classification === 'SAFE') return 'SAFE_TO_EMBARK';
  if (classification === 'MONITOR') return 'PROCEED_WITH_CAUTION';
  return 'DO_NOT_EMBARK';
}

export function calculateCumulativeDose(
  samples: RadiationSamplePoint[],
  params: Pick<CrewRadiationParams, 'timestepHours' | 'shieldingFactor' | 'crewSensitivity'> = {},
): number {
  const timestepHours = params.timestepHours ?? 6;
  const shieldingFactor = params.shieldingFactor ?? 0.72;
  const crewSensitivity = params.crewSensitivity ?? 1.08;
  return samples.reduce(
    (sum, sample) => sum + sample.radiation * timestepHours * shieldingFactor * crewSensitivity,
    0,
  );
}

export function calculatePeakExposure(
  samples: RadiationSamplePoint[],
  params: Pick<CrewRadiationParams, 'shieldingFactor' | 'crewSensitivity'> = {},
): number {
  const shieldingFactor = params.shieldingFactor ?? 0.72;
  const crewSensitivity = params.crewSensitivity ?? 1.08;
  return samples.reduce(
    (max, sample) => Math.max(max, sample.radiation * shieldingFactor * crewSensitivity),
    0,
  );
}

export function calculateUnsafeDuration(
  samples: RadiationSamplePoint[],
  params: Pick<CrewRadiationParams, 'timestepHours' | 'shieldingFactor' | 'crewSensitivity' | 'unsafeDoseRateThreshold'> = {},
): number {
  const timestepHours = params.timestepHours ?? 6;
  const shieldingFactor = params.shieldingFactor ?? 0.72;
  const crewSensitivity = params.crewSensitivity ?? 1.08;
  const unsafeDoseRateThreshold = params.unsafeDoseRateThreshold ?? 0.78;
  return samples.filter(
    (sample) => sample.radiation * shieldingFactor * crewSensitivity > unsafeDoseRateThreshold,
  ).length * timestepHours;
}

export function calculateHealthRiskScore(
  metrics: {
    cumulativeDose: number;
    peakExposure: number;
    unsafeDuration: number;
    missionDuration: number;
  },
  params: Pick<CrewRadiationParams, 'alpha' | 'beta' | 'gamma' | 'unsafeDoseRateThreshold' | 'normalizationDenominator'> = {},
): { rawScore: number; riskScore: number } {
  const alpha = params.alpha ?? 0.42;
  const beta = params.beta ?? 0.95;
  const gamma = params.gamma ?? 0.08;
  const unsafeDoseRateThreshold = params.unsafeDoseRateThreshold ?? 0.78;
  const rawScore = alpha * metrics.cumulativeDose + beta * metrics.peakExposure + gamma * metrics.unsafeDuration;
  const normalizationDenominator = params.normalizationDenominator
    ?? Math.max(1.2, unsafeDoseRateThreshold * Math.max(metrics.missionDuration, 1) * 0.82);
  return {
    rawScore,
    riskScore: clamp(rawScore / normalizationDenominator, 0, 1.5),
  };
}

export function classifyCrewRadiationRisk(riskScore: number): {
  classification: CrewRiskClassification;
  embarkationDecision: EmbarkationDecision;
} {
  const classification = classifyRisk(riskScore);
  return {
    classification,
    embarkationDecision: embarkationFromClassification(classification),
  };
}

export function determineDominantRiskDriver(
  readiness: Pick<CrewRadiationReadiness, 'peakExposure' | 'unsafeDuration' | 'cumulativeDose' | 'dominantSegment'>,
  params: Pick<CrewRadiationParams, 'acuteDoseRateThreshold'> = {},
): string {
  const acuteDoseRateThreshold = params.acuteDoseRateThreshold ?? 1.05;
  if (readiness.peakExposure > acuteDoseRateThreshold) return 'peak acute exposure';
  if (readiness.unsafeDuration > 0) return 'unsafe duration';
  return 'cumulative dose';
}

export function generateThresholdTrace(
  readiness: CrewRadiationReadiness,
  params: Pick<CrewRadiationParams, 'acuteDoseRateThreshold'> = {},
): string {
  const dominantMetric = determineDominantRiskDriver(readiness, params);
  if (readiness.classification === 'DO_NOT_EMBARK') {
    return `Do not embark because ${dominantMetric} crossed mission-action thresholds; ${readiness.dominantSegment.nodeName} contributed ${(readiness.dominantSegment.share * 100).toFixed(0)}% of modeled cumulative dose and unsafe exposure persisted for ${readiness.unsafeDuration.toFixed(1)} hours.`;
  }
  if (readiness.classification === 'HIGH_RISK') {
    return `High-risk classification triggered by ${dominantMetric}; ${readiness.dominantSegment.nodeName} was the dominant contributor and acute-rate screening remained under continuous review.`;
  }
  if (readiness.classification === 'MONITOR') {
    return `Proceed-with-caution posture because cumulative dose remained below no-go limits but exceeded the nominal safe band during ${readiness.unsafeDuration.toFixed(1)} hours.`;
  }
  return 'Safe-to-embark classification retained because no modeled radiation metric crossed the operational action thresholds.';
}

export function runInternalConsistencyChecks(
  samples: RadiationSamplePoint[],
  readiness: CrewRadiationReadiness,
  params: Pick<CrewRadiationParams, 'timestepHours' | 'shieldingFactor' | 'crewSensitivity'> = {},
): Array<{ name: string; passed: boolean; note: string }> {
  const timestepHours = params.timestepHours ?? 6;
  const rawPeak = calculatePeakExposure(samples, params);
  return [
    {
      name: 'Cumulative dose is non-negative',
      passed: readiness.cumulativeDose >= 0,
      note: `Computed cumulative dose ${readiness.cumulativeDose.toFixed(2)}.`,
    },
    {
      name: 'Peak exposure matches timestep maxima',
      passed: Math.abs(readiness.peakExposure - rawPeak) < 1e-6,
      note: `Reported ${readiness.peakExposure.toFixed(4)} vs recomputed ${rawPeak.toFixed(4)}.`,
    },
    {
      name: 'Unsafe duration bounded by mission duration',
      passed: readiness.unsafeDuration <= readiness.missionDuration + 1e-9,
      note: `Unsafe duration ${readiness.unsafeDuration.toFixed(1)} h within mission duration ${readiness.missionDuration.toFixed(1)} h.`,
    },
    {
      name: 'Classification thresholds monotonic',
      passed: classifyRisk(0.25) === 'SAFE' && classifyRisk(0.45) === 'MONITOR' && classifyRisk(0.8) === 'HIGH_RISK' && classifyRisk(1.1) === 'DO_NOT_EMBARK',
      note: `Threshold ladder evaluated with timestep ${timestepHours.toFixed(1)} h.`,
    },
  ];
}

export function runPlausibilityChecks(
  samples: RadiationSamplePoint[],
  params: CrewRadiationParams = {},
): Array<{ name: string; passed: boolean; note: string }> {
  const baseline = computeCrewRadiationReadiness(samples, params);
  const strongerShielding = computeCrewRadiationReadiness(samples, { ...params, shieldingFactor: (params.shieldingFactor ?? 0.72) * 0.82 });
  const higherSensitivity = computeCrewRadiationReadiness(samples, { ...params, crewSensitivity: (params.crewSensitivity ?? 1.08) * 1.15 });
  const longerDuration = computeCrewRadiationReadiness([...samples, ...(samples.length ? [samples[samples.length - 1]] : [])], params);
  const acuteSpike = computeCrewRadiationReadiness(
    samples.map((sample, index) => index === Math.floor(samples.length * 0.6) ? { ...sample, radiation: sample.radiation * 1.45 } : sample),
    params,
  );

  return [
    {
      name: 'Increasing shielding lowers dose',
      passed: strongerShielding.cumulativeDose <= baseline.cumulativeDose + 1e-9,
      note: `Baseline ${baseline.cumulativeDose.toFixed(2)} vs stronger shielding ${strongerShielding.cumulativeDose.toFixed(2)}.`,
    },
    {
      name: 'Increasing crew sensitivity raises risk',
      passed: higherSensitivity.riskScore >= baseline.riskScore - 1e-9,
      note: `Baseline ${baseline.riskScore.toFixed(2)} vs higher sensitivity ${higherSensitivity.riskScore.toFixed(2)}.`,
    },
    {
      name: 'Longer exposure raises total risk',
      passed: longerDuration.cumulativeDose >= baseline.cumulativeDose - 1e-9,
      note: `Baseline ${baseline.cumulativeDose.toFixed(2)} vs extended ${longerDuration.cumulativeDose.toFixed(2)}.`,
    },
    {
      name: 'Acute spikes increase acute risk',
      passed: acuteSpike.peakExposure >= baseline.peakExposure - 1e-9 && acuteSpike.riskScore >= baseline.riskScore - 1e-9,
      note: `Baseline peak ${baseline.peakExposure.toFixed(2)} vs spike ${acuteSpike.peakExposure.toFixed(2)}.`,
    },
  ];
}

export function computeCrewRiskCounterfactuals(
  samples: RadiationSamplePoint[],
  baseline: CrewRadiationReadiness,
  params: CrewRadiationParams = {},
  alternateRouteSamples?: RadiationSamplePoint[],
): CrewRiskCounterfactual[] {
  const shieldingFactor = params.shieldingFactor ?? 0.72;
  const delayedLaunchRadiationScale = params.delayedLaunchRadiationScale ?? 0.84;
  const strongerShielding = computeCrewRadiationReadiness(samples, { ...params, shieldingFactor: shieldingFactor * 0.82 });
  const delayed = computeCrewRadiationReadiness(
    samples.map((sample) => ({ ...sample, radiation: sample.radiation * delayedLaunchRadiationScale })),
    params,
  );

  const counterfactuals: CrewRiskCounterfactual[] = [
    {
      name: 'Stronger shielding',
      riskScore: strongerShielding.riskScore,
      classification: strongerShielding.classification,
      deltaRisk: strongerShielding.riskScore - baseline.riskScore,
      summary: `Reducing effective dose by stronger shielding changes risk by ${(strongerShielding.riskScore - baseline.riskScore).toFixed(2)}.`,
    },
    {
      name: 'Delayed launch window',
      riskScore: delayed.riskScore,
      classification: delayed.classification,
      deltaRisk: delayed.riskScore - baseline.riskScore,
      summary: 'A delayed window is modeled as lower background space-weather forcing rather than a deterministic forecast.',
    },
  ];

  if (alternateRouteSamples?.length) {
    const alternate = computeCrewRadiationReadiness(alternateRouteSamples, params);
    counterfactuals.push({
      name: 'Alternate route B',
      riskScore: alternate.riskScore,
      classification: alternate.classification,
      deltaRisk: alternate.riskScore - baseline.riskScore,
      summary: `Alternate route B shifts the dominant radiation burden to ${alternate.dominantSegment.nodeName}.`,
    });
  }

  return counterfactuals;
}

export function computeCrewRadiationReadiness(
  samples: RadiationSamplePoint[],
  params: CrewRadiationParams = {},
): CrewRadiationReadiness {
  const timestepHours = params.timestepHours ?? 6;
  const unsafeDoseRateThreshold = params.unsafeDoseRateThreshold ?? 0.78;
  const acuteDoseRateThreshold = params.acuteDoseRateThreshold ?? 1.05;
  const missionDuration = samples.length * timestepHours;
  const cumulativeDose = calculateCumulativeDose(samples, params);
  const peakExposure = calculatePeakExposure(samples, params);
  const unsafeDuration = calculateUnsafeDuration(samples, params);
  const { rawScore, riskScore } = calculateHealthRiskScore({
    cumulativeDose,
    peakExposure,
    unsafeDuration,
    missionDuration,
  }, params);
  const { classification, embarkationDecision } = classifyCrewRadiationRisk(riskScore);
  const shieldingFactor = params.shieldingFactor ?? 0.72;
  const crewSensitivity = params.crewSensitivity ?? 1.08;

  const weighted = samples.map((sample) => {
    const effectiveRate = sample.radiation * shieldingFactor * crewSensitivity;
    return {
      ...sample,
      effectiveRate,
      doseContribution: effectiveRate * timestepHours,
      unsafe: effectiveRate > unsafeDoseRateThreshold,
      acute: effectiveRate > acuteDoseRateThreshold,
    };
  });

  const segmentMap = new Map<string, { nodeId: string; nodeName: string; contributionDose: number; unsafeHours: number }>();
  for (const sample of weighted) {
    const key = `${sample.nodeId}:${sample.nodeName}`;
    const existing = segmentMap.get(key) ?? {
      nodeId: sample.nodeId,
      nodeName: sample.nodeName,
      contributionDose: 0,
      unsafeHours: 0,
    };
    existing.contributionDose += sample.doseContribution;
    if (sample.unsafe) existing.unsafeHours += timestepHours;
    segmentMap.set(key, existing);
  }

  const segmentContributions = [...segmentMap.values()].sort((a, b) => b.contributionDose - a.contributionDose);
  const dominantSegment = segmentContributions[0] ?? {
    nodeId: 'none',
    nodeName: 'None',
    contributionDose: 0,
    share: 0,
  };

  return {
    cumulativeDose,
    peakExposure,
    unsafeDuration,
    riskScore,
    classification,
    embarkationDecision,
    rawScore,
    missionDuration,
    dominantSegment: {
      ...dominantSegment,
      share: cumulativeDose > 0 ? dominantSegment.contributionDose / cumulativeDose : 0,
    },
    segmentContributions,
    assumptions: [
      'Radiation is integrated over discrete mission epochs rather than continuous dosimetry.',
      'Shielding and biological sensitivity are treated as multiplicative modifiers for comparative mission support.',
      'Thresholds are tuned for conservative mission-screening logic, not individualized medical prescription.',
    ],
    limitations: [
      'The model does not include particle-energy spectra, organ-specific dose, or individualized astronaut susceptibility.',
      'Space-weather forcing remains scenario-based and is not a forecast-grade heliophysics pipeline.',
    ],
  };
}

export function validateCrewRadiationReadiness(
  samples: RadiationSamplePoint[],
  baseline: CrewRadiationReadiness,
  params: CrewRadiationParams = {},
  alternateRouteSamples?: RadiationSamplePoint[],
): CrewRiskValidationReport {
  const shieldingFactor = params.shieldingFactor ?? 0.72;
  const crewSensitivity = params.crewSensitivity ?? 1.08;
  const consistencyChecks = runInternalConsistencyChecks(samples, baseline, params);
  const plausibilityChecks = runPlausibilityChecks(samples, params);
  const thresholdTrace = generateThresholdTrace(baseline, params);
  const counterfactuals = computeCrewRiskCounterfactuals(samples, baseline, params, alternateRouteSamples);
  const dominantMetric = determineDominantRiskDriver(baseline, params);

  return {
    passedConsistencyChecks: consistencyChecks.every((check) => check.passed),
    consistencyChecks,
    monotonicityChecks: plausibilityChecks,
    thresholdTrace,
    dominantRiskDriver: dominantMetric,
    counterfactuals,
    confidenceNote: 'This is a mission-support approximation with internally consistent monotonic behavior, but it is not a clinical radiation adjudication system.',
    limitations: [
      'Thresholds represent defensible screening proxies rather than astronaut-specific medical certification criteria.',
      'Delayed launch and alternate-route counterfactuals are scenario analyses and should not be treated as forecast certainty.',
    ],
  };
}
