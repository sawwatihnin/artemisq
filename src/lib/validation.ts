export interface ValidationCheck {
  metric: string;
  actual: number;
  expectedMin: number;
  expectedMax: number;
  unit: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  rationale: string;
}

export interface ValidationAssessment {
  benchmarkId: string;
  benchmarkName: string;
  missionClass: string;
  overallStatus: 'PASS' | 'WARN' | 'FAIL';
  score: number;
  checks: ValidationCheck[];
  notes: string[];
  source: string;
}

interface ValidationEnvelope {
  id: string;
  name: string;
  missionClass: string;
  transferDays: [number, number];
  totalDeltaVKmS: [number, number];
  totalDoseMsv: [number, number];
  peakDoseRateMsvHr: [number, number];
  commCoverageFraction: [number, number];
  conjunctionCount: [number, number];
}

const VALIDATION_ENVELOPES: ValidationEnvelope[] = [
  {
    id: 'earth-moon-crewed',
    name: 'Crewed Earth-Moon Free Return',
    missionClass: 'CREWED_CISLUNAR_MISSION_OPS',
    transferDays: [7.5, 12.5],
    totalDeltaVKmS: [3.0, 4.6],
    totalDoseMsv: [8, 45],
    peakDoseRateMsvHr: [0.03, 0.28],
    commCoverageFraction: [0.45, 1.0],
    conjunctionCount: [0, 6],
  },
  {
    id: 'earth-mars-transfer',
    name: 'Earth-Mars Conjunction-Class Transfer',
    missionClass: 'INTERPLANETARY_TRANSFER',
    transferDays: [140, 320],
    totalDeltaVKmS: [3.2, 6.8],
    totalDoseMsv: [120, 900],
    peakDoseRateMsvHr: [0.02, 0.35],
    commCoverageFraction: [0.15, 0.95],
    conjunctionCount: [0, 12],
  },
  {
    id: 'leo-geo-transfer',
    name: 'LEO-GEO Transfer and Deployment',
    missionClass: 'EARTH_ORBITAL_TRANSFER',
    transferDays: [0.15, 3.5],
    totalDeltaVKmS: [2.2, 4.5],
    totalDoseMsv: [0.2, 18],
    peakDoseRateMsvHr: [0.001, 0.08],
    commCoverageFraction: [0.55, 1.0],
    conjunctionCount: [0, 20],
  },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function scoreRange(actual: number, [min, max]: [number, number]): ValidationCheck['status'] {
  if (actual >= min && actual <= max) return 'PASS';
  const span = Math.max(max - min, Math.max(Math.abs(max), 1) * 0.15);
  if (actual >= min - span * 0.35 && actual <= max + span * 0.35) return 'WARN';
  return 'FAIL';
}

function findEnvelope(launchBodyId: string, targetBodyId: string): ValidationEnvelope {
  if (launchBodyId === 'earth' && targetBodyId === 'moon') return VALIDATION_ENVELOPES[0];
  if (launchBodyId === 'earth' && targetBodyId === 'mars') return VALIDATION_ENVELOPES[1];
  return VALIDATION_ENVELOPES[2];
}

export function validateMissionAgainstBenchmarks(input: {
  launchBodyId: string;
  targetBodyId: string;
  transferDays: number;
  totalDeltaVKmS: number;
  totalDoseMsv: number;
  peakDoseRateMsvHr: number;
  commCoverageFraction: number;
  conjunctionCount: number;
}): ValidationAssessment {
  const envelope = findEnvelope(input.launchBodyId, input.targetBodyId);
  const checks: ValidationCheck[] = [
    {
      metric: 'Transfer Duration',
      actual: input.transferDays,
      expectedMin: envelope.transferDays[0],
      expectedMax: envelope.transferDays[1],
      unit: 'days',
      status: scoreRange(input.transferDays, envelope.transferDays),
      rationale: 'Checks whether transfer timing matches the selected mission-class envelope.',
    },
    {
      metric: 'Total Δv',
      actual: input.totalDeltaVKmS,
      expectedMin: envelope.totalDeltaVKmS[0],
      expectedMax: envelope.totalDeltaVKmS[1],
      unit: 'km/s',
      status: scoreRange(input.totalDeltaVKmS, envelope.totalDeltaVKmS),
      rationale: 'Compares the solved trajectory burden against benchmark mission energy.',
    },
    {
      metric: 'Cumulative Dose',
      actual: input.totalDoseMsv,
      expectedMin: envelope.totalDoseMsv[0],
      expectedMax: envelope.totalDoseMsv[1],
      unit: 'mSv',
      status: scoreRange(input.totalDoseMsv, envelope.totalDoseMsv),
      rationale: 'Validates integrated exposure against mission-class crew/environment expectations.',
    },
    {
      metric: 'Peak Dose Rate',
      actual: input.peakDoseRateMsvHr,
      expectedMin: envelope.peakDoseRateMsvHr[0],
      expectedMax: envelope.peakDoseRateMsvHr[1],
      unit: 'mSv/h',
      status: scoreRange(input.peakDoseRateMsvHr, envelope.peakDoseRateMsvHr),
      rationale: 'Checks whether acute exposure posture stays near the benchmark envelope.',
    },
    {
      metric: 'Comm Coverage',
      actual: input.commCoverageFraction,
      expectedMin: envelope.commCoverageFraction[0],
      expectedMax: envelope.commCoverageFraction[1],
      unit: 'fraction',
      status: scoreRange(input.commCoverageFraction, envelope.commCoverageFraction),
      rationale: 'Assesses whether DSN/relay visibility is plausible for the selected lane.',
    },
    {
      metric: 'Conjunction Count',
      actual: input.conjunctionCount,
      expectedMin: envelope.conjunctionCount[0],
      expectedMax: envelope.conjunctionCount[1],
      unit: 'events',
      status: scoreRange(input.conjunctionCount, envelope.conjunctionCount),
      rationale: 'Checks whether screened conjunction volume is consistent with the operating regime.',
    },
  ];

  const passCount = checks.filter((check) => check.status === 'PASS').length;
  const warnCount = checks.filter((check) => check.status === 'WARN').length;
  const failCount = checks.filter((check) => check.status === 'FAIL').length;
  const overallStatus = failCount > 0 ? 'FAIL' : warnCount > 1 ? 'WARN' : 'PASS';
  const score = clamp((passCount + warnCount * 0.5) / checks.length, 0, 1);
  const notes = [
    `${envelope.name} is used as the benchmark lane for ${input.launchBodyId} → ${input.targetBodyId}.`,
    failCount > 0
      ? 'At least one primary mission metric sits outside the calibrated benchmark envelope.'
      : warnCount > 0
        ? 'The solution is close to the benchmark boundary on one or more metrics.'
        : 'Current mission outputs align with the selected benchmark envelope.',
  ];

  return {
    benchmarkId: envelope.id,
    benchmarkName: envelope.name,
    missionClass: envelope.missionClass,
    overallStatus,
    score,
    checks,
    notes,
    source: 'FORMULA-DRIVEN · Benchmark validation and calibration envelope',
  };
}
