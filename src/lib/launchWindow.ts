export interface LaunchWindow {
  launchTimeIso: string;
  offsetHours: number;
  epochMs: number;
  phaseAngleRad: number;
  alignmentScore: number;
}

export interface LaunchWindowMissionParams {
  baseDeltaV_ms: number;
  baseRadiation: number;
  baseCommunication: number;
  riskWeight?: number;
  costWeight?: number;
  communicationWeight?: number;
  lunarSynodicPeriodHours?: number;
  solarRotationHours?: number;
  idealPhaseAngleRad?: number;
  planeChangeSensitivity?: number;
  communicationSensitivity?: number;
  radiationSensitivity?: number;
}

export interface LaunchWindowEvaluation {
  window: LaunchWindow;
  deltaV_ms: number;
  radiationExposure: number;
  communicationAvailability: number;
  score: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function wrapAngle(angle: number): number {
  const wrapped = ((angle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return wrapped;
}

export function generateLaunchWindows(
  baseTime: string | Date,
  intervals: number[],
  params: { lunarSynodicPeriodHours?: number; idealPhaseAngleRad?: number } = {},
): LaunchWindow[] {
  const baseEpoch = new Date(baseTime).getTime();
  const lunarSynodicPeriodHours = params.lunarSynodicPeriodHours ?? 655.728;
  const idealPhaseAngleRad = params.idealPhaseAngleRad ?? Math.PI / 2;
  const omega = (2 * Math.PI) / (lunarSynodicPeriodHours * 3600 * 1000);

  return intervals.map((offsetHours) => {
    const epochMs = baseEpoch + offsetHours * 3600 * 1000;
    const phaseAngleRad = ((epochMs - baseEpoch) * omega + idealPhaseAngleRad) % (2 * Math.PI);
    const alignmentScore = 0.5 * (1 + Math.cos(wrapAngle(phaseAngleRad - idealPhaseAngleRad)));
    return {
      launchTimeIso: new Date(epochMs).toISOString(),
      offsetHours,
      epochMs,
      phaseAngleRad,
      alignmentScore,
    };
  });
}

export function evaluateLaunchWindow(
  window: LaunchWindow,
  missionParams: LaunchWindowMissionParams,
): LaunchWindowEvaluation {
  const idealPhaseAngleRad = missionParams.idealPhaseAngleRad ?? Math.PI / 2;
  const solarRotationHours = missionParams.solarRotationHours ?? 27 * 24;
  const planeChangeSensitivity = missionParams.planeChangeSensitivity ?? 0.045;
  const communicationSensitivity = missionParams.communicationSensitivity ?? 0.24;
  const radiationSensitivity = missionParams.radiationSensitivity ?? 0.1;
  const riskWeight = missionParams.riskWeight ?? 0.45;
  const costWeight = missionParams.costWeight ?? 0.35;
  const communicationWeight = missionParams.communicationWeight ?? 0.2;

  const phaseError = wrapAngle(window.phaseAngleRad - idealPhaseAngleRad);
  const solarPhase = (2 * Math.PI * (window.offsetHours % solarRotationHours)) / solarRotationHours;
  const deltaV_ms = missionParams.baseDeltaV_ms * (1 + planeChangeSensitivity * phaseError * phaseError);
  const radiationExposure = missionParams.baseRadiation * (1 + radiationSensitivity * (0.6 + 0.4 * Math.sin(solarPhase)));
  const communicationAvailability = clamp(
    missionParams.baseCommunication * (1 - communicationSensitivity * Math.abs(Math.sin(phaseError)) + 0.08 * window.alignmentScore),
    0,
    1,
  );

  const normalizedCost = deltaV_ms / Math.max(missionParams.baseDeltaV_ms, 1);
  const normalizedRisk = radiationExposure / Math.max(missionParams.baseRadiation, 1e-6);
  const normalizedCommPenalty = 1 - communicationAvailability;
  const score = riskWeight * normalizedRisk + costWeight * normalizedCost + communicationWeight * normalizedCommPenalty;

  return {
    window,
    deltaV_ms,
    radiationExposure,
    communicationAvailability,
    score,
  };
}

export function rankLaunchWindows(
  windows: LaunchWindow[],
  missionParams: LaunchWindowMissionParams,
): LaunchWindowEvaluation[] {
  return windows
    .map((window) => evaluateLaunchWindow(window, missionParams))
    .sort((a, b) => a.score - b.score);
}
