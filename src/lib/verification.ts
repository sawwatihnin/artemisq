import {
  computeCrewRadiationReadiness,
  validateCrewRadiationReadiness,
  type CrewRadiationParams,
  type RadiationSamplePoint,
} from './crewRisk';
import { evaluateMissionDecision } from './missionDecision';
import type { ReplanOption } from './replan';
import { assessDecisionCost } from './replanCost';

export interface MissionSupportVerification {
  verificationPassed: boolean;
  failedChecks: string[];
  sensitivitySummary: string[];
  counterfactualSummary: string[];
  notes: string[];
}

export function runMissionSupportVerification(
  samples: RadiationSamplePoint[],
  params: CrewRadiationParams,
  replans: ReplanOption[],
): MissionSupportVerification {
  const failedChecks: string[] = [];
  const baseline = computeCrewRadiationReadiness(samples, params);
  const moreShielding = computeCrewRadiationReadiness(samples, { ...params, shieldingFactor: (params.shieldingFactor ?? 0.72) * 0.85 });
  const longerMission = computeCrewRadiationReadiness([...samples, ...(samples.length ? [samples[samples.length - 1]] : [])], params);
  const acuteMission = computeCrewRadiationReadiness(
    samples.map((sample, index) => index === Math.floor(samples.length * 0.55) ? { ...sample, radiation: sample.radiation * 1.6 } : sample),
    params,
  );
  const validation = validateCrewRadiationReadiness(samples, baseline, params);

  if (moreShielding.riskScore > baseline.riskScore + 1e-9) failedChecks.push('Medical monotonicity: increasing shielding raised risk.');
  if (longerMission.cumulativeDose < baseline.cumulativeDose - 1e-9) failedChecks.push('Medical monotonicity: longer exposure lowered cumulative dose.');
  if (acuteMission.peakExposure < baseline.peakExposure - 1e-9) failedChecks.push('Medical monotonicity: acute spike lowered peak exposure.');

  const baselineDecision = evaluateMissionDecision(['earth', 'transfer', 'moon'], baseline, { alternateCorridorAvailable: true });
  const worseDecision = evaluateMissionDecision(['earth', 'transfer', 'moon'], acuteMission, { alternateCorridorAvailable: true });
  const decisionRank = { CONTINUE: 0, REPLAN: 1, ABORT: 2 } as const;
  if (decisionRank[worseDecision.decision] < decisionRank[baselineDecision.decision]) {
    failedChecks.push('Decision monotonicity: higher crew risk yielded a more permissive mission decision.');
  }

  const sortedByRiskCost = [...replans]
    .sort((a, b) => (a.newTotalMissionRisk - b.newTotalMissionRisk) || (a.score - b.score));
  const bestReplan = sortedByRiskCost[0];
  const worstReplan = sortedByRiskCost[sortedByRiskCost.length - 1];
  if (bestReplan && worstReplan) {
    const bestCost = assessDecisionCost(bestReplan);
    const worstCost = assessDecisionCost(worstReplan);
    if (
      bestReplan.newTotalMissionRisk <= worstReplan.newTotalMissionRisk &&
      bestCost.riskAdjustedCost <= worstCost.riskAdjustedCost &&
      bestReplan.score < worstReplan.score
    ) {
      failedChecks.push('Decision monotonicity: a weakly dominant replan was scored below an inferior alternative.');
    }
  }

  const delayOption = replans.find((option) => option.type === 'DELAYED_LAUNCH');
  if (delayOption) {
    const shortDelayCost = assessDecisionCost({ ...delayOption, missionDurationChange: 6 });
    const longDelayCost = assessDecisionCost({ ...delayOption, missionDurationChange: 24 });
    if (longDelayCost.directCost < shortDelayCost.directCost) failedChecks.push('Financial consistency: longer delay reduced direct cost.');
  }

  const abortOption = replans.find((option) => option.type === 'ABORT');
  if (abortOption) {
    const abortCost = assessDecisionCost(abortOption);
    if (abortCost.directCost <= 0 || abortCost.riskAdjustedCost <= abortCost.directCost) {
      failedChecks.push('Financial consistency: abort cost failed to include mission loss and recovery burden.');
    }
  }

  const continueOption = replans.find((option) => option.type === 'CONTINUE');
  if (continueOption) {
    const saferContinue = assessDecisionCost({ ...continueOption, probabilityOfSuccess: 0.95 });
    const riskierContinue = assessDecisionCost({ ...continueOption, probabilityOfSuccess: 0.55 });
    if (riskierContinue.riskAdjustedCost < saferContinue.riskAdjustedCost) {
      failedChecks.push('Financial consistency: risk-adjusted cost decreased as failure probability rose.');
    }
  }

  if (!validation.thresholdTrace.includes('Do not embark') && baseline.classification === 'DO_NOT_EMBARK') {
    failedChecks.push('Explainability verification: threshold trace does not match final classification.');
  }
  if (!['peak acute exposure', 'unsafe duration', 'cumulative dose'].includes(validation.dominantRiskDriver)) {
    failedChecks.push('Explainability verification: dominant risk driver was not one of the computed metrics.');
  }

  return {
    verificationPassed: failedChecks.length === 0,
    failedChecks,
    sensitivitySummary: [
      `Shielding sensitivity changed risk from ${baseline.riskScore.toFixed(2)} to ${moreShielding.riskScore.toFixed(2)}.`,
      `Mission duration extension changed cumulative dose from ${baseline.cumulativeDose.toFixed(2)} to ${longerMission.cumulativeDose.toFixed(2)}.`,
      `Acute spike test changed peak exposure from ${baseline.peakExposure.toFixed(2)} to ${acuteMission.peakExposure.toFixed(2)}.`,
    ],
    counterfactualSummary: validation.counterfactuals.map((item) => `${item.name}: ${item.classification} (${item.riskScore.toFixed(2)}).`),
    notes: [
      'Verification logic is deterministic and intended for regression-style confidence checks.',
      'These checks verify monotonic and accounting behavior, not full biomedical truth or high-fidelity orbital mechanics.',
    ],
  };
}
