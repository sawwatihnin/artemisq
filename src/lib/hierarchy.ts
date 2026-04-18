import type { MissionDecision } from './missionDecision';

export interface HierarchicalState {
  crewRisk: number;
  anomalySeverity?: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' | null;
  communicationStability: number;
  returnFeasibility: number;
  preferredReplan?: string;
}

export interface HierarchicalDecision {
  lowLevelAction: string;
  midLevelDecision: string;
  highLevelDecision: MissionDecision;
}

export function evaluateHierarchicalDecision(state: HierarchicalState): HierarchicalDecision {
  const lowLevelAction = state.anomalySeverity === 'CRITICAL'
    ? 'Enter safe-mode telemetry preservation and crew sheltering.'
    : state.communicationStability < 0.6
      ? 'Bias trajectory toward communication-stable waypoints.'
      : 'Maintain nominal trajectory trim updates.';

  const midLevelDecision = state.crewRisk > 0.75 || state.communicationStability < 0.65
    ? state.preferredReplan ?? 'Prepare replan package for mission control review.'
    : 'No mission-level replan required.';

  const highLevelDecision: MissionDecision = state.crewRisk > 1.0
    ? 'ABORT'
    : state.crewRisk > 0.6 || state.returnFeasibility < 0.55
      ? 'REPLAN'
      : 'CONTINUE';

  return {
    lowLevelAction,
    midLevelDecision,
    highLevelDecision,
  };
}
