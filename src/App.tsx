import type { ChangeEvent, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertTriangle,
  Atom,
  ChevronRight,
  Gauge,
  Globe,
  Rocket,
  ShieldAlert,
  Thermometer,
  Upload,
  Wind,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Canvas } from '@react-three/fiber';
import { Line as DreiLine, OrbitControls, PerspectiveCamera, Stars, Text } from '@react-three/drei';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import {
  type KeplerianElements,
  type TrajectoryPoint,
  atmosphericDensity,
  calculateArtemisTrajectory,
  computeHohmann,
  estimateConjunctionRisk,
  generateOrbitPoints,
  getPlanetPosition,
  keplerian2ECI,
  RE,
  CISLUNAR_VIS_KM_PER_UNIT,
  VIS_SCENE_KM_PER_UNIT,
} from './lib/orbital';
import { moonGeocentricPositionKm, normalize3, slerpUnitVectors } from './lib/lunarEphemeris';
import { AeroDynamicsVisualizer } from './components/AeroDynamicsVisualizer';
import { AscentDynamicsVisualizer } from './components/AscentDynamicsVisualizer';
import type { GeometryStabilityHints } from './lib/ascentDynamics';
import { explainAscentDynamics } from './lib/explain';
import { j2NodalPrecession, tsiolkovskyFuelMass, vanAllenDose } from './lib/optimizer';
import { LaunchSimulator } from './lib/simulator';
import { STLAnalyzer, type STLAnalysis } from './lib/stlAnalyzer';
import { CELESTIAL_BODIES, CELESTIAL_BODY_MAP, getApproximateHeliocentricPosition, getDateAdjustedLocalGravity, searchBodies } from './lib/celestial';
import { assessConjunction, buildMissionGraphFromImportedConfig, type GeneratedMissionNode, type ImportedMissionConfig } from './lib/missionPlanner';
import { generateMissionReport } from './lib/report';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function formatMoney(value: number) {
  if (!Number.isFinite(value)) return '--';
  return `$${(value / 1_000_000).toFixed(1)}M`;
}

type MissionType = 'lunar' | 'orbital' | 'rover';
type FuelType = 'RP-1' | 'LH2' | 'Methane';
type Tab = 'mission' | 'physics' | 'vehicle' | 'quantum';
type Provenance = 'live-api' | 'formula' | 'preset' | 'heuristic';
type PolicyProfile = 'CREW_FIRST' | 'BALANCED' | 'COST_FIRST';
type ScenarioType = 'NOMINAL' | 'SOLAR_STORM' | 'COMM_BLACKOUT' | 'PROPULSION_ANOMALY' | 'DELAYED_LAUNCH';

interface PropellantType {
  name: FuelType;
  isp_vac: number;
  isp_sl: number;
  density: number;
  color: string;
}

interface OptimizationResult {
  path: string[];
  totalCost: number;
  fuel: number;
  radiationExposure: number;
  commLoss: number;
  timePenalty?: number;
  safetyPenalty?: number;
  naivePath: string[];
  naiveCost: number;
  quboGraph: { nodes: number; binaryVars: number; temperature: number; annealingSteps: number; nonZeroTerms?: number };
  circuitMap: { gate: string; qubit: number; target?: number; angle?: string; layer?: number }[];
  totalDeltaV_ms: number;
  fuelMass_kg: number;
  propellantFraction: number;
  annealingHistory: { step: number; temperature: number; energy: number }[];
  qaoa: {
    layers: Array<{ gamma: number; beta: number; energyExpectation: number }>;
    finalEnergy: number;
    approximationRatio: number;
    quantumAdvantage_pct: number;
    qaoaMatchPct?: number;
    classicalSAImprovement_pct?: number;
    distribution?: Array<{ state: string; probability: number; energy: number; isOptimal: boolean }>;
  };
  physics: { hohmannDeltaV: number; j2Correction: number; vanAllenDose: number; transferTime_days: number };
  stochastic?: { expectedCost: number; variance: number; successProbability: number; runs: number };
  explanation?: {
    summary: string[];
    contributionBreakdown: Array<{ term: string; value: number; percentage: number }>;
    avoidedNodes: Array<{ id: string; name: string; reasons: string[] }>;
  };
  crewRisk?: {
    cumulativeDose: number;
    peakExposure: number;
    unsafeDuration: number;
    riskScore: number;
    classification: 'SAFE' | 'MONITOR' | 'HIGH_RISK' | 'DO_NOT_EMBARK';
    embarkationDecision: 'SAFE_TO_EMBARK' | 'PROCEED_WITH_CAUTION' | 'DO_NOT_EMBARK';
    dominantSegment: { nodeName: string; share: number };
  };
  medicalValidation?: {
    passedConsistencyChecks: boolean;
    consistencyChecks?: Array<{ name: string; passed: boolean; note: string }>;
    monotonicityChecks: Array<{ name: string; passed: boolean; note: string }>;
    thresholdTrace: string;
    dominantRiskDriver: string;
    counterfactuals: Array<{ name: string; riskScore: number; classification: string; deltaRisk: number; summary: string }>;
    confidenceNote: string;
    limitations: string[];
  };
  missionDecision?: {
    decision: 'CONTINUE' | 'REPLAN' | 'ABORT';
    urgencyLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
    rationale: string;
    candidateActions: string[];
    expectedRiskReduction: number;
  };
  replanOptions?: Array<{
    name: string;
    type: string;
    newTotalMissionRisk: number;
    deltaVChange: number;
    missionDurationChange: number;
    communicationImpact: number;
    operationalComplexity: number;
    probabilityOfSuccess: number;
    riskReduction: number;
    score: number;
    recommendation: string;
  }>;
  decisionCosts?: Array<{
    optionName: string;
    directCost: number;
    indirectCost: number;
    riskAdjustedCost: number;
    recommendationValueScore: number;
  }>;
  decisionMonteCarlo?: Array<{
    optionName: string;
    expectedMissionCost: number;
    expectedCrewRisk: number;
    variance: number;
    probabilityUnsafe: number;
    probabilityOfSuccessfulCompletion: number;
  }>;
  decisionNarrative?: {
    medicalRisk: string;
    operationalDecision: string;
    financialRecommendation: string;
  };
  verification?: {
    verificationPassed: boolean;
    failedChecks: string[];
    sensitivitySummary: string[];
    counterfactualSummary: string[];
    notes: string[];
  };
  systemLimitations?: string[];
  benchmarks?: {
    optimized: { label: string; totalCost: number; constraintViolations: number; successProbability: number };
    shortestPath: { label: string; totalCost: number; constraintViolations: number; successProbability: number };
    greedy: { label: string; totalCost: number; constraintViolations: number; successProbability: number };
  };
  constraintViolations?: string[];
  timeDependent?: { communicationViolations: number; radiationViolations: number; radiationThreshold: number };
  launchWindows?: Array<{
    window: { launchTimeIso: string; offsetHours: number; alignmentScore: number };
    deltaV_ms: number;
    radiationExposure: number;
    communicationAvailability: number;
    score: number;
  }>;
  shieldingTradeoff?: {
    shieldingMassKg: number;
    shieldingFactor: number;
    adjustedRadiation: number;
    adjustedDeltaV_ms: number;
    addedPropellantKg: number;
    valueScore: number;
  };
  deltaVPhases?: {
    totalDeltaV: number;
    phases: { departure: number; midcourse: number; flyby: number; return: number };
  };
  uncertaintySummary?: {
    cost: { mean: number; variance: number; p10: number; p50: number; p90: number; histogram: Array<{ binStart: number; binEnd: number; count: number }> };
    risk: { mean: number; variance: number; p10: number; p50: number; p90: number; histogram: Array<{ binStart: number; binEnd: number; count: number }> };
    success: { mean: number; variance: number; p10: number; p50: number; p90: number; histogram: Array<{ binStart: number; binEnd: number; count: number }> };
  };
  policy?: { profile: PolicyProfile; rationale: string };
  reentry?: { reentrySafe: boolean; reentryRiskScore: number; violationReason?: string; approachVelocityMs: number; flightPathAngleDeg: number };
  gravityAssist?: { adjustedDeltaV_ms: number; totalBonusFraction: number; contributions: Array<{ nodeName: string; deltaVBonusFraction: number }> };
  telemetry?: { events: Array<{ timeIndex: number; event: string; severity: 'INFO' | 'WATCH' | 'ALERT'; detail: string }> };
  scenario?: { type: ScenarioType; summary: string };
  missionConfidence?: { confidenceScore: number; interpretation: string };
  stakeholderView?: { crewView: string; controlView: string; financeView: string };
  bayesianRisk?: {
    current?: { posteriorRisk: number; evidence: string[] };
  };
  decisionTree?: {
    optimalPolicy: { sequence: string[]; expectedRisk: number; expectedCost: number };
  };
  recommendations?: {
    recommendedPolicy: { shieldingMassKg: number; launchDelayHours: number; profile: PolicyProfile };
    rationale: string[];
  };
  inversePlanning?: {
    recommendedWeights: { fuel: number; rad: number; comm: number; safety: number; time: number };
    shieldingLevel: number;
    launchWindow: number;
    expectedOutcome: { risk: number; cost: number; successProbability: number };
    policy: PolicyProfile;
  };
  calibration?: {
    updatedParameters: { radiationScale?: number; communicationScale?: number; costScale?: number };
    errorReduction: number;
    appliedParameters: { radiationScale: number; communicationScale: number; costScale: number };
  };
  phasePolicies?: Record<string, { rationale: string }>;
  counterfactuals?: {
    scenarios: Array<{ name: string; deltaRisk: number; deltaCost: number; deltaSuccessProbability: number; explanation: string }>;
    outcomeDifferences: string[];
  };
  regret?: { regretScore: number; missedOpportunity: string };
  policySwitch?: { newPolicy: PolicyProfile; reason: string };
  voi?: { valueOfWaiting: number; recommendation: string };
  hierarchy?: { lowLevelAction: string; midLevelDecision: string; highLevelDecision: 'CONTINUE' | 'REPLAN' | 'ABORT' };
  reportPreview?: { summary: string; findings: string[]; recommendations: string[] };
  multiMission?: {
    missionPlans: Array<{ name: string; funded: boolean; portfolioScore: number }>;
    tradeoffs: string[];
  };
  digitalTwin?: {
    summary: { meanResidual: number; maxResidual: number; driftDetected: boolean; health: 'TRACKING' | 'WATCH' | 'OFF_NOMINAL' };
    recommendation: string;
    residuals: Array<{
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
    }>;
  };
  missionCommand?: {
    entries: Array<{
      timeIndex: number;
      title: string;
      severity: 'INFO' | 'WATCH' | 'ALERT';
      detail: string;
      source: 'telemetry' | 'bayes' | 'digital_twin' | 'decision' | 'policy';
    }>;
  };
  adaptiveNarrative?: {
    bayesian: string;
    decisionTree: string;
    coupling: string;
    recommendations: string;
  };
}

interface LaunchSimulationStep {
  time: number;
  altitude: number;
  velocity: number;
  q: number;
  stress: number;
  pitch: number;
  mach: number;
  dragN: number;
  downrangeKm: number;
  accel_ms2: number;
  cdEffective: number;
}

interface LaunchSimulationResult {
  steps: LaunchSimulationStep[];
  stabilityScore: number;
  ascentFlags: string[];
  failurePoints: string[];
  maxQTime: number;
  maxQValue: number;
  maxQAltitudeKm: number;
  peakDragN: number;
  mecoTime: number;
  residualMass_kg: number;
  apogeeKm: number;
  downrangeKm: number;
  peakAccelerationGs: number;
  burnoutVelocity: number;
  finalAltitudeKm: number;
  source: 'formula-driven';
  flightPath: {
    pitchKickSpeed: number;
    pitchRateDegPerSec: number;
    maxPitchDeg: number;
  };
  aiSummary: {
    max_q_kpa: number;
    peak_drag_n: number;
    stability_score: number;
    max_q_altitude_km: number;
    meco_time_s: number;
  };
}

interface LaunchOptimizationResponse {
  best: LaunchSimulationResult;
  candidates: Array<{
    score: number;
    stabilityScore: number;
    apogeeKm: number;
    maxQValue: number;
    peakAccelerationGs: number;
    flightPath: LaunchSimulationResult['flightPath'];
  }>;
  source: 'formula-driven';
}

interface StageDisplay {
  sequence: number;
  label: string;
  progress: number;
  color: string;
  phase: string;
  timeS?: number;
  distanceKm?: number;
  fuelRemainingPct?: number;
  driver?: string;
}

const PROPELLANTS: Record<FuelType, PropellantType> = {
  'RP-1': { name: 'RP-1', isp_vac: 353, isp_sl: 311, density: 820, color: '#f59e0b' },
  LH2: { name: 'LH2', isp_vac: 453, isp_sl: 381, density: 71, color: '#60a5fa' },
  Methane: { name: 'Methane', isp_vac: 380, isp_sl: 330, density: 450, color: '#34d399' },
};

const MISSION_PRESETS: Record<
  MissionType,
  { title: string; start: string; end: string; nodes: Array<Record<string, any>>; edges: Array<Record<string, any>>; provenance: Provenance }
> = {
  lunar: {
    title: 'Lunar Gateway Transfer',
    start: 'earth',
    end: 'moon',
    provenance: 'preset',
    nodes: [
      { id: 'earth', name: 'LEO Parking', x: 10, y: 50, radiation: 0.08, commScore: 1.0, altitude_km: 400, inclination: 28.5 },
      { id: 'v_allen', name: 'Van Allen Passage', x: 28, y: 38, radiation: 0.92, commScore: 0.55, altitude_km: 15000, inclination: 28.5 },
      { id: 'l1', name: 'EML-1 Gateway', x: 50, y: 50, radiation: 0.15, commScore: 0.92, altitude_km: 326000, inclination: 5.1 },
      { id: 'loi', name: 'Lunar Orbit Insertion', x: 73, y: 65, radiation: 0.35, commScore: 0.65, altitude_km: 380000, inclination: 90.0 },
      { id: 'moon', name: 'Lunar Gateway (NRHO)', x: 92, y: 50, radiation: 0.2, commScore: 0.5, altitude_km: 384400, inclination: 90.0 },
    ],
    edges: [
      { from: 'earth', to: 'v_allen', distance: 14600, fuelCost: 22, deltaV_ms: 3130 },
      { from: 'earth', to: 'l1', distance: 325600, fuelCost: 48, deltaV_ms: 3900 },
      { from: 'v_allen', to: 'l1', distance: 311000, fuelCost: 18, deltaV_ms: 900 },
      { from: 'v_allen', to: 'loi', distance: 365400, fuelCost: 58, deltaV_ms: 4200 },
      { from: 'l1', to: 'loi', distance: 58400, fuelCost: 24, deltaV_ms: 1500 },
      { from: 'l1', to: 'moon', distance: 58400, fuelCost: 52, deltaV_ms: 3200 },
      { from: 'loi', to: 'moon', distance: 4000, fuelCost: 10, deltaV_ms: 900 },
    ],
  },
  orbital: {
    title: 'GEO Satellite Deployment',
    start: 'leo',
    end: 'geo',
    provenance: 'preset',
    nodes: [
      { id: 'leo', name: 'LEO (400 km)', x: 10, y: 50, radiation: 0.08, commScore: 1.0, altitude_km: 400, inclination: 28.5 },
      { id: 'meo1', name: 'MEO-Alpha', x: 35, y: 28, radiation: 0.55, commScore: 0.8, altitude_km: 20200, inclination: 55.0 },
      { id: 'meo2', name: 'MEO-Beta', x: 35, y: 72, radiation: 0.5, commScore: 0.78, altitude_km: 19100, inclination: 64.8 },
      { id: 'transfer', name: 'GTO Apogee', x: 65, y: 50, radiation: 0.28, commScore: 0.88, altitude_km: 35786, inclination: 0.0 },
      { id: 'geo', name: 'GEO Station', x: 90, y: 50, radiation: 0.18, commScore: 0.97, altitude_km: 35786, inclination: 0.0 },
    ],
    edges: [
      { from: 'leo', to: 'meo1', distance: 19800, fuelCost: 14, deltaV_ms: 2400 },
      { from: 'leo', to: 'meo2', distance: 18700, fuelCost: 13, deltaV_ms: 2300 },
      { from: 'meo1', to: 'transfer', distance: 15586, fuelCost: 22, deltaV_ms: 1800 },
      { from: 'meo2', to: 'transfer', distance: 16686, fuelCost: 21, deltaV_ms: 1700 },
      { from: 'leo', to: 'transfer', distance: 35386, fuelCost: 42, deltaV_ms: 3900 },
      { from: 'transfer', to: 'geo', distance: 0, fuelCost: 18, deltaV_ms: 1500 },
    ],
  },
  rover: {
    title: 'Surface Rover Traversal',
    start: 'base',
    end: 'crater',
    provenance: 'preset',
    nodes: [
      { id: 'base', name: 'Artemis Base Camp', x: 10, y: 50, radiation: 0.12, commScore: 0.95, altitude_km: 0, inclination: 0 },
      { id: 'ridge', name: 'Shackleton Ridge', x: 30, y: 32, radiation: 0.28, commScore: 1.0, altitude_km: 0, inclination: 0 },
      { id: 'slope', name: 'North Slope', x: 55, y: 62, radiation: 0.65, commScore: 0.22, altitude_km: 0, inclination: 0 },
      { id: 'plains', name: 'Borealis Plains', x: 70, y: 38, radiation: 0.18, commScore: 0.82, altitude_km: 0, inclination: 0 },
      { id: 'crater', name: 'Ice Deposit Site', x: 90, y: 55, radiation: 0.3, commScore: 0.7, altitude_km: 0, inclination: 0 },
    ],
    edges: [
      { from: 'base', to: 'ridge', distance: 28, fuelCost: 14, deltaV_ms: 0 },
      { from: 'base', to: 'slope', distance: 48, fuelCost: 38, deltaV_ms: 0 },
      { from: 'ridge', to: 'plains', distance: 42, fuelCost: 11, deltaV_ms: 0 },
      { from: 'slope', to: 'crater', distance: 38, fuelCost: 22, deltaV_ms: 0 },
      { from: 'plains', to: 'crater', distance: 22, fuelCost: 8, deltaV_ms: 0 },
      { from: 'ridge', to: 'crater', distance: 60, fuelCost: 18, deltaV_ms: 0 },
    ],
  },
};

const MISSION_SCENARIOS = [
  { id: 'artemis-ii', name: 'Artemis II Lunar Flyby', target: 'moon', mode: 'lunar', fuel: 'LH2', date: '2025-11-20', mass: 26500, thrust: 111200 },
  { id: 'mars-rover', name: 'Mars Rover Survey', target: 'mars', mode: 'rover', fuel: 'Methane', date: '2026-07-15', mass: 15000, thrust: 90000 },
  { id: 'venus-orbit', name: 'Venus Orbital Insertion', target: 'venus', mode: 'orbital', fuel: 'RP-1', date: '2026-10-10', mass: 18000, thrust: 95000 },
];

const FLIGHT_SEQUENCE_TEMPLATE = [
  { label: 'Parking Orbit', phase: 'Launch and ascent', progress: 0.08, driver: 'Ascent energy is converted into a stable parking orbit before translunar commitment.' },
  { label: 'Transfer Burn', phase: 'Launch and ascent', progress: 0.16, driver: 'Primary outbound delta-v impulse commits the vehicle to the transfer trajectory.' },
  { label: 'Translunar coast', phase: 'Launch and ascent', progress: 0.36, driver: 'Ballistic coast is dominated by transfer geometry, distance growth, and low-propulsive trim.' },
  { label: 'Approach', phase: 'Outbound phase', progress: 0.48, driver: 'Relative range to the destination collapses and guidance starts shaping encounter conditions.' },
  { label: 'Encounter', phase: 'Outbound phase', progress: 0.58, driver: 'Closest-body operations are driven by capture, flyby, or proximity-operations physics.' },
  { label: 'Return coast', phase: 'Return phase', progress: 0.74, driver: 'Earth-return leg is largely ballistic with reserve burns protecting corridor accuracy.' },
  { label: 'Entry', phase: 'Recovery phase', progress: 0.9, driver: 'Aerothermal entry corridor and deceleration constraints dominate the physics.' },
  { label: 'Landing', phase: 'Recovery phase', progress: 0.985, driver: 'Terminal descent uses residual reserves and recovery geometry to complete the mission.' },
] as const;

function stageColor(label: string): string {
  const lower = label.toLowerCase();
  if (lower.includes('launch') || lower.includes('departure') || lower.includes('parking') || lower.includes('landing') || lower.includes('gateway')) return '#84cc16';
  if (lower.includes('sep') || lower.includes('max q')) return '#eab308';
  if (lower.includes('transfer') || lower.includes('burn') || lower.includes('meco')) return '#38bdf8';
  if (lower.includes('entry')) return '#ef4444';
  if (lower.includes('encounter') || lower.includes('approach')) return '#f59e0b';
  return '#a78bfa';
}

function stagePhase(progress: number): string {
  if (progress < 0.2) return 'Launch and ascent';
  if (progress < 0.55) return 'Outbound phase';
  if (progress < 0.82) return 'Return phase';
  return 'Recovery phase';
}

function stageDriver(label: string): string {
  return FLIGHT_SEQUENCE_TEMPLATE.find((stage) => stage.label === label)?.driver ?? 'Mission phase derived from trajectory geometry and operational constraints.';
}

function normalizeStageLabel(label: string): string {
  switch (label) {
    case 'LEO / Departure':
      return 'Parking Orbit';
    case 'TLI':
      return 'Transfer Burn';
    case 'Translunar':
      return 'Translunar coast';
    case 'Outbound Cruise':
      return 'Translunar coast';
    case 'NRHO / Gateway':
      return 'Encounter';
    case 'Return Burn':
      return 'Return coast';
    case 'Earth return':
      return 'Entry';
    case 'Entry Interface':
      return 'Entry';
    case 'Lunar approach':
      return 'Approach';
    case 'Landing / Splashdown':
      return 'Landing';
    default:
      return label;
  }
}

function distanceBetweenPointsKm(a: [number, number, number], b: [number, number, number], kmPerUnit: number): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz) * kmPerUnit;
}

function estimateFuelRemainingPct(label: string, progress: number, distanceShare: number): number {
  const baselineByStage: Record<string, number> = {
    'Parking Orbit': 92,
    'Transfer Burn': 74,
    'Translunar coast': 66,
    'Approach': 57,
    'Encounter': 49,
    'Return coast': 34,
    'Entry': 12,
    'Landing': 5,
  };
  const base = baselineByStage[label] ?? Math.round((1 - progress) * 100);
  const distancePenalty = distanceShare * 8;
  return Math.max(3, Math.min(98, Math.round(base - distancePenalty)));
}

function deriveTrajectoryStages(
  trajectory: Array<{ label?: string; time_s?: number; pos: [number, number, number] }>,
  options: { kmPerUnit: number },
): StageDisplay[] {
  if (trajectory.length < 2) return [];

  const totalTime = Math.max(1, trajectory[trajectory.length - 1]?.time_s ?? 1);
  const cumulativeDistanceKm: number[] = [0];
  for (let i = 1; i < trajectory.length; i++) {
    cumulativeDistanceKm.push(cumulativeDistanceKm[i - 1] + distanceBetweenPointsKm(trajectory[i - 1].pos, trajectory[i].pos, options.kmPerUnit));
  }
  const totalDistanceKm = Math.max(cumulativeDistanceKm[cumulativeDistanceKm.length - 1], 1);

  const labelIndex = new Map<string, number>();
  for (let i = 0; i < trajectory.length; i++) {
    const label = trajectory[i].label ? normalizeStageLabel(trajectory[i].label) : null;
    if (label && !labelIndex.has(label)) labelIndex.set(label, i);
  }

  return FLIGHT_SEQUENCE_TEMPLATE.map((template, index) => {
    const fallbackIdx = Math.min(trajectory.length - 1, Math.max(0, Math.floor(template.progress * (trajectory.length - 1))));
    const idx = labelIndex.get(template.label) ?? fallbackIdx;
    const timeS = trajectory[idx]?.time_s ?? template.progress * totalTime;
    const progress = Math.max(0.015, Math.min(0.985, timeS / totalTime));
    const distanceKm = cumulativeDistanceKm[idx] ?? totalDistanceKm * progress;
    const distanceShare = distanceKm / totalDistanceKm;
    return {
      sequence: index + 1,
      label: template.label,
      progress,
      color: stageColor(template.label),
      phase: template.phase,
      timeS,
      distanceKm,
      fuelRemainingPct: estimateFuelRemainingPct(template.label, progress, distanceShare),
      driver: stageDriver(template.label),
    };
  });
}

function findClosestStepTime(steps: LaunchSimulationStep[], predicate: (step: LaunchSimulationStep) => boolean): number | null {
  for (const step of steps) {
    if (predicate(step)) return step.time;
  }
  return null;
}

function deriveAscentTimelineStages(
  simResult: LaunchOptimizationResponse | null,
  transferTimeDays?: number,
): StageDisplay[] {
  if (!simResult) {
    return [
      { label: 'Launch', progress: 0.015, color: stageColor('Launch'), phase: 'Launch and ascent', driver: 'Initial ascent from the launch site.' },
      { label: 'Stage Sep', progress: 0.12, color: stageColor('Stage Sep'), phase: 'Launch and ascent', driver: 'Stage separation reshapes thrust-to-mass and drag conditions.' },
      { label: 'Parking Orbit', progress: 0.26, color: stageColor('Parking Orbit'), phase: 'Launch and ascent', driver: stageDriver('Parking Orbit') },
      { label: 'Transfer Burn', progress: 0.42, color: stageColor('Transfer Burn'), phase: 'Launch and ascent', driver: stageDriver('Transfer Burn') },
      { label: 'Encounter', progress: 0.7, color: stageColor('Encounter'), phase: 'Outbound phase', driver: stageDriver('Encounter') },
      { label: 'Entry', progress: 0.9, color: stageColor('Entry'), phase: 'Recovery phase', driver: stageDriver('Entry') },
      { label: 'Landing', progress: 0.985, color: stageColor('Landing'), phase: 'Recovery phase', driver: stageDriver('Landing') },
    ].map((stage, index) => ({
      sequence: index + 1,
      ...stage,
    }));
  }

  const steps = simResult.best.steps;
  const transonicTime = findClosestStepTime(steps, (step) => step.mach >= 0.95) ?? simResult.best.maxQTime * 0.85;
  const stageSepTime = Math.min(simResult.best.mecoTime * 0.58, Math.max(transonicTime, simResult.best.maxQTime * 1.08));
  const parkingOrbitTime = simResult.best.mecoTime + Math.max(120, Math.min(900, simResult.best.mecoTime * 0.4));
  const transferBurnTime = parkingOrbitTime + Math.max(120, Math.min(1800, simResult.best.mecoTime * 1.2));
  const transferDurationS = Math.max(1, (transferTimeDays ?? 5) * 86400);
  const encounterTime = transferBurnTime + transferDurationS;
  const entryTime = encounterTime + transferDurationS * 0.82;
  const landingTime = encounterTime + transferDurationS;
  const totalTime = Math.max(landingTime, 1);
  const events = [
    { label: 'Launch', timeS: 0 },
    { label: 'Stage Sep', timeS: stageSepTime },
    { label: 'Parking Orbit', timeS: parkingOrbitTime },
    { label: 'Transfer Burn', timeS: transferBurnTime },
    { label: 'Encounter', timeS: encounterTime },
    { label: 'Entry', timeS: entryTime },
    { label: 'Landing', timeS: landingTime },
  ];

  return events.map((event, index) => ({
    sequence: index + 1,
    label: event.label,
    progress: index === 0 ? 0.015 : index === events.length - 1 ? 0.985 : Math.max(0.02, Math.min(0.97, event.timeS / totalTime)),
    color: stageColor(event.label),
    phase: stagePhase(event.timeS / totalTime),
    timeS: event.timeS,
    driver: stageDriver(event.label),
  }));
}

function getSurfaceDensity(bodyId: string): number | undefined {
  switch (bodyId) {
    case 'earth':
      return 1.225;
    case 'mars':
      return 0.02;
    case 'venus':
      return 65;
    case 'titan':
      return 5.3;
    default:
      return undefined;
  }
}

function buildGeometryHints(stl: STLAnalysis | null): GeometryStabilityHints | null {
  if (!stl) return null;
  const { width, height, depth } = stl.bounds;
  const axis = stl.principalAxis;
  const length = axis === 'x' ? width : axis === 'y' ? height : depth;
  const crossMax = axis === 'x' ? Math.max(height, depth) : axis === 'y' ? Math.max(width, depth) : Math.max(width, height);
  const aspectRatio = length / Math.max(1e-9, crossMax);
  const idx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const offset = Math.abs(stl.centerOfPressure[idx] - stl.centerOfMass[idx]);
  const cpComOffsetNorm = offset / Math.max(1e-9, length);
  return { aspectRatio, cpComOffsetNorm, referenceLengthM: length };
}

const CB = '#4B9CD3';

function provenanceTone(kind: Provenance) {
  switch (kind) {
    case 'live-api':
      return 'border-green-500/30 bg-green-500/10 text-green-300';
    case 'formula':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-300';
    case 'preset':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
    case 'heuristic':
      return 'border-red-500/30 bg-red-500/10 text-red-300';
    default:
      return 'border-slate-700 bg-slate-900/70 text-slate-300';
  }
}

function DashboardCard({
  title,
  children,
  icon: Icon,
  provenance,
  className,
}: {
  title: string;
  children: ReactNode;
  icon: any;
  provenance?: Provenance;
  className?: string;
}) {
  return (
    <section className={cn('rounded-xl border border-slate-800 bg-[#0d1224]/95 shadow-[0_20px_60px_rgba(0,0,0,0.28)]', className)}>
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4" style={{ color: CB }} />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">{title}</h2>
        </div>
        {provenance ? <ProvenancePill kind={provenance} /> : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function MetricBadge({
  label,
  value,
  unit,
  tone = 'default',
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: 'default' | 'good' | 'warn' | 'bad';
}) {
  const color =
    tone === 'good' ? 'text-green-300 border-green-500/20 bg-green-500/5' :
    tone === 'warn' ? 'text-amber-300 border-amber-500/20 bg-amber-500/5' :
    tone === 'bad' ? 'text-red-300 border-red-500/20 bg-red-500/5' :
    'text-slate-100 border-slate-700 bg-slate-900/70';

  return (
    <div className={cn('rounded-lg border p-3', color)}>
      <p className="text-[9px] uppercase tracking-[0.16em] text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
      {unit ? <p className="text-[10px] text-slate-500">{unit}</p> : null}
    </div>
  );
}

function ProvenancePill({ kind }: { kind: Provenance }) {
  const label =
    kind === 'live-api' ? 'Live API' :
    kind === 'formula' ? 'Formula' :
    kind === 'preset' ? 'Preset' :
    'Heuristic';
  return <span className={cn('rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em]', provenanceTone(kind))}>{label}</span>;
}

function StatusPill({ value, tone }: { value: string; tone: 'good' | 'warn' | 'bad' | 'default' }) {
  const classes =
    tone === 'good' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' :
    tone === 'warn' ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' :
    tone === 'bad' ? 'border-red-500/30 bg-red-500/10 text-red-200' :
    'border-slate-700 bg-slate-900/70 text-slate-200';
  return <span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]', classes)}>{value}</span>;
}

function QuantumCircuit({ gates }: { gates: OptimizationResult['circuitMap'] }) {
  if (!gates?.length) return <p className="text-sm text-slate-400">Run mission optimization to inspect the synthesized circuit.</p>;

  const gateColors: Record<string, string> = {
    H: '#a78bfa',
    RX: '#4B9CD3',
    RZ: '#4ade80',
    CNOT: '#f87171',
  };
  const layers = gates.reduce<Record<number, typeof gates>>((acc, gate) => {
    const key = gate.layer ?? 0;
    acc[key] ??= [];
    acc[key].push(gate);
    return acc;
  }, {});
  const nQubits = Math.max(...gates.map((gate) => Math.max(gate.qubit, gate.target ?? 0))) + 1;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[320px] space-y-2">
        {Array.from({ length: nQubits }, (_, qubit) => (
          <div key={qubit} className="flex items-center gap-2">
            <span className="w-7 text-[10px] text-slate-400">q{qubit}</span>
            <div className="flex flex-1 items-center gap-1">
              {Object.entries(layers).map(([layer, layerGates]) => {
                const gate = layerGates.find((candidate) => candidate.qubit === qubit || candidate.target === qubit);
                if (!gate) return <div key={layer} className="h-7 w-8 rounded border border-transparent" />;
                const color = gateColors[gate.gate] ?? '#94a3b8';
                return (
                  <div key={`${layer}-${qubit}`} className="flex h-7 w-8 flex-col items-center justify-center rounded border text-[9px] font-semibold" style={{ borderColor: color, color, backgroundColor: `${color}22` }}>
                    <span>{gate.gate}</span>
                    {gate.angle ? <span className="text-[7px] opacity-80">{gate.angle}</span> : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-3 text-[9px] text-slate-500">
          {Object.entries(gateColors).map(([gate, color]) => (
            <div key={gate} className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
              <span>{gate}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function QuantumDistribution({ distribution }: { distribution?: Array<{ state: string; probability: number; energy: number; isOptimal: boolean }> }) {
  if (!distribution?.length) return <p className="text-sm text-slate-400">Probability distribution becomes available after optimization.</p>;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={distribution} margin={{ top: 4, right: 8, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis dataKey="state" stroke="#64748b" tick={{ fontSize: 9 }} />
        <YAxis stroke="#64748b" tick={{ fontSize: 9 }} tickFormatter={(value) => `${(value * 100).toFixed(0)}%`} />
        <Tooltip
          contentStyle={{ background: '#020617', border: '1px solid #334155' }}
          formatter={(value: number, _name, payload: { payload?: { energy: number; isOptimal: boolean } }) => [
            `${(value * 100).toFixed(2)}%`,
            `E=${payload.payload?.energy?.toFixed?.(2) ?? '--'}${payload.payload?.isOptimal ? ' · optimal' : ''}`,
          ]}
        />
        <Bar dataKey="probability" radius={[3, 3, 0, 0]}>
          {distribution.map((entry, index) => (
            <Cell key={index} fill={entry.isOptimal ? '#f59e0b' : '#4B9CD3'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function OrbitLine({ elements, kmPerUnit = VIS_SCENE_KM_PER_UNIT, lineWidth = 1.5 }: { elements: KeplerianElements; kmPerUnit?: number; lineWidth?: number }) {
  const points = useMemo(() => generateOrbitPoints(elements, 200, 1 / kmPerUnit), [elements, kmPerUnit]);
  return <DreiLine points={points} color={CB} lineWidth={lineWidth} transparent opacity={0.7} />;
}

function createPlanetTexture(bodyId: string, baseColor: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (bodyId === 'earth') {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#9ed8ff');
    gradient.addColorStop(0.45, '#2d7dd2');
    gradient.addColorStop(1, '#113a71');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#3aa66b';
    const patches = [
      [160, 160, 180, 70],
      [260, 220, 120, 90],
      [420, 170, 210, 95],
      [700, 180, 190, 80],
      [820, 290, 120, 70],
      [560, 300, 170, 60],
    ];
    for (const [x, y, w, h] of patches) {
      ctx.beginPath();
      ctx.ellipse(x, y, w, h, Math.PI / 8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    for (let i = 0; i < 18; i++) {
      ctx.beginPath();
      ctx.ellipse(60 + i * 52, 80 + (i % 5) * 55, 38 + (i % 3) * 12, 12 + (i % 2) * 6, 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (bodyId === 'moon') {
    const g = ctx.createRadialGradient(420, 200, 40, 520, 280, 420);
    g.addColorStop(0, '#e8eaef');
    g.addColorStop(0.35, '#b8bcc6');
    g.addColorStop(0.7, '#7a7f8a');
    g.addColorStop(1, '#4a4d56');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(25,28,32,0.35)';
    for (let i = 0; i < 55; i++) {
      const cx = Math.random() * canvas.width;
      const cy = Math.random() * canvas.height;
      const rw = 15 + Math.random() * 90;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rw, rw * (0.35 + Math.random() * 0.35), Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    for (let i = 0; i < 12; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (i / 12) * canvas.height);
      ctx.bezierCurveTo(canvas.width * 0.3, (i / 12) * canvas.height + 40, canvas.width * 0.7, (i / 12) * canvas.height - 40, canvas.width, (i / 12) * canvas.height);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 12; i++) {
      ctx.beginPath();
      ctx.ellipse(80 + i * 75, 70 + (i % 4) * 90, 45 + (i % 3) * 18, 18 + (i % 2) * 8, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function PrimaryBody3D({ bodyId, color, radius }: { bodyId: string; color: string; radius: number }) {
  const texture = useMemo(() => createPlanetTexture(bodyId, color), [bodyId, color]);
  return (
    <group>
      <mesh>
        <sphereGeometry args={[radius, 64, 64]} />
        <meshStandardMaterial map={texture ?? undefined} color={color} emissive="#001020" metalness={0.2} roughness={0.8} />
      </mesh>
      <mesh scale={1.02}>
        <sphereGeometry args={[radius, 64, 64]} />
        <meshStandardMaterial color={color} transparent opacity={0.08} side={THREE.BackSide} />
      </mesh>
    </group>
  );
}

/** Scene radius from physical km using cislunar / heliocentric visual scale. */
function bodySceneRadiusFromKm(radiusKm: number): number {
  return Math.max(0.35, radiusKm / VIS_SCENE_KM_PER_UNIT);
}

function bodyDisplayRadiusKm(radiusKm: number): number {
  const earthScene = RE / VIS_SCENE_KM_PER_UNIT;
  const scaled = Math.pow(radiusKm / 6378.137, 0.45) * earthScene;
  return Math.max(earthScene * 0.12, scaled);
}

function RadiationOverlay({
  bodyRadius,
  atmosphereScaleHeightKm,
  isPrimary,
}: {
  bodyRadius: number;
  atmosphereScaleHeightKm?: number;
  isPrimary?: boolean;
}) {
  const zones = isPrimary
    ? [
        { radius: bodyRadius + Math.max(10, bodyRadius * 0.8), color: '#f59e0b', opacity: 0.08 },
        { radius: bodyRadius + Math.max(22, bodyRadius * 1.5), color: '#ef4444', opacity: 0.06 },
        { radius: bodyRadius + Math.max(38, bodyRadius * 2.3), color: '#f97316', opacity: 0.04 },
      ]
    : atmosphereScaleHeightKm
      ? [
          { radius: bodyRadius + Math.max(2.5, atmosphereScaleHeightKm / 3), color: '#fb7185', opacity: 0.035 },
        ]
      : [];

  return (
    <group>
      {zones.map((zone, index) => (
        <mesh key={index}>
          <sphereGeometry args={[zone.radius, 40, 40]} />
          <meshBasicMaterial color={zone.color} transparent opacity={zone.opacity} wireframe />
        </mesh>
      ))}
    </group>
  );
}

function MissionGlobe({
  launchDate,
  targetPlanetId,
  launchBodyId,
  preset,
  pathNodeIds,
  keplerEl,
  stageList,
  trajectory,
}: {
  launchDate: string;
  targetPlanetId: string;
  launchBodyId: string;
  preset: (typeof MISSION_PRESETS)[MissionType];
  pathNodeIds: string[];
  keplerEl: KeplerianElements;
  stageList: StageDisplay[];
  trajectory: TrajectoryPoint[];
}) {
  const isCislunar = targetPlanetId === 'moon' && launchBodyId === 'earth';
  const outboundTrajectory = useMemo(() => trajectory.slice(0, Math.max(2, Math.floor(trajectory.length * 0.55))), [trajectory]);
  const inboundTrajectory = useMemo(() => trajectory.slice(Math.max(1, Math.floor(trajectory.length * 0.5))), [trajectory]);
  const sceneDate = useMemo(() => new Date(launchDate + 'T12:00:00Z'), [launchDate]);
  const heliocentricEarthRadiusScene = RE / VIS_SCENE_KM_PER_UNIT;
  const earthRadiusScene = isCislunar ? RE / CISLUNAR_VIS_KM_PER_UNIT : heliocentricEarthRadiusScene;
  const cislunarKmPerUnit = CISLUNAR_VIS_KM_PER_UNIT;

  const systemBodies = useMemo(() => {
    if (isCislunar) return [];
    const earthHelio = getApproximateHeliocentricPosition(CELESTIAL_BODY_MAP.earth, sceneDate);
    return CELESTIAL_BODIES
      .filter((body) => body.orbit && body.id !== launchBodyId)
      .map((body) => {
        const p = getApproximateHeliocentricPosition(body, sceneDate);
        return {
          ...body,
          pos: [p[0] - earthHelio[0], p[1] - earthHelio[1], p[2] - earthHelio[2]] as [number, number, number],
        };
      });
  }, [sceneDate, isCislunar, launchBodyId]);

  const moonScene = useMemo(() => {
    const km = moonGeocentricPositionKm(sceneDate);
    const inv = 1 / cislunarKmPerUnit;
    const trueR = CELESTIAL_BODY_MAP.moon.radiusKm * inv;
    return {
      pos: [km[0] * inv, km[1] * inv, km[2] * inv] as [number, number, number],
      radius: Math.max(2.2, trueR * 2.4),
    };
  }, [sceneDate, cislunarKmPerUnit]);

  const moonTexture = useMemo(() => createPlanetTexture('moon', '#c8ccd4'), []);

  const projectedNodes = useMemo<Array<Record<string, any> & { pos3d: [number, number, number] }>>(() => {
    const inv = 1 / (isCislunar ? cislunarKmPerUnit : VIS_SCENE_KM_PER_UNIT);
    const toScene = (km: [number, number, number]): [number, number, number] => [km[0] * inv, km[1] * inv, km[2] * inv];
    if (isCislunar) {
      const leo = keplerian2ECI(keplerEl);
      const leoHat = normalize3(leo.r);
      const moonKm = moonGeocentricPositionKm(sceneDate);
      const moonH = normalize3(moonKm);
      return preset.nodes.map((node) => {
        const alt = typeof node.altitude_km === 'number' ? node.altitude_km : 400;
        const rKm = alt > 100_000 ? alt : RE + Math.max(0, alt);
        const frac = Math.min(1, rKm / 450_000);
        const dir = slerpUnitVectors(leoHat, moonH, frac);
        return {
          ...node,
          pos3d: toScene([dir[0] * rKm, dir[1] * rKm, dir[2] * rKm]),
        };
      });
    }
    const radius = Math.max(18, heliocentricEarthRadiusScene * 8);
    return preset.nodes.map((node) => {
      const phi = (node.x / 100) * Math.PI * 2;
      const theta = (node.y / 100) * Math.PI;
      return {
        ...node,
        pos3d: [
          -radius * Math.sin(theta) * Math.cos(phi),
          radius * Math.cos(theta),
          radius * Math.sin(theta) * Math.sin(phi),
        ] as [number, number, number],
      };
    });
  }, [preset, isCislunar, keplerEl, sceneDate, heliocentricEarthRadiusScene, cislunarKmPerUnit]);

  const launchBody = CELESTIAL_BODY_MAP[launchBodyId] ?? CELESTIAL_BODY_MAP.earth;
  const targetBody = CELESTIAL_BODY_MAP[targetPlanetId] ?? CELESTIAL_BODY_MAP.moon;
  const stageMarkers = stageList.map((stage) => {
    let idx = Math.min(trajectory.length - 1, Math.max(0, Math.floor(stage.progress * (trajectory.length - 1))));
    if (stage.timeS != null) {
      let bestIdx = idx;
      let bestDt = Infinity;
      for (let i = 0; i < trajectory.length; i++) {
        const dt = Math.abs((trajectory[i].time_s ?? 0) - stage.timeS);
        if (dt < bestDt) {
          bestDt = dt;
          bestIdx = i;
        }
      }
      idx = bestIdx;
    }
    return { ...stage, point: trajectory[idx]?.pos ?? [0, 0, 0] };
  });

  return (
    <group>
      <PrimaryBody3D bodyId={launchBody.id} color={launchBody.color} radius={launchBodyId === 'earth' ? earthRadiusScene : bodySceneRadiusFromKm(launchBody.radiusKm)} />
      <RadiationOverlay bodyRadius={launchBodyId === 'earth' ? earthRadiusScene : bodySceneRadiusFromKm(launchBody.radiusKm)} atmosphereScaleHeightKm={launchBody.atmosphereScaleHeightKm} isPrimary />
      <OrbitLine elements={keplerEl} kmPerUnit={isCislunar ? cislunarKmPerUnit : VIS_SCENE_KM_PER_UNIT} lineWidth={isCislunar ? 2.4 : 1.5} />
      {isCislunar ? (
        <group position={moonScene.pos}>
          <mesh>
            <sphereGeometry args={[moonScene.radius, 48, 48]} />
            <meshStandardMaterial map={moonTexture ?? undefined} color="#d4d8e0" roughness={0.9} metalness={0.04} emissive="#0a0c10" emissiveIntensity={0.08} />
          </mesh>
          <Text position={[0, moonScene.radius + 2.2, 0]} fontSize={2.2} color="#e2e8f0" anchorX="center">
            Moon
          </Text>
        </group>
      ) : null}
      {systemBodies.map((body) => {
        const isTarget = body.id === targetBody.id;
        const radius = bodyDisplayRadiusKm(body.radiusKm);
        return (
          <group key={body.id} position={body.pos as [number, number, number]}>
            <mesh>
              <sphereGeometry args={[radius, 32, 32]} />
              <meshStandardMaterial color={body.color} roughness={0.82} metalness={0.06} />
            </mesh>
            <RadiationOverlay bodyRadius={radius} atmosphereScaleHeightKm={body.atmosphereScaleHeightKm} isPrimary={isTarget} />
            <Text position={[0, radius + 3.5, 0]} fontSize={2.5} color={isTarget ? '#f8fafc' : '#94a3b8'} anchorX="center">
              {body.name}
            </Text>
          </group>
        );
      })}
      <DreiLine points={outboundTrajectory.map((point) => point.pos)} color="#84cc16" lineWidth={isCislunar ? 3.6 : 2.3} transparent opacity={0.95} />
      <DreiLine points={inboundTrajectory.map((point) => point.pos)} color="#f59e0b" lineWidth={isCislunar ? 3.6 : 2.3} transparent opacity={0.95} />
      {trajectory.length > 0 && (
        <DreiLine
          points={trajectory.filter((_, index) => index % 8 === 0).map((point) => point.pos)}
          color="#ef4444"
          lineWidth={1}
          transparent
          opacity={0.22}
          dashed
          dashScale={10}
          dashSize={0.8}
          gapSize={0.55}
        />
      )}
      {projectedNodes.map((node) => {
        const selected = pathNodeIds.includes(node.id);
        const nr = isCislunar ? (selected ? 2.4 : 1.55) : (selected ? 2.2 : 1.4);
        const lift = isCislunar ? 5.5 : 6;
        const fs = isCislunar ? 2.6 : 3;
        return (
          <group key={node.id}>
            <mesh position={node.pos3d}>
              <sphereGeometry args={[nr, 18, 18]} />
              <meshBasicMaterial color={selected ? CB : node.radiation > 0.5 ? '#ef4444' : '#64748b'} />
            </mesh>
            <Text position={[node.pos3d[0], node.pos3d[1] + lift, node.pos3d[2]]} fontSize={fs} color={selected ? '#e0f2fe' : '#94a3b8'} anchorX="center">
              {node.name}
            </Text>
          </group>
        );
      })}
      {stageMarkers.map((stage) => {
        const sr = isCislunar ? 2.5 : 2.8;
        const ty = isCislunar ? 5.2 : 5.5;
        const tf = isCislunar ? 2.2 : 2.4;
        return (
          <group key={`${stage.sequence}-${stage.label}`} position={stage.point as [number, number, number]}>
            <mesh>
              <sphereGeometry args={[sr, 16, 16]} />
              <meshBasicMaterial color={stage.color} />
            </mesh>
            <Text position={[0, ty + 1.8, 0]} fontSize={tf * 0.92} color="#f8fafc" anchorX="center">
              {stage.sequence}
            </Text>
            <Text position={[0, ty - 0.6, 0]} fontSize={tf} color={stage.color} anchorX="center">
              {stage.label}
            </Text>
          </group>
        );
      })}
      <Stars radius={800} depth={500} count={10000} factor={10} saturation={0} fade speed={0.4} />
    </group>
  );
}

function SourceStatus({
  weatherData,
  nasaWeather,
  stlAnalysis,
  simResult,
}: {
  weatherData: any;
  nasaWeather: any;
  stlAnalysis: STLAnalysis | null;
  simResult: LaunchOptimizationResponse | null;
}) {
  const rows = [
    { label: 'Surface weather', source: weatherData?.source ?? 'Unavailable', kind: weatherData?.source?.startsWith('LIVE') ? 'live-api' : 'preset' },
    { label: 'Space weather', source: nasaWeather?.source ?? 'Unavailable', kind: nasaWeather?.source?.startsWith('LIVE') ? 'live-api' : 'preset' },
    { label: 'Ascent dynamics', source: simResult ? 'In-browser 2D ascent solver' : 'Not run', kind: simResult ? 'formula' : 'preset' },
    { label: 'Vehicle geometry', source: stlAnalysis ? 'User STL-derived geometry' : 'No uploaded vehicle', kind: stlAnalysis ? 'formula' : 'preset' },
    { label: 'Mission graph', source: 'Scenario graph still uses preset nodes and edges', kind: 'preset' },
    { label: 'Conjunction panel', source: 'Shell-spacing heuristic only', kind: 'heuristic' },
  ] as const;

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">{row.label}</p>
            <p className="text-sm text-slate-200">{row.source}</p>
          </div>
          <ProvenancePill kind={row.kind} />
        </div>
      ))}
    </div>
  );
}

function FuelCalculator({ fuelType }: { fuelType: FuelType }) {
  const [m0, setM0] = useState(10000);
  const [dv, setDv] = useState(3900);
  const prop = PROPELLANTS[fuelType];
  const mProp = tsiolkovskyFuelMass(dv, m0, prop.isp_vac);
  const mDry = Math.max(1, m0 - mProp);
  const massRatio = m0 / mDry;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 font-mono text-[11px] text-amber-300">
        Δm = m₀ · (1 - e^(-Δv / (Isp · g₀)))
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
          Initial Mass
          <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-slate-100" type="number" value={m0} onChange={(event) => setM0(+event.target.value)} />
        </label>
        <label className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
          Delta-v
          <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-slate-100" type="number" value={dv} onChange={(event) => setDv(+event.target.value)} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <MetricBadge label="Propellant" value={mProp.toFixed(0)} unit="kg" tone="warn" />
        <MetricBadge label="Mass Ratio" value={massRatio.toFixed(3)} unit="m0 / mf" />
        <MetricBadge label="Propellant Fraction" value={`${((mProp / m0) * 100).toFixed(1)}%`} unit="of initial mass" />
        <MetricBadge label="Isp" value={String(prop.isp_vac)} unit="s vacuum" tone="good" />
      </div>
    </div>
  );
}

function PhysicsPanel({ keplerEl, fuelType }: { keplerEl: KeplerianElements; fuelType: FuelType }) {
  const altitude = keplerEl.a - 6371;
  const hohmann = computeHohmann(altitude, 35786);
  const j2 = j2NodalPrecession(altitude, keplerEl.e, keplerEl.i);
  const dose = vanAllenDose(altitude, keplerEl.i);
  const density = atmosphericDensity(altitude);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 font-mono text-[11px]">
        <div className="flex justify-between text-slate-300"><span>Hohmann ΔV</span><span className="text-green-300">{hohmann.dvTotal_ms.toFixed(1)} m/s</span></div>
        <div className="mt-1 flex justify-between text-slate-300"><span>Transfer Time</span><span className="text-green-300">{hohmann.tof_days.toFixed(2)} days</span></div>
        <div className="mt-1 flex justify-between text-slate-300"><span>J2 RAAN Drift</span><span className="text-green-300">{j2.toFixed(4)} deg/day</span></div>
        <div className="mt-1 flex justify-between text-slate-300"><span>Van Allen Dose</span><span className={dose > 500 ? 'text-red-300' : 'text-green-300'}>{dose.toFixed(1)} mrad/day</span></div>
        <div className="mt-1 flex justify-between text-slate-300"><span>Atmospheric Density</span><span className="text-green-300">{density.toExponential(2)} kg/m³</span></div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <MetricBadge label="Circular Velocity" value={hohmann.v_circ1_kms.toFixed(2)} unit="km/s" />
        <MetricBadge label="Propellant" value={String(PROPELLANTS[fuelType].isp_vac)} unit="s vacuum" tone="good" />
        <MetricBadge label="Altitude" value={altitude.toFixed(0)} unit="km" />
      </div>
    </div>
  );
}

function ConjunctionPanel({ importedNodes }: { importedNodes: GeneratedMissionNode[] }) {
  const assessments = useMemo(() => {
    const results = [];
    for (let i = 0; i < importedNodes.length; i++) {
      for (let j = i + 1; j < importedNodes.length; j++) {
        results.push(assessConjunction(importedNodes[i], importedNodes[j]));
      }
    }
    return results.sort((a, b) => a.closestApproachKm - b.closestApproachKm).slice(0, 6);
  }, [importedNodes]);

  return (
    <div className="space-y-2">
      {assessments.length === 0 ? <p className="text-sm text-slate-400">Import at least two orbital states or TLEs to compute propagated closest approach.</p> : null}
      {assessments.map((threat) => {
        const tone = threat.collisionProbability > 0.1 ? 'bad' : threat.collisionProbability > 0.01 ? 'warn' : 'good';
        return (
          <div key={`${threat.objectA}-${threat.objectB}`} className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-200">{threat.objectA} vs {threat.objectB}</span>
              <MetricBadge label="CA" value={threat.closestApproachKm.toFixed(2)} unit="km" tone={tone} />
            </div>
            <p className="mt-1 text-xs text-slate-400">TCA {Math.round(threat.tcaSeconds / 60)} min | RelVel {threat.relativeVelocityKms.toFixed(2)} km/s | P {threat.collisionProbability.toExponential(2)}</p>
          </div>
        );
      })}
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('mission');
  const [missionType, setMissionType] = useState<MissionType>('lunar');
  const [fuelType, setFuelType] = useState<FuelType>('LH2');
  const [targetPlanet, setTargetPlanet] = useState('moon');
  const [launchBodyId, setLaunchBodyId] = useState('earth');
  const [launchDate, setLaunchDate] = useState(new Date().toISOString().split('T')[0]);
  const [spacecraftMass, setSpacecraftMass] = useState(26500);
  const [spacecraftThrust, setSpacecraftThrust] = useState(111200);
  const [windSpeed, setWindSpeed] = useState(0);
  const [launchLatitude, setLaunchLatitude] = useState(28.5729);
  const [launchLongitude, setLaunchLongitude] = useState(-80.649);
  const [launchAltitudeKm, setLaunchAltitudeKm] = useState(0);
  const [bodySearch, setBodySearch] = useState('');
  const [weatherData, setWeatherData] = useState<any>(null);
  const [nasaWeather, setNasaWeather] = useState<any>(null);
  const [optResult, setOptResult] = useState<OptimizationResult | null>(null);
  const [importedMissionConfig, setImportedMissionConfig] = useState<ImportedMissionConfig | null>(null);
  const [importedGraph, setImportedGraph] = useState<{ nodes: GeneratedMissionNode[]; edges: any[] } | null>(null);
  const [logLines, setLogLines] = useState<string[]>([
    '> ARTEMIS-Q analysis console ready',
    '> Live sources are labeled explicitly',
    '> Ascent optimization runs in-browser from the Vehicle tab (STL optional)',
  ]);
  const [stlAnalysis, setStlAnalysis] = useState<STLAnalysis | null>(null);
  const [stlVizGeometry, setStlVizGeometry] = useState<THREE.BufferGeometry | null>(null);
  const stlVizGeometryRef = useRef<THREE.BufferGeometry | null>(null);
  const [stlFilename, setStlFilename] = useState<string>('');
  useEffect(() => {
    stlVizGeometryRef.current = stlVizGeometry;
  }, [stlVizGeometry]);
  useEffect(() => {
    return () => {
      stlVizGeometryRef.current?.dispose();
      stlVizGeometryRef.current = null;
    };
  }, []);
  const [simResult, setSimResult] = useState<LaunchOptimizationResponse | null>(null);
  const [ascentTargetDeltaV, setAscentTargetDeltaV] = useState(9200);
  const [maxQThresholdKpa, setMaxQThresholdKpa] = useState(42);
  const [optimizing, setOptimizing] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [horizonsTrajectory, setHorizonsTrajectory] = useState<TrajectoryPoint[] | null>(null);
  const [horizonsTrajectorySource, setHorizonsTrajectorySource] = useState<string | null>(null);
  const [qaoaDepth, setQaoaDepth] = useState(3);
  const [qaoaRefreshing, setQaoaRefreshing] = useState(false);
  const [shieldingMassKg, setShieldingMassKg] = useState(180);
  const [launchOffsetHours, setLaunchOffsetHours] = useState(0);
  const [policyProfile, setPolicyProfile] = useState<PolicyProfile>('BALANCED');
  const [scenarioType, setScenarioType] = useState<ScenarioType>('NOMINAL');
  const [targetRisk, setTargetRisk] = useState(0.45);
  const [targetCostM, setTargetCostM] = useState(180);

  const [keplerEl, setKeplerEl] = useState<KeplerianElements>({
    a: 6778,
    e: 0.0008,
    i: 51.6,
    raan: 247,
    argp: 130,
    nu: 0,
  });

  const addLog = useCallback((message: string) => {
    setLogLines((previous) => [...previous.slice(-14), `> ${message}`]);
  }, []);

  const preset = MISSION_PRESETS[missionType];
  const activeGraph = importedGraph ?? { nodes: preset.nodes, edges: preset.edges };
  const altitude = keplerEl.a - 6371;
  const launchBody = CELESTIAL_BODY_MAP[launchBodyId] ?? CELESTIAL_BODY_MAP.earth;
  const bodyMatches = useMemo(() => searchBodies(bodySearch), [bodySearch]);
  const currentDose = vanAllenDose(altitude, keplerEl.i);
  const localGravity = getDateAdjustedLocalGravity(launchBody, launchLatitude, launchLongitude, launchAltitudeKm, new Date(launchDate));
  const targetBody = CELESTIAL_BODY_MAP[targetPlanet] ?? CELESTIAL_BODY_MAP.moon;

  useEffect(() => {
    const fetchAll = async () => {
      try {
        let wx: any = { source: 'NOT APPLICABLE' };
        if (launchBodyId === 'earth') {
          const wxRes = await fetch(`/api/weather?lat=${launchLatitude}&lon=${launchLongitude}`);
          wx = await wxRes.json();
        }
        const nasaRes = await fetch('/api/space-weather');
        const nasa = await nasaRes.json();
        setWeatherData(wx);
        setNasaWeather(nasa);
        if (wx.wind_speed) setWindSpeed(Math.round(wx.wind_speed / 3.6));
        addLog(`Surface weather: ${wx.source ?? 'NOT APPLICABLE'}`);
        addLog(`Space weather: ${nasa.source}`);
      } catch (error) {
        addLog('Data fetch failed; source status remains explicit');
      }
    };
    fetchAll();
  }, [addLog, launchBodyId, launchLatitude, launchLongitude]);

  useEffect(() => {
    if (optResult?.totalDeltaV_ms && Number.isFinite(optResult.totalDeltaV_ms) && optResult.totalDeltaV_ms > 0) {
      setAscentTargetDeltaV(Math.round(optResult.totalDeltaV_ms));
    }
  }, [optResult?.totalDeltaV_ms]);

  const handleScenarioChange = (scenarioId: string) => {
    const scenario = MISSION_SCENARIOS.find((item) => item.id === scenarioId);
    if (!scenario) return;
    setTargetPlanet(scenario.target);
    setMissionType(scenario.mode as MissionType);
    setFuelType(scenario.fuel as FuelType);
    setLaunchDate(scenario.date);
    setSpacecraftMass(scenario.mass);
    setSpacecraftThrust(scenario.thrust);
    setLaunchBodyId('earth');
    setOptResult(null);
    addLog(`Scenario loaded: ${scenario.name}`);
  };

  const handleOptimize = async () => {
    setOptimizing(true);
    try {
      const response = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes: activeGraph.nodes,
          edges: activeGraph.edges,
          weights: { fuel: 3.0, rad: 5.0, comm: 2.0, safety: 4.0 },
          start: activeGraph.nodes[0]?.id ?? preset.start,
          end: activeGraph.nodes[activeGraph.nodes.length - 1]?.id ?? preset.end,
          steps: Math.max(2, activeGraph.nodes.length),
          date: launchDate,
          radiationIndex: nasaWeather?.radiationIndex || 1.0,
          isp_s: PROPELLANTS[fuelType].isp_vac,
          spacecraft_mass_kg: spacecraftMass,
          qaoa_p: qaoaDepth,
          missionProfile: {
            launchOffsetHours,
            launchWindowOffsetsHours: [0, 6, 12, 24, 36],
            shieldingMassKg,
            habitatAreaM2: Math.max(10, (stlAnalysis?.surfaceArea ?? 90) * 0.2),
            policyProfile,
            scenarioType,
            inverseTargetRisk: targetRisk,
            inverseTargetCost: targetCostM * 1_000_000,
          },
        }),
      });
      const data = await response.json();
      setOptResult(data);
      addLog(`Mission optimization complete: ${data.qaoa.layers.length} QAOA layers`);
      addLog(`Quantum tab remains simulated; routing cost still uses preset graph data`);
    } catch (error) {
      addLog('Mission optimization failed');
    } finally {
      setOptimizing(false);
    }
  };

  const rerunQAOA = useCallback(async (nextDepth: number) => {
    if (!optResult?.path?.length) return;
    setQaoaRefreshing(true);
    try {
      const response = await fetch('/api/qaoa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bestPath: optResult.path,
          nodes: activeGraph.nodes,
          edges: activeGraph.edges,
          weights: { fuel: 3.0, rad: 5.0, comm: 2.0, safety: 4.0 },
          qaoa_p: nextDepth,
          isp_s: PROPELLANTS[fuelType].isp_vac,
          spacecraft_mass_kg: spacecraftMass,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'QAOA refresh failed');
      setOptResult((previous) => previous ? { ...previous, qaoa: data.qaoa, circuitMap: data.circuitMap } : previous);
      addLog(`QAOA rerun complete at depth p=${nextDepth}`);
    } catch (error) {
      addLog(error instanceof Error ? error.message : 'QAOA refresh failed');
    } finally {
      setQaoaRefreshing(false);
    }
  }, [optResult, activeGraph.nodes, activeGraph.edges, fuelType, spacecraftMass, addLog]);

  const handleStlUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const analyzer = new STLAnalyzer();
      const { analysis, geometry } = await analyzer.parseWithGeometry(file);
      setStlVizGeometry((prev) => {
        prev?.dispose();
        return geometry;
      });
      setStlAnalysis(analysis);
      setStlFilename(file.name);
      addLog(`STL parsed: ${file.name}`);
      addLog(`Derived frontal area ${analysis.frontalArea.toFixed(2)} m² and Cd ${analysis.dragCoeff.toFixed(2)}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      addLog(`STL parsing failed: ${detail}`);
      setStlAnalysis(null);
      setStlFilename('');
      setStlVizGeometry((prev) => {
        prev?.dispose();
        return null;
      });
    } finally {
      event.target.value = '';
    }
  };

  const handleMissionConfigImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const config = JSON.parse(text);
      setImportedMissionConfig(config);
      if (config.launchBodyId) setLaunchBodyId(config.launchBodyId);
      if (config.targetBodyId) setTargetPlanet(config.targetBodyId);
      if (config.launchDate) setLaunchDate(config.launchDate);
      if (config.missionType) setMissionType(config.missionType);
      if (config.fuelType) setFuelType(config.fuelType);
      if (typeof config.launchLatitude === 'number') setLaunchLatitude(config.launchLatitude);
      if (typeof config.launchLongitude === 'number') setLaunchLongitude(config.launchLongitude);
      if (typeof config.launchAltitudeKm === 'number') setLaunchAltitudeKm(config.launchAltitudeKm);
      if (typeof config.spacecraftMass === 'number') setSpacecraftMass(config.spacecraftMass);
      if (typeof config.spacecraftThrust === 'number') setSpacecraftThrust(config.spacecraftThrust);
      const graph = buildMissionGraphFromImportedConfig(config);
      setImportedGraph(graph);
      addLog(`Mission config imported: ${file.name}`);
      addLog(`Imported ${graph.nodes.length} orbital objects and generated ${graph.edges.length} reachable edges`);
    } catch {
      addLog('Mission config import failed');
    }
  };

  const exportMissionReport = () => {
    const formalReport = optResult ? generateMissionReport({
      missionName: `${launchBodyId} to ${targetPlanet}`,
      crewRisk: optResult.crewRisk ?? { riskScore: 0, classification: 'SAFE', embarkationDecision: 'SAFE_TO_EMBARK' },
      cost: { expectedCost: optResult.stochastic?.expectedCost ?? optResult.totalCost, riskAdjustedCost: optResult.decisionCosts?.[0]?.riskAdjustedCost },
      missionDecision: optResult.missionDecision ?? { decision: 'CONTINUE', rationale: 'Mission decision unavailable.' },
      confidence: optResult.missionConfidence,
      counterfactuals: optResult.counterfactuals,
      regret: optResult.regret,
      voi: optResult.voi,
    }) : null;
    const payload = {
      exportedAt: new Date().toISOString(),
      launchBodyId,
      targetBodyId: targetPlanet,
      launchDate,
      missionType,
      fuelType,
      launchLatitude,
      launchLongitude,
      launchAltitudeKm,
      spacecraftMass,
      spacecraftThrust,
      localGravity,
      weatherData,
      nasaWeather,
      optimization: optResult,
      importedMissionConfig,
      importedGraph,
      ascent: simResult,
      stlAnalysis,
      formalReport,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `artemisq-report-${launchDate}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    addLog('Mission report exported');
  };

  const runLaunchSimulation = async () => {
    const useStl = Boolean(stlAnalysis);
    const frontalArea = stlAnalysis?.frontalArea ?? 18;
    const dragCoeff = stlAnalysis?.dragCoeff ?? 0.48;
    const stlMass = stlAnalysis?.estimatedMass ?? 0;

    if (!useStl) {
      addLog('No STL loaded — using reference aeroshell (18 m², Cd 0.48). Upload an STL to use mesh-derived geometry.');
    }

    setSimulating(true);
    setSimResult(null);
    try {
      await new Promise((r) => setTimeout(r, 0));
      const pressure = weatherData?.pressure ?? 101.325;
      const sim = new LaunchSimulator(
        spacecraftMass + stlMass,
        spacecraftThrust,
        frontalArea,
        dragCoeff,
        fuelType,
        windSpeed,
        pressure,
      );
      const result = sim.optimizeFlightPath({
        exitArea: Math.max(0.2, frontalArea * 0.16),
        propellantMassFraction: 0.88,
        targetDeltaV_ms: ascentTargetDeltaV,
        maxQThresholdKpa: maxQThresholdKpa,
        geometryHints: buildGeometryHints(stlAnalysis),
        dt: 0.5,
        maxTime: 420,
        body: {
          radiusMeters: launchBody.radiusKm * 1000,
          muMeters3s2: launchBody.muKm3s2 * 1e9,
          atmosphereScaleHeightKm: launchBody.atmosphereScaleHeightKm,
          surfaceDensityKgM3: getSurfaceDensity(launchBody.id),
        },
      });

      if (!result?.best?.steps?.length) {
        throw new Error('Ascent solver returned no trajectory steps');
      }

      setSimResult(result as LaunchOptimizationResponse);
      addLog(`Ascent optimization complete: apogee ${result.best.apogeeKm.toFixed(1)} km`);
      addLog(`Best guidance: kick ${result.best.flightPath.pitchKickSpeed} m/s, rate ${result.best.flightPath.pitchRateDegPerSec.toFixed(2)} deg/s`);
      addLog(
        explainAscentDynamics({
          ...result.best.aiSummary,
          flags: result.best.ascentFlags,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Launch simulation failed';
      addLog(`Launch simulation failed: ${message}`);
    } finally {
      setSimulating(false);
    }
  };

  const cislunarVisualizer = missionType === 'lunar' && targetPlanet === 'moon' && launchBodyId === 'earth';
  const missionKmPerUnit = cislunarVisualizer ? CISLUNAR_VIS_KM_PER_UNIT : VIS_SCENE_KM_PER_UNIT;
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    void (async () => {
      try {
        const params = new URLSearchParams({
          launchDate,
          destinationId: targetPlanet,
          launchBodyId,
          a: String(keplerEl.a),
          e: String(keplerEl.e),
          i: String(keplerEl.i),
          raan: String(keplerEl.raan),
          argp: String(keplerEl.argp),
          nu: String(keplerEl.nu),
        });
        const response = await fetch(`/api/horizons/trajectory?${params.toString()}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Horizons HTTP ${response.status}`);
        const payload = await response.json() as { trajectory?: TrajectoryPoint[]; source?: string; error?: string };
        if (payload.error) throw new Error(payload.error);
        if (!cancelled && payload.trajectory?.length) {
          setHorizonsTrajectory(payload.trajectory);
          setHorizonsTrajectorySource(payload.source ?? 'LIVE · JPL Horizons');
        }
      } catch {
        if (!cancelled) {
          setHorizonsTrajectory(null);
          setHorizonsTrajectorySource(null);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [launchDate, targetPlanet, launchBodyId, keplerEl.a, keplerEl.e, keplerEl.i, keplerEl.raan, keplerEl.argp, keplerEl.nu]);

  const missionTrajectory = useMemo(
    () => horizonsTrajectory ?? calculateArtemisTrajectory(launchDate, targetPlanet, launchBodyId, keplerEl),
    [horizonsTrajectory, launchDate, targetPlanet, launchBodyId, keplerEl],
  );
  const missionStages = useMemo(() => {
    const derived = deriveTrajectoryStages(missionTrajectory, { kmPerUnit: missionKmPerUnit });
    return derived.length
      ? derived
      : FLIGHT_SEQUENCE_TEMPLATE.map((stage, index) => ({
          sequence: index + 1,
          label: stage.label,
          progress: stage.progress,
          color: stageColor(stage.label),
          phase: stage.phase,
          driver: stage.driver,
        }));
  }, [missionTrajectory, missionKmPerUnit]);
  const vehicleTimelineStages = useMemo(
    () => deriveAscentTimelineStages(simResult, optResult?.physics.transferTime_days),
    [simResult, optResult?.physics.transferTime_days],
  );

  const ascentChartData = simResult?.best.steps.map((step) => ({
    time: step.time,
    altitude: step.altitude,
    velocity: step.velocity,
    q: step.q,
    pitch: step.pitch,
  })) ?? [];

  const annealData = optResult?.annealingHistory ?? [];

  return (
    <div className="min-h-screen bg-[#050810] text-slate-100">
      <div className="pointer-events-none fixed inset-0 opacity-[0.05]" style={{ backgroundImage: 'linear-gradient(to right, rgba(75,156,211,0.2) 1px, transparent 1px), linear-gradient(to bottom, rgba(75,156,211,0.2) 1px, transparent 1px)', backgroundSize: '42px 42px' }} />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-[1600px] flex-col px-4 py-4">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-black/40 px-5 py-4 backdrop-blur">
          <div>
            <h1 className="text-xl font-bold uppercase tracking-[0.28em]">ARTEMIS-Q</h1>
            <p className="text-sm text-slate-400">Physics-informed mission analysis with explicit provenance and STL-driven ascent optimization.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(['mission', 'physics', 'vehicle', 'quantum'] as const).map((tab) => (
              <button key={tab} className={cn('rounded-md border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em]', activeTab === tab ? 'border-sky-400/60 bg-sky-400/15 text-sky-200' : 'border-slate-700 bg-slate-950/60 text-slate-300')} onClick={() => setActiveTab(tab)}>
                {tab}
              </button>
            ))}
            <select className="rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-[11px] uppercase tracking-[0.14em]" onChange={(event) => handleScenarioChange(event.target.value)} defaultValue="">
              <option value="">Scenarios</option>
              {MISSION_SCENARIOS.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>{scenario.name}</option>
              ))}
            </select>
          </div>
        </header>

        <main className="grid flex-1 gap-4 lg:grid-cols-[1.2fr_420px]">
          <section className="flex min-h-0 flex-col gap-4">
            <DashboardCard
              title={activeTab === 'vehicle' ? 'Ascent Dynamics Visualizer' : `${importedGraph ? 'Imported Mission Graph' : preset.title} Visualizer`}
              icon={activeTab === 'vehicle' ? Rocket : Globe}
              provenance={activeTab === 'vehicle' ? (simResult ? 'formula' : 'preset') : importedGraph ? 'formula' : 'preset'}
              className="flex-1"
            >
              {activeTab === 'vehicle' ? (
                simResult ? (
                  <AscentDynamicsVisualizer
                    steps={simResult.best.steps.map((s) => ({
                      time: s.time,
                      altitude: s.altitude,
                      downrangeKm: s.downrangeKm,
                      q: s.q,
                      velocity: s.velocity,
                      dragN: s.dragN,
                      pitch: s.pitch,
                      mach: s.mach,
                      stress: s.stress,
                    }))}
                    mecoTime={simResult.best.mecoTime}
                    missionStages={vehicleTimelineStages}
                    transferTimeDays={optResult?.physics.transferTime_days}
                    stlGeometry={stlVizGeometry}
                    stressConcentrations={stlAnalysis?.stressConcentrations}
                    principalAxis={stlAnalysis?.principalAxis ?? 'y'}
                  />
                ) : (
                  <div className="flex h-[420px] flex-col items-center justify-center gap-2 rounded-xl border border-slate-800 bg-black/40 px-6 text-center">
                    <p className="text-sm text-slate-300">
                      On this tab, click <span className="font-medium text-sky-200">Run STL-Based Ascent Optimization</span> (right column). The trajectory appears here after the run; upload an STL first if you want mesh-derived area and drag.
                    </p>
                    {stlAnalysis ? (
                      <p className="text-xs text-sky-200/90">Mesh ready ({stlFilename}) — press Run to compute the ascent.</p>
                    ) : (
                      <p className="max-w-md text-xs text-slate-500">
                        Without an STL, the solver uses a reference 18 m² / Cd 0.48 vehicle. The plot uses q = ½ρv² along the path (blue → red).
                      </p>
                    )}
                  </div>
                )
              ) : (
                <>
                  <div className="h-[420px] overflow-hidden rounded-xl border border-slate-800 bg-black/40">
                    <Canvas>
                      <PerspectiveCamera makeDefault position={cislunarVisualizer ? [0, 72, 520] : [0, 80, 500]} />
                      <OrbitControls minDistance={cislunarVisualizer ? 55 : 80} maxDistance={cislunarVisualizer ? 2200 : 1200} />
                      <ambientLight intensity={0.45} />
                      <pointLight position={[500, 200, 200]} intensity={1.2} color="#fff9db" />
                      <MissionGlobe launchDate={launchDate} targetPlanetId={targetPlanet} launchBodyId={launchBodyId} preset={{ ...preset, nodes: activeGraph.nodes }} pathNodeIds={optResult?.path ?? []} keplerEl={keplerEl} stageList={missionStages} trajectory={missionTrajectory} />
                    </Canvas>
                  </div>
                  <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                    {cislunarVisualizer ? (
                      <>
                        Cislunar view: 1 unit ≈ {CISLUNAR_VIS_KM_PER_UNIT.toLocaleString()} km (Earth radius ≈ {(RE / CISLUNAR_VIS_KM_PER_UNIT).toFixed(1)} units). Moon position from a truncated Meeus-style ephemeris; Moon sphere is slightly enlarged for readability. Transfer uses Hohmann TOF with direction blending along LEO→Moon.
                      </>
                    ) : (
                      <>
                        Heliocentric bodies are shown relative to Earth at the selected date (same scale as orbit polynomials in <code className="text-slate-400">celestial.ts</code>). Trajectory is a smooth guide curve, not a patched-conic solve.
                      </>
                    )}
                    {horizonsTrajectorySource ? <span className="ml-1 text-sky-300">Trajectory source: {horizonsTrajectorySource}.</span> : null}
                  </p>
                  {simResult ? (
                    <p className="mt-2 text-[10px] text-sky-200/90">
                      Ascent trajectory (q-colored path, Max Q / MECO) is in the top card on the{' '}
                      <button type="button" className="font-semibold underline decoration-sky-400/60 underline-offset-2 hover:text-sky-100" onClick={() => setActiveTab('vehicle')}>
                        Vehicle
                      </button>{' '}
                      tab.
                    </p>
                  ) : null}
                </>
              )}
            </DashboardCard>

            <div className="grid gap-4 lg:grid-cols-3">
              <DashboardCard title="Mission Metrics" icon={Gauge} provenance={optResult ? 'formula' : 'preset'}>
                <div className="grid grid-cols-2 gap-2">
                  <MetricBadge label="Launch Gravity" value={localGravity.toFixed(3)} unit="m/s²" tone="good" />
                  <MetricBadge label="Launch Body" value={launchBody.name} unit={launchBody.category} />
                  <MetricBadge label="Destination" value={targetBody.name} unit={targetBody.category} />
                  <MetricBadge label="Radiation Context" value={currentDose.toFixed(0)} unit="mrad/day" tone={currentDose > 500 ? 'bad' : 'warn'} />
                  {optResult ? (
                    <>
                    <MetricBadge label="Total Delta-v" value={(optResult.totalDeltaV_ms / 1000).toFixed(2)} unit="km/s" tone="good" />
                    <MetricBadge label="Propellant" value={optResult.fuelMass_kg.toFixed(0)} unit="kg" tone="warn" />
                    <MetricBadge label="Path Saving" value={`${((1 - optResult.totalCost / optResult.naiveCost) * 100).toFixed(1)}%`} unit="vs greedy" tone="good" />
                    <MetricBadge label="Dose" value={optResult.physics.vanAllenDose.toFixed(0)} unit="mrad/day" tone={optResult.physics.vanAllenDose > 500 ? 'bad' : 'warn'} />
                    <MetricBadge label="Success Prob." value={`${((optResult.stochastic?.successProbability ?? 0) * 100).toFixed(0)}%`} unit={`${optResult.stochastic?.runs ?? 0} MC runs`} tone={(optResult.stochastic?.successProbability ?? 0) > 0.8 ? 'good' : 'warn'} />
                    <MetricBadge label="E[J]" value={optResult.stochastic?.expectedCost.toFixed(1) ?? '--'} unit="expected cost" />
                    </>
                  ) : null}
                </div>
              </DashboardCard>

              <DashboardCard title="Ascent Metrics" icon={Rocket} provenance={simResult ? 'formula' : 'preset'}>
                {simResult ? (
                  <div className="grid grid-cols-2 gap-2">
                    <MetricBadge label="Apogee" value={simResult.best.apogeeKm.toFixed(1)} unit="km" tone="good" />
                    <MetricBadge label="Max-Q" value={simResult.best.maxQValue.toFixed(1)} unit="kPa" tone={simResult.best.maxQValue > 50 ? 'bad' : 'warn'} />
                    <MetricBadge label="Max Q alt" value={simResult.best.maxQAltitudeKm.toFixed(1)} unit="km" tone="good" />
                    <MetricBadge label="Peak drag" value={(simResult.best.peakDragN / 1000).toFixed(2)} unit="kN" />
                    <MetricBadge label="Peak Accel" value={simResult.best.peakAccelerationGs.toFixed(2)} unit="g" tone={simResult.best.peakAccelerationGs > 6 ? 'bad' : 'good'} />
                    <MetricBadge label="Stability" value={simResult.best.stabilityScore.toFixed(0)} unit="/100" tone={simResult.best.stabilityScore < 60 ? 'bad' : 'good'} />
                  </div>
                ) : (
                  <div className="space-y-2 text-sm text-slate-400">
                    <p>
                      Go to the <span className="font-medium text-slate-300">Vehicle</span> tab and click{' '}
                      <span className="font-medium text-slate-300">Run STL-Based Ascent Optimization</span>. The solver runs in your browser; an STL refines area, Cd, and stability heuristics but is not required.
                    </p>
                    {stlAnalysis ? (
                      <p className="text-xs text-sky-200/90">
                        STL loaded ({stlFilename || 'mesh'}) — run ascent once to fill these metrics.
                      </p>
                    ) : null}
                  </div>
                )}
              </DashboardCard>

              <DashboardCard title="Live Strip" icon={Thermometer} provenance={weatherData?.source?.startsWith('LIVE') ? 'live-api' : 'preset'}>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm text-slate-300">
                    <span className="flex items-center gap-2"><Thermometer className="h-4 w-4 text-red-300" /> Surface Temp</span>
                    <span>{weatherData?.temp?.toFixed?.(1) ?? '--'} °C</span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-slate-300">
                    <span className="flex items-center gap-2"><Wind className="h-4 w-4 text-sky-300" /> Wind</span>
                    <span>{weatherData?.wind_speed?.toFixed?.(1) ?? '--'} km/h</span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-slate-300">
                    <span>Space Radiation Index</span>
                    <span>{nasaWeather?.radiationIndex?.toFixed?.(2) ?? '--'}x</span>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-400">{weatherData?.source ?? 'Weather unavailable'}</div>
                </div>
              </DashboardCard>
            </div>

            <DashboardCard title="Analysis Console" icon={AlertTriangle}>
              <div className="h-[140px] overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/70 p-3 font-mono text-[11px]">
                {logLines.map((line, index) => (
                  <div key={index} className={cn('leading-6', line.includes('failed') ? 'text-red-300' : line.includes('complete') ? 'text-green-300' : 'text-slate-400')}>
                    {line}
                  </div>
                ))}
              </div>
            </DashboardCard>

            {optResult?.crewRisk ? (
              <>
                <div className="grid gap-4 lg:grid-cols-2">
                  <DashboardCard title="Crew Health Panel" icon={ShieldAlert} provenance="formula">
                    <div className="grid grid-cols-2 gap-2">
                      <MetricBadge label="Cumulative Dose" value={optResult.crewRisk.cumulativeDose.toFixed(2)} unit="arb. dose" tone={optResult.crewRisk.cumulativeDose > 18 ? 'bad' : 'warn'} />
                      <MetricBadge label="Peak Exposure" value={optResult.crewRisk.peakExposure.toFixed(2)} unit="dose-rate proxy" tone={optResult.crewRisk.peakExposure > 1 ? 'bad' : 'warn'} />
                      <MetricBadge label="Unsafe Duration" value={optResult.crewRisk.unsafeDuration.toFixed(1)} unit="hours" tone={optResult.crewRisk.unsafeDuration > 6 ? 'bad' : 'warn'} />
                      <MetricBadge label="Risk Score" value={optResult.crewRisk.riskScore.toFixed(2)} unit={optResult.crewRisk.classification} tone={optResult.crewRisk.riskScore > 1 ? 'bad' : optResult.crewRisk.riskScore > 0.6 ? 'warn' : 'good'} />
                    </div>
                    <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Embarkation</p>
                        <p className="text-sm text-slate-100">{optResult.crewRisk.embarkationDecision.replaceAll('_', ' ')}</p>
                      </div>
                      <StatusPill
                        value={optResult.crewRisk.classification}
                        tone={optResult.crewRisk.classification === 'SAFE' ? 'good' : optResult.crewRisk.classification === 'MONITOR' ? 'warn' : 'bad'}
                      />
                    </div>
                    <p className="mt-2 text-xs text-slate-400">
                      Dominant segment: {optResult.crewRisk.dominantSegment.nodeName} ({(optResult.crewRisk.dominantSegment.share * 100).toFixed(0)}% of cumulative modeled dose).
                    </p>
                  </DashboardCard>

                  <DashboardCard title="Mission Decision Panel" icon={AlertTriangle} provenance="formula">
                    {optResult.missionDecision ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <StatusPill
                            value={optResult.missionDecision.decision}
                            tone={optResult.missionDecision.decision === 'CONTINUE' ? 'good' : optResult.missionDecision.decision === 'REPLAN' ? 'warn' : 'bad'}
                          />
                          <StatusPill
                            value={optResult.missionDecision.urgencyLevel}
                            tone={optResult.missionDecision.urgencyLevel === 'LOW' ? 'good' : optResult.missionDecision.urgencyLevel === 'MODERATE' ? 'warn' : 'bad'}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <MetricBadge label="Risk Reduction" value={`${(optResult.missionDecision.expectedRiskReduction * 100).toFixed(0)}%`} unit="estimated" />
                          <MetricBadge label="Driver" value={optResult.medicalValidation?.dominantRiskDriver ?? '--'} unit="dominant factor" />
                          <MetricBadge label="Regret" value={optResult.regret?.regretScore.toFixed(2) ?? '--'} unit="utility gap" tone="warn" />
                          <MetricBadge label="VOI" value={optResult.voi?.valueOfWaiting.toFixed(2) ?? '--'} unit="value of waiting" tone={(optResult.voi?.valueOfWaiting ?? 0) > 0 ? 'good' : 'default'} />
                        </div>
                        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">
                          <p>{optResult.missionDecision.rationale}</p>
                          {optResult.hierarchy ? (
                            <div className="mt-2 space-y-1 text-xs text-slate-400">
                              <p>Low-level: {optResult.hierarchy.lowLevelAction}</p>
                              <p>Mid-level: {optResult.hierarchy.midLevelDecision}</p>
                              <p>High-level: {optResult.hierarchy.highLevelDecision}</p>
                            </div>
                          ) : null}
                          {optResult.missionDecision.candidateActions?.length ? (
                            <div className="mt-2 space-y-1 text-xs text-slate-400">
                              {optResult.missionDecision.candidateActions.map((action, index) => (
                                <p key={index}>• {action}</p>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400">Run mission optimization to derive continue, replan, or abort logic.</p>
                    )}
                  </DashboardCard>
                </div>

                <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
                  <DashboardCard title="Replan Comparison Board" icon={Gauge} provenance="formula">
                    <div className="space-y-3">
                      {optResult.replanOptions?.slice(0, 6).map((option) => {
                        const cost = optResult.decisionCosts?.find((item) => item.optionName === option.name);
                        const mc = optResult.decisionMonteCarlo?.find((item) => item.optionName === option.name);
                        const isPreferred = optResult.replanOptions?.[0]?.name === option.name;
                        return (
                          <div key={option.name} className={cn('rounded-xl border p-3', isPreferred ? 'border-sky-400/40 bg-sky-400/5' : 'border-slate-800 bg-slate-950/60')}>
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm text-slate-100">{option.name}</p>
                                <p className="mt-1 text-xs text-slate-400">{option.recommendation}</p>
                              </div>
                              <StatusPill value={isPreferred ? 'PRIMARY' : option.type} tone={isPreferred ? 'good' : 'default'} />
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-5">
                              <MetricBadge label="Crew Risk" value={option.newTotalMissionRisk.toFixed(2)} unit="score" tone={option.newTotalMissionRisk > 1 ? 'bad' : option.newTotalMissionRisk > 0.6 ? 'warn' : 'good'} />
                              <MetricBadge label="P(Success)" value={`${(option.probabilityOfSuccess * 100).toFixed(0)}%`} unit="point estimate" />
                              <MetricBadge label="Duration" value={`${option.missionDurationChange >= 0 ? '+' : ''}${option.missionDurationChange.toFixed(0)}`} unit="hours" />
                              <MetricBadge label="Delta-v" value={`${option.deltaVChange >= 0 ? '+' : ''}${option.deltaVChange.toFixed(0)}`} unit="m/s" />
                              <MetricBadge label="Risk Cost" value={formatMoney(cost?.riskAdjustedCost ?? 0)} unit="expected" tone="warn" />
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-2 xl:grid-cols-5">
                              <MetricBadge
                                label="Embarkation"
                                value={option.newTotalMissionRisk > 1 ? 'DO NOT EMBARK' : option.newTotalMissionRisk > 0.6 ? 'PROCEED WITH CAUTION' : 'SAFE TO EMBARK'}
                                unit="crew posture"
                                tone={option.newTotalMissionRisk > 1 ? 'bad' : option.newTotalMissionRisk > 0.6 ? 'warn' : 'good'}
                              />
                              <MetricBadge label="Direct Cost" value={formatMoney(cost?.directCost ?? 0)} unit="direct" />
                              <MetricBadge label="Indirect Cost" value={formatMoney(cost?.indirectCost ?? 0)} unit="indirect" />
                              <MetricBadge label="Value Score" value={(cost?.recommendationValueScore ?? 0).toExponential(2)} unit="risk / $" tone="good" />
                              <MetricBadge label="P(Unsafe)" value={`${(((mc?.probabilityUnsafe ?? 0) * 100)).toFixed(0)}%`} unit="MC estimate" tone={(mc?.probabilityUnsafe ?? 0) > 0.25 ? 'bad' : 'warn'} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </DashboardCard>

                  <DashboardCard title="Verification Summary" icon={Atom} provenance="formula">
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <MetricBadge label="Consistency" value={optResult.medicalValidation?.passedConsistencyChecks ? 'PASS' : 'REVIEW'} unit="medical checks" tone={optResult.medicalValidation?.passedConsistencyChecks ? 'good' : 'warn'} />
                        <MetricBadge label="Verification" value={optResult.verification?.verificationPassed ? 'PASS' : 'REVIEW'} unit="formal harness" tone={optResult.verification?.verificationPassed ? 'good' : 'warn'} />
                      </div>
                      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">
                        <p>{optResult.medicalValidation?.thresholdTrace ?? 'Threshold trace unavailable.'}</p>
                        <p className="mt-2 text-xs text-slate-400">{optResult.medicalValidation?.confidenceNote}</p>
                      </div>
                      <div className="space-y-1 text-xs text-slate-400">
                        {(optResult.medicalValidation?.consistencyChecks ?? []).slice(0, 3).map((check, index) => (
                          <p key={index}>• {check.name}: {check.passed ? 'pass' : 'review'}</p>
                        ))}
                        {(optResult.medicalValidation?.monotonicityChecks ?? []).slice(0, 3).map((check, index) => (
                          <p key={`m-${index}`}>• {check.name}: {check.passed ? 'pass' : 'review'}</p>
                        ))}
                      </div>
                      {optResult.decisionNarrative ? (
                        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
                          <p>{optResult.decisionNarrative.medicalRisk}</p>
                          <p className="mt-2">{optResult.decisionNarrative.operationalDecision}</p>
                          <p className="mt-2">{optResult.decisionNarrative.financialRecommendation}</p>
                          {optResult.counterfactuals?.outcomeDifferences?.slice(0, 2).map((item, index) => (
                            <p key={index} className="mt-2">{item}</p>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </DashboardCard>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <DashboardCard title="Launch & Shielding Trade Space" icon={Rocket} provenance="formula">
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <MetricBadge label="Policy" value={optResult.policy?.profile ?? policyProfile} unit="decision mode" />
                        <MetricBadge label="Confidence" value={optResult.missionConfidence?.confidenceScore.toFixed(0) ?? '--'} unit="/100" tone={(optResult.missionConfidence?.confidenceScore ?? 0) >= 70 ? 'good' : (optResult.missionConfidence?.confidenceScore ?? 0) >= 50 ? 'warn' : 'bad'} />
                        <MetricBadge label="Shielding" value={optResult.shieldingTradeoff?.shieldingMassKg.toFixed(0) ?? String(shieldingMassKg)} unit="kg" />
                        <MetricBadge label="Shield Factor" value={optResult.shieldingTradeoff?.shieldingFactor.toFixed(2) ?? '--'} unit="attenuation" tone="good" />
                        <MetricBadge label="Inverse Risk" value={optResult.inversePlanning?.expectedOutcome.risk.toFixed(2) ?? '--'} unit="targeted" />
                        <MetricBadge label="Inverse Cost" value={formatMoney(optResult.inversePlanning?.expectedOutcome.cost ?? 0)} unit="targeted" />
                      </div>
                      {optResult.launchWindows?.slice(0, 4).map((entry, index) => (
                        <div key={`${entry.window.launchTimeIso}-${index}`} className={cn('rounded-lg border px-3 py-2 text-sm', index === 0 ? 'border-sky-400/40 bg-sky-400/5 text-slate-100' : 'border-slate-800 bg-slate-950/60 text-slate-300')}>
                          <div className="flex items-center justify-between">
                            <span>Launch +{entry.window.offsetHours} h</span>
                            <span className="text-sky-200">score {entry.score.toFixed(2)}</span>
                          </div>
                          <div className="mt-1 text-xs text-slate-400">
                            Δv {entry.deltaV_ms.toFixed(0)} m/s | Radiation {entry.radiationExposure.toFixed(2)} | Comm {(entry.communicationAvailability * 100).toFixed(0)}%
                          </div>
                        </div>
                      ))}
                    </div>
                  </DashboardCard>

                  <DashboardCard title="Uncertainty & Reentry" icon={Wind} provenance="formula">
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <MetricBadge label="Reentry" value={optResult.reentry?.reentrySafe ? 'SAFE' : 'REVIEW'} unit="corridor" tone={optResult.reentry?.reentrySafe ? 'good' : 'bad'} />
                        <MetricBadge label="Reentry Risk" value={optResult.reentry?.reentryRiskScore.toFixed(1) ?? '--'} unit="/100" tone={(optResult.reentry?.reentryRiskScore ?? 0) < 30 ? 'good' : 'warn'} />
                        <MetricBadge label="Cost P50" value={formatMoney(optResult.uncertaintySummary?.cost.p50 ?? 0)} unit="MC median" />
                        <MetricBadge label="Risk P90" value={optResult.uncertaintySummary?.risk.p90.toFixed(2) ?? '--'} unit="upper band" tone="warn" />
                      </div>
                      {optResult.uncertaintySummary?.cost.histogram?.length ? (
                        <ResponsiveContainer width="100%" height={180}>
                          <BarChart data={optResult.uncertaintySummary.cost.histogram}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis dataKey="binStart" stroke="#64748b" tick={{ fontSize: 10 }} />
                            <YAxis stroke="#64748b" tick={{ fontSize: 10 }} />
                            <Tooltip contentStyle={{ background: '#020617', border: '1px solid #334155' }} />
                            <Bar dataKey="count" fill="#4B9CD3" />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : null}
                      <p className="text-xs text-slate-400">{optResult.reentry?.violationReason ?? optResult.missionConfidence?.interpretation}</p>
                    </div>
                  </DashboardCard>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <DashboardCard title="Phase Breakdown" icon={ChevronRight} provenance="formula">
                    <div className="grid grid-cols-2 gap-2">
                      <MetricBadge label="Departure" value={optResult.deltaVPhases?.phases.departure.toFixed(0) ?? '--'} unit="m/s" />
                      <MetricBadge label="Midcourse" value={optResult.deltaVPhases?.phases.midcourse.toFixed(0) ?? '--'} unit="m/s" />
                      <MetricBadge label="Flyby" value={optResult.deltaVPhases?.phases.flyby.toFixed(0) ?? '--'} unit="m/s" />
                      <MetricBadge label="Return" value={optResult.deltaVPhases?.phases.return.toFixed(0) ?? '--'} unit="m/s" />
                    </div>
                    <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
                      <p>Gravity assist bonus: {(((optResult.gravityAssist?.totalBonusFraction ?? 0) * 100)).toFixed(1)}% Δv reduction.</p>
                      <p className="mt-1">Scenario: {optResult.scenario?.type ?? scenarioType}.</p>
                      <p className="mt-1">{optResult.scenario?.summary}</p>
                    </div>
                  </DashboardCard>

                  <DashboardCard title="Stakeholder Board" icon={Globe} provenance="formula">
                    <div className="space-y-2 text-sm text-slate-300">
                      <p>{optResult.stakeholderView?.crewView}</p>
                      <p>{optResult.stakeholderView?.controlView}</p>
                      <p>{optResult.stakeholderView?.financeView}</p>
                      {optResult.policySwitch ? <p>{optResult.policySwitch.reason}</p> : null}
                      {optResult.regret ? <p>{optResult.regret.missedOpportunity}</p> : null}
                      {optResult.adaptiveNarrative ? <p>{optResult.adaptiveNarrative.bayesian}</p> : null}
                    </div>
                    {optResult.telemetry?.events?.length ? (
                      <div className="mt-3 space-y-2">
                        {optResult.telemetry.events.slice(0, 5).map((event, index) => (
                          <div key={`${event.event}-${index}`} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-400">
                            <div className="flex items-center justify-between">
                              <span>{event.event}</span>
                              <StatusPill value={event.severity} tone={event.severity === 'INFO' ? 'good' : event.severity === 'WATCH' ? 'warn' : 'bad'} />
                            </div>
                            <p className="mt-1">{event.detail}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {optResult.multiMission?.missionPlans?.length ? (
                      <div className="mt-3 space-y-2">
                        {optResult.multiMission.missionPlans.slice(0, 3).map((mission, index) => (
                          <div key={`${mission.name}-${index}`} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-400">
                            <div className="flex items-center justify-between">
                              <span>{mission.name}</span>
                              <StatusPill value={mission.funded ? 'FUNDED' : 'DEFERRED'} tone={mission.funded ? 'good' : 'warn'} />
                            </div>
                            <p className="mt-1">Portfolio score {mission.portfolioScore.toFixed(2)}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </DashboardCard>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <DashboardCard title="Digital Twin" icon={Gauge} provenance="formula">
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <MetricBadge
                          label="Twin Health"
                          value={optResult.digitalTwin?.summary.health ?? '--'}
                          unit="residual state"
                          tone={optResult.digitalTwin?.summary.health === 'TRACKING' ? 'good' : optResult.digitalTwin?.summary.health === 'WATCH' ? 'warn' : 'bad'}
                        />
                        <MetricBadge label="Residual Mean" value={optResult.digitalTwin?.summary.meanResidual.toFixed(2) ?? '--'} unit="normalized" tone="warn" />
                        <MetricBadge label="Residual Max" value={optResult.digitalTwin?.summary.maxResidual.toFixed(2) ?? '--'} unit="normalized" tone={(optResult.digitalTwin?.summary.maxResidual ?? 0) > 0.45 ? 'bad' : 'warn'} />
                        <MetricBadge label="Calibration Gain" value={optResult.calibration?.errorReduction.toFixed(2) ?? '--'} unit="RMSE reduction" tone="good" />
                      </div>
                      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
                        <p>{optResult.digitalTwin?.recommendation ?? 'Digital twin assessment unavailable.'}</p>
                        {optResult.calibration ? (
                          <p className="mt-2">
                            Applied calibration:
                            {' '}rad {optResult.calibration.appliedParameters.radiationScale.toFixed(2)}
                            {' '}| comm {optResult.calibration.appliedParameters.communicationScale.toFixed(2)}
                            {' '}| cost {optResult.calibration.appliedParameters.costScale.toFixed(2)}
                          </p>
                        ) : null}
                      </div>
                      <div className="space-y-2">
                        {(optResult.digitalTwin?.residuals ?? []).slice(0, 4).map((residual, index) => (
                          <div key={`${residual.nodeName}-${index}`} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-400">
                            <div className="flex items-center justify-between">
                              <span>{residual.nodeName}</span>
                              <StatusPill value={residual.status} tone={residual.status === 'TRACKING' ? 'good' : residual.status === 'WATCH' ? 'warn' : 'bad'} />
                            </div>
                            <p className="mt-1">
                              Rad {residual.predictedRadiation.toFixed(2)} → {residual.observedRadiation.toFixed(2)}
                              {' '}| Comm {(residual.predictedCommunication * 100).toFixed(0)}% → {(residual.observedCommunication * 100).toFixed(0)}%
                              {' '}| Risk {residual.predictedRisk.toFixed(2)} → {residual.observedRisk.toFixed(2)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </DashboardCard>

                  <DashboardCard title="Mission Command" icon={AlertTriangle} provenance="formula">
                    <div className="space-y-2">
                      {(optResult.missionCommand?.entries ?? []).slice(0, 8).map((entry, index) => (
                        <div key={`${entry.title}-${index}`} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-400">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-slate-200">{entry.title}</span>
                            <div className="flex items-center gap-2">
                              <span className="uppercase tracking-[0.12em] text-slate-500">t+{entry.timeIndex}</span>
                              <StatusPill value={entry.severity} tone={entry.severity === 'INFO' ? 'good' : entry.severity === 'WATCH' ? 'warn' : 'bad'} />
                            </div>
                          </div>
                          <p className="mt-1">{entry.detail}</p>
                          <p className="mt-1 uppercase tracking-[0.12em] text-slate-500">{entry.source.replace('_', ' ')}</p>
                        </div>
                      ))}
                    </div>
                  </DashboardCard>
                </div>
              </>
            ) : null}
          </section>

          <aside className="flex max-h-[calc(100vh-130px)] flex-col gap-4 overflow-y-auto pb-8">
            <AnimatePresence mode="wait">
              {activeTab === 'mission' ? (
                <motion.div key="mission" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex flex-col gap-4">
                  <DashboardCard title="Mission Controls" icon={Globe} provenance={importedGraph ? 'formula' : 'preset'}>
                    <div className="grid gap-3">
                      <label className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                        Search Launch Body
                        <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" type="text" list="body-suggestions" value={bodySearch} onChange={(event) => setBodySearch(event.target.value)} placeholder="Earth, Mars, Titan..." />
                        <datalist id="body-suggestions">
                          {CELESTIAL_BODIES.map((body) => <option key={body.id} value={body.name} />)}
                        </datalist>
                      </label>
                      <label className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                        Launch Body
                        <select className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" value={launchBodyId} onChange={(event) => setLaunchBodyId(event.target.value)}>
                          {bodyMatches.map((body) => (
                            <option key={body.id} value={body.id}>{body.name}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                        Mission Type
                        <select className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" value={missionType} onChange={(event) => setMissionType(event.target.value as MissionType)}>
                          <option value="lunar">Lunar</option>
                          <option value="orbital">Orbital</option>
                          <option value="rover">Rover</option>
                        </select>
                      </label>
                      <label className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                        Target
                        <select className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" value={targetPlanet} onChange={(event) => setTargetPlanet(event.target.value)}>
                          {CELESTIAL_BODIES.map((planet) => (
                            <option key={planet.id} value={planet.id}>{planet.name}</option>
                          ))}
                        </select>
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        <label className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                          Latitude
                          <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-slate-100" type="number" value={launchLatitude} onChange={(event) => setLaunchLatitude(+event.target.value)} />
                        </label>
                        <label className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                          Longitude
                          <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-slate-100" type="number" value={launchLongitude} onChange={(event) => setLaunchLongitude(+event.target.value)} />
                        </label>
                        <label className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                          Altitude
                          <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-slate-100" type="number" value={launchAltitudeKm} onChange={(event) => setLaunchAltitudeKm(+event.target.value)} />
                        </label>
                      </div>
                      <label className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                        Launch Date
                        <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" type="date" value={launchDate} onChange={(event) => setLaunchDate(event.target.value)} />
                      </label>
                      <label className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                        Launch Window Offset
                        <select className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" value={launchOffsetHours} onChange={(event) => setLaunchOffsetHours(+event.target.value)}>
                          {[0, 6, 12, 24, 36].map((offset) => (
                            <option key={offset} value={offset}>+{offset} h</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                        Mission Policy
                        <select className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" value={policyProfile} onChange={(event) => setPolicyProfile(event.target.value as PolicyProfile)}>
                          <option value="CREW_FIRST">Crew First</option>
                          <option value="BALANCED">Balanced</option>
                          <option value="COST_FIRST">Cost First</option>
                        </select>
                      </label>
                      <label className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                        Stress Scenario
                        <select className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" value={scenarioType} onChange={(event) => setScenarioType(event.target.value as ScenarioType)}>
                          <option value="NOMINAL">Nominal</option>
                          <option value="SOLAR_STORM">Solar Storm</option>
                          <option value="COMM_BLACKOUT">Comm Blackout</option>
                          <option value="PROPULSION_ANOMALY">Propulsion Anomaly</option>
                          <option value="DELAYED_LAUNCH">Delayed Launch</option>
                        </select>
                      </label>
                      <label className="block text-[10px] uppercase tracking-[0.14em] text-slate-400">
                        <div className="mb-1 flex items-center justify-between">
                          <span>Shielding Mass</span>
                          <span className="text-sky-200">{shieldingMassKg.toFixed(0)} kg</span>
                        </div>
                        <input className="w-full" type="range" min={0} max={1200} step={20} value={shieldingMassKg} onChange={(event) => setShieldingMassKg(+event.target.value)} />
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                          Target Risk
                          <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" type="number" min={0.1} max={1.5} step={0.01} value={targetRisk} onChange={(event) => setTargetRisk(+event.target.value)} />
                        </label>
                        <label className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                          Target Cost
                          <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" type="number" min={10} step={5} value={targetCostM} onChange={(event) => setTargetCostM(+event.target.value)} />
                          <span className="mt-1 block text-[10px] text-slate-500">$M</span>
                        </label>
                      </div>
                      <label className="flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-950/50 px-4 py-3 text-sm text-slate-300">
                        Import Mission Config
                        <input className="hidden" type="file" accept=".json" onChange={handleMissionConfigImport} />
                      </label>
                      <button className="rounded-lg border border-sky-400/30 bg-sky-400/10 px-4 py-3 text-sm font-semibold text-sky-200 disabled:opacity-50" onClick={handleOptimize} disabled={optimizing}>
                        {optimizing ? 'Optimizing Mission...' : 'Run Mission Optimization'}
                      </button>
                      <button className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm font-semibold text-emerald-200" onClick={exportMissionReport}>
                        Export Mission Report
                      </button>
                    </div>
                  </DashboardCard>

                  <DashboardCard title="Flight Sequence" icon={Rocket} provenance="formula">
                    <div className="space-y-2">
                      {missionStages.map((stage) => (
                        <div key={stage.label} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-slate-950" style={{ background: stage.color }}>
                            {stage.sequence}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-slate-100">{stage.label}</p>
                            <p className="text-xs text-slate-400">{stage.phase}</p>
                            {stage.driver ? <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{stage.driver}</p> : null}
                            <div className="mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.12em] text-slate-500">
                              {stage.distanceKm != null ? <span>{stage.distanceKm.toLocaleString(undefined, { maximumFractionDigits: 0 })} km</span> : null}
                              {stage.fuelRemainingPct != null ? <span>{stage.fuelRemainingPct}% fuel reserve</span> : null}
                              {stage.timeS != null ? <span>T+{(stage.timeS / 3600).toFixed(1)} h</span> : null}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </DashboardCard>

                  <DashboardCard title="Route Output" icon={ChevronRight} provenance={importedGraph ? 'formula' : optResult ? 'formula' : 'preset'}>
                    {optResult ? (
                      <div className="space-y-3">
                        <div className="flex flex-wrap gap-1">
                          {optResult.path.map((nodeId, index) => (
                            <span key={nodeId + index} className="flex items-center gap-1">
                              <span className="rounded-md border border-sky-400/30 bg-sky-400/10 px-2 py-1 text-[11px] text-sky-100">{nodeId}</span>
                              {index < optResult.path.length - 1 ? <ChevronRight className="h-3 w-3 text-slate-600" /> : null}
                            </span>
                          ))}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <MetricBadge label="Anneal Steps" value={optResult.quboGraph.annealingSteps.toLocaleString()} />
                          <MetricBadge label="QUBO Vars" value={String(optResult.quboGraph.binaryVars)} />
                          <MetricBadge label="Violations" value={String(optResult.constraintViolations?.length ?? 0)} tone={(optResult.constraintViolations?.length ?? 0) > 0 ? 'warn' : 'good'} />
                          <MetricBadge label="QUBO Terms" value={String(optResult.quboGraph.nonZeroTerms ?? '--')} />
                        </div>
                        {optResult.explanation?.summary?.length ? (
                          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">
                            {optResult.explanation.summary.map((line, index) => (
                              <p key={index} className={index > 0 ? 'mt-1' : ''}>{line}</p>
                            ))}
                          </div>
                        ) : null}
                        {optResult.benchmarks ? (
                          <div className="space-y-2">
                            {[optResult.benchmarks.optimized, optResult.benchmarks.shortestPath, optResult.benchmarks.greedy].map((benchmark) => (
                              <div key={benchmark.label} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-300">
                                <div className="flex items-center justify-between">
                                  <span>{benchmark.label}</span>
                                  <span className="text-sky-200">{benchmark.totalCost.toFixed(1)}</span>
                                </div>
                                <div className="mt-1 text-xs text-slate-400">
                                  Violations {benchmark.constraintViolations} | Success {(benchmark.successProbability * 100).toFixed(0)}%
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400">{importedGraph ? 'Imported orbital states loaded. Run optimization to solve on generated reachable edges.' : 'Import a mission config with `orbitalObjects` or `tleObjects` to replace the preset graph.'}</p>
                    )}
                  </DashboardCard>

                  <DashboardCard title="Provenance Audit" icon={ShieldAlert}>
                    <SourceStatus weatherData={weatherData} nasaWeather={nasaWeather} stlAnalysis={stlAnalysis} simResult={simResult} />
                  </DashboardCard>
                </motion.div>
              ) : null}

              {activeTab === 'physics' ? (
                <motion.div key="physics" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex flex-col gap-4">
                  <DashboardCard title="Keplerian Controls" icon={Gauge} provenance="formula">
                    <div className="space-y-3">
                      {([
                        { key: 'a', label: 'Semi-major axis', min: 6571, max: 42164, step: 10, suffix: 'km' },
                        { key: 'e', label: 'Eccentricity', min: 0, max: 0.9, step: 0.001, suffix: '' },
                        { key: 'i', label: 'Inclination', min: 0, max: 180, step: 0.1, suffix: 'deg' },
                        { key: 'raan', label: 'RAAN', min: 0, max: 360, step: 0.5, suffix: 'deg' },
                        { key: 'argp', label: 'Arg Perigee', min: 0, max: 360, step: 0.5, suffix: 'deg' },
                        { key: 'nu', label: 'True Anomaly', min: 0, max: 360, step: 1, suffix: 'deg' },
                      ] as const).map((item) => (
                        <label key={item.key} className="block text-[10px] uppercase tracking-[0.14em] text-slate-400">
                          <div className="mb-1 flex items-center justify-between">
                            <span>{item.label}</span>
                            <span className="text-sky-200">{String(keplerEl[item.key as keyof KeplerianElements])} {item.suffix}</span>
                          </div>
                          <input className="w-full" type="range" min={item.min} max={item.max} step={item.step} value={keplerEl[item.key as keyof KeplerianElements] as number} onChange={(event) => setKeplerEl((prev) => ({ ...prev, [item.key]: +event.target.value }))} />
                        </label>
                      ))}
                    </div>
                  </DashboardCard>

                  <DashboardCard title="Orbital Physics" icon={Globe} provenance="formula">
                    <PhysicsPanel keplerEl={keplerEl} fuelType={fuelType} />
                  </DashboardCard>

                  <DashboardCard title="STL Aerodynamics" icon={Wind} provenance={stlAnalysis ? 'formula' : 'preset'}>
                    <AeroDynamicsVisualizer stlGeometry={stlVizGeometry} stlAnalysis={stlAnalysis} />
                  </DashboardCard>

                  <DashboardCard title="Conjunction Panel" icon={ShieldAlert} provenance={importedGraph ? 'formula' : 'preset'}>
                    <ConjunctionPanel importedNodes={importedGraph?.nodes ?? []} />
                  </DashboardCard>

                  <DashboardCard title="Fuel Calculator" icon={Rocket} provenance="formula">
                    <FuelCalculator fuelType={fuelType} />
                  </DashboardCard>
                </motion.div>
              ) : null}

              {activeTab === 'vehicle' ? (
                <motion.div key="vehicle" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex flex-col gap-4">
                  <DashboardCard title="Vehicle Inputs" icon={Upload} provenance={stlAnalysis ? 'formula' : 'preset'}>
                    <div className="space-y-3">
                      <label className="block">
                        <span className="mb-2 block text-[10px] uppercase tracking-[0.14em] text-slate-400">Upload STL</span>
                        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-600 bg-slate-950/60 px-4 py-6 text-sm text-slate-300">
                          <Upload className="h-4 w-4" />
                          {stlFilename || 'Choose a rocket STL'}
                          <input className="hidden" type="file" accept=".stl" onChange={handleStlUpload} />
                        </label>
                      </label>

                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                          Vehicle Mass
                          <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" type="number" value={spacecraftMass} onChange={(event) => setSpacecraftMass(+event.target.value)} />
                        </label>
                        <label className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                          Thrust
                          <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" type="number" value={spacecraftThrust} onChange={(event) => setSpacecraftThrust(+event.target.value)} />
                        </label>
                        <label className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                          Fuel
                          <select className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" value={fuelType} onChange={(event) => setFuelType(event.target.value as FuelType)}>
                            <option value="LH2">LH2</option>
                            <option value="RP-1">RP-1</option>
                            <option value="Methane">Methane</option>
                          </select>
                        </label>
                        <label className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                          Wind
                          <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" type="number" value={windSpeed} onChange={(event) => setWindSpeed(+event.target.value)} />
                        </label>
                        <label className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                          Ascent ΔV (Tsiolkovsky)
                          <input
                            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                            type="number"
                            value={ascentTargetDeltaV}
                            onChange={(event) => setAscentTargetDeltaV(+event.target.value)}
                            title="Propellant mass uses the same rocket equation as the Fuel calculator: m_prop = m₀(1 − e^(−Δv/(Isp·g₀)))."
                          />
                        </label>
                        <label className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                          Max Q limit (kPa)
                          <input
                            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                            type="number"
                            value={maxQThresholdKpa}
                            onChange={(event) => setMaxQThresholdKpa(+event.target.value)}
                          />
                        </label>
                      </div>

                      <p className="text-[10px] leading-snug text-slate-500">
                        Ascent runs <span className="text-slate-300">in your browser</span> (no API required). Mission routing still uses <code className="text-slate-400">npm run dev</code> for <code className="text-slate-400">/api/optimize</code>. Without an STL, a reference 18 m² / Cd 0.48 vehicle is used.
                      </p>
                      <button type="button" className="w-full rounded-lg border border-sky-400/30 bg-sky-400/10 px-4 py-3 text-sm font-semibold text-sky-200 disabled:opacity-50" onClick={() => void runLaunchSimulation()} disabled={simulating}>
                        {simulating ? 'Optimizing Flight Path...' : 'Run STL-Based Ascent Optimization'}
                      </button>
                    </div>
                  </DashboardCard>

                  <DashboardCard title="STL-Derived Geometry" icon={Rocket} provenance={stlAnalysis ? 'formula' : 'preset'}>
                    {stlAnalysis ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <MetricBadge label="Frontal Area" value={stlAnalysis.frontalArea.toFixed(2)} unit="m²" />
                          <MetricBadge label="Drag Coefficient" value={stlAnalysis.dragCoeff.toFixed(2)} unit="estimated" tone="warn" />
                          <MetricBadge label="Volume" value={stlAnalysis.volume.toFixed(2)} unit="m³" />
                          <MetricBadge label="Est. Mass" value={stlAnalysis.estimatedMass.toFixed(0)} unit="kg" />
                          <MetricBadge label="Surface Area" value={stlAnalysis.surfaceArea.toFixed(2)} unit="m²" />
                          <MetricBadge label="Strength" value={(stlAnalysis.materialStrength / 1e6).toFixed(0)} unit="MPa" />
                          <MetricBadge label="Axis" value={stlAnalysis.principalAxis.toUpperCase()} unit="principal body axis" />
                          <MetricBadge label="Center Pressure" value={stlAnalysis.centerOfPressure.map((v) => v.toFixed(2)).join(', ')} unit="mesh coordinates" />
                        </div>
                        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                          <p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-slate-400">Mesh Panel Aero / Stress Distribution</p>
                          <div className="space-y-2">
                            {stlAnalysis.panelLoads.map((panel, index) => (
                              <div key={index}>
                                <div className="mb-1 flex justify-between text-xs text-slate-400">
                                  <span>Station {(panel.station * 100).toFixed(0)}%</span>
                                  <span>Cp {panel.loadCoefficient.toFixed(2)} | σ {(panel.stressPa / 1e6).toFixed(1)} MPa</span>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                                  <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-amber-400" style={{ width: `${Math.min(100, Math.max(panel.loadCoefficient * 55, (panel.stressPa / Math.max(1, stlAnalysis.materialStrength)) * 100))}%` }} />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400">No vehicle uploaded yet. Geometry is parsed locally from the user STL.</p>
                    )}
                  </DashboardCard>

                  <DashboardCard title="Best Flight Path" icon={Gauge} provenance={simResult ? 'formula' : 'preset'}>
                    {simResult ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <MetricBadge label="Pitch Kick" value={String(simResult.best.flightPath.pitchKickSpeed)} unit="m/s" />
                          <MetricBadge label="Pitch Rate" value={simResult.best.flightPath.pitchRateDegPerSec.toFixed(2)} unit="deg/s" />
                          <MetricBadge label="Max Pitch" value={simResult.best.flightPath.maxPitchDeg.toFixed(0)} unit="deg" />
                          <MetricBadge label="Burnout V" value={simResult.best.burnoutVelocity.toFixed(0)} unit="m/s" />
                        </div>
                        <div className="space-y-2">
                          {simResult.candidates.slice(0, 4).map((candidate, index) => (
                            <div key={index} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-300">
                              <div className="flex justify-between"><span>Candidate {index + 1}</span><span className="text-sky-200">{candidate.score.toFixed(1)}</span></div>
                              <div className="mt-1 text-xs text-slate-400">Kick {candidate.flightPath.pitchKickSpeed} m/s | Rate {candidate.flightPath.pitchRateDegPerSec.toFixed(2)} deg/s | Max Pitch {candidate.flightPath.maxPitchDeg} deg</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400">The ascent solver sweeps several gravity-turn programs and returns the best candidate by apogee, stability, and Max-Q penalties.</p>
                    )}
                  </DashboardCard>

                  <DashboardCard title="Ascent Trace" icon={Wind} provenance={simResult ? 'formula' : 'preset'}>
                    {simResult ? (
                      <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={ascentChartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                          <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 10 }} />
                          <YAxis yAxisId="left" stroke="#64748b" tick={{ fontSize: 10 }} />
                          <YAxis yAxisId="right" orientation="right" stroke="#64748b" tick={{ fontSize: 10 }} />
                          <Tooltip contentStyle={{ background: '#020617', border: '1px solid #334155' }} />
                          <Legend wrapperStyle={{ fontSize: 10 }} />
                          <Line yAxisId="left" type="monotone" dataKey="altitude" stroke="#4B9CD3" dot={false} name="Altitude (km)" />
                          <Line yAxisId="left" type="monotone" dataKey="velocity" stroke="#34d399" dot={false} name="Velocity (m/s)" />
                          <Line yAxisId="right" type="monotone" dataKey="q" stroke="#f59e0b" dot={false} name="Dynamic Pressure (kPa)" />
                          <Line yAxisId="right" type="monotone" dataKey="pitch" stroke="#a78bfa" dot={false} name="Pitch (deg)" />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className="text-sm text-slate-400">The chart appears after a successful ascent run.</p>
                    )}
                  </DashboardCard>

                  <DashboardCard title="Stability & AI summary" icon={ShieldAlert} provenance={simResult ? 'formula' : 'preset'}>
                    {simResult ? (
                      <div className="space-y-3">
                        <div className="flex flex-wrap gap-2">
                          {simResult.best.ascentFlags.length ? (
                            simResult.best.ascentFlags.map((flag) => (
                              <span key={flag} className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">
                                {flag}
                              </span>
                            ))
                          ) : (
                            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-200">
                              Within heuristic thresholds
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <MetricBadge label="Max Q altitude" value={simResult.best.maxQAltitudeKm.toFixed(1)} unit="km" />
                          <MetricBadge label="Peak drag" value={(simResult.best.peakDragN / 1000).toFixed(2)} unit="kN" />
                          <MetricBadge label="AI · max_q" value={simResult.best.aiSummary.max_q_kpa.toFixed(2)} unit="kPa" />
                          <MetricBadge label="AI · stability" value={simResult.best.aiSummary.stability_score.toFixed(0)} unit="/100" />
                        </div>
                        <p className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs leading-relaxed text-slate-300">
                          {explainAscentDynamics({ ...simResult.best.aiSummary, flags: simResult.best.ascentFlags })}
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400">Run ascent optimization to populate stability flags and copilot-ready summary fields (max_q, peak_drag, stability_score).</p>
                    )}
                  </DashboardCard>
                </motion.div>
              ) : null}

              {activeTab === 'quantum' ? (
                <motion.div key="quantum" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex flex-col gap-4">
                  <DashboardCard title="Quantum Layer" icon={Atom} provenance="heuristic">
                    <div className="space-y-3 text-sm text-slate-300">
                      <p>The route optimizer still uses a classical simulated annealer with a QAOA-style visualization layer. It is not quantum hardware, and its “advantage” metric is still a comparison against the greedy baseline on preset graphs.</p>
                      {optResult ? (
                        <div className="grid grid-cols-2 gap-2">
                          <MetricBadge label="QAOA Layers" value={String(optResult.qaoa.layers.length)} />
                          <MetricBadge label="Approx Ratio" value={optResult.qaoa.approximationRatio.toFixed(4)} />
                          <MetricBadge label="Final Energy" value={optResult.qaoa.finalEnergy.toFixed(4)} />
                          <MetricBadge label="Displayed Saving" value={`${optResult.qaoa.quantumAdvantage_pct.toFixed(1)}%`} tone="warn" />
                          <MetricBadge label="QAOA Match" value={`${(optResult.qaoa.qaoaMatchPct ?? 0).toFixed(1)}%`} unit="feasible-optimality proxy" tone="good" />
                          <MetricBadge label="SA Improvement" value={`${(optResult.qaoa.classicalSAImprovement_pct ?? optResult.qaoa.quantumAdvantage_pct).toFixed(1)}%`} unit="vs baseline" />
                        </div>
                      ) : null}
                      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                        <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-slate-400">
                          <span>QAOA Depth</span>
                          <span>p = {qaoaDepth}</span>
                        </div>
                        <input
                          className="w-full"
                          type="range"
                          min={1}
                          max={6}
                          step={1}
                          value={qaoaDepth}
                          onChange={(event) => setQaoaDepth(+event.target.value)}
                          onMouseUp={() => rerunQAOA(qaoaDepth)}
                          onTouchEnd={() => rerunQAOA(qaoaDepth)}
                          disabled={!optResult || qaoaRefreshing}
                        />
                        <p className="mt-2 text-xs text-slate-500">
                          Uses the pulled `/api/qaoa` rerun path so QAOA diagnostics can update without re-running the full annealer.
                        </p>
                      </div>
                    </div>
                  </DashboardCard>

                  <DashboardCard title="Quantum Circuit" icon={Atom} provenance={optResult ? 'formula' : 'preset'}>
                    <QuantumCircuit gates={optResult?.circuitMap ?? []} />
                  </DashboardCard>

                  <DashboardCard title="State Distribution" icon={Gauge} provenance={optResult ? 'formula' : 'preset'}>
                    <QuantumDistribution distribution={optResult?.qaoa.distribution} />
                  </DashboardCard>

                  <DashboardCard title="Annealing History" icon={Atom} provenance={optResult ? 'formula' : 'preset'}>
                    {optResult ? (
                      <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={annealData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                          <XAxis dataKey="step" stroke="#64748b" tick={{ fontSize: 10 }} />
                          <YAxis stroke="#64748b" tick={{ fontSize: 10 }} />
                          <Tooltip contentStyle={{ background: '#020617', border: '1px solid #334155' }} />
                          <Legend wrapperStyle={{ fontSize: 10 }} />
                          <Line type="monotone" dataKey="energy" stroke="#4B9CD3" dot={false} name="Energy" />
                          <Line type="monotone" dataKey="temperature" stroke="#f59e0b" dot={false} name="Temperature" />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className="text-sm text-slate-400">Run mission optimization to inspect the annealing trace.</p>
                    )}
                  </DashboardCard>

                  <DashboardCard title="Reality Boundary" icon={ShieldAlert}>
                    <div className="space-y-2 text-sm text-slate-300">
                      <p>What is mathematically grounded now:</p>
                      <ul className="list-disc pl-5 text-slate-400">
                        <li>Hohmann transfer, Tsiolkovsky, J2 drift, atmosphere, and the 2D ascent solver.</li>
                        <li>STL-derived frontal area, surface area, volume, and a coarse drag estimate.</li>
                      </ul>
                      <p>What is still not NASA-grade:</p>
                      <ul className="list-disc pl-5 text-slate-400">
                        <li>Mission node graph values remain preset.</li>
                        <li>Conjunction panel is still a shell-spacing heuristic.</li>
                        <li>Quantum view is still explanatory, not operational.</li>
                      </ul>
                    </div>
                  </DashboardCard>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </aside>
        </main>
      </div>
    </div>
  );
}
