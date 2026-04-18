export interface EvaPlanResult {
  evaDurationHours: number;
  commCoverageFraction: number;
  doseDuringEvaMsv: number;
  thermalExposureIndex: number;
  consumablesMarginHours: number;
  constraintsSatisfied: boolean;
  rationale: string;
  source: string;
}

export function evaluateEvaPlan(params: {
  evaDurationHours: number;
  radiationDoseRateMsvHr: number;
  commCoverageFraction: number;
  localTempC: number;
  lifeSupportMarginHours: number;
  daylight: boolean;
}): EvaPlanResult {
  const doseDuringEvaMsv = params.evaDurationHours * params.radiationDoseRateMsvHr;
  const thermalExposureIndex = Math.abs(params.localTempC - 20) / 80 + (params.daylight ? 0.15 : 0.28);
  const consumablesMarginHours = params.lifeSupportMarginHours - params.evaDurationHours;
  const constraintsSatisfied =
    doseDuringEvaMsv <= 2.5 &&
    params.commCoverageFraction >= 0.55 &&
    consumablesMarginHours >= 6 &&
    thermalExposureIndex <= 1.35;
  const rationale = constraintsSatisfied
    ? 'EVA remains within modeled radiation, comm, thermal, and life-support margins.'
    : 'EVA violates one or more modeled crew-safety margins and should be shortened, delayed, or moved to safe-haven support.';

  return {
    evaDurationHours: params.evaDurationHours,
    commCoverageFraction: params.commCoverageFraction,
    doseDuringEvaMsv,
    thermalExposureIndex,
    consumablesMarginHours,
    constraintsSatisfied,
    rationale,
    source: 'FORMULA-DRIVEN · EVA planning constraints',
  };
}
