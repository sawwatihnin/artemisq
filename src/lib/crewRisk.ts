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

export function computeCrewRadiationReadiness(
  samples: RadiationSamplePoint[],
  params: CrewRadiationParams = {},
): CrewRadiationReadiness {
  const timestepHours = params.timestepHours ?? 6;
  const shieldingFactor = params.shieldingFactor ?? 0.72;
  const crewSensitivity = params.crewSensitivity ?? 1.08;
  const unsafeDoseRateThreshold = params.unsafeDoseRateThreshold ?? 0.78;
  const acuteDoseRateThreshold = params.acuteDoseRateThreshold ?? 1.05;
  const alpha = params.alpha ?? 0.42;
  const beta = params.beta ?? 0.95;
  const gamma = params.gamma ?? 0.08;
  const missionDuration = samples.length * timestepHours;

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

  const cumulativeDose = weighted.reduce((sum, sample) => sum + sample.doseContribution, 0);
  const peakExposure = weighted.length ? Math.max(...weighted.map((sample) => sample.effectiveRate)) : 0;
  const unsafeDuration = weighted.filter((sample) => sample.unsafe).length * timestepHours;
  const rawScore = alpha * cumulativeDose + beta * peakExposure + gamma * unsafeDuration;
  const normalizationDenominator = params.normalizationDenominator ?? Math.max(1.2, unsafeDoseRateThreshold * Math.max(missionDuration, 1) * 0.82);
  const riskScore = clamp(rawScore / normalizationDenominator, 0, 1.5);
  const classification = classifyRisk(riskScore);

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
    embarkationDecision: embarkationFromClassification(classification),
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
  const timestepHours = params.timestepHours ?? 6;
  const shieldingFactor = params.shieldingFactor ?? 0.72;
  const crewSensitivity = params.crewSensitivity ?? 1.08;
  const unsafeDoseRateThreshold = params.unsafeDoseRateThreshold ?? 0.78;
  const acuteDoseRateThreshold = params.acuteDoseRateThreshold ?? 1.05;
  const strongerShieldingFactor = params.strongerShieldingFactor ?? shieldingFactor * 0.82;
  const delayedLaunchRadiationScale = params.delayedLaunchRadiationScale ?? 0.84;

  const rawMax = samples.reduce((max, sample) => Math.max(max, sample.radiation * shieldingFactor * crewSensitivity), 0);
  const consistencyPassed =
    baseline.cumulativeDose >= 0 &&
    Math.abs(baseline.peakExposure - rawMax) < 1e-6 &&
    baseline.unsafeDuration >= 0 &&
    baseline.unsafeDuration <= baseline.missionDuration &&
    classifyRisk(0.25) === 'SAFE' &&
    classifyRisk(0.45) === 'MONITOR' &&
    classifyRisk(0.8) === 'HIGH_RISK' &&
    classifyRisk(1.1) === 'DO_NOT_EMBARK';

  const strongerShielding = computeCrewRadiationReadiness(samples, { ...params, shieldingFactor: strongerShieldingFactor });
  const higherSensitivity = computeCrewRadiationReadiness(samples, { ...params, crewSensitivity: crewSensitivity * 1.15 });
  const longerExposure = computeCrewRadiationReadiness([...samples, ...(samples.length ? [samples[samples.length - 1]] : [])], params);
  const spikedSamples = samples.map((sample, index) => (
    index === Math.max(0, Math.floor(samples.length * 0.6))
      ? { ...sample, radiation: sample.radiation * 1.45 }
      : sample
  ));
  const acuteSpike = computeCrewRadiationReadiness(spikedSamples, params);

  const dominantMetric = baseline.peakExposure > acuteDoseRateThreshold
    ? 'peak acute exposure'
    : baseline.unsafeDuration > 0
      ? 'unsafe duration'
      : 'cumulative dose';

  const thresholdTrace =
    baseline.classification === 'DO_NOT_EMBARK'
      ? `Do not embark because ${dominantMetric} crossed mission-action thresholds; ${baseline.dominantSegment.nodeName} contributed ${(baseline.dominantSegment.share * 100).toFixed(0)}% of modeled cumulative dose and unsafe exposure persisted for ${baseline.unsafeDuration.toFixed(1)} hours.`
      : baseline.classification === 'HIGH_RISK'
        ? `High-risk classification triggered by ${dominantMetric}; ${baseline.dominantSegment.nodeName} was the dominant contributor and acute-rate screening remained under continuous review.`
        : baseline.classification === 'MONITOR'
          ? `Proceed-with-caution posture because cumulative dose remained below no-go limits but exceeded the nominal safe band during ${baseline.unsafeDuration.toFixed(1)} hours.`
          : `Safe-to-embark classification retained because no modeled radiation metric crossed the operational action thresholds.`;

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
      riskScore: computeCrewRadiationReadiness(
        samples.map((sample) => ({ ...sample, radiation: sample.radiation * delayedLaunchRadiationScale })),
        params,
      ).riskScore,
      classification: computeCrewRadiationReadiness(
        samples.map((sample) => ({ ...sample, radiation: sample.radiation * delayedLaunchRadiationScale })),
        params,
      ).classification,
      deltaRisk: computeCrewRadiationReadiness(
        samples.map((sample) => ({ ...sample, radiation: sample.radiation * delayedLaunchRadiationScale })),
        params,
      ).riskScore - baseline.riskScore,
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

  return {
    passedConsistencyChecks: consistencyPassed,
    monotonicityChecks: [
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
        name: 'Longer duration raises total risk',
        passed: longerExposure.cumulativeDose >= baseline.cumulativeDose - 1e-9,
        note: `Baseline duration ${baseline.missionDuration.toFixed(1)} h vs extended ${longerExposure.missionDuration.toFixed(1)} h.`,
      },
      {
        name: 'Acute spikes increase acute risk',
        passed: acuteSpike.peakExposure >= baseline.peakExposure - 1e-9 && acuteSpike.riskScore >= baseline.riskScore - 1e-9,
        note: `Baseline peak ${baseline.peakExposure.toFixed(2)} vs spike ${acuteSpike.peakExposure.toFixed(2)} with threshold ${acuteDoseRateThreshold.toFixed(2)}.`,
      },
      {
        name: 'Unsafe duration bounded by mission duration',
        passed: baseline.unsafeDuration <= samples.length * timestepHours + 1e-9,
        note: `Unsafe duration ${baseline.unsafeDuration.toFixed(1)} h within mission duration ${(samples.length * timestepHours).toFixed(1)} h.`,
      },
      {
        name: 'Classification thresholds remain monotonic',
        passed: consistencyPassed,
        note: `Safe ${unsafeDoseRateThreshold.toFixed(2)} and acute ${acuteDoseRateThreshold.toFixed(2)} thresholds were applied monotonically.`,
      },
    ],
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
