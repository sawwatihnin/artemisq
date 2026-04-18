import type { STLAnalysis } from './stlAnalyzer';

const G0 = 9.80665;

export interface VehicleStage {
  name: string;
  dryMassKg: number;
  propellantMassKg: number;
  thrustVacN: number;
  thrustSlN: number;
  ispVacS: number;
  ispSlS: number;
  engineCount: number;
  engineOutCount?: number;
  tankCgMeters?: number;
}

export interface StageAnalysis {
  stageName: string;
  ignitionMassKg: number;
  burnoutMassKg: number;
  separationMassKg: number;
  deltaVKmS: number;
  burnTimeS: number;
  thrustToWeightVac: number;
  thrustToWeightSl: number;
  cgShiftMeters: number;
  controllabilityIndex: number;
  engineOutDeltaVKmS: number;
}

export interface MultiStageVehicleAssessment {
  totalDeltaVKmS: number;
  stageAnalyses: StageAnalysis[];
  tpsPeakHeatFluxKwM2: number;
  structuralIndex: number;
  source: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function analyzeMultiStageVehicle(params: {
  stages: VehicleStage[];
  payloadMassKg: number;
  entryVelocityKmS?: number;
  noseRadiusM?: number;
  stlAnalysis?: STLAnalysis | null;
}): MultiStageVehicleAssessment {
  let upperStackMassKg = params.payloadMassKg;
  const stageAnalyses: StageAnalysis[] = [];
  let totalDeltaVKmS = 0;

  for (let i = params.stages.length - 1; i >= 0; i--) {
    const stage = params.stages[i];
    const ignitionMassKg = upperStackMassKg + stage.dryMassKg + stage.propellantMassKg;
    const burnoutMassKg = upperStackMassKg + stage.dryMassKg;
    const separationMassKg = upperStackMassKg;
    const deltaVKmS = (stage.ispVacS * G0 * Math.log(ignitionMassKg / Math.max(burnoutMassKg, 1))) / 1000;
    const mdotVac = stage.thrustVacN / Math.max(stage.ispVacS * G0, 1);
    const burnTimeS = stage.propellantMassKg / Math.max(mdotVac, 1e-6);
    const engineOutThrust = stage.thrustVacN * (1 - (stage.engineOutCount ?? 0) / Math.max(stage.engineCount, 1));
    const mdotEngineOut = engineOutThrust / Math.max(stage.ispVacS * G0, 1);
    const engineOutDeltaVKmS = ((stage.ispVacS * G0 * Math.log(ignitionMassKg / Math.max(burnoutMassKg, 1))) * (engineOutThrust / Math.max(stage.thrustVacN, 1))) / 1000;
    const thrustToWeightVac = stage.thrustVacN / Math.max(ignitionMassKg * G0, 1);
    const thrustToWeightSl = stage.thrustSlN / Math.max(ignitionMassKg * G0, 1);
    const cgShiftMeters = Math.abs((stage.tankCgMeters ?? 0) * (stage.propellantMassKg / Math.max(ignitionMassKg, 1)));
    const controllabilityIndex = clamp(thrustToWeightSl / (1 + cgShiftMeters), 0, 5);
    stageAnalyses.unshift({
      stageName: stage.name,
      ignitionMassKg,
      burnoutMassKg,
      separationMassKg,
      deltaVKmS,
      burnTimeS,
      thrustToWeightVac,
      thrustToWeightSl,
      cgShiftMeters,
      controllabilityIndex,
      engineOutDeltaVKmS,
    });
    totalDeltaVKmS += deltaVKmS;
    upperStackMassKg = ignitionMassKg;
    void mdotEngineOut;
  }

  const entryVelocityKmS = params.entryVelocityKmS ?? 11.1;
  const noseRadiusM = Math.max(params.noseRadiusM ?? 1.2, 0.25);
  const rhoRef = 1.2e-4;
  const tpsPeakHeatFluxKwM2 = 1.83e-4 * Math.sqrt(rhoRef / noseRadiusM) * Math.pow(entryVelocityKmS * 1000, 3) / 1000;
  const structuralIndex = clamp(
    ((params.stlAnalysis?.surfaceArea ?? 120) / Math.max(params.stlAnalysis?.volume ?? 60, 1)) * 0.18 +
    stageAnalyses.reduce((sum, stage) => sum + stage.cgShiftMeters * 0.12, 0),
    0.2,
    5,
  );

  return {
    totalDeltaVKmS,
    stageAnalyses,
    tpsPeakHeatFluxKwM2,
    structuralIndex,
    source: 'FORMULA-DRIVEN · Multi-stage rocket equation + Sutton-Graves TPS estimate',
  };
}
