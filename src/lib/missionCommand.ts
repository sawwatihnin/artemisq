import type { BayesianRiskUpdate } from './bayes';
import type { DigitalTwinAssessment } from './digitalTwin';
import type { MissionDecisionResult } from './missionDecision';
import type { PolicySwitchResult } from './policySwitch';
import type { TelemetryTimeline } from './telemetry';

export interface MissionCommandEntry {
  timeIndex: number;
  title: string;
  severity: 'INFO' | 'WATCH' | 'ALERT';
  detail: string;
  source: 'telemetry' | 'bayes' | 'digital_twin' | 'decision' | 'policy';
}

export interface MissionCommandTimeline {
  entries: MissionCommandEntry[];
}

export function buildMissionCommandTimeline(params: {
  telemetry: TelemetryTimeline;
  bayesianUpdates: BayesianRiskUpdate[];
  digitalTwin: DigitalTwinAssessment;
  missionDecision: MissionDecisionResult;
  policySwitch: PolicySwitchResult;
}): MissionCommandTimeline {
  const entries: MissionCommandEntry[] = params.telemetry.events.map((event) => ({
    timeIndex: event.timeIndex,
    title: event.event,
    severity: event.severity,
    detail: event.detail,
    source: 'telemetry',
  }));

  params.bayesianUpdates.forEach((update, index) => {
    if (Math.abs(update.posteriorRisk - update.priorRisk) >= 0.08) {
      entries.push({
        timeIndex: index,
        title: 'RISK POSTERIOR SHIFT',
        severity: update.posteriorRisk > update.priorRisk ? 'WATCH' : 'INFO',
        detail: `Posterior risk moved from ${update.priorRisk.toFixed(2)} to ${update.posteriorRisk.toFixed(2)}.`,
        source: 'bayes',
      });
    }
  });

  params.digitalTwin.residuals.forEach((residual) => {
    if (residual.status !== 'TRACKING') {
      entries.push({
        timeIndex: residual.timeIndex,
        title: residual.status === 'OFF_NOMINAL' ? 'DIGITAL TWIN DIVERGENCE' : 'RESIDUAL DRIFT',
        severity: residual.status === 'OFF_NOMINAL' ? 'ALERT' : 'WATCH',
        detail: `${residual.nodeName} residual score ${residual.residualScore.toFixed(2)} with observed risk ${residual.observedRisk.toFixed(2)}.`,
        source: 'digital_twin',
      });
    }
  });

  entries.push({
    timeIndex: Math.max(params.telemetry.maxRiskIndex, params.digitalTwin.residuals.length - 1),
    title: 'MISSION DECISION',
    severity: params.missionDecision.decision === 'ABORT' ? 'ALERT' : params.missionDecision.decision === 'REPLAN' ? 'WATCH' : 'INFO',
    detail: `${params.missionDecision.decision} with urgency ${params.missionDecision.urgencyLevel}.`,
    source: 'decision',
  });

  entries.push({
    timeIndex: Math.max(0, params.telemetry.maxRiskIndex),
    title: 'POLICY POSTURE',
    severity: params.policySwitch.newPolicy === 'CREW_FIRST' ? 'WATCH' : 'INFO',
    detail: params.policySwitch.reason,
    source: 'policy',
  });

  return {
    entries: entries.sort((a, b) => a.timeIndex - b.timeIndex),
  };
}
