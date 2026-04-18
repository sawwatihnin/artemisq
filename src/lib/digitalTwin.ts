import type { BayesianRiskUpdate } from './bayes';
import { detectAnomalies } from './fdi';
import type { MonteCarloSummary } from './monteCarlo';

export interface DigitalTwinTimelinePoint {
  t: number;
  nodeId: string;
  nodeName: string;
  radiation: number;
  communicationOpen: boolean;
  communicationReliability: number;
  fuelMultiplier: number;
  riskScore: number;
}

export interface DigitalTwinResidual {
  timeIndex: number;
  nodeName: string;
  predictedRadiation: number;
  observedRadiation: number;
  predictedCommunication: number;
  observedCommunication: number;
  predictedRisk: number;
  observedRisk: number;
  residualScore: number;
  status: 'TRACKING' | 'WATCH' | 'OFF_NOMINAL';
}

export interface DigitalTwinAssessment {
  residuals: DigitalTwinResidual[];
  summary: {
    meanResidual: number;
    maxResidual: number;
    driftDetected: boolean;
    health: 'TRACKING' | 'WATCH' | 'OFF_NOMINAL';
  };
  recommendation: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function buildDigitalTwinAssessment(
  timeline: DigitalTwinTimelinePoint[],
  stochastic: MonteCarloSummary<unknown>,
  bayesianUpdates: BayesianRiskUpdate[],
): DigitalTwinAssessment {
  const radiationScale = mean(stochastic.samples.map((sample) => sample.sample.radiationScale));
  const communicationScale = mean(stochastic.samples.map((sample) => sample.sample.communicationScale));
  const healthRiskScale = mean(stochastic.samples.map((sample) => sample.sample.healthRiskScale ?? 1));
  const outagePenalty = mean(stochastic.samples.map((sample) => sample.sample.outagePenalty ?? 1));

  const residuals = timeline.map((point, index) => {
    const posterior = bayesianUpdates[Math.min(index, bayesianUpdates.length - 1)];
    const anomalyLoad = detectAnomalies({
      time: point.t,
      radiation: point.radiation,
      previousRadiation: timeline[index - 1]?.radiation,
      communicationOpen: point.communicationOpen,
      previousCommunicationOpen: timeline[index - 1]?.communicationOpen,
      communicationReliability: point.communicationReliability,
      propulsionDeviation: Math.abs((point.fuelMultiplier ?? 1) - 1),
      riskScore: point.riskScore,
    }).length;

    const observedRadiation = point.radiation * radiationScale * (1 + 0.05 * anomalyLoad);
    const observedCommunication = point.communicationOpen
      ? clamp(point.communicationReliability / Math.max(communicationScale, 0.6), 0, 1)
      : clamp(0.08 / Math.max(outagePenalty, 1), 0, 0.2);
    const predictedRisk = point.riskScore / 100;
    const observedRisk = clamp(
      Math.max(predictedRisk * healthRiskScale * (1 + 0.04 * anomalyLoad), posterior?.posteriorRisk ?? predictedRisk),
      0,
      1.5,
    );

    const radiationResidual = Math.abs(observedRadiation - point.radiation) / Math.max(point.radiation, 0.1);
    const communicationResidual = Math.abs(observedCommunication - point.communicationReliability) / Math.max(point.communicationReliability, 0.1);
    const riskResidual = Math.abs(observedRisk - predictedRisk) / Math.max(predictedRisk, 0.12);
    const residualScore = 0.4 * radiationResidual + 0.25 * communicationResidual + 0.35 * riskResidual;

    return {
      timeIndex: index,
      nodeName: point.nodeName,
      predictedRadiation: point.radiation,
      observedRadiation,
      predictedCommunication: point.communicationReliability,
      observedCommunication,
      predictedRisk,
      observedRisk,
      residualScore,
      status: residualScore > 0.45 ? 'OFF_NOMINAL' : residualScore > 0.22 ? 'WATCH' : 'TRACKING',
    } satisfies DigitalTwinResidual;
  });

  const meanResidual = mean(residuals.map((point) => point.residualScore));
  const maxResidual = residuals.length ? Math.max(...residuals.map((point) => point.residualScore)) : 0;
  const driftDetected = residuals.slice(-3).every((point) => point.residualScore > 0.22);
  const health: DigitalTwinAssessment['summary']['health'] = maxResidual > 0.45
    ? 'OFF_NOMINAL'
    : driftDetected || meanResidual > 0.2
      ? 'WATCH'
      : 'TRACKING';

  return {
    residuals,
    summary: {
      meanResidual,
      maxResidual,
      driftDetected,
      health,
    },
    recommendation: health === 'OFF_NOMINAL'
      ? 'Residual divergence is large enough to require replanning or calibration update before committing the next maneuver.'
      : health === 'WATCH'
        ? 'Track residual drift and refresh posterior risk before the next major decision epoch.'
        : 'Predicted and observed mission states remain well aligned under current uncertainty.',
  };
}
