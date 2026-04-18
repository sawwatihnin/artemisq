/**
 * ARTEMIS-Q Quantum Optimizer — research prototype extension
 *
 * Discrete-time mission model:
 *   x_{i,t} ∈ {0,1}, x_{i,t}=1 iff the vehicle occupies node i at epoch t.
 *
 * Objective:
 *   J(x) = λ_f Fuel(x)
 *        + λ_r Radiation(x)
 *        + λ_c CommunicationPenalty(x)
 *        + λ_s Risk(x)
 *        + λ_t Time(x)
 *        + P_continuity(x)
 *        + P_start/end(x)
 *        + P_illegal(x)
 *
 * QUBO mapping:
 *   min_x x^T Q x
 * with penalties expanded into diagonal and pairwise terms over the binary
 * variables x_{i,t}. This keeps the formulation compatible with annealing-style
 * solvers while remaining implementable in the current prototype.
 */

import {
  explainCrewRisk,
  explainFinancialRecommendation,
  explainMissionDecision,
  explainPath,
  type ExplainNodeMetric,
  type PathExplanation,
} from './explain';
import {
  computeCrewRadiationReadiness,
  validateCrewRadiationReadiness,
  type CrewRadiationParams,
  type CrewRadiationReadiness,
  type CrewRiskValidationReport,
  type RadiationSamplePoint,
} from './crewRisk';
import {
  evaluateMissionDecision,
  recommendAbortOrReplan,
  type DecisionPathCandidate,
  type MissionDecisionResult,
} from './missionDecision';
import {
  runMonteCarlo,
  runDecisionOptionMonteCarlo,
  type DecisionOptionMonteCarloSummary,
  type MissionUncertaintySample,
  type MonteCarloSummary,
  type UncertaintyModel,
} from './monteCarlo';
import { generateReplanOptions, type ReplanOption } from './replan';
import { assessDecisionCost, compareDecisionCosts, type DecisionCostAssessment } from './replanCost';
import { runMissionSupportVerification, type MissionSupportVerification } from './verification';

export interface OptimizerNode {
  id: string;
  name: string;
  x: number;
  y: number;
  radiation: number;
  commScore: number;
  altitude_km?: number;
  inclination?: number;
}

export interface OptimizerEdge {
  from: string;
  to: string;
  distance: number;
  fuelCost: number;
  deltaV_ms?: number;
}

export interface QUBOWeights {
  fuel: number;
  rad: number;
  comm: number;
  safety: number;
  time?: number;
}

export interface QuantumState {
  amplitudes: number[];
  phases: number[];
  nQubits: number;
}

export interface QAOALayer {
  gamma: number;
  beta: number;
  energyExpectation: number;
}

export interface DistributionEntry {
  state: string;
  probability: number;
  energy: number;
  isOptimal: boolean;
}

export interface QAOAResult {
  layers: QAOALayer[];
  finalEnergy: number;
  approximationRatio: number;
  quantumAdvantage_pct: number;
  qaoaMatchPct?: number;
  classicalSAImprovement_pct?: number;
  distribution?: DistributionEntry[];
}

export interface TimeDependentNodeState {
  communicationWindow: number[];
  radiationField: number[];
  fuelMultiplier: number[];
  communicationReliability: number[];
}

export interface IllegalTransitionRule {
  from: string;
  to: string;
  activeAt?: number[];
  penalty?: number;
  reason?: string;
}

export interface MissionTimeProfile {
  horizon: number;
  radiationThreshold: number;
  nodeStates: Record<string, TimeDependentNodeState>;
  illegalTransitions?: IllegalTransitionRule[];
}

export interface MissionTimelinePoint {
  t: number;
  nodeId: string;
  nodeName: string;
  radiation: number;
  communicationOpen: boolean;
  communicationReliability: number;
  fuelMultiplier: number;
  stepCost: number;
  riskScore: number;
}

export interface MissionCostBreakdown {
  total: number;
  fuel: number;
  rad: number;
  comm: number;
  safety: number;
  time: number;
  continuityPenalty: number;
  startEndPenalty: number;
  illegalTransitionPenalty: number;
  deltaV_ms: number;
  timeline: MissionTimelinePoint[];
  nodeMetrics: ExplainNodeMetric[];
  violations: string[];
}

export interface StrategyBenchmark {
  label: string;
  path: string[];
  totalCost: number;
  constraintViolations: number;
  successProbability: number;
}

export interface OptimizationResult {
  path: string[];
  totalCost: number;
  fuel: number;
  radiationExposure: number;
  commLoss: number;
  timePenalty: number;
  safetyPenalty: number;
  naivePath: string[];
  naiveCost: number;
  quboGraph: { nodes: number; binaryVars: number; temperature: number; annealingSteps: number; nonZeroTerms: number };
  circuitMap: { gate: string; qubit: number; target?: number; angle?: string; layer?: number }[];
  totalDeltaV_ms: number;
  fuelMass_kg: number;
  propellantFraction: number;
  annealingHistory: { step: number; temperature: number; energy: number }[];
  qaoa: QAOAResult;
  physics: {
    hohmannDeltaV: number;
    j2Correction: number;
    vanAllenDose: number;
    transferTime_days: number;
  };
  timeline: MissionTimelinePoint[];
  constraintViolations: string[];
  stochastic: MonteCarloSummary<{
    fuel: number;
    radiation: number;
    communication: number;
    safety: number;
    violations: number;
  }>;
  explanation: PathExplanation;
  crewRisk: CrewRadiationReadiness;
  medicalValidation: CrewRiskValidationReport;
  missionDecision: MissionDecisionResult;
  replanOptions: ReplanOption[];
  decisionCosts: DecisionCostAssessment[];
  decisionMonteCarlo: DecisionOptionMonteCarloSummary<{
    crewRisk: number;
    riskAdjustedCost: number;
    successProbability: number;
  }>[];
  decisionNarrative: {
    medicalRisk: string;
    operationalDecision: string;
    financialRecommendation: string;
  };
  verification: MissionSupportVerification;
  systemLimitations: string[];
  benchmarks: {
    optimized: StrategyBenchmark;
    shortestPath: StrategyBenchmark;
    greedy: StrategyBenchmark;
  };
  formalModel: {
    variables: string[];
    objective: string[];
    constraints: string[];
    qubo: string[];
    assumptions: string[];
    limitations: string[];
  };
  timeDependent: {
    radiationThreshold: number;
    communicationViolations: number;
    radiationViolations: number;
  };
}

const G = 6.67430e-11;
const M_EARTH = 5.972e24;
const R_EARTH = 6.371e6;
const MU_EARTH = G * M_EARTH;
const G0 = 9.80665;
const J2 = 1.08263e-3;
const RE_KM = 6371;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function timelineToRadiationSamples(timeline: MissionTimelinePoint[]): RadiationSamplePoint[] {
  return timeline.map((point) => ({
    t: point.t,
    nodeId: point.nodeId,
    nodeName: point.nodeName,
    radiation: point.radiation,
  }));
}

function averageCommunicationStability(timeline: MissionTimelinePoint[]): number {
  if (!timeline.length) return 0;
  return timeline.reduce((sum, point) => (
    sum + (point.communicationOpen ? point.communicationReliability : point.communicationReliability * 0.2)
  ), 0) / timeline.length;
}

export function hohmannDeltaV(r1_km: number, r2_km: number): { dv1: number; dv2: number; dvTotal: number; tof_days: number } {
  const r1 = (r1_km + RE_KM) * 1000;
  const r2 = (r2_km + RE_KM) * 1000;
  const at = (r1 + r2) / 2;

  const v1 = Math.sqrt(MU_EARTH / r1);
  const v2 = Math.sqrt(MU_EARTH / r2);
  const vt1 = Math.sqrt(MU_EARTH * (2 / r1 - 1 / at));
  const vt2 = Math.sqrt(MU_EARTH * (2 / r2 - 1 / at));

  const dv1 = Math.abs(vt1 - v1);
  const dv2 = Math.abs(v2 - vt2);
  const tof_s = Math.PI * Math.sqrt(at ** 3 / MU_EARTH);

  return { dv1, dv2, dvTotal: dv1 + dv2, tof_days: tof_s / 86400 };
}

export function j2NodalPrecession(a_km: number, ecc: number, inc_deg: number): number {
  const a = (a_km + RE_KM) * 1000;
  const i = (inc_deg * Math.PI) / 180;
  const p = a * (1 - ecc * ecc);
  const n = Math.sqrt(MU_EARTH / (a * a * a));
  const dOmega_rad_s = (-3 / 2) * n * J2 * (R_EARTH / p) ** 2 * Math.cos(i);
  return ((dOmega_rad_s * 180) / Math.PI) * 86400;
}

export function vanAllenDose(altitude_km: number, inc_deg: number): number {
  const r = (altitude_km + RE_KM) / RE_KM;
  const i_rad = (inc_deg * Math.PI) / 180;
  const L = r / (Math.cos(i_rad) ** 2 + 0.001);
  const inner = 2000 * Math.exp(-((L - 1.5) ** 2) / 0.3);
  const outer = 800 * Math.exp(-((L - 4.0) ** 2) / 1.5);
  return inner + outer;
}

export function tsiolkovskyFuelMass(dv_ms: number, m0_kg: number, isp_s: number): number {
  return m0_kg * (1 - Math.exp(-dv_ms / (isp_s * G0)));
}

export function buildFormalMissionQUBO(
  nodes: Map<string, OptimizerNode>,
  edges: OptimizerEdge[],
  weights: Required<QUBOWeights>,
  pathLen: number,
  missionProfile: MissionTimeProfile,
  start: string,
  end: string,
): { matrix: number[][]; nonZeroTerms: number } {
  const nodeList = [...nodes.values()];
  const n = nodeList.length;
  const N = n * pathLen;
  const Q: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
  const edgeSet = new Set(edges.map((edge) => `${edge.from}->${edge.to}`));
  const idx = (i: number, t: number) => i * pathLen + t;

  const lambdaPos = 900;
  const lambdaOnce = 450;
  const lambdaStartEnd = 1200;
  const lambdaIllegal = 650;

  for (let t = 0; t < pathLen; t++) {
    for (let i = 0; i < n; i++) {
      Q[idx(i, t)][idx(i, t)] -= lambdaPos;
      for (let j = i + 1; j < n; j++) {
        Q[idx(i, t)][idx(j, t)] += 2 * lambdaPos;
      }
    }
  }

  for (let i = 0; i < n; i++) {
    for (let t = 0; t < pathLen; t++) {
      for (let u = t + 1; u < pathLen; u++) {
        Q[idx(i, t)][idx(i, u)] += 2 * lambdaOnce;
      }
    }
  }

  for (let i = 0; i < n; i++) {
    const node = nodeList[i];
    if (node.id === start) Q[idx(i, 0)][idx(i, 0)] -= lambdaStartEnd;
    else Q[idx(i, 0)][idx(i, 0)] += lambdaStartEnd;

    if (node.id === end) Q[idx(i, pathLen - 1)][idx(i, pathLen - 1)] -= lambdaStartEnd;
    else Q[idx(i, pathLen - 1)][idx(i, pathLen - 1)] += lambdaStartEnd;
  }

  for (let t = 0; t < pathLen; t++) {
    for (let i = 0; i < n; i++) {
      const node = nodeList[i];
      const state = missionProfile.nodeStates[node.id];
      const radiation = state?.radiationField[t] ?? node.radiation;
      const commOpen = state?.communicationWindow[t] ?? 1;
      const commReliability = state?.communicationReliability[t] ?? node.commScore;
      const timeCost = 1 + 0.001 * (node.altitude_km ?? 0);
      const radiationPenalty = radiation > missionProfile.radiationThreshold
        ? 40 * ((radiation - missionProfile.radiationThreshold) / missionProfile.radiationThreshold) ** 2
        : 0;
      const commPenalty = commOpen ? (1 - commReliability) ** 2 : 8 + (1 - commReliability);

      Q[idx(i, t)][idx(i, t)] +=
        weights.rad * radiation ** 2 +
        weights.comm * commPenalty +
        weights.time * timeCost +
        weights.safety * radiationPenalty;
    }
  }

  for (let t = 0; t < pathLen - 1; t++) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;

        const fromNode = nodeList[i];
        const toNode = nodeList[j];
        const edge = edges.find((candidate) => candidate.from === fromNode.id && candidate.to === toNode.id);
        const rule = missionProfile.illegalTransitions?.find((candidate) =>
          candidate.from === fromNode.id &&
          candidate.to === toNode.id &&
          (!candidate.activeAt || candidate.activeAt.includes(t)),
        );

        if (edge) {
          const state = missionProfile.nodeStates[fromNode.id];
          const fuelMultiplier = state?.fuelMultiplier[t] ?? 1;
          Q[idx(i, t)][idx(j, t + 1)] += weights.fuel * edge.fuelCost * fuelMultiplier;
          if (rule) {
            Q[idx(i, t)][idx(j, t + 1)] += rule.penalty ?? lambdaIllegal;
          }
        } else if (rule || !edgeSet.has(`${fromNode.id}->${toNode.id}`)) {
          Q[idx(i, t)][idx(j, t + 1)] += rule?.penalty ?? lambdaIllegal;
        }
      }
    }
  }

  let nonZeroTerms = 0;
  for (let i = 0; i < N; i++) {
    for (let j = i; j < N; j++) {
      if (Math.abs(Q[i][j]) > 1e-9) nonZeroTerms++;
    }
  }

  return { matrix: Q, nonZeroTerms };
}

function simulateQAOA(energies: number[], nQubits: number, p: number = 3): {
  layers: QAOALayer[];
  finalEnergy: number;
  optGamma: number[];
  optBeta: number[];
  finalAmps: number[];
} {
  const dim = Math.pow(2, nQubits);
  const actualDim = Math.min(dim, energies.length);
  let amps = new Array(actualDim).fill(1 / Math.sqrt(actualDim));

  const layers: QAOALayer[] = [];
  const optGamma: number[] = [];
  const optBeta: number[] = [];
  let bestEnergy = Infinity;

  for (let layer = 0; layer < p; layer++) {
    let bestG = 0;
    let bestB = 0;
    let bestE = Infinity;

    for (let gi = 0; gi <= 8; gi++) {
      for (let bi = 0; bi <= 8; bi++) {
        const gamma = (gi / 8) * Math.PI;
        const beta = (bi / 8) * (Math.PI / 2);
        const testAmps = applyQAOALayer([...amps], energies, gamma, beta, nQubits, actualDim);
        const E = expectationValue(testAmps, energies);
        if (E < bestE) {
          bestE = E;
          bestG = gamma;
          bestB = beta;
        }
      }
    }

    amps = applyQAOALayer(amps, energies, bestG, bestB, nQubits, actualDim);
    const E = expectationValue(amps, energies);
    optGamma.push(bestG);
    optBeta.push(bestB);
    layers.push({ gamma: bestG, beta: bestB, energyExpectation: E });
    if (E < bestEnergy) bestEnergy = E;
  }

  return { layers, finalEnergy: bestEnergy, optGamma, optBeta, finalAmps: amps };
}

function applyQAOALayer(amps: number[], energies: number[], gamma: number, beta: number, nQubits: number, dim: number): number[] {
  const phasedAmps = amps.map((amplitude, index) => amplitude * Math.abs(Math.cos(gamma * (energies[index] ?? 0))));
  let result = [...phasedAmps];

  for (let q = 0; q < Math.min(nQubits, 6); q++) {
    const newAmps = new Array(dim).fill(0);
    for (let x = 0; x < dim; x++) {
      const flipped = x ^ (1 << q);
      if (flipped < dim) {
        newAmps[x] += result[x] * Math.cos(beta);
        newAmps[x] += result[flipped] * (-Math.sin(beta));
      } else {
        newAmps[x] = result[x];
      }
    }
    const norm = Math.sqrt(newAmps.reduce((sum, amplitude) => sum + amplitude * amplitude, 0)) || 1;
    result = newAmps.map((amplitude) => amplitude / norm);
  }

  return result;
}

function expectationValue(amps: number[], energies: number[]): number {
  return amps.reduce((sum, amplitude, index) => sum + amplitude * amplitude * (energies[index] ?? 0), 0);
}

export class SimulatedAnnealer {
  private nodes: Map<string, OptimizerNode>;
  private edges: OptimizerEdge[];
  private weights: Required<QUBOWeights>;
  private isp_s: number;
  private spacecraft_mass_kg: number;

  constructor(
    nodes: OptimizerNode[],
    edges: OptimizerEdge[],
    weights: QUBOWeights = { fuel: 3.0, rad: 5.0, comm: 2.0, safety: 4.0, time: 1.2 },
    isp_s: number = 450,
    spacecraft_mass_kg: number = 5000,
  ) {
    this.nodes = new Map(nodes.map((node) => [node.id, node]));
    this.edges = edges;
    this.weights = {
      fuel: weights.fuel,
      rad: weights.rad,
      comm: weights.comm,
      safety: weights.safety,
      time: weights.time ?? 1.2,
    };
    this.isp_s = isp_s;
    this.spacecraft_mass_kg = spacecraft_mass_kg;
  }

  private findEdge(from: string, to: string): OptimizerEdge | undefined {
    return this.edges.find((edge) => edge.from === from && edge.to === to);
  }

  private buildMissionProfile(
    horizon: number,
    radiationMultiplier: number,
    overrides?: Partial<MissionTimeProfile>,
  ): MissionTimeProfile {
    const nodeList = [...this.nodes.values()];
    const nodeStates = Object.fromEntries(
      nodeList.map((node, index) => {
        const phase = (index + 1) * 0.65;
        const communicationWindow = Array.from({ length: horizon }, (_, t) =>
          (0.5 + 0.5 * Math.sin((2 * Math.PI * (t + 1)) / Math.max(horizon, 2) + phase)) < (1 - node.commScore * 0.95)
            ? 0
            : 1,
        );
        const communicationReliability = Array.from({ length: horizon }, (_, t) =>
          clamp(node.commScore * (0.85 + 0.2 * Math.cos((2 * Math.PI * t) / Math.max(horizon, 2) + phase / 2)), 0.05, 1),
        );
        const radiationField = Array.from({ length: horizon }, (_, t) =>
          clamp(node.radiation * radiationMultiplier * (0.88 + 0.28 * Math.sin((2 * Math.PI * t) / Math.max(horizon, 2) + phase)), 0, 2),
        );
        const fuelMultiplier = Array.from({ length: horizon }, (_, t) =>
          1 + 0.08 * Math.cos((2 * Math.PI * t) / Math.max(horizon, 2) + phase),
        );

        return [
          node.id,
          {
            communicationWindow,
            communicationReliability,
            radiationField,
            fuelMultiplier,
          } satisfies TimeDependentNodeState,
        ];
      }),
    ) as Record<string, TimeDependentNodeState>;

    return {
      horizon,
      radiationThreshold: overrides?.radiationThreshold ?? 0.75,
      nodeStates: { ...nodeStates, ...(overrides?.nodeStates ?? {}) },
      illegalTransitions: overrides?.illegalTransitions ?? [],
    };
  }

  private getInitialPath(start: string, end: string, steps: number): string[] {
    const path: string[] = [start];
    let currentId = start;
    const visited = new Set([start]);

    for (let i = 0; i < steps - 2; i++) {
      const neighbors = this.edges
        .filter((edge) => edge.from === currentId && !visited.has(edge.to))
        .sort((a, b) => a.fuelCost - b.fuelCost);
      if (!neighbors.length) break;
      currentId = neighbors[0].to;
      visited.add(currentId);
      path.push(currentId);
      if (currentId === end) break;
    }

    if (path[path.length - 1] !== end) path.push(end);
    return path;
  }

  private getShortestPath(start: string, end: string): string[] {
    const dist = new Map<string, number>();
    const prev = new Map<string, string | null>();
    const unvisited = new Set(this.nodes.keys());

    for (const id of unvisited) {
      dist.set(id, Infinity);
      prev.set(id, null);
    }
    dist.set(start, 0);

    while (unvisited.size) {
      let current: string | null = null;
      let best = Infinity;
      for (const nodeId of unvisited) {
        const candidate = dist.get(nodeId) ?? Infinity;
        if (candidate < best) {
          best = candidate;
          current = nodeId;
        }
      }
      if (!current || current === end) break;
      unvisited.delete(current);

      for (const edge of this.edges.filter((candidate) => candidate.from === current)) {
        const alt = (dist.get(current) ?? Infinity) + edge.distance;
        if (alt < (dist.get(edge.to) ?? Infinity)) {
          dist.set(edge.to, alt);
          prev.set(edge.to, current);
        }
      }
    }

    const path: string[] = [];
    let cursor: string | null = end;
    while (cursor) {
      path.unshift(cursor);
      cursor = prev.get(cursor) ?? null;
    }
    return path[0] === start ? path : this.getInitialPath(start, end, 4);
  }

  private getGreedyPath(start: string, end: string, missionProfile: MissionTimeProfile): string[] {
    const path: string[] = [start];
    const visited = new Set(path);
    let current = start;

    while (current !== end && path.length < missionProfile.horizon) {
      const next = this.edges
        .filter((edge) => edge.from === current && !visited.has(edge.to))
        .map((edge) => {
          const node = this.nodes.get(edge.to);
          const t = path.length;
          const state = node ? missionProfile.nodeStates[node.id] : undefined;
          const radiation = state?.radiationField[t] ?? node?.radiation ?? 1;
          const commPenalty = state?.communicationWindow[t]
            ? (1 - (state?.communicationReliability[t] ?? node?.commScore ?? 0.2)) ** 2
            : 8;
          const score = edge.fuelCost * this.weights.fuel + radiation ** 2 * this.weights.rad + commPenalty * this.weights.comm;
          return { score, to: edge.to };
        })
        .sort((a, b) => a.score - b.score)[0];

      if (!next) break;
      current = next.to;
      visited.add(current);
      path.push(current);
    }

    if (path[path.length - 1] !== end) path.push(end);
    return path;
  }

  private evaluatePath(
    path: string[],
    missionProfile: MissionTimeProfile,
    start: string,
    end: string,
    uncertainty: MissionUncertaintySample = { fuelScale: 1, radiationScale: 1, communicationScale: 1 },
  ): MissionCostBreakdown {
    let fuel = 0;
    let rad = 0;
    let comm = 0;
    let safety = 0;
    let time = 0;
    let continuityPenalty = 0;
    let startEndPenalty = 0;
    let illegalTransitionPenalty = 0;
    let deltaV_ms = 0;
    const timeline: MissionTimelinePoint[] = [];
    const nodeMetrics = new Map<string, ExplainNodeMetric>();
    const violations: string[] = [];
    const visited = new Set<string>();

    if (path[0] !== start) {
      startEndPenalty += 800;
      violations.push(`Start constraint violated: expected ${start}, got ${path[0]}`);
    }
    if (path[path.length - 1] !== end) {
      startEndPenalty += 800;
      violations.push(`End constraint violated: expected ${end}, got ${path[path.length - 1]}`);
    }

    for (let t = 0; t < path.length; t++) {
      const node = this.nodes.get(path[t]);
      if (!node) {
        continuityPenalty += 500;
        violations.push(`Unknown node at t=${t}: ${path[t]}`);
        continue;
      }

      const state = missionProfile.nodeStates[node.id];
      const communicationOpen = (state?.communicationWindow[t] ?? 1) > 0;
      const communicationReliability = clamp(
        (state?.communicationReliability[t] ?? node.commScore) / uncertainty.communicationScale,
        0.01,
        1,
      );
      const radiation = (state?.radiationField[t] ?? node.radiation) * uncertainty.radiationScale;
      const fuelMultiplier = (state?.fuelMultiplier[t] ?? 1) * uncertainty.fuelScale;
      const radiationPenalty = radiation ** 2;
      const communicationPenalty = communicationOpen ? (1 - communicationReliability) ** 2 : 8 + (1 - communicationReliability);
      const timePenalty = 1 + 0.0015 * (node.altitude_km ?? 0);
      let nodeSafetyPenalty = 0;
      const reasons: string[] = [];

      rad += radiationPenalty;
      comm += communicationPenalty;
      time += timePenalty;

      if (!communicationOpen) {
        violations.push(`Communication blackout at ${node.id} (t=${t})`);
        reasons.push('communication blackout');
      }

      if (radiation > missionProfile.radiationThreshold) {
        const excess = (radiation - missionProfile.radiationThreshold) / Math.max(missionProfile.radiationThreshold, 0.1);
        nodeSafetyPenalty += 40 * excess ** 2;
        violations.push(`Radiation threshold exceeded at ${node.id} (t=${t})`);
        reasons.push('high radiation');
      }

      if (visited.has(node.id)) {
        continuityPenalty += 350;
        violations.push(`Repeated visit to ${node.id}`);
      }
      visited.add(node.id);

      const metric = nodeMetrics.get(node.id) ?? {
        id: node.id,
        name: node.name,
        fuelPenalty: 0,
        radiationPenalty: 0,
        communicationPenalty: 0,
        safetyPenalty: 0,
        timePenalty: 0,
        reasons: [],
      };

      metric.radiationPenalty += this.weights.rad * radiationPenalty;
      metric.communicationPenalty += this.weights.comm * communicationPenalty;
      metric.timePenalty += this.weights.time * timePenalty;
      metric.safetyPenalty += this.weights.safety * nodeSafetyPenalty;
      metric.reasons = [...new Set([...metric.reasons, ...reasons])];
      nodeMetrics.set(node.id, metric);

      if (t < path.length - 1) {
        const nextNode = this.nodes.get(path[t + 1]);
        const edge = this.findEdge(path[t], path[t + 1]);
        const illegalRule = missionProfile.illegalTransitions?.find((candidate) =>
          candidate.from === path[t] &&
          candidate.to === path[t + 1] &&
          (!candidate.activeAt || candidate.activeAt.includes(t)),
        );

        if (edge) {
          fuel += edge.fuelCost * fuelMultiplier;
          deltaV_ms += edge.deltaV_ms ?? 0;
          metric.fuelPenalty += this.weights.fuel * edge.fuelCost * fuelMultiplier;

          if (illegalRule) {
            illegalTransitionPenalty += illegalRule.penalty ?? 650;
            reasons.push(illegalRule.reason ?? 'time-blocked transition');
            violations.push(`Time-dependent transition lock ${path[t]} -> ${path[t + 1]} at t=${t}`);
          }

          if (nextNode) {
            const nextState = missionProfile.nodeStates[nextNode.id];
            const nextRadiation = (nextState?.radiationField[t + 1] ?? nextNode.radiation) * uncertainty.radiationScale;
            const radShock = Math.abs(nextRadiation - radiation);
            if (radShock > 0.35) {
              nodeSafetyPenalty += 45 * radShock ** 2;
              reasons.push('radiation gradient');
            }

            const incDelta = Math.abs((nextNode.inclination ?? 0) - (node.inclination ?? 0));
            nodeSafetyPenalty += incDelta * 10;
            if (incDelta > 10) reasons.push('excessive plane change');
          }
        } else {
          continuityPenalty += 1200;
          illegalTransitionPenalty += illegalRule?.penalty ?? 900;
          metric.fuelPenalty += 900;
          reasons.push(illegalRule?.reason ?? 'illegal transition');
          violations.push(`Illegal transition ${path[t]} -> ${path[t + 1]} at t=${t}`);
        }
      }

      safety += nodeSafetyPenalty;
      metric.safetyPenalty += this.weights.safety * nodeSafetyPenalty;
      metric.reasons = [...new Set([...metric.reasons, ...reasons])];
      nodeMetrics.set(node.id, metric);

      const weightedStepCost =
        this.weights.rad * radiationPenalty +
        this.weights.comm * communicationPenalty +
        this.weights.safety * nodeSafetyPenalty +
        this.weights.time * timePenalty;

      timeline.push({
        t,
        nodeId: node.id,
        nodeName: node.name,
        radiation,
        communicationOpen,
        communicationReliability,
        fuelMultiplier,
        stepCost: weightedStepCost,
        riskScore: clamp(100 * (0.45 * radiation + 0.35 * (communicationOpen ? 0.15 : 1) + 0.2 * nodeSafetyPenalty / 50), 0, 100),
      });
    }

    const total =
      this.weights.fuel * fuel +
      this.weights.rad * rad +
      this.weights.comm * comm +
      this.weights.safety * safety +
      this.weights.time * time +
      continuityPenalty +
      startEndPenalty +
      illegalTransitionPenalty;

    return {
      total,
      fuel,
      rad,
      comm,
      safety,
      time,
      continuityPenalty,
      startEndPenalty,
      illegalTransitionPenalty,
      deltaV_ms,
      timeline,
      nodeMetrics: [...nodeMetrics.values()],
      violations,
    };
  }

  private generateQAOACircuit(
    path: string[],
    timeline: MissionTimelinePoint[],
    gamma: number,
    beta: number,
    layer: number,
  ): { gate: string; qubit: number; target?: number; angle?: string; layer?: number }[] {
    const circuit: { gate: string; qubit: number; target?: number; angle?: string; layer?: number }[] = [];
    const nQubits = Math.min(path.length, 8);

    if (layer === 0) {
      for (let q = 0; q < nQubits; q++) {
        circuit.push({ gate: 'H', qubit: q, layer: 0 });
      }
    }

    for (let q = 0; q < nQubits; q++) {
      const diagCost = timeline[q]?.stepCost ?? 0;
      circuit.push({ gate: 'RZ', qubit: q, angle: (gamma * diagCost).toFixed(3), layer });
    }

    for (let q = 0; q < nQubits - 1; q++) {
      const edge = this.findEdge(path[q], path[q + 1]);
      const edgeCost = edge ? edge.fuelCost * this.weights.fuel : 600;
      circuit.push({ gate: 'CNOT', qubit: q, target: q + 1, layer });
      circuit.push({ gate: 'RZ', qubit: q + 1, angle: (gamma * edgeCost).toFixed(3), layer });
      circuit.push({ gate: 'CNOT', qubit: q, target: q + 1, layer });
    }

    for (let q = 0; q < nQubits; q++) {
      circuit.push({ gate: 'RX', qubit: q, angle: (2 * beta).toFixed(3), layer });
    }

    return circuit;
  }

  private buildBasisEnergiesFromTimeline(
    timeline: MissionTimelinePoint[],
    nQubits: number,
    dim: number,
    infeasiblePenalty: number,
  ): number[] {
    return Array.from({ length: dim }, (_, x) => {
      const hasStart = !!(x & 1);
      const hasEnd = !!(x & (1 << (nQubits - 1)));
      if (!hasStart || !hasEnd) return infeasiblePenalty;

      let energy = 0;
      for (let q = 0; q < nQubits; q++) {
        if (x & (1 << q)) energy += timeline[q]?.stepCost ?? 0;
      }
      return energy;
    });
  }

  private benchmarkStrategy(
    label: string,
    path: string[],
    missionProfile: MissionTimeProfile,
    start: string,
    end: string,
    uncertaintyModel: UncertaintyModel,
  ): StrategyBenchmark {
    const deterministic = this.evaluatePath(path, missionProfile, start, end);
    const stochastic = runMonteCarlo(
      32,
      (sample) => {
        const result = this.evaluatePath(path, missionProfile, start, end, sample);
        const success = result.violations.length === 0 && result.safety < 180;
        return {
          cost: result.total,
          success,
          metrics: {
            fuel: result.fuel,
            radiation: result.rad,
            communication: result.comm,
            safety: result.safety,
            violations: result.violations.length,
          },
        };
      },
      uncertaintyModel,
    );

    return {
      label,
      path,
      totalCost: deterministic.total,
      constraintViolations: deterministic.violations.length,
      successProbability: stochastic.successProbability,
    };
  }

  public optimize(
    start: string,
    end: string,
    steps: number = 8,
    radiationMultiplier: number = 1.0,
    missionProfileOverrides?: Partial<MissionTimeProfile>,
    monteCarloRuns: number = 80,
    qaoaDepth: number = 3,
  ): OptimizationResult {
    const horizon = Math.max(2, steps);
    const missionProfile = this.buildMissionProfile(horizon, radiationMultiplier, missionProfileOverrides);
    const uncertaintyModel: UncertaintyModel = {
      fuelSigmaFraction: 0.07,
      radiationSigmaFraction: 0.14,
      communicationSpread: 0.2,
    };

    const naivePath = this.getInitialPath(start, end, horizon);
    const naiveCostData = this.evaluatePath(naivePath, missionProfile, start, end);
    const naiveCost = naiveCostData.total;

    let currentPath = [...naivePath];
    let currentCost = this.evaluatePath(currentPath, missionProfile, start, end);
    let bestPath = [...currentPath];
    let bestCost = { ...currentCost };

    const T0 = 8000.0;
    const Tf = 0.01;
    const iterations = 20000;
    const coolingRate = Math.pow(Tf / T0, 1 / iterations);
    let temp = T0;

    const annealingHistory: { step: number; temperature: number; energy: number }[] = [];
    const sampleInterval = Math.max(1, Math.floor(iterations / 60));

    for (let i = 0; i < iterations; i++) {
      const newPath = [...currentPath];
      if (newPath.length > 2) {
        const moveType = Math.random();
        if (moveType < 0.6) {
          const idx1 = Math.floor(Math.random() * (newPath.length - 2)) + 1;
          const idx2 = Math.floor(Math.random() * (newPath.length - 2)) + 1;
          [newPath[idx1], newPath[idx2]] = [newPath[idx2], newPath[idx1]];
        } else {
          const idx = Math.floor(Math.random() * (newPath.length - 2)) + 1;
          const prevNode = newPath[idx - 1];
          const candidates = this.edges.filter((edge) => edge.from === prevNode).map((edge) => edge.to);
          if (candidates.length) {
            newPath[idx] = candidates[Math.floor(Math.random() * candidates.length)];
          }
        }
      }

      const newCost = this.evaluatePath(newPath, missionProfile, start, end);
      const delta = newCost.total - currentCost.total;

      if (delta < 0 || Math.random() < Math.exp(-delta / temp)) {
        currentPath = newPath;
        currentCost = newCost;
        if (currentCost.total < bestCost.total) {
          bestPath = [...currentPath];
          bestCost = { ...currentCost };
        }
      }

      temp *= coolingRate;
      if (i % sampleInterval === 0) {
        annealingHistory.push({ step: i, temperature: temp, energy: currentCost.total });
      }
    }

    const shortestPath = this.getShortestPath(start, end);
    const greedyPath = this.getGreedyPath(start, end, missionProfile);
    const shortestCostData = this.evaluatePath(shortestPath, missionProfile, start, end);
    const greedyCostData = this.evaluatePath(greedyPath, missionProfile, start, end);

    const qubo = buildFormalMissionQUBO(this.nodes, this.edges, this.weights, bestPath.length, missionProfile, start, end);
    const nQubits = Math.min(bestPath.length, 6);
    const dim = Math.pow(2, nQubits);

    const basisEnergies = Array.from({ length: dim }, (_, x) => {
      let energy = 0;
      for (let q = 0; q < nQubits; q++) {
        if (x & (1 << q)) energy += bestCost.timeline[q]?.stepCost ?? 0;
      }
      return energy;
    });

    const qaoa = simulateQAOA(basisEnergies, nQubits, qaoaDepth);
    const classicalMin = Math.min(...basisEnergies);
    const approxRatio = classicalMin !== 0 ? qaoa.finalEnergy / classicalMin : 1.0;
    const quantumAdvantage_pct = Math.max(0, (1 - bestCost.total / Math.max(naiveCost, 1e-9)) * 100);
    const optimalIdx = basisEnergies.reduce((best, energy, index) => (
      energy < basisEnergies[best] ? index : best
    ), 0);
    const distribution: DistributionEntry[] = Array.from({ length: dim }, (_, x) => ({
      state: x.toString(2).padStart(nQubits, '0'),
      probability: qaoa.finalAmps[x] ? qaoa.finalAmps[x] ** 2 : 0,
      energy: basisEnergies[x],
      isOptimal: x === optimalIdx,
    }))
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 16);
    const fullCircuit = qaoa.layers.flatMap((layer, index) =>
      this.generateQAOACircuit(bestPath, bestCost.timeline, layer.gamma, layer.beta, index),
    );

    let totalDeltaV = bestCost.deltaV_ms;
    if (totalDeltaV === 0) {
      totalDeltaV = this.isp_s * G0 * bestCost.fuel * 0.05;
    }

    const fuelMass_kg = tsiolkovskyFuelMass(totalDeltaV, this.spacecraft_mass_kg, this.isp_s);
    const propellantFraction = fuelMass_kg / this.spacecraft_mass_kg;

    const firstNode = this.nodes.get(bestPath[0]);
    const lastNode = this.nodes.get(bestPath[bestPath.length - 1]);
    const h1 = firstNode?.altitude_km ?? 400;
    const h2 = lastNode?.altitude_km ?? 35786;
    const hohmann = hohmannDeltaV(h1, h2);
    const avgAlt = bestPath.reduce((sum, id) => sum + (this.nodes.get(id)?.altitude_km ?? 400), 0) / bestPath.length;
    const avgInc = bestPath.reduce((sum, id) => sum + (this.nodes.get(id)?.inclination ?? 28.5), 0) / bestPath.length;
    const vanAllenDoseVal = vanAllenDose(avgAlt, avgInc);
    const j2corr = j2NodalPrecession(avgAlt, 0.001, avgInc);

    const stochastic = runMonteCarlo(
      Math.max(50, Math.min(100, monteCarloRuns)),
      (sample) => {
        const result = this.evaluatePath(bestPath, missionProfile, start, end, sample);
        const success = result.violations.length === 0 && result.safety < 180 && result.illegalTransitionPenalty === 0;
        return {
          cost: result.total,
          success,
          metrics: {
            fuel: result.fuel,
            radiation: result.rad,
            communication: result.comm,
            safety: result.safety,
            violations: result.violations.length,
          },
        };
      },
      uncertaintyModel,
    );

    const crewRiskParams: CrewRadiationParams = {
      timestepHours: 6,
      shieldingFactor: 0.74,
      crewSensitivity: 1.08,
      unsafeDoseRateThreshold: missionProfile.radiationThreshold,
      acuteDoseRateThreshold: missionProfile.radiationThreshold * 1.25,
      alpha: 0.42,
      beta: 0.95,
      gamma: 0.08,
    };
    const bestRadiationSamples = timelineToRadiationSamples(bestCost.timeline);
    const shortestRadiationSamples = timelineToRadiationSamples(shortestCostData.timeline);
    const greedyRadiationSamples = timelineToRadiationSamples(greedyCostData.timeline);
    const crewRisk = computeCrewRadiationReadiness(bestRadiationSamples, crewRiskParams);
    const shortestCrewRisk = computeCrewRadiationReadiness(shortestRadiationSamples, crewRiskParams);
    const greedyCrewRisk = computeCrewRadiationReadiness(greedyRadiationSamples, crewRiskParams);
    const alternateRouteSamples = shortestCrewRisk.riskScore <= greedyCrewRisk.riskScore
      ? shortestRadiationSamples
      : greedyRadiationSamples;
    const medicalValidation = validateCrewRadiationReadiness(bestRadiationSamples, crewRisk, crewRiskParams, alternateRouteSamples);
    const communicationStability = averageCommunicationStability(bestCost.timeline);
    const missionProgress = 0;
    const returnFeasibility = clamp(1 - propellantFraction * 0.55 - bestCost.illegalTransitionPenalty / 4000, 0, 1);
    const forecastRemainingRisk = clamp(
      crewRisk.riskScore * (0.58 + (1 - communicationStability) * 0.35 + (1 - returnFeasibility) * 0.2),
      0,
      1.5,
    );
    const candidateDecisionPaths: DecisionPathCandidate[] = [
      {
        name: 'Shortest path',
        path: shortestPath,
        projectedRiskScore: shortestCrewRisk.riskScore,
        communicationStability: averageCommunicationStability(shortestCostData.timeline),
        returnFeasibility: clamp(1 - shortestCostData.deltaV_ms / Math.max(totalDeltaV + 1200, 1), 0, 1),
        missionProgressGain: 0.92,
      },
      {
        name: 'Greedy path',
        path: greedyPath,
        projectedRiskScore: greedyCrewRisk.riskScore,
        communicationStability: averageCommunicationStability(greedyCostData.timeline),
        returnFeasibility: clamp(1 - greedyCostData.deltaV_ms / Math.max(totalDeltaV + 1200, 1), 0, 1),
        missionProgressGain: 0.86,
      },
    ];
    const baseMissionDecision = evaluateMissionDecision(bestPath, crewRisk, {
      forecastRemainingRisk,
      returnFeasibility,
      communicationStability,
      missionProgress,
      alternateCorridorAvailable: candidateDecisionPaths.some((candidate) => candidate.projectedRiskScore < crewRisk.riskScore),
    });
    const missionDecision = baseMissionDecision.decision === 'CONTINUE'
      ? baseMissionDecision
      : recommendAbortOrReplan(bestPath, {
          crewRisk,
          forecastRemainingRisk,
          returnFeasibility,
          communicationStability,
          missionProgress,
        }, candidateDecisionPaths);
    const replanOptions = generateReplanOptions(
      {
        currentPath: bestPath,
        currentRiskScore: crewRisk.riskScore,
        baselineDeltaV: totalDeltaV,
        baselineDurationHours: bestCost.timeline.length * (crewRiskParams.timestepHours ?? 6),
        baselineCommunication: communicationStability,
        missionProgress,
        currentSuccessProbability: stochastic.successProbability,
      },
      {
        nodes: [...this.nodes.values()],
        edges: this.edges,
      },
      {
        shieldingBenefitFraction: 0.18,
      },
    );
    const decisionCosts = compareDecisionCosts(replanOptions);
    const decisionMonteCarlo = replanOptions.map((option) =>
      runDecisionOptionMonteCarlo(
        option.name,
        48,
        (sample) => {
          const optionRisk = clamp(
            option.newTotalMissionRisk *
              sample.radiationScale *
              (sample.healthRiskScale ?? 1) *
              (sample.solarEvent ? (sample.acuteSpikeScale ?? 1.1) : 1),
            0,
            1.5,
          );
          const costAssessment = assessDecisionCost(option);
          const cost = costAssessment.riskAdjustedCost * (sample.costScale ?? 1) * (sample.outagePenalty ?? 1);
          const successProbability = clamp(
            option.probabilityOfSuccess * (sample.replanSuccessScale ?? 1) / (option.type === 'CONTINUE' && sample.solarEvent ? 1.15 : 1),
            0,
            1,
          );
          return {
            cost,
            success: successProbability >= 0.55,
            unsafe: optionRisk > 1,
            crewRisk: optionRisk,
            metrics: {
              crewRisk: optionRisk,
              riskAdjustedCost: cost,
              successProbability,
            },
          };
        },
        {
          ...uncertaintyModel,
          communicationOutageProbability: 0.14,
          replanSuccessSigmaFraction: 0.1,
          costSigmaFraction: 0.16,
          healthRiskSigmaFraction: 0.12,
          solarEventProbability: 0.2,
        },
      ),
    );

    const pathIdSet = new Set(bestPath);
    const offPathExplainMetrics: ExplainNodeMetric[] = [...this.nodes.values()]
      .filter((node) => !pathIdSet.has(node.id))
      .map((node) => {
        const radiationPenalty = node.radiation ** 2;
        const communicationPenalty = (1 - node.commScore) ** 2;
        const timePenalty = 1 + 0.0015 * (node.altitude_km ?? 0);
        return {
          id: node.id,
          name: node.name,
          fuelPenalty: 0,
          radiationPenalty: this.weights.rad * radiationPenalty,
          communicationPenalty: this.weights.comm * communicationPenalty,
          safetyPenalty: 0,
          timePenalty: this.weights.time * timePenalty,
          reasons: ['graph alternative not on optimized path'],
        };
      });

    const explanation = explainPath(
      bestPath,
      {
        fuel: bestCost.fuel * this.weights.fuel,
        radiation: bestCost.rad * this.weights.rad,
        communication: bestCost.comm * this.weights.comm,
        safety: bestCost.safety * this.weights.safety,
        time: bestCost.time * this.weights.time,
      },
      [...bestCost.nodeMetrics, ...offPathExplainMetrics],
    );

    const benchmarks = {
      optimized: this.benchmarkStrategy('Optimized', bestPath, missionProfile, start, end, uncertaintyModel),
      shortestPath: this.benchmarkStrategy('Shortest Path', shortestPath, missionProfile, start, end, uncertaintyModel),
      greedy: this.benchmarkStrategy('Greedy', greedyPath, missionProfile, start, end, uncertaintyModel),
    };
    const financiallyPreferred = [...decisionCosts].sort((a, b) => a.riskAdjustedCost - b.riskAdjustedCost)[0];
    const costBenchmark = [...decisionCosts].sort((a, b) => b.riskAdjustedCost - a.riskAdjustedCost)[0];
    const preferredReplan = replanOptions[0];
    const verification = runMissionSupportVerification(bestRadiationSamples, crewRiskParams, replanOptions);

    return {
      path: bestPath,
      totalCost: bestCost.total,
      fuel: bestCost.fuel,
      radiationExposure: bestCost.rad,
      commLoss: bestCost.comm,
      timePenalty: bestCost.time,
      safetyPenalty: bestCost.safety,
      naivePath,
      naiveCost,
      quboGraph: {
        nodes: this.nodes.size,
        binaryVars: this.nodes.size * bestPath.length,
        temperature: temp,
        annealingSteps: iterations,
        nonZeroTerms: qubo.nonZeroTerms,
      },
      circuitMap: fullCircuit,
      totalDeltaV_ms: totalDeltaV,
      fuelMass_kg,
      propellantFraction,
      annealingHistory,
      qaoa: {
        layers: qaoa.layers,
        finalEnergy: qaoa.finalEnergy,
        approximationRatio: approxRatio,
        quantumAdvantage_pct,
        qaoaMatchPct: approxRatio > 0 ? Math.min(100, 100 / approxRatio) : 100,
        classicalSAImprovement_pct: quantumAdvantage_pct,
        distribution,
      },
      physics: {
        hohmannDeltaV: hohmann.dvTotal,
        j2Correction: j2corr,
        vanAllenDose: vanAllenDoseVal,
        transferTime_days: hohmann.tof_days,
      },
      timeline: bestCost.timeline,
      constraintViolations: bestCost.violations,
      stochastic,
      explanation,
      crewRisk,
      medicalValidation,
      missionDecision,
      replanOptions,
      decisionCosts,
      decisionMonteCarlo,
      decisionNarrative: {
        medicalRisk: explainCrewRisk(crewRisk, medicalValidation),
        operationalDecision: explainMissionDecision(missionDecision, preferredReplan),
        financialRecommendation: financiallyPreferred
          ? explainFinancialRecommendation(financiallyPreferred, costBenchmark)
          : 'No financially differentiated replan recommendation was available.',
      },
      verification,
      systemLimitations: [
        'Radiation scoring is a mission-support approximation and not individualized astronaut clinical judgment.',
        'Replan generation is graph-based and does not solve full continuous translunar or cislunar trajectory mechanics.',
        'Cost magnitudes are scenario proxies for comparative decision intelligence rather than agency budget truth.',
        'Uncertainty propagation is illustrative and not a space-weather forecast-grade probabilistic operations stack.',
      ],
      benchmarks,
      formalModel: {
        variables: [
          'Binary decision variable x(i,t) = 1 when the vehicle occupies node i at time index t.',
          'Transition pairs x(i,t)x(j,t+1) encode discrete moves between mission states.',
        ],
        objective: [
          'Fuel(x) = Σ_t Σ_(i,j) F_ij(t) x(i,t)x(j,t+1)',
          'Radiation(x) = Σ_t Σ_i R(i,t)^2 x(i,t)',
          'CommunicationPenalty(x) = Σ_t Σ_i [1 - C(i,t)rho(i,t)]_pen x(i,t)',
          'Risk(x) = Σ_t Σ_i Psi(i,t) x(i,t)',
          'Time(x) = Σ_t Σ_i tau(i,t) x(i,t)',
        ],
        constraints: [
          'Position occupancy: Σ_i x(i,t) = 1 for every t.',
          'Visit consistency: Σ_t x(i,t) <= 1 for each node i in this prototype formulation.',
          `Boundary conditions: x(${start},0)=1 and x(${end},T-1)=1.`,
          'Continuity: forbidden transitions receive large pairwise penalties.',
        ],
        qubo: [
          'Q diagonal terms contain node-wise fuel/radiation/communication/time costs.',
          'Q off-diagonal terms contain transition fuel costs and illegal-transition penalties.',
          'Quadratic penalty expansion maps equality constraints into x^T Q x without auxiliary continuous variables.',
        ],
        assumptions: [
          'Decision epochs are discretized and aligned with graph nodes rather than continuous thrust arcs.',
          'Time-varying communication and radiation are surrogate mission environment fields suitable for rapid trade studies.',
          'Annealing is used because it scales to combinatorial mission design spaces faster than exact enumeration in a hackathon prototype.',
          'Crew radiation readiness, replan valuation, and decision thresholds are transparent screening layers built on top of the optimized route.',
        ],
        limitations: [
          'The present QUBO uses coarse graph states and does not solve continuous low-thrust or full ephemeris-constrained dynamics.',
          'Communication and radiation fields are stylized if no external forecast is supplied.',
          'QAOA is simulated for explainability only; no quantum hardware execution is implied.',
          'Crew-health logic remains a medically serious but simplified mission-support surrogate model.',
        ],
      },
      timeDependent: {
        radiationThreshold: missionProfile.radiationThreshold,
        communicationViolations: bestCost.violations.filter((item) => item.includes('Communication blackout')).length,
        radiationViolations: bestCost.violations.filter((item) => item.includes('Radiation threshold exceeded')).length,
      },
    };
  }

  public runQAOAOnly(
    path: string[],
    qaoaDepth: number = 3,
  ): {
    qaoa: QAOAResult;
    circuitMap: { gate: string; qubit: number; target?: number; angle?: string; layer?: number }[];
  } {
    const syntheticTimeline = path.map((nodeId, index) => {
      const node = this.nodes.get(nodeId);
      const radiation = node?.radiation ?? 0;
      const communicationReliability = node?.commScore ?? 0.5;
      const communicationPenalty = (1 - communicationReliability) ** 2;
      const stepCost =
        this.weights.rad * radiation ** 2 +
        this.weights.comm * communicationPenalty +
        this.weights.time * (1 + 0.0015 * (node?.altitude_km ?? 0));

      return {
        t: index,
        nodeId,
        nodeName: node?.name ?? nodeId,
        radiation,
        communicationOpen: true,
        communicationReliability,
        fuelMultiplier: 1,
        stepCost,
        riskScore: clamp(100 * (0.6 * radiation + 0.4 * communicationPenalty), 0, 100),
      } satisfies MissionTimelinePoint;
    });

    const nQubits = Math.min(path.length, 6);
    const dim = Math.pow(2, nQubits);
    const infeasiblePenalty = 1e6;
    const basisEnergies = this.buildBasisEnergiesFromTimeline(syntheticTimeline, nQubits, dim, infeasiblePenalty);
    const qaoa = simulateQAOA(basisEnergies, nQubits, qaoaDepth);
    const classicalMin = Math.min(...basisEnergies.filter((energy) => energy < infeasiblePenalty));
    const approxRatio = classicalMin !== 0 ? qaoa.finalEnergy / classicalMin : 1.0;
    const optimalIdx = basisEnergies.reduce((best, energy, index) => (
      energy < basisEnergies[best] ? index : best
    ), 0);
    const distribution: DistributionEntry[] = Array.from({ length: dim }, (_, x) => ({
      state: x.toString(2).padStart(nQubits, '0'),
      probability: qaoa.finalAmps[x] ? qaoa.finalAmps[x] ** 2 : 0,
      energy: basisEnergies[x],
      isOptimal: x === optimalIdx,
    }))
      .filter((entry) => entry.energy < infeasiblePenalty)
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 16);

    return {
      qaoa: {
        layers: qaoa.layers,
        finalEnergy: qaoa.finalEnergy,
        approximationRatio: approxRatio,
        quantumAdvantage_pct: 0,
        qaoaMatchPct: approxRatio > 0 ? Math.min(100, 100 / approxRatio) : 100,
        classicalSAImprovement_pct: 0,
        distribution,
      },
      circuitMap: qaoa.layers.flatMap((layer, index) =>
        this.generateQAOACircuit(path, syntheticTimeline, layer.gamma, layer.beta, index),
      ),
    };
  }
}
