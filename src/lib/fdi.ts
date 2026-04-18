export type AnomalyType = 'COMM_LOSS' | 'PROPULSION_DEVIATION' | 'RADIATION_SPIKE' | 'NONE';
export type AnomalySeverity = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';

export interface FDIState {
  time?: number;
  radiation: number;
  previousRadiation?: number;
  communicationOpen: boolean;
  previousCommunicationOpen?: boolean;
  communicationReliability?: number;
  propulsionDeviation?: number;
  riskScore?: number;
}

export interface AnomalyAssessment {
  anomalyType: AnomalyType;
  severity: AnomalySeverity;
  confidence: number;
  recommendedAction: string;
  trigger: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function severityFromScore(score: number): AnomalySeverity {
  if (score >= 0.85) return 'CRITICAL';
  if (score >= 0.65) return 'HIGH';
  if (score >= 0.4) return 'MODERATE';
  return 'LOW';
}

export function classifyAnomaly(signal: {
  type: Exclude<AnomalyType, 'NONE'>;
  magnitude: number;
  context?: string;
}): AnomalyAssessment {
  const boundedMagnitude = clamp(signal.magnitude, 0, 1.5);
  const severity = severityFromScore(boundedMagnitude);
  const confidence = clamp(0.55 + boundedMagnitude * 0.3, 0, 0.98);

  return {
    anomalyType: signal.type,
    severity,
    confidence,
    recommendedAction: recommendResponse({
      anomalyType: signal.type,
      severity,
    }),
    trigger: signal.context ?? 'telemetry threshold crossed',
  };
}

export function recommendResponse(anomaly: Pick<AnomalyAssessment, 'anomalyType' | 'severity'>): string {
  if (anomaly.anomalyType === 'COMM_LOSS') {
    return anomaly.severity === 'CRITICAL'
      ? 'Transition to communications-preserving safe mode and prepare return corridor validation.'
      : 'Increase relay attempts and prioritize a communication-stable corridor.';
  }
  if (anomaly.anomalyType === 'PROPULSION_DEVIATION') {
    return anomaly.severity === 'CRITICAL'
      ? 'Freeze discretionary burns, re-estimate delta-v margin, and evaluate abort geometry.'
      : 'Recalibrate burn plan and shift to a lower-complexity replan option.';
  }
  if (anomaly.anomalyType === 'RADIATION_SPIKE') {
    return anomaly.severity === 'CRITICAL'
      ? 'Shelter crew, shorten exposure duration, and prepare immediate mission reduction or abort.'
      : 'Raise dosimetry cadence and evaluate shielding-adjusted or delayed profiles.';
  }
  return 'Maintain monitoring and continue nominal operations.';
}

export function detectAnomalies(state: FDIState): AnomalyAssessment[] {
  const anomalies: AnomalyAssessment[] = [];
  const radiationJump = typeof state.previousRadiation === 'number'
    ? Math.max(0, state.radiation - state.previousRadiation)
    : 0;

  if (!state.communicationOpen && (state.previousCommunicationOpen ?? true)) {
    anomalies.push(classifyAnomaly({
      type: 'COMM_LOSS',
      magnitude: 0.55 + 0.35 * (1 - clamp(state.communicationReliability ?? 0.5, 0, 1)),
      context: 'new communication blackout',
    }));
  }

  if ((state.propulsionDeviation ?? 0) > 0.08) {
    anomalies.push(classifyAnomaly({
      type: 'PROPULSION_DEVIATION',
      magnitude: clamp((state.propulsionDeviation ?? 0) / 0.22, 0, 1.2),
      context: 'delta-v or thrust deviation exceeded tolerance',
    }));
  }

  if (state.radiation > 1.0 || radiationJump > 0.25) {
    anomalies.push(classifyAnomaly({
      type: 'RADIATION_SPIKE',
      magnitude: clamp(Math.max(state.radiation / 1.25, radiationJump / 0.4), 0, 1.4),
      context: radiationJump > 0.25 ? 'rapid radiation gradient observed' : 'radiation exceeded spike threshold',
    }));
  }

  return anomalies.sort((a, b) => b.confidence - a.confidence);
}
