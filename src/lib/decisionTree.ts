import type { AnomalyAssessment } from './fdi';
import type { ReplanOption } from './replan';

export type PolicyDecision = 'CONTINUE' | 'REPLAN' | 'ABORT';

export interface DecisionTreeState {
  currentRisk: number;
  posteriorRisk?: number;
  currentCost: number;
  communicationStability: number;
  returnFeasibility: number;
  missionProgress: number;
  anomaly?: AnomalyAssessment | null;
  replanOptions?: ReplanOption[];
}

export interface DecisionBranch {
  step: number;
  action: PolicyDecision;
  expectedRisk: number;
  expectedCost: number;
  score: number;
  children: DecisionBranch[];
}

export interface DecisionTree {
  root: DecisionBranch;
  horizon: number;
}

export interface OptimalPolicy {
  sequence: PolicyDecision[];
  expectedRisk: number;
  expectedCost: number;
  score: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function evolveState(state: DecisionTreeState, action: PolicyDecision, step: number): DecisionTreeState {
  const anomalyPenalty = state.anomaly?.severity === 'CRITICAL' ? 0.18 : state.anomaly?.severity === 'HIGH' ? 0.1 : 0;
  if (action === 'ABORT') {
    return {
      ...state,
      currentRisk: clamp(state.currentRisk * 0.2, 0, 1.5),
      posteriorRisk: clamp((state.posteriorRisk ?? state.currentRisk) * 0.18, 0, 1.5),
      currentCost: state.currentCost + 260 + 40 * step,
      missionProgress: state.missionProgress,
    };
  }
  if (action === 'REPLAN') {
    const option = state.replanOptions?.find((candidate) => candidate.type !== 'CONTINUE');
    return {
      ...state,
      currentRisk: clamp(option?.newTotalMissionRisk ?? state.currentRisk * 0.78, 0, 1.5),
      posteriorRisk: clamp((state.posteriorRisk ?? state.currentRisk) * 0.84, 0, 1.5),
      currentCost: state.currentCost + (option?.deltaVChange ?? 180) * 0.18 + 90,
      communicationStability: clamp(state.communicationStability + 0.05, 0, 1),
      returnFeasibility: clamp(state.returnFeasibility + 0.04, 0, 1),
      missionProgress: clamp(state.missionProgress + 0.2, 0, 1),
      anomaly: null,
    };
  }
  return {
    ...state,
    currentRisk: clamp(state.currentRisk * (1.04 + anomalyPenalty), 0, 1.5),
    posteriorRisk: clamp((state.posteriorRisk ?? state.currentRisk) * (1.02 + anomalyPenalty), 0, 1.5),
    currentCost: state.currentCost + 45 + 25 * (1 - state.communicationStability),
    missionProgress: clamp(state.missionProgress + 0.25, 0, 1),
  };
}

function scoreState(state: DecisionTreeState): number {
  const effectiveRisk = state.posteriorRisk ?? state.currentRisk;
  return 100 * effectiveRisk + 0.12 * state.currentCost - 16 * state.returnFeasibility - 12 * state.communicationStability;
}

function buildBranch(
  state: DecisionTreeState,
  depth: number,
  horizon: number,
  action: PolicyDecision,
): DecisionBranch {
  const actions: PolicyDecision[] = depth >= horizon
    ? []
    : ['CONTINUE', 'REPLAN', 'ABORT'];
  const nextState = depth === 0 ? state : evolveState(state, action, depth);
  const children = actions.map((nextAction) => buildBranch(nextState, depth + 1, horizon, nextAction));
  return {
    step: depth,
    action,
    expectedRisk: nextState.posteriorRisk ?? nextState.currentRisk,
    expectedCost: nextState.currentCost,
    score: scoreState(nextState),
    children,
  };
}

export function buildDecisionTree(state: DecisionTreeState, horizon: number): DecisionTree {
  return {
    root: buildBranch(state, 0, Math.max(1, horizon), 'CONTINUE'),
    horizon: Math.max(1, horizon),
  };
}

export function evaluateBranch(branch: DecisionBranch): { expectedCost: number; expectedRisk: number; score: number } {
  if (!branch.children.length) {
    return {
      expectedCost: branch.expectedCost,
      expectedRisk: branch.expectedRisk,
      score: branch.score,
    };
  }

  const childEvaluations = branch.children.map((child) => evaluateBranch(child));
  const expectedCost = childEvaluations.reduce((sum, item) => sum + item.expectedCost, 0) / childEvaluations.length;
  const expectedRisk = childEvaluations.reduce((sum, item) => sum + item.expectedRisk, 0) / childEvaluations.length;
  const score = childEvaluations.reduce((best, item) => Math.min(best, item.score), Number.POSITIVE_INFINITY);

  return { expectedCost, expectedRisk, score };
}

function collectBestSequence(branch: DecisionBranch): OptimalPolicy {
  if (!branch.children.length) {
    return {
      sequence: [],
      expectedRisk: branch.expectedRisk,
      expectedCost: branch.expectedCost,
      score: branch.score,
    };
  }

  const ranked = branch.children
    .map((child) => {
      const bestChild = collectBestSequence(child);
      return {
        action: child.step === 0 ? 'CONTINUE' : child.action,
        policy: bestChild,
        score: bestChild.score,
      };
    })
    .sort((a, b) => a.score - b.score)[0];

  return {
    sequence: [ranked.action, ...ranked.policy.sequence],
    expectedRisk: ranked.policy.expectedRisk,
    expectedCost: ranked.policy.expectedCost,
    score: ranked.policy.score,
  };
}

export function selectOptimalPolicy(tree: DecisionTree): OptimalPolicy {
  const rootChildren = tree.root.children.map((child) => {
    const policy = collectBestSequence(child);
    return {
      action: child.action,
      policy,
      score: policy.score,
    };
  }).sort((a, b) => a.score - b.score)[0];

  return {
    sequence: [rootChildren.action, ...rootChildren.policy.sequence].slice(0, tree.horizon + 1),
    expectedRisk: rootChildren.policy.expectedRisk,
    expectedCost: rootChildren.policy.expectedCost,
    score: rootChildren.policy.score,
  };
}
