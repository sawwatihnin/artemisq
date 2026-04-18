export interface AscentRiskThresholds {
  maxQkPa: number;
  structuralLoadLimit: number;
  thermalStressLimit: number;
  radiationDoseLimit: number;
}

export interface RiskPoint {
  time: number;
  dynamicPressure: number;
  structuralLoad: number;
  thermalStress: number;
  radiationDoseRate: number;
  riskScore: number;
  flags: string[];
}

export interface RiskAnalysis {
  profile: RiskPoint[];
  criticalPoints: RiskPoint[];
  maxRiskScore: number;
  overallRiskScore: number;
  assumptions: string[];
  limitations: string[];
}

export interface FlightRiskSample {
  time: number;
  q: number;
  stress: number;
  mach: number;
  altitude: number;
}

const DEFAULT_THRESHOLDS: AscentRiskThresholds = {
  maxQkPa: 45,
  structuralLoadLimit: 1,
  thermalStressLimit: 75,
  radiationDoseLimit: 2.5,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function evaluateFlightRisk(
  samples: FlightRiskSample[],
  thresholds: Partial<AscentRiskThresholds> = {},
): RiskAnalysis {
  const merged = { ...DEFAULT_THRESHOLDS, ...thresholds };

  const profile = samples.map((sample) => {
    const thermalStress = sample.q * Math.sqrt(Math.max(sample.mach, 0.3));
    const radiationDoseRate = 0.12 + Math.max(0, sample.altitude - 50) * 0.0025;
    const normalizedQ = sample.q / merged.maxQkPa;
    const normalizedStructural = sample.stress / merged.structuralLoadLimit;
    const normalizedThermal = thermalStress / merged.thermalStressLimit;
    const normalizedRadiation = radiationDoseRate / merged.radiationDoseLimit;
    const riskScore = clamp(
      100 * (0.35 * normalizedQ + 0.3 * normalizedStructural + 0.2 * normalizedThermal + 0.15 * normalizedRadiation),
      0,
      100,
    );

    const flags: string[] = [];
    if (sample.q > merged.maxQkPa) flags.push('MAX_Q_EXCEEDANCE');
    if (sample.stress > merged.structuralLoadLimit) flags.push('STRUCTURAL_INSTABILITY');
    if (thermalStress > merged.thermalStressLimit) flags.push('THERMAL_STRESS');
    if (radiationDoseRate > merged.radiationDoseLimit) flags.push('RADIATION_SPIKE');

    return {
      time: sample.time,
      dynamicPressure: sample.q,
      structuralLoad: sample.stress,
      thermalStress,
      radiationDoseRate,
      riskScore,
      flags,
    };
  });

  const criticalPoints = profile.filter((point) => point.flags.length > 0 || point.riskScore >= 70);
  const maxRiskScore = profile.length ? Math.max(...profile.map((point) => point.riskScore)) : 0;
  const overallRiskScore = profile.length
    ? profile.reduce((sum, point) => sum + point.riskScore, 0) / profile.length
    : 0;

  return {
    profile,
    criticalPoints,
    maxRiskScore,
    overallRiskScore,
    assumptions: [
      'Dynamic pressure uses q = 0.5 rho v^2 from the ascent integrator.',
      'Thermal stress is a proxy derived from dynamic pressure and Mach number, not a full aeroheating model.',
      'Radiation dose rate is treated as altitude-dependent for rapid trade studies.',
    ],
    limitations: [
      'This model does not resolve coupled aeroelastic modes or stage-separation transients.',
      'Thermal and radiation estimates are surrogate metrics intended for comparative screening only.',
    ],
  };
}
