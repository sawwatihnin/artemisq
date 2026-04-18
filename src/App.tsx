import type { ChangeEvent, ReactNode, RefObject } from 'react';
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
import { Canvas, useThree } from '@react-three/fiber';
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
import {
  CELESTIAL_BODIES,
  CELESTIAL_BODY_MAP,
  getApproximateHeliocentricPosition,
  getDateAdjustedLocalGravity,
  heliocentricHorizonsKmToScene,
  searchBodies,
} from './lib/celestial';
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
type VisualizerViewMode = 'fit' | 'launch' | 'target' | 'reset';

interface ExternalConjunctionThreat {
  objectA: string;
  objectB: string;
  tcaSeconds: number;
  closestApproachKm: number;
  relativeVelocityKms: number;
  collisionProbability: number;
}

interface ExternalConjunctionFeed {
  conjunctions: ExternalConjunctionThreat[];
  source: string;
}

interface ExternalEventFeed {
  total: number;
  events: Array<{ id: string; title: string }>;
  categoryCounts: Record<string, number>;
  source: string;
}

interface ExternalTelemetryFeed {
  frame: {
    timestamp: string;
    source: string;
    commMarginDb?: number;
    radiationDoseRate?: number;
    subsystemFlags?: string[];
  } | null;
  source: string;
}

interface DsnVisibilityFeed {
  windows: Array<{
    stationId: string;
    stationName: string;
    startTime: string;
    endTime: string;
    durationMinutes: number;
    maxElevationDeg: number;
  }>;
  source: string;
}

interface SolarBodyFeed {
  id: string;
  name?: string;
  englishName?: string;
  bodyType?: string;
  gravity?: number;
  meanRadius?: number;
  semimajorAxis?: number;
  sideralOrbit?: number;
  sideralRotation?: number;
  eccentricity?: number;
  inclination?: number;
  axialTilt?: number;
  color?: string;
  atmosphereScaleHeightKm?: number;
}

interface SolarBodiesFeed {
  bodies: SolarBodyFeed[];
  source: string;
}

interface SystemEphemerisFeed {
  bodies: Array<{ id: string; x: number; y: number; z: number; jd: number }>;
  centerBodyId: string;
  date: string;
  source: string;
}

interface NearEarthRadiationFeed {
  fetchedAt?: string;
  environment: {
    aggregateIndex: number;
    zones: Array<{ label: string; innerRadiusKm: number; outerRadiusKm: number; severity: number; color: string }>;
    notes: string[];
    source: string;
  };
  goes?: {
    stormLevel?: string;
    protonFlux10MeV?: number;
    electronFluxGeo?: number;
    observedAt?: string | null;
  };
  donki?: {
    eventCount?: number;
    severeFlareCount?: number;
    sepCount?: number;
    radiationBoost?: number;
    windowEnd?: string;
  };
  source: string;
}

interface RadiationIntersectionFeed {
  assessment: {
    totalTraversedDistanceKm: number;
    totalWeightedExposureScore: number;
    normalizedRiskIndex: number;
    maxZoneSeverity: number;
    crossings: number;
    zoneIntersections: Array<{
      label: string;
      severity: number;
      entered: boolean;
      samplesInside: number;
      peakRadiusKm: number;
      traversedDistanceKm: number;
      weightedExposureScore: number;
    }>;
  };
  source: string;
}

interface CislunarOpsFeed {
  analysis: {
    lane: 'CREWED_CISLUNAR_MISSION_OPS';
    dose: {
      cumulativeDoseMsv: number;
      peakDoseRateMsvHr: number;
      beltDoseMsv: number;
      deepSpaceDoseMsv: number;
      safeHavenRequired: boolean;
      safeHavenWindows: Array<{ startHour: number; endHour: number; reason: string }>;
    };
    lighting: {
      eclipseFraction: number;
      longestEclipseHours: number;
      betaAngleDeg: number;
      eclipseIntervals: Array<{ startHour: number; endHour: number; body: 'EARTH' | 'MOON' }>;
    };
    consumables: {
      missionDurationHours: number;
      oxygenUsedKg: number;
      waterUsedKg: number;
      foodUsedKg: number;
      powerGeneratedKWh: number;
      powerConsumedKWh: number;
      batteryDrawKWh: number;
      commCoverageFraction: number;
      lifeSupportMarginHours: number;
      propellantReservePolicyPct: number;
    };
    goNoGo: {
      overall: 'GO' | 'CONDITIONAL' | 'NO_GO';
      rationale: string;
      rules: Array<{ rule: string; status: 'GO' | 'WATCH' | 'NO_GO'; value: number | string; threshold: string; rationale: string }>;
    };
    provenance: string[];
  };
  source: string;
}

interface GravityInfluenceFeed {
  assessments: Array<{
    bodyId: string;
    bodyName: string;
    closestApproachKm: number;
    sphereOfInfluenceKm: number;
    maxTidalAccelerationMs2: number;
    influenceRatio: number;
    willInfluence: boolean;
  }>;
  source: string;
}

interface LaunchSiteFeed {
  sites: Array<{
    id: string;
    name: string;
    lat: number;
    lon: number;
    country: string;
    pads: Array<{ id: string; name: string; supportedVehicles: string[] }>;
  }>;
  source: string;
}

interface TrajectoryDesignFeed {
  lambert: {
    departureSpeedKmS: number;
    arrivalSpeedKmS: number;
    c3Km2S2: number;
    solved: boolean;
    iterations: number;
  };
  patchedConic: {
    departureDeltaVKmS: number;
    arrivalDeltaVKmS: number;
    totalDeltaVKmS: number;
  };
  phasing: {
    bestDelayHours: number;
    residualDeg: number;
    synodicPeriodDays: number;
  };
  gravityAssistSequences: Array<{
    sequence: string[];
    score: number;
    estimatedDeltaVGainKmS: number;
    estimatedTimeDays: number;
  }>;
  abortBranches: Array<{
    label: string;
    branchType: 'FREE_RETURN' | 'DIRECT_RETURN' | 'SAFE_HAVEN';
    deltaVKmS: number;
    timeToRecoveryDays: number;
    riskModifier: number;
  }>;
  reservePolicy: {
    propellantReservePct: number;
    reserveDeltaVKmS: number;
    rationale: string;
  };
  launchWindows: Array<{
    offsetHours: number;
    score: number;
    deltaVKmS: number;
    weatherScore: number;
    radiationScore: number;
    commScore: number;
  }>;
  source: string;
}

interface GroundConstraintFeed {
  analysis: {
    launchSite: LaunchSiteFeed['sites'][number];
    padStatus: Array<{ padId: string; available: boolean; rationale: string }>;
    keepOutZones: Array<{ label: string; radiusKm: number; azimuthCenterDeg: number; azimuthHalfWidthDeg: number }>;
    recoveryCorridors: Array<{ label: string; headingDeg: number; lengthKm: number; widthKm: number }>;
    airspaceMaritimeExclusions: Array<{ label: string; footprintKm2: number; active: boolean }>;
    rangeGo: boolean;
    rationale: string;
  };
  source: string;
}

interface TimelineTaskInput {
  id: string;
  name: string;
  durationHours: number;
  earliestStartHour?: number;
  latestFinishHour?: number;
  dependencies?: string[];
  resource?: string;
}

interface TimelineSolveFeed {
  timeline: {
    tasks: Array<TimelineTaskInput & {
      scheduledStartHour: number;
      scheduledFinishHour: number;
      slackHours: number;
      critical: boolean;
    }>;
    totalDurationHours: number;
    criticalPath: string[];
    violations: string[];
  };
  source: string;
}

interface ConsumablesFeed {
  analysis: {
    timeline: Array<{
      timeHour: number;
      state: {
        powerKWh: number;
        thermalMarginC: number;
        commMinutes: number;
        propellantKg: number;
        crewHours: number;
        oxygenKg: number;
        waterKg: number;
      };
    }>;
    depleted: Array<{ resource: string; timeHour: number }>;
    finalState: {
      powerKWh: number;
      thermalMarginC: number;
      commMinutes: number;
      propellantKg: number;
      crewHours: number;
      oxygenKg: number;
      waterKg: number;
    };
  };
  source: string;
}

interface SurfaceEnvironmentFeed {
  bodyId: string;
  localSolarHour: number;
  solarElevationDeg: number;
  localGravityMs2: number;
  estimatedSurfaceTempC: number;
  daylight: boolean;
  dustOrRegolithRisk: 'LOW' | 'MODERATE' | 'HIGH';
  source: string;
}

interface LaunchConstraintFeed {
  analysis: {
    densityAtMaxQKgM3: number;
    windConstraintScore: number;
    precipitationConstraintScore: number;
    upperAtmospherePenalty: number;
    goForLaunch: boolean;
    rationale: string;
  };
  source: string;
}

interface OpsConsoleFeed {
  console: {
    status: 'NOMINAL' | 'WATCH' | 'ALERT';
    alarms: Array<{ title: string; severity: 'INFO' | 'WATCH' | 'ALERT'; detail: string }>;
  };
  source: string;
}

interface Sgp4State {
  id: string;
  name: string;
  epoch: string;
  positionKm: [number, number, number];
  velocityKmS: [number, number, number];
}

interface Sgp4PropagateFeed {
  states: Sgp4State[];
  source: string;
}

interface Sgp4ConjunctionFeed {
  conjunctions: Array<{
    objectA: string;
    objectB: string;
    tcaIso: string;
    tcaSeconds: number;
    closestApproachKm: number;
    relativeVelocityKmS: number;
    collisionProbability: number;
  }>;
  source: string;
}

interface Sgp4ResidualFeed {
  residuals: Array<{
    id: string;
    observedMinusPredictedKm: [number, number, number];
    observedMinusPredictedKmS: [number, number, number];
    positionResidualKm: number;
    velocityResidualKmS: number;
  }>;
  source: string;
}

interface CovarianceFeed {
  propagation: {
    horizonMinutes: number;
    sigmaPositionKm: number;
    sigmaVelocityKmS: number;
    radialSigmaKm: number;
    alongTrackSigmaKm: number;
    crossTrackSigmaKm: number;
    covarianceTrace: number;
    missDistance95Km: number;
    source: string;
  };
  source: string;
}

interface ManeuverTargetingFeed {
  targeting: {
    deltaVVectorKmS: [number, number, number];
    deltaVMagnitudeKmS: number;
    burnDurationS: number;
    closingVelocityKmS: number;
    estimatedArrivalErrorKm: number;
    targetingQuality: 'GOOD' | 'WATCH' | 'POOR';
    source: string;
  };
  source: string;
}

interface EvaPlanFeed {
  eva: {
    evaDurationHours: number;
    commCoverageFraction: number;
    doseDuringEvaMsv: number;
    thermalExposureIndex: number;
    consumablesMarginHours: number;
    constraintsSatisfied: boolean;
    rationale: string;
    source: string;
  };
  source: string;
}

interface FlightReviewFeed {
  report: {
    headline: string;
    readiness: 'READY' | 'CONDITIONAL' | 'NOT_READY';
    findings: string[];
    actions: string[];
    provenance: string[];
  };
  source: string;
}

interface StageConfig {
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

interface MultiStageAssessment {
  totalDeltaVKmS: number;
  stageAnalyses: Array<{
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
  }>;
  tpsPeakHeatFluxKwM2: number;
  structuralIndex: number;
  source: string;
}

interface ImportedCcsdsFeed {
  metadata: Record<string, string>;
  points: TrajectoryPoint[];
}

interface BaselineCompareFeed {
  comparison: {
    addedKeys: string[];
    removedKeys: string[];
    changedValues: Array<{ path: string; before: string; after: string }>;
    versionHashBefore: string;
    versionHashAfter: string;
  };
  beforeVersion: { versionHash: string; stablePayload: string };
  afterVersion: { versionHash: string; stablePayload: string };
  source: string;
}

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
    layers: Array<{ gamma: number; beta: number; energyExpectation: number; entropyBits?: number; participationRatio?: number }>;
    finalEnergy: number;
    approximationRatio: number;
    quantumAdvantage_pct: number;
    qaoaMatchPct?: number;
    classicalSAImprovement_pct?: number;
    distribution?: Array<{ state: string; probability: number; energy: number; isOptimal: boolean; shotCount?: number }>;
    simulation?: {
      backend: 'statevector';
      shots: number;
      qubits: number;
      basisStates: number;
      optimalProbabilityPct: number;
      gammaGridSteps: number;
      betaGridSteps: number;
    };
    diagnostics?: {
      entropyBits: number;
      participationRatio: number;
      averageHammingWeight: number;
      qubitMarginals: number[];
      zzCorrelations: number[];
    };
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

interface FlightSequenceTemplateEntry {
  label: string;
  phase: string;
  progress: number;
  driver: string;
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

const DEFAULT_TIMELINE_TASKS: TimelineTaskInput[] = [
  { id: 'launch_prep', name: 'Launch Prep', durationHours: 18, earliestStartHour: 0, latestFinishHour: 24, resource: 'ground' },
  { id: 'ascent', name: 'Ascent / Parking Orbit', durationHours: 4, dependencies: ['launch_prep'], resource: 'vehicle' },
  { id: 'tli', name: 'Transfer Injection', durationHours: 2, dependencies: ['ascent'], resource: 'vehicle' },
  { id: 'lunar_ops', name: 'Lunar / Target Ops', durationHours: 36, dependencies: ['tli'], resource: 'crew' },
  { id: 'return_commit', name: 'Return Commit', durationHours: 3, dependencies: ['lunar_ops'], resource: 'vehicle' },
  { id: 'recovery', name: 'Recovery', durationHours: 8, dependencies: ['return_commit'], latestFinishHour: 96, resource: 'ground' },
];

const DEFAULT_STAGE_CONFIGS: StageConfig[] = [
  { name: 'Booster', dryMassKg: 28500, propellantMassKg: 395000, thrustVacN: 7_600_000, thrustSlN: 6_900_000, ispVacS: 311, ispSlS: 282, engineCount: 9, engineOutCount: 1, tankCgMeters: 18 },
  { name: 'Core Stage', dryMassKg: 8200, propellantMassKg: 112000, thrustVacN: 1_050_000, thrustSlN: 920_000, ispVacS: 365, ispSlS: 333, engineCount: 1, engineOutCount: 0, tankCgMeters: 9 },
  { name: 'Trans-Lunar Stage', dryMassKg: 3400, propellantMassKg: 28000, thrustVacN: 115_000, thrustSlN: 95_000, ispVacS: 451, ispSlS: 380, engineCount: 1, engineOutCount: 0, tankCgMeters: 4.5 },
];

const DEFAULT_TLE_TEXT = `ISS
1 25544U 98067A   26109.51851852  .00014215  00000-0  25562-3 0  9998
2 25544  51.6404 121.6200 0004901 143.1129 328.0090 15.49799364501754
HST
1 20580U 90037B   26109.53125000  .00000822  00000-0  48511-4 0  9995
2 20580  28.4697 168.1422 0002858  50.9986 309.1178 15.09186495801229`;

const LUNAR_FLIGHT_SEQUENCE_TEMPLATE: FlightSequenceTemplateEntry[] = [
  { label: 'Parking Orbit', phase: 'Launch and ascent', progress: 0.08, driver: 'Ascent energy is converted into a stable parking orbit before translunar commitment.' },
  { label: 'Transfer Burn', phase: 'Launch and ascent', progress: 0.16, driver: 'Primary outbound delta-v impulse commits the vehicle to the transfer trajectory.' },
  { label: 'Translunar coast', phase: 'Launch and ascent', progress: 0.36, driver: 'Ballistic coast is dominated by transfer geometry, distance growth, and low-propulsive trim.' },
  { label: 'Approach', phase: 'Outbound phase', progress: 0.48, driver: 'Relative range to the destination collapses and guidance starts shaping encounter conditions.' },
  { label: 'Encounter', phase: 'Outbound phase', progress: 0.58, driver: 'Closest-body operations are driven by capture, flyby, or proximity-operations physics.' },
  { label: 'Return coast', phase: 'Return phase', progress: 0.74, driver: 'Earth-return leg is largely ballistic with reserve burns protecting corridor accuracy.' },
  { label: 'Entry', phase: 'Recovery phase', progress: 0.9, driver: 'Aerothermal entry corridor and deceleration constraints dominate the physics.' },
  { label: 'Landing', phase: 'Recovery phase', progress: 0.985, driver: 'Terminal descent uses residual reserves and recovery geometry to complete the mission.' },
];

const GENERIC_FLIGHT_SEQUENCE_TEMPLATE: FlightSequenceTemplateEntry[] = [
  { label: 'Parking Orbit', phase: 'Launch and ascent', progress: 0.06, driver: 'Ascent energy is converted into a stable parking orbit before interplanetary commitment.' },
  { label: 'Transfer Burn', phase: 'Launch and ascent', progress: 0.12, driver: 'Primary departure burn commits the vehicle to the transfer trajectory.' },
  { label: 'Transfer coast', phase: 'Outbound phase', progress: 0.36, driver: 'Coast arc is dominated by heliocentric transfer geometry, distance growth, and trim maneuvers.' },
  { label: 'Approach', phase: 'Outbound phase', progress: 0.5, driver: 'Relative range to the destination collapses and navigation starts shaping encounter conditions.' },
  { label: 'Encounter', phase: 'Outbound phase', progress: 0.58, driver: 'Closest-body operations are driven by capture, flyby, or proximity-operations physics.' },
  { label: 'Return coast', phase: 'Return phase', progress: 0.76, driver: 'Return leg is shaped by transfer geometry and reserve maneuvers.' },
  { label: 'Entry', phase: 'Recovery phase', progress: 0.92, driver: 'Entry corridor and deceleration constraints dominate the return to the origin body.' },
  { label: 'Landing', phase: 'Recovery phase', progress: 0.985, driver: 'Terminal recovery uses residual reserves and site geometry to complete the mission.' },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function classifyDisplayedCrewRisk(score: number): 'SAFE' | 'MONITOR' | 'HIGH_RISK' | 'DO_NOT_EMBARK' {
  if (score <= 0.3) return 'SAFE';
  if (score <= 0.6) return 'MONITOR';
  if (score <= 1.0) return 'HIGH_RISK';
  return 'DO_NOT_EMBARK';
}

function embarkationFromDisplayedRisk(classification: 'SAFE' | 'MONITOR' | 'HIGH_RISK' | 'DO_NOT_EMBARK') {
  if (classification === 'SAFE') return 'SAFE_TO_EMBARK';
  if (classification === 'MONITOR') return 'PROCEED_WITH_CAUTION';
  return 'DO_NOT_EMBARK';
}

function formatHour(value: number): string {
  return `T+${value.toFixed(1)} h`;
}

function parseTleText(text: string): Array<{ id: string; name: string; tle1: string; tle2: string; covarianceSigmaKm?: number }> {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const records: Array<{ id: string; name: string; tle1: string; tle2: string; covarianceSigmaKm?: number }> = [];
  let i = 0;
  while (i < lines.length) {
    const maybeName = lines[i];
    const line1 = lines[i + 1]?.startsWith('1 ') ? lines[i + 1] : lines[i];
    const line2 = lines[i + 2]?.startsWith('2 ') ? lines[i + 2] : lines[i + 1];
    const hasExplicitName = maybeName && !maybeName.startsWith('1 ');
    if (line1?.startsWith('1 ') && line2?.startsWith('2 ')) {
      const name = hasExplicitName ? maybeName : `TLE-${records.length + 1}`;
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      records.push({ id, name, tle1: line1, tle2: line2, covarianceSigmaKm: 1.5 });
      i += hasExplicitName ? 3 : 2;
      continue;
    }
    i += 1;
  }
  return records;
}

function parseObservedStateText(text: string): Array<{ id: string; positionKm: [number, number, number]; velocityKmS: [number, number, number] }> {
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        id: String(item.id ?? ''),
        positionKm: [Number(item.positionKm?.[0] ?? 0), Number(item.positionKm?.[1] ?? 0), Number(item.positionKm?.[2] ?? 0)] as [number, number, number],
        velocityKmS: [Number(item.velocityKmS?.[0] ?? 0), Number(item.velocityKmS?.[1] ?? 0), Number(item.velocityKmS?.[2] ?? 0)] as [number, number, number],
      }))
      .filter((item) => item.id);
  } catch {
    return [];
  }
}

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

function getFlightSequenceTemplate(targetPlanetId: string, launchBodyId: string): FlightSequenceTemplateEntry[] {
  return targetPlanetId === 'moon' && launchBodyId === 'earth'
    ? LUNAR_FLIGHT_SEQUENCE_TEMPLATE
    : GENERIC_FLIGHT_SEQUENCE_TEMPLATE;
}

function stageDriver(label: string, template: FlightSequenceTemplateEntry[]): string {
  return template.find((stage) => stage.label === label)?.driver ?? 'Mission phase derived from trajectory geometry and operational constraints.';
}

function normalizeStageLabel(label: string, targetPlanetId: string, launchBodyId: string): string {
  const isLunar = targetPlanetId === 'moon' && launchBodyId === 'earth';
  switch (label) {
    case 'LEO / Departure':
      return 'Parking Orbit';
    case 'Launch / Takeoff':
      return 'Parking Orbit';
    case 'TLI':
      return 'Transfer Burn';
    case 'Outbound Departure':
      return 'Transfer Burn';
    case 'Translunar':
      return 'Translunar coast';
    case 'Outbound Cruise':
      return isLunar ? 'Translunar coast' : 'Transfer coast';
    case 'Transfer coast':
      return isLunar ? 'Translunar coast' : 'Transfer coast';
    case 'NRHO / Gateway':
      return 'Encounter';
    case 'Return Burn':
      return 'Return coast';
    case 'Inbound Cruise':
      return 'Return coast';
    case 'Outbound Arrival':
      return 'Encounter';
    case 'Lunar approach':
      return 'Approach';
    case 'Approach':
      return 'Approach';
    case 'Encounter':
      return 'Encounter';
    case 'Earth return':
      return 'Entry';
    case 'Entry Interface':
      return 'Entry';
    case 'Landing / Splashdown':
      return 'Landing';
    case 'Surface Recovery':
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
  options: { kmPerUnit: number; targetPlanetId: string; launchBodyId: string },
): StageDisplay[] {
  if (trajectory.length < 2) return [];
  const template = getFlightSequenceTemplate(options.targetPlanetId, options.launchBodyId);

  const totalTime = Math.max(1, trajectory[trajectory.length - 1]?.time_s ?? 1);
  const cumulativeDistanceKm: number[] = [0];
  for (let i = 1; i < trajectory.length; i++) {
    cumulativeDistanceKm.push(cumulativeDistanceKm[i - 1] + distanceBetweenPointsKm(trajectory[i - 1].pos, trajectory[i].pos, options.kmPerUnit));
  }
  const totalDistanceKm = Math.max(cumulativeDistanceKm[cumulativeDistanceKm.length - 1], 1);

  const labelIndex = new Map<string, number>();
  for (let i = 0; i < trajectory.length; i++) {
    const label = trajectory[i].label ? normalizeStageLabel(trajectory[i].label, options.targetPlanetId, options.launchBodyId) : null;
    if (label && !labelIndex.has(label)) labelIndex.set(label, i);
  }

  return template.map((stageTemplate, index) => {
    const fallbackIdx = Math.min(trajectory.length - 1, Math.max(0, Math.floor(stageTemplate.progress * (trajectory.length - 1))));
    const idx = labelIndex.get(stageTemplate.label) ?? fallbackIdx;
    const timeS = trajectory[idx]?.time_s ?? stageTemplate.progress * totalTime;
    const progress = Math.max(0.015, Math.min(0.985, timeS / totalTime));
    const distanceKm = cumulativeDistanceKm[idx] ?? totalDistanceKm * progress;
    const distanceShare = distanceKm / totalDistanceKm;
    return {
      sequence: index + 1,
      label: stageTemplate.label,
      progress,
      color: stageColor(stageTemplate.label),
      phase: stageTemplate.phase,
      timeS,
      distanceKm,
      fuelRemainingPct: estimateFuelRemainingPct(stageTemplate.label, progress, distanceShare),
      driver: stageDriver(stageTemplate.label, template),
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
  const template = GENERIC_FLIGHT_SEQUENCE_TEMPLATE;
  if (!simResult) {
    return [
      { label: 'Launch', progress: 0.015, color: stageColor('Launch'), phase: 'Launch and ascent', driver: 'Initial ascent from the launch site.' },
      { label: 'Stage Sep', progress: 0.12, color: stageColor('Stage Sep'), phase: 'Launch and ascent', driver: 'Stage separation reshapes thrust-to-mass and drag conditions.' },
      { label: 'Parking Orbit', progress: 0.26, color: stageColor('Parking Orbit'), phase: 'Launch and ascent', driver: stageDriver('Parking Orbit', template) },
      { label: 'Transfer Burn', progress: 0.42, color: stageColor('Transfer Burn'), phase: 'Launch and ascent', driver: stageDriver('Transfer Burn', template) },
      { label: 'Encounter', progress: 0.7, color: stageColor('Encounter'), phase: 'Outbound phase', driver: stageDriver('Encounter', template) },
      { label: 'Entry', progress: 0.9, color: stageColor('Entry'), phase: 'Recovery phase', driver: stageDriver('Entry', template) },
      { label: 'Landing', progress: 0.985, color: stageColor('Landing'), phase: 'Recovery phase', driver: stageDriver('Landing', template) },
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
    driver: stageDriver(event.label, template),
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

function QuantumDistribution({ distribution }: { distribution?: Array<{ state: string; probability: number; energy: number; isOptimal: boolean; shotCount?: number }> }) {
  if (!distribution?.length) return <p className="text-sm text-slate-400">Probability distribution becomes available after optimization.</p>;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={distribution} margin={{ top: 4, right: 8, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis dataKey="state" stroke="#64748b" tick={{ fontSize: 9 }} />
        <YAxis stroke="#64748b" tick={{ fontSize: 9 }} tickFormatter={(value) => `${(value * 100).toFixed(0)}%`} />
        <Tooltip
          contentStyle={{ background: '#020617', border: '1px solid #334155' }}
          formatter={(value: number, _name, payload: { payload?: { energy: number; isOptimal: boolean; shotCount?: number } }) => [
            `${(value * 100).toFixed(2)}%`,
            `E=${payload.payload?.energy?.toFixed?.(2) ?? '--'}${payload.payload?.isOptimal ? ' · optimal' : ''}${payload.payload?.shotCount != null ? ` · ${payload.payload.shotCount} shots` : ''}`,
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
  } else if (bodyId === 'mercury') {
    const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    g.addColorStop(0, '#d1d5db');
    g.addColorStop(0.45, '#9ca3af');
    g.addColorStop(1, '#4b5563');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(17,24,39,0.22)';
    for (let i = 0; i < 42; i++) {
      ctx.beginPath();
      ctx.ellipse(Math.random() * canvas.width, Math.random() * canvas.height, 18 + Math.random() * 68, 10 + Math.random() * 38, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (bodyId === 'venus') {
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, '#fde68a');
    g.addColorStop(0.32, '#fbbf24');
    g.addColorStop(0.68, '#d97706');
    g.addColorStop(1, '#92400e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(255,244,214,0.22)';
    ctx.lineWidth = 18;
    for (let i = 0; i < 11; i++) {
      const y = 30 + i * 46;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(canvas.width * 0.25, y + 26, canvas.width * 0.65, y - 18, canvas.width, y + 8);
      ctx.stroke();
    }
  } else if (bodyId === 'mars') {
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, '#fecaca');
    g.addColorStop(0.28, '#fb923c');
    g.addColorStop(0.68, '#c2410c');
    g.addColorStop(1, '#7c2d12');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(127,29,29,0.22)';
    for (let i = 0; i < 18; i++) {
      ctx.beginPath();
      ctx.ellipse(60 + i * 56, 120 + (i % 5) * 58, 40 + (i % 4) * 14, 14 + (i % 3) * 10, 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,245,245,0.16)';
    ctx.beginPath();
    ctx.ellipse(790, 72, 150, 44, 0.06, 0, Math.PI * 2);
    ctx.fill();
  } else if (bodyId === 'jupiter') {
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, '#f5d0a9');
    g.addColorStop(0.25, '#e7b074');
    g.addColorStop(0.5, '#d99752');
    g.addColorStop(0.75, '#9a6a42');
    g.addColorStop(1, '#5b4637');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const bands = [
      ['rgba(120,74,49,0.32)', 42],
      ['rgba(255,240,214,0.18)', 88],
      ['rgba(110,63,43,0.28)', 140],
      ['rgba(250,220,180,0.16)', 196],
      ['rgba(115,70,44,0.3)', 254],
      ['rgba(245,228,198,0.16)', 318],
      ['rgba(122,77,52,0.24)', 384],
    ] as const;
    for (const [stroke, y] of bands) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 28;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(canvas.width * 0.25, y + 14, canvas.width * 0.75, y - 16, canvas.width, y + 10);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(172,74,47,0.55)';
    ctx.beginPath();
    ctx.ellipse(690, 292, 96, 42, -0.1, 0, Math.PI * 2);
    ctx.fill();
  } else if (bodyId === 'saturn') {
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, '#fef3c7');
    g.addColorStop(0.35, '#fcd34d');
    g.addColorStop(0.72, '#d6a651');
    g.addColorStop(1, '#8b6a3d');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(255,248,220,0.2)';
    ctx.lineWidth = 18;
    for (let i = 0; i < 9; i++) {
      const y = 44 + i * 52;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(canvas.width * 0.3, y + 12, canvas.width * 0.7, y - 8, canvas.width, y + 8);
      ctx.stroke();
    }
  } else if (bodyId === 'uranus') {
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, '#d9f99d');
    g.addColorStop(0.25, '#a7f3d0');
    g.addColorStop(0.7, '#67e8f9');
    g.addColorStop(1, '#0f766e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(236,254,255,0.18)';
    ctx.lineWidth = 14;
    for (let i = 0; i < 8; i++) {
      const y = 52 + i * 54;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(canvas.width * 0.3, y + 10, canvas.width * 0.7, y - 10, canvas.width, y + 6);
      ctx.stroke();
    }
  } else if (bodyId === 'neptune') {
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, '#bfdbfe');
    g.addColorStop(0.25, '#60a5fa');
    g.addColorStop(0.6, '#2563eb');
    g.addColorStop(1, '#1e3a8a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(219,234,254,0.18)';
    ctx.lineWidth = 20;
    for (let i = 0; i < 8; i++) {
      const y = 40 + i * 56;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(canvas.width * 0.28, y + 16, canvas.width * 0.72, y - 12, canvas.width, y + 10);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.ellipse(720, 210, 120, 34, 0.04, 0, Math.PI * 2);
    ctx.fill();
  } else if (bodyId === 'pluto') {
    const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    g.addColorStop(0, '#f5e1d3');
    g.addColorStop(0.4, '#c4a484');
    g.addColorStop(0.72, '#7c5c45');
    g.addColorStop(1, '#3f2d25');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.ellipse(720, 132, 160, 70, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(35,23,18,0.22)';
    for (let i = 0; i < 16; i++) {
      ctx.beginPath();
      ctx.ellipse(Math.random() * canvas.width, Math.random() * canvas.height, 20 + Math.random() * 44, 12 + Math.random() * 28, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
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
        <sphereGeometry args={[radius, 80, 80]} />
        <meshPhysicalMaterial
          map={texture ?? undefined}
          color={color}
          emissive={color}
          emissiveIntensity={0.12}
          metalness={0.04}
          roughness={0.84}
          clearcoat={0.22}
          clearcoatRoughness={0.78}
        />
      </mesh>
      <mesh scale={1.035}>
        <sphereGeometry args={[radius, 80, 80]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.16} transparent opacity={0.12} side={THREE.BackSide} />
      </mesh>
      <mesh scale={1.085}>
        <sphereGeometry args={[radius, 56, 56]} />
        <meshBasicMaterial color={color} transparent opacity={0.05} side={THREE.BackSide} />
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

function trajectoryPointAtStage(trajectory: TrajectoryPoint[], stageList: StageDisplay[], labels: string[]): [number, number, number] | null {
  if (!trajectory.length) return null;
  const stage = labels
    .map((label) => stageList.find((item) => item.label === label))
    .find((item): item is StageDisplay => Boolean(item));
  if (!stage) return trajectory[trajectory.length - 1]?.pos ?? null;

  let bestIndex = Math.min(trajectory.length - 1, Math.max(0, Math.floor(stage.progress * (trajectory.length - 1))));
  if (stage.timeS != null) {
    let bestDt = Infinity;
    for (let i = 0; i < trajectory.length; i++) {
      const dt = Math.abs((trajectory[i].time_s ?? 0) - stage.timeS);
      if (dt < bestDt) {
        bestDt = dt;
        bestIndex = i;
      }
    }
  }
  return trajectory[bestIndex]?.pos ?? null;
}

function computeSceneCenter(points: Array<[number, number, number]>): THREE.Vector3 {
  const center = new THREE.Vector3();
  if (!points.length) return center;
  for (const point of points) {
    center.add(new THREE.Vector3(point[0], point[1], point[2]));
  }
  return center.multiplyScalar(1 / points.length);
}

function computeSceneRadius(points: Array<[number, number, number]>, center: THREE.Vector3): number {
  if (!points.length) return 1;
  let radius = 1;
  for (const point of points) {
    radius = Math.max(radius, center.distanceTo(new THREE.Vector3(point[0], point[1], point[2])));
  }
  return radius;
}

function trajectoryIndexAtStage(trajectory: TrajectoryPoint[], stageList: StageDisplay[], labels: string[]): number {
  if (trajectory.length < 2) return 0;
  const stage = labels
    .map((label) => stageList.find((item) => item.label === label))
    .find((item): item is StageDisplay => Boolean(item));
  if (!stage) return trajectory.length - 1;

  let bestIndex = Math.min(trajectory.length - 1, Math.max(1, Math.floor(stage.progress * (trajectory.length - 1))));
  if (stage.timeS != null) {
    let bestDt = Infinity;
    for (let i = 0; i < trajectory.length; i++) {
      const dt = Math.abs((trajectory[i].time_s ?? 0) - stage.timeS);
      if (dt < bestDt) {
        bestDt = dt;
        bestIndex = i;
      }
    }
  }
  return bestIndex;
}

function MissionSceneNavigator({
  controlsRef,
  command,
  trajectory,
  stageList,
  cislunar,
}: {
  controlsRef: RefObject<any>;
  command: { mode: VisualizerViewMode; nonce: number };
  trajectory: TrajectoryPoint[];
  stageList: StageDisplay[];
  cislunar: boolean;
}) {
  const { camera, size } = useThree();

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls || !trajectory.length) return;

    const launchPoint = trajectory[0]?.pos ?? [0, 0, 0];
    const targetPoint =
      trajectoryPointAtStage(trajectory, stageList, ['Encounter', 'Approach', 'Landing']) ??
      trajectory[trajectory.length - 1]?.pos ??
      launchPoint;
    const samples = [launchPoint, targetPoint, ...trajectory.map((point) => point.pos)];
    const fitCenter = computeSceneCenter(samples);
    const fitRadius = computeSceneRadius(samples, fitCenter);

    const view =
      command.mode === 'launch'
        ? {
            center: new THREE.Vector3(launchPoint[0], launchPoint[1], launchPoint[2]),
            radius: Math.max(cislunar ? 22 : 30, fitRadius * 0.22),
            direction: new THREE.Vector3(0.9, 0.28, 1.25),
          }
        : command.mode === 'target'
          ? {
              center: new THREE.Vector3(targetPoint[0], targetPoint[1], targetPoint[2]),
              radius: Math.max(cislunar ? 28 : 36, fitRadius * 0.26),
              direction: new THREE.Vector3(-1.0, 0.34, 1.1),
            }
          : {
              center: fitCenter,
              radius: fitRadius,
              direction: new THREE.Vector3(1.0, 0.42, 1.28),
            };

    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    const aspect = size.width / Math.max(size.height, 1);
    const fov = THREE.MathUtils.degToRad(perspectiveCamera.fov || 50);
    const fitDistance = view.radius / Math.max(Math.tan(fov / 2), 0.25);
    const framedDistance = Math.max(
      fitDistance / Math.max(Math.sqrt(Math.max(aspect, 1)), 0.9),
      cislunar ? 85 : 135,
      view.radius * (cislunar ? 2.3 : 2.6),
    );

    perspectiveCamera.position.copy(view.center.clone().add(view.direction.normalize().multiplyScalar(framedDistance)));
    perspectiveCamera.near = Math.max(0.1, framedDistance / 5000);
    perspectiveCamera.far = Math.max(6000, framedDistance * 18);
    perspectiveCamera.updateProjectionMatrix();
    controls.target.copy(view.center);
    controls.update();
  }, [camera, cislunar, command, controlsRef, size.height, size.width, stageList, trajectory]);

  return null;
}

function RadiationOverlay({
  bodyRadius,
  atmosphereScaleHeightKm,
  isPrimary,
  customZones,
  kmPerUnit,
}: {
  bodyRadius: number;
  atmosphereScaleHeightKm?: number;
  isPrimary?: boolean;
  customZones?: Array<{ outerRadiusKm: number; severity: number; color: string }>;
  kmPerUnit?: number;
}) {
  const zones = customZones?.length
    ? customZones.map((zone) => ({
        radius: zone.outerRadiusKm / Math.max(kmPerUnit ?? VIS_SCENE_KM_PER_UNIT, 1),
        color: zone.color,
        opacity: Math.min(0.12, 0.025 + zone.severity * 0.015),
      }))
    : isPrimary
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
  externalBodies,
  radiationEnvironment,
}: {
  launchDate: string;
  targetPlanetId: string;
  launchBodyId: string;
  preset: (typeof MISSION_PRESETS)[MissionType];
  pathNodeIds: string[];
  keplerEl: KeplerianElements;
  stageList: StageDisplay[];
  trajectory: TrajectoryPoint[];
  externalBodies: Array<SolarBodyFeed & { pos?: [number, number, number] }>;
  radiationEnvironment: NearEarthRadiationFeed | null;
}) {
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const isCislunar = targetPlanetId === 'moon' && launchBodyId === 'earth';
  const { outboundTrajectory, returnTrajectory } = useMemo(() => {
    if (trajectory.length < 2) {
      return { outboundTrajectory: trajectory, returnTrajectory: [] as TrajectoryPoint[] };
    }
    const encounterIndex = trajectoryIndexAtStage(trajectory, stageList, ['Encounter', 'Approach']);
    const outbound = trajectory.slice(0, Math.max(2, encounterIndex + 1));
    const inbound = encounterIndex < trajectory.length - 1 ? trajectory.slice(encounterIndex) : [];
    return { outboundTrajectory: outbound, returnTrajectory: inbound };
  }, [trajectory, stageList]);
  const sceneDate = useMemo(() => new Date(launchDate + 'T12:00:00Z'), [launchDate]);
  const heliocentricEarthRadiusScene = RE / VIS_SCENE_KM_PER_UNIT;
  const earthRadiusScene = isCislunar ? RE / CISLUNAR_VIS_KM_PER_UNIT : heliocentricEarthRadiusScene;
  const cislunarKmPerUnit = CISLUNAR_VIS_KM_PER_UNIT;

  const systemBodies = useMemo(() => {
    if (isCislunar) return [];
    if (externalBodies.length) {
      const fromFeed = externalBodies
        .filter((body) => body.pos && body.id !== launchBodyId && body.bodyType?.toLowerCase().includes('planet'))
        .map((body) => ({
          id: body.id,
          name: body.englishName ?? body.name ?? body.id,
          radiusKm: body.meanRadius ?? 2500,
          color: body.color ?? '#94a3b8',
          atmosphereScaleHeightKm: body.atmosphereScaleHeightKm,
          pos: body.pos!,
        }));
      if (fromFeed.length) return fromFeed;
    }
    const earthHelio = getApproximateHeliocentricPosition(CELESTIAL_BODY_MAP.earth, sceneDate);
    return CELESTIAL_BODIES
      .filter((body) => body.orbit && body.id !== launchBodyId)
      .map((body) => {
        const p = getApproximateHeliocentricPosition(body, sceneDate);
        return {
          id: body.id,
          name: body.name,
          radiusKm: body.radiusKm,
          color: body.color,
          atmosphereScaleHeightKm: body.atmosphereScaleHeightKm,
          pos: [p[0] - earthHelio[0], p[1] - earthHelio[1], p[2] - earthHelio[2]] as [number, number, number],
        };
      });
  }, [sceneDate, isCislunar, launchBodyId, externalBodies]);

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
  const encounterMarker = useMemo(() => {
    const encounterStage = stageList.find((stage) => stage.label === 'Encounter') ?? stageList.find((stage) => stage.label === 'Approach');
    if (!encounterStage) return null;
    let bestIdx = 0;
    let bestDt = Infinity;
    for (let i = 0; i < trajectory.length; i++) {
      const dt = Math.abs((trajectory[i].time_s ?? 0) - (encounterStage.timeS ?? 0));
      if (dt < bestDt) {
        bestDt = dt;
        bestIdx = i;
      }
    }
    return trajectory[bestIdx]?.pos ?? null;
  }, [stageList, trajectory]);
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
  const hasReturnPhase = stageList.some((stage) => stage.label === 'Return coast' || stage.label === 'Entry' || stage.label === 'Landing');

  return (
    <group>
      <PrimaryBody3D bodyId={launchBody.id} color={launchBody.color} radius={launchBodyId === 'earth' ? earthRadiusScene : bodySceneRadiusFromKm(launchBody.radiusKm)} />
      <RadiationOverlay
        bodyRadius={launchBodyId === 'earth' ? earthRadiusScene : bodySceneRadiusFromKm(launchBody.radiusKm)}
        atmosphereScaleHeightKm={launchBody.atmosphereScaleHeightKm}
        isPrimary
        customZones={launchBodyId === 'earth' ? radiationEnvironment?.environment?.zones?.map((zone) => ({
          outerRadiusKm: zone.outerRadiusKm,
          severity: zone.severity,
          color: zone.color,
        })) : undefined}
        kmPerUnit={isCislunar ? cislunarKmPerUnit : VIS_SCENE_KM_PER_UNIT}
      />
      {isCislunar ? (
        <group position={moonScene.pos}>
          <mesh>
            <sphereGeometry args={[moonScene.radius, 72, 72]} />
            <meshPhysicalMaterial map={moonTexture ?? undefined} color="#d4d8e0" roughness={0.88} metalness={0.03} emissive="#9ca3af" emissiveIntensity={0.08} clearcoat={0.12} clearcoatRoughness={0.82} />
          </mesh>
          <mesh scale={1.04}>
            <sphereGeometry args={[moonScene.radius, 56, 56]} />
            <meshBasicMaterial color="#e2e8f0" transparent opacity={0.05} side={THREE.BackSide} />
          </mesh>
          <Text position={[0, moonScene.radius + 2.2, 0]} fontSize={2.2} color="#e2e8f0" anchorX="center">
            Moon
          </Text>
        </group>
      ) : null}
      {systemBodies.map((body) => {
        const isTarget = body.id === targetBody.id;
        const radius = bodyDisplayRadiusKm(body.radiusKm);
        const bodyPos = (!isCislunar && isTarget && encounterMarker) ? encounterMarker : body.pos as [number, number, number];
        return (
          <group key={body.id} position={bodyPos}>
            <mesh>
              <sphereGeometry args={[radius, 48, 48]} />
              <meshPhysicalMaterial color={body.color} roughness={0.8} metalness={0.04} emissive={body.color} emissiveIntensity={isTarget ? 0.18 : 0.1} clearcoat={0.18} clearcoatRoughness={0.8} />
            </mesh>
            <mesh scale={1.05}>
              <sphereGeometry args={[radius, 40, 40]} />
              <meshBasicMaterial color={body.color} transparent opacity={isTarget ? 0.08 : 0.045} side={THREE.BackSide} />
            </mesh>
            <RadiationOverlay bodyRadius={radius} atmosphereScaleHeightKm={body.atmosphereScaleHeightKm} isPrimary={isTarget} />
            <Text position={[0, radius + 3.5, 0]} fontSize={2.5} color={isTarget ? '#f8fafc' : '#94a3b8'} anchorX="center">
              {isTarget && encounterMarker ? `${body.name} (encounter)` : body.name}
            </Text>
          </group>
        );
      })}
      <DreiLine points={outboundTrajectory.map((point) => point.pos)} color="#84cc16" lineWidth={isCislunar ? 3.8 : 2.5} transparent opacity={0.96} />
      {hasReturnPhase && returnTrajectory.length >= 2 ? (
        <DreiLine points={returnTrajectory.map((point) => point.pos)} color="#38bdf8" lineWidth={isCislunar ? 3.2 : 2.2} transparent opacity={0.88} />
      ) : null}
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
        const stageId = `${stage.sequence}-${stage.label}`;
        const active = selectedStageId === stageId;
        const sr = isCislunar ? 1.4 : 1.55;
        const tf = isCislunar ? 1.65 : 1.75;
        return (
          <group key={stageId} position={stage.point as [number, number, number]}>
            <mesh
              onClick={(event) => {
                event.stopPropagation();
                setSelectedStageId((current) => (current === stageId ? null : stageId));
              }}
            >
              <sphereGeometry args={[sr, 16, 16]} />
              <meshBasicMaterial color={stage.color} />
            </mesh>
            <mesh
              onClick={(event) => {
                event.stopPropagation();
                setSelectedStageId((current) => (current === stageId ? null : stageId));
              }}
            >
              <sphereGeometry args={[sr * 1.8, 12, 12]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            {active ? (
              <>
                <Text position={[0, sr + 2.1, 0]} fontSize={tf * 0.92} color="#f8fafc" anchorX="center">
                  {stage.sequence}
                </Text>
                <Text position={[0, sr + 0.45, 0]} fontSize={tf} color={stage.color} anchorX="center">
                  {stage.label}
                </Text>
              </>
            ) : null}
          </group>
        );
      })}
      <Stars radius={800} depth={500} count={10000} factor={10} saturation={0} fade speed={0.4} />
    </group>
  );
}

function SourceStatus({
  weatherData,
  openMeteoWeather,
  nasaWeather,
  solarBodies,
  nearEarthRadiation,
  gravityInfluence,
  eonetEvents,
  celestrakTraffic,
  telemetryFeed,
  dsnVisibility,
  webGeoCalcMeta,
  stlAnalysis,
  simResult,
  trajectoryDesign,
  groundConstraints,
  launchConstraintAnalysis,
  sgp4Propagation,
  multistageAssessment,
}: {
  weatherData: any;
  openMeteoWeather: any;
  nasaWeather: any;
  solarBodies: SolarBodiesFeed | null;
  nearEarthRadiation: NearEarthRadiationFeed | null;
  gravityInfluence: GravityInfluenceFeed | null;
  eonetEvents: ExternalEventFeed | null;
  celestrakTraffic: ExternalConjunctionFeed | null;
  telemetryFeed: ExternalTelemetryFeed | null;
  dsnVisibility: DsnVisibilityFeed | null;
  webGeoCalcMeta: { source?: string; version?: string } | null;
  stlAnalysis: STLAnalysis | null;
  simResult: LaunchOptimizationResponse | null;
  trajectoryDesign?: TrajectoryDesignFeed | null;
  groundConstraints?: GroundConstraintFeed | null;
  launchConstraintAnalysis?: LaunchConstraintFeed | null;
  sgp4Propagation?: Sgp4PropagateFeed | null;
  multistageAssessment?: MultiStageAssessment | null;
}) {
  const rows = [
    { label: 'Surface weather', source: weatherData?.source ?? 'Unavailable', kind: weatherData?.source?.startsWith('LIVE') ? 'live-api' : 'preset' },
    { label: 'Backup meteorology', source: openMeteoWeather?.source ?? 'Unavailable', kind: openMeteoWeather?.source?.startsWith('LIVE') ? 'live-api' : 'preset' },
    { label: 'Space weather', source: nasaWeather?.source ?? 'Unavailable', kind: nasaWeather?.source?.startsWith('LIVE') ? 'live-api' : 'preset' },
    { label: 'Body catalog', source: solarBodies?.source ?? 'Unavailable', kind: solarBodies?.source?.startsWith('LIVE') ? 'live-api' : 'preset' },
    { label: 'Radiation zones', source: nearEarthRadiation?.environment?.source ?? 'Unavailable', kind: nearEarthRadiation?.environment?.source ? 'formula' : 'preset' },
    { label: 'Earth events', source: eonetEvents?.source ?? 'Unavailable', kind: eonetEvents?.source?.startsWith('LIVE') ? 'live-api' : 'preset' },
    { label: 'Ascent dynamics', source: simResult ? 'In-browser 2D ascent solver' : 'Not run', kind: simResult ? 'formula' : 'preset' },
    { label: 'Vehicle geometry', source: stlAnalysis ? 'User STL-derived geometry' : 'No uploaded vehicle', kind: stlAnalysis ? 'formula' : 'preset' },
    { label: 'Mission graph', source: 'Scenario graph still uses preset nodes and edges', kind: 'preset' },
    { label: 'Conjunction panel', source: celestrakTraffic?.source ?? 'Imported-state propagation only', kind: celestrakTraffic?.source?.startsWith('LIVE') ? 'live-api' : 'heuristic' },
    { label: 'Ground stations', source: dsnVisibility?.source ?? 'Unavailable', kind: dsnVisibility?.source?.includes('DSN') ? 'formula' : 'preset' },
    { label: 'Gravity influence', source: gravityInfluence?.source ?? 'Unavailable', kind: gravityInfluence?.source?.startsWith('FORMULA') ? 'formula' : 'preset' },
    { label: 'Telemetry ingest', source: telemetryFeed?.frame ? telemetryFeed.source : 'Awaiting external frames', kind: telemetryFeed?.frame ? 'live-api' : 'preset' },
    { label: 'SPICE verification', source: webGeoCalcMeta?.source ?? 'Unavailable', kind: webGeoCalcMeta?.source?.startsWith('LIVE') ? 'live-api' : 'preset' },
    { label: 'Trajectory design', source: trajectoryDesign?.source ?? 'Unavailable', kind: trajectoryDesign ? 'formula' : 'preset' },
    { label: 'Ground systems', source: groundConstraints?.source ?? 'Unavailable', kind: groundConstraints ? 'formula' : 'preset' },
    { label: 'Launch constraints', source: launchConstraintAnalysis?.source ?? 'Unavailable', kind: launchConstraintAnalysis ? 'formula' : 'preset' },
    { label: 'Orbital ops', source: sgp4Propagation?.source ?? 'Unavailable', kind: sgp4Propagation ? 'formula' : 'preset' },
    { label: 'Vehicle staging', source: multistageAssessment?.source ?? 'Unavailable', kind: multistageAssessment ? 'formula' : 'preset' },
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

function ConjunctionPanel({
  importedNodes,
  externalThreats,
}: {
  importedNodes: GeneratedMissionNode[];
  externalThreats: ExternalConjunctionThreat[];
}) {
  const assessments = useMemo(() => {
    if (importedNodes.length < 2) return externalThreats.slice(0, 6);
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
      {assessments.length === 0 ? <p className="text-sm text-slate-400">Import at least two orbital states or TLEs, or allow the live CelesTrak feed to populate screening results.</p> : null}
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

function GroundRangeOverlay({ analysis }: { analysis: GroundConstraintFeed['analysis'] | null }) {
  if (!analysis) {
    return <p className="text-sm text-slate-400">Ground-range exclusions appear once launch-site and range constraints are solved.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
        <svg viewBox="0 0 240 240" className="h-52 w-full">
          <circle cx="120" cy="120" r="14" fill="#38bdf8" opacity="0.9" />
          {analysis.keepOutZones.map((zone, index) => {
            const r = 22 + index * 24;
            const start = (zone.azimuthCenterDeg - zone.azimuthHalfWidthDeg - 90) * (Math.PI / 180);
            const end = (zone.azimuthCenterDeg + zone.azimuthHalfWidthDeg - 90) * (Math.PI / 180);
            const x1 = 120 + r * Math.cos(start);
            const y1 = 120 + r * Math.sin(start);
            const x2 = 120 + r * Math.cos(end);
            const y2 = 120 + r * Math.sin(end);
            const largeArc = zone.azimuthHalfWidthDeg * 2 > 180 ? 1 : 0;
            return (
              <path
                key={zone.label}
                d={`M 120 120 L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`}
                fill={index % 2 === 0 ? 'rgba(239,68,68,0.22)' : 'rgba(245,158,11,0.18)'}
                stroke={index % 2 === 0 ? '#ef4444' : '#f59e0b'}
                strokeWidth="1.2"
              />
            );
          })}
          {analysis.recoveryCorridors.map((corridor, index) => {
            const angle = (corridor.headingDeg - 90) * (Math.PI / 180);
            const x2 = 120 + 90 * Math.cos(angle);
            const y2 = 120 + 90 * Math.sin(angle);
            const offset = 6 + index * 4;
            return (
              <line
                key={corridor.label}
                x1={120}
                y1={120}
                x2={x2 + offset}
                y2={y2 + offset}
                stroke={index === 0 ? '#22c55e' : '#60a5fa'}
                strokeWidth="4"
                strokeLinecap="round"
                opacity="0.85"
              />
            );
          })}
          <circle cx="120" cy="120" r="96" fill="none" stroke="#1e293b" strokeDasharray="4 5" />
        </svg>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {analysis.keepOutZones.map((zone) => (
          <div key={zone.label} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-300">
            <p className="text-slate-100">{zone.label}</p>
            <p className="mt-1 text-slate-400">R {zone.radiusKm.toFixed(0)} km | az {zone.azimuthCenterDeg.toFixed(0)}° ± {zone.azimuthHalfWidthDeg.toFixed(0)}°</p>
          </div>
        ))}
      </div>
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
  const [openMeteoWeather, setOpenMeteoWeather] = useState<any>(null);
  const [nasaWeather, setNasaWeather] = useState<any>(null);
  const [solarBodies, setSolarBodies] = useState<SolarBodiesFeed | null>(null);
  const [systemEphemeris, setSystemEphemeris] = useState<SystemEphemerisFeed | null>(null);
  const [nearEarthRadiation, setNearEarthRadiation] = useState<NearEarthRadiationFeed | null>(null);
  const [radiationIntersection, setRadiationIntersection] = useState<RadiationIntersectionFeed | null>(null);
  const [cislunarOps, setCislunarOps] = useState<CislunarOpsFeed | null>(null);
  const [gravityInfluence, setGravityInfluence] = useState<GravityInfluenceFeed | null>(null);
  const [eonetEvents, setEonetEvents] = useState<ExternalEventFeed | null>(null);
  const [celestrakTraffic, setCelestrakTraffic] = useState<ExternalConjunctionFeed | null>(null);
  const [telemetryFeed, setTelemetryFeed] = useState<ExternalTelemetryFeed | null>(null);
  const [dsnVisibility, setDsnVisibility] = useState<DsnVisibilityFeed | null>(null);
  const [webGeoCalcMeta, setWebGeoCalcMeta] = useState<{ source?: string; version?: string } | null>(null);
  const [launchSites, setLaunchSites] = useState<LaunchSiteFeed | null>(null);
  const [selectedLaunchSiteId, setSelectedLaunchSiteId] = useState('ksc');
  const [trajectoryDesign, setTrajectoryDesign] = useState<TrajectoryDesignFeed | null>(null);
  const [groundConstraints, setGroundConstraints] = useState<GroundConstraintFeed | null>(null);
  const [timelineTasks, setTimelineTasks] = useState<TimelineTaskInput[]>(DEFAULT_TIMELINE_TASKS);
  const [timelineSolution, setTimelineSolution] = useState<TimelineSolveFeed | null>(null);
  const [consumablesAnalysis, setConsumablesAnalysis] = useState<ConsumablesFeed | null>(null);
  const [surfaceEnvironment, setSurfaceEnvironment] = useState<SurfaceEnvironmentFeed | null>(null);
  const [launchConstraintAnalysis, setLaunchConstraintAnalysis] = useState<LaunchConstraintFeed | null>(null);
  const [opsConsole, setOpsConsole] = useState<OpsConsoleFeed | null>(null);
  const [tleInputText, setTleInputText] = useState(DEFAULT_TLE_TEXT);
  const [sgp4Propagation, setSgp4Propagation] = useState<Sgp4PropagateFeed | null>(null);
  const [sgp4Conjunctions, setSgp4Conjunctions] = useState<Sgp4ConjunctionFeed | null>(null);
  const [observedStateText, setObservedStateText] = useState('');
  const [sgp4Residuals, setSgp4Residuals] = useState<Sgp4ResidualFeed | null>(null);
  const [covariancePropagation, setCovariancePropagation] = useState<CovarianceFeed | null>(null);
  const [maneuverTargeting, setManeuverTargeting] = useState<ManeuverTargetingFeed | null>(null);
  const [evaDurationHours, setEvaDurationHours] = useState(6);
  const [evaPlan, setEvaPlan] = useState<EvaPlanFeed | null>(null);
  const [flightReview, setFlightReview] = useState<FlightReviewFeed | null>(null);
  const [stageConfigs, setStageConfigs] = useState<StageConfig[]>(DEFAULT_STAGE_CONFIGS);
  const [multistageAssessment, setMultistageAssessment] = useState<MultiStageAssessment | null>(null);
  const [ccsdsImportText, setCcsdsImportText] = useState('');
  const [ccsdsImportResult, setCcsdsImportResult] = useState<ImportedCcsdsFeed | null>(null);
  const [oemPreview, setOemPreview] = useState('');
  const [opmPreview, setOpmPreview] = useState('');
  const [baselineComparison, setBaselineComparison] = useState<BaselineCompareFeed | null>(null);
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
  const visualizerControlsRef = useRef<any>(null);
  const [visualizerViewCommand, setVisualizerViewCommand] = useState<{ mode: VisualizerViewMode; nonce: number }>({
    mode: 'fit',
    nonce: 0,
  });
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
  const baseGraph = importedGraph ?? { nodes: preset.nodes, edges: preset.edges };
  const altitude = keplerEl.a - 6371;
  const launchBody = CELESTIAL_BODY_MAP[launchBodyId] ?? CELESTIAL_BODY_MAP.earth;
  const bodyCatalog = useMemo(() => (
    solarBodies?.bodies?.length
      ? solarBodies.bodies.map((body) => ({
          id: body.id,
          name: body.englishName ?? body.name ?? body.id,
        }))
      : CELESTIAL_BODIES.map((body) => ({ id: body.id, name: body.name }))
  ), [solarBodies]);
  const bodyMatches = useMemo(() => {
    const normalized = bodySearch.trim().toLowerCase();
    if (!normalized) return bodyCatalog;
    return bodyCatalog.filter((body) => body.name.toLowerCase().includes(normalized) || body.id.includes(normalized));
  }, [bodyCatalog, bodySearch]);
  const currentDose = vanAllenDose(altitude, keplerEl.i);
  const localGravity = getDateAdjustedLocalGravity(launchBody, launchLatitude, launchLongitude, launchAltitudeKm, new Date(launchDate));
  const targetBody = CELESTIAL_BODY_MAP[targetPlanet] ?? CELESTIAL_BODY_MAP.moon;
  useEffect(() => {
    if (!launchSites?.sites?.length) return;
    const best = [...launchSites.sites].sort((a, b) => {
      const da = Math.hypot(a.lat - launchLatitude, a.lon - launchLongitude);
      const db = Math.hypot(b.lat - launchLatitude, b.lon - launchLongitude);
      return da - db;
    })[0];
    if (best?.id) setSelectedLaunchSiteId(best.id);
  }, [launchSites, launchLatitude, launchLongitude]);

  useEffect(() => {
    let cancelled = false;
    let firstFetch = true;

    const fetchAll = async () => {
      const isEarth = launchBodyId === 'earth';
      const weatherUrl = `/api/weather?lat=${launchLatitude}&lon=${launchLongitude}`;
      const openMeteoUrl = `/api/openmeteo/weather?lat=${launchLatitude}&lon=${launchLongitude}`;
      const [wxResult, openMeteoResult, spaceResult, solarBodiesResult, ephemerisResult, radiationResult, eonetResult, trafficResult, telemetryResult, wgcResult, launchSitesResult] = await Promise.allSettled([
        isEarth ? fetch(weatherUrl).then((res) => res.json()) : Promise.resolve({ source: 'NOT APPLICABLE' }),
        isEarth ? fetch(openMeteoUrl).then((res) => res.json()) : Promise.resolve({ source: 'NOT APPLICABLE' }),
        fetch('/api/space-weather').then((res) => res.json()),
        fetch('/api/bodies').then((res) => res.json()),
        fetch(`/api/ephemeris/system?centerBody=${launchBodyId}&date=${launchDate}`).then((res) => res.json()),
        fetch('/api/radiation/live?days=7').then((res) => res.json()),
        fetch('/api/eonet/events?status=open&limit=4&days=14').then((res) => res.json()),
        fetch('/api/celestrak/conjunctions?group=STATIONS&limit=10').then((res) => res.json()),
        fetch('/api/telemetry/latest').then((res) => res.json()),
        fetch('/api/webgeocalc/metadata').then((res) => res.json()),
        fetch('/api/ground/launch-sites').then((res) => res.json()),
      ]);

      const wx = wxResult.status === 'fulfilled' ? wxResult.value : { source: 'UNAVAILABLE' };
      const openMeteo = openMeteoResult.status === 'fulfilled' ? openMeteoResult.value : { source: 'UNAVAILABLE' };
      const nasa = spaceResult.status === 'fulfilled' ? spaceResult.value : { source: 'UNAVAILABLE' };
      const bodies = solarBodiesResult.status === 'fulfilled' ? solarBodiesResult.value : null;
      const ephemeris = ephemerisResult.status === 'fulfilled' ? ephemerisResult.value : null;
      const radiation = radiationResult.status === 'fulfilled' ? radiationResult.value : null;
      const eonet = eonetResult.status === 'fulfilled' ? eonetResult.value : null;
      const traffic = trafficResult.status === 'fulfilled' ? trafficResult.value : null;
      const telemetry = telemetryResult.status === 'fulfilled' ? telemetryResult.value : null;
      const wgc = wgcResult.status === 'fulfilled' ? wgcResult.value : null;
      const sites = launchSitesResult.status === 'fulfilled' ? launchSitesResult.value : null;

      if (cancelled) return;

      setWeatherData(wx);
      setOpenMeteoWeather(openMeteo);
      setNasaWeather(nasa);
      setSolarBodies(bodies);
      setSystemEphemeris(ephemeris);
      setNearEarthRadiation(radiation);
      setEonetEvents(eonet);
      setCelestrakTraffic(traffic);
      setTelemetryFeed(telemetry);
      setWebGeoCalcMeta(wgc);
      setLaunchSites(sites);
      if (wx.wind_speed) setWindSpeed(Math.round(wx.wind_speed / 3.6));

      if (firstFetch) {
        addLog(`Surface weather: ${wx.source ?? 'NOT APPLICABLE'}`);
        addLog(`Space weather: ${nasa.source ?? 'UNAVAILABLE'}`);
        if (ephemeris?.source) addLog(`Planet ephemerides: ${ephemeris.source}`);
        if (radiation?.environment?.source) addLog(`Radiation belts: ${radiation.environment.source}`);
        if (traffic?.source) addLog(`Traffic screening: ${traffic.source}`);
        if (telemetry?.frame) addLog(`Telemetry ingest active: ${telemetry.frame.source}`);
        firstFetch = false;
      }
      if (!isEarth) {
        setWeatherData({ source: 'NOT APPLICABLE' });
        setOpenMeteoWeather({ source: 'NOT APPLICABLE' });
      }
    };
    void fetchAll();
    const intervalId = window.setInterval(() => {
      void fetchAll();
    }, 300000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [addLog, launchBodyId, launchLatitude, launchLongitude, launchDate]);

  useEffect(() => {
    const fetchDsnVisibility = async () => {
      try {
        const start = launchDate;
        const stop = new Date(new Date(launchDate).getTime() + 3 * 86400000).toISOString().slice(0, 10);
        const response = await fetch(`/api/dsn/visibility?targetId=${targetPlanet}&startTime=${start}&stopTime=${stop}&stepSize=2 h&minElevationDeg=10`);
        const data = await response.json();
        setDsnVisibility(data);
      } catch {
        setDsnVisibility(null);
      }
    };
    fetchDsnVisibility();
  }, [launchDate, targetPlanet]);

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
          nodes: missionGraph.nodes,
          edges: missionGraph.edges,
          weights: { fuel: 3.0, rad: 5.0, comm: 2.0, safety: 4.0 },
          start: missionGraph.nodes[0]?.id ?? preset.start,
          end: missionGraph.nodes[missionGraph.nodes.length - 1]?.id ?? preset.end,
          steps: Math.max(2, missionGraph.nodes.length),
          date: launchDate,
          radiationIndex: Math.max(
            nasaWeather?.radiationIndex || 1.0,
            nearEarthRadiation?.environment?.aggregateIndex || 1.0,
            radiationIntersection?.assessment?.normalizedRiskIndex || 1.0,
          ),
          isp_s: PROPELLANTS[fuelType].isp_vac,
          spacecraft_mass_kg: spacecraftMass,
          qaoa_p: qaoaDepth,
          targetPlanet,
          launchBodyId,
          keplerEl,
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
      addLog(`Mission graph costs are now conditioned on live radiation, comm, and transfer design inputs`);
    } catch (error) {
      addLog('Mission optimization failed');
    } finally {
      setOptimizing(false);
    }
  };

  async function rerunQAOA(nextDepth: number) {
    if (!optResult?.path?.length) return;
    setQaoaRefreshing(true);
    try {
      const response = await fetch('/api/qaoa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bestPath: optResult.path,
          nodes: missionGraph.nodes,
          edges: missionGraph.edges,
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
  }

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
      nearEarthRadiation,
      radiationIntersection,
      cislunarOps,
      trajectoryDesign,
      groundConstraints,
      timelineSolution,
      consumablesAnalysis,
      surfaceEnvironment,
      launchConstraintAnalysis,
      opsConsole,
      sgp4Propagation,
      sgp4Conjunctions,
      sgp4Residuals,
      covariancePropagation,
      maneuverTargeting,
      evaPlan,
      flightReview,
      multistageAssessment,
      baselineComparison,
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
  const missionDistanceKm = useMemo(() => {
    let total = 0;
    for (let i = 1; i < missionTrajectory.length; i++) {
      const a = missionTrajectory[i - 1].pos;
      const b = missionTrajectory[i].pos;
      total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * missionKmPerUnit;
    }
    return total;
  }, [missionTrajectory, missionKmPerUnit]);
  const missionGraph: { nodes: Array<Record<string, any>>; edges: Array<Record<string, any>> } = useMemo(() => {
    if (importedGraph) return importedGraph;

    const radiationScale = Math.max(
      nasaWeather?.radiationIndex ?? 1,
      nearEarthRadiation?.environment?.aggregateIndex ?? 1,
      radiationIntersection?.assessment?.normalizedRiskIndex ?? 1,
      ((cislunarOps?.analysis?.dose?.cumulativeDoseMsv ?? 0) / 40),
      1,
    );
    const dsnCoverage = clamp((dsnVisibility?.windows?.reduce((sum, window) => sum + window.durationMinutes, 0) ?? 0) / (72 * 60), 0.15, 1);
    const telemetryComm = clamp((((telemetryFeed?.frame?.commMarginDb ?? 6) + 2) / 12), 0.2, 1);
    const launchCommit = launchConstraintAnalysis?.analysis?.goForLaunch === false ? 0.82 : 1;
    const commScale = clamp(0.55 * dsnCoverage + 0.45 * telemetryComm, 0.2, 1) * launchCommit;
    const totalBaseDistance = Math.max(1, preset.edges.reduce((sum, edge) => sum + Math.max(0, edge.distance ?? 0), 0));
    const totalBaseDeltaV = Math.max(1, preset.edges.reduce((sum, edge) => sum + Math.max(0, edge.deltaV_ms ?? 0), 0));
    const designedDeltaV = Math.max(
      trajectoryDesign?.patchedConic?.totalDeltaVKmS ? trajectoryDesign.patchedConic.totalDeltaVKmS * 1000 : 0,
      trajectoryDesign?.reservePolicy?.reserveDeltaVKmS ? trajectoryDesign.reservePolicy.reserveDeltaVKmS * 1000 : 0,
      totalBaseDeltaV,
    );
    const totalDistance = Math.max(missionDistanceKm, totalBaseDistance);
    const solarBoost = clamp((eonetEvents?.total ?? 0) / 10, 0, 0.18);

    const nodes = preset.nodes.map((node, index) => {
      const progress = preset.nodes.length > 1 ? index / (preset.nodes.length - 1) : 0;
      const altitudeFactor = clamp(node.altitude_km / 400000, 0, 1.4);
      const beltBoost = node.id.toLowerCase().includes('allen') ? Math.max(0.35, (radiationIntersection?.assessment?.normalizedRiskIndex ?? 0) * 0.8) : 0;
      const surfaceShielding = missionType === 'rover' && surfaceEnvironment?.dustOrRegolithRisk === 'HIGH' ? 0.08 : 0;
      const radiation = clamp(
        node.radiation * (0.7 + 0.45 * radiationScale) + altitudeFactor * 0.12 + beltBoost + solarBoost - surfaceShielding,
        0.04,
        1.6,
      );
      const commPenalty = progress > 0.55 ? 0.18 * (1 - dsnCoverage) : 0.05 * (1 - telemetryComm);
      const surfaceCommBoost = missionType === 'rover' && surfaceEnvironment?.daylight ? 0.06 : 0;
      const commScore = clamp(node.commScore * commScale - commPenalty + surfaceCommBoost, 0.08, 1);
      return {
        ...node,
        radiation,
        commScore,
      };
    });

    const edges = preset.edges.map((edge) => {
      const distanceShare = Math.max(0, edge.distance ?? 0) / totalBaseDistance;
      const deltaVShare = Math.max(0, edge.deltaV_ms ?? 0) / totalBaseDeltaV;
      const blendedShare = deltaVShare > 0 ? 0.65 * deltaVShare + 0.35 * distanceShare : distanceShare;
      const distance = missionType === 'rover'
        ? edge.distance
        : Math.max(edge.distance ?? 0, totalDistance * blendedShare);
      const deltaV_ms = missionType === 'rover'
        ? edge.deltaV_ms
        : Math.max(25, designedDeltaV * blendedShare);
      const fuelFraction = missionType === 'rover'
        ? (edge.fuelCost ?? 0) / 100
        : tsiolkovskyFuelMass(deltaV_ms, spacecraftMass, PROPELLANTS[fuelType].isp_vac) / Math.max(spacecraftMass, 1);
      return {
        ...edge,
        distance,
        deltaV_ms,
        fuelCost: clamp(fuelFraction * 100, 0.5, 95),
      };
    });

    return { nodes, edges };
  }, [
    importedGraph,
    nasaWeather?.radiationIndex,
    nearEarthRadiation,
    radiationIntersection,
    cislunarOps,
    dsnVisibility,
    telemetryFeed,
    launchConstraintAnalysis,
    preset,
    trajectoryDesign,
    missionDistanceKm,
    missionType,
    spacecraftMass,
    fuelType,
    eonetEvents,
    surfaceEnvironment,
  ]);
  useEffect(() => {
    const analyzeGravity = async () => {
      if (!systemEphemeris?.bodies?.length || !missionTrajectory.length) {
        setGravityInfluence(null);
        return;
      }
      try {
        const response = await fetch('/api/gravity/influences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trajectory: missionTrajectory.map((point) => ({
              ...point,
              pos: [
                point.pos[0] * missionKmPerUnit,
                point.pos[1] * missionKmPerUnit,
                point.pos[2] * missionKmPerUnit,
              ],
            })),
            bodyPositions: systemEphemeris.bodies.map((body) => ({
              id: body.id,
              name: body.id[0].toUpperCase() + body.id.slice(1),
              posKm: [body.x, body.y, body.z],
            })),
          }),
        });
        const data = await response.json();
        setGravityInfluence(data);
      } catch {
        setGravityInfluence(null);
      }
    };
    analyzeGravity();
  }, [systemEphemeris, missionTrajectory, missionKmPerUnit]);

  useEffect(() => {
    const analyzeRadiationIntersection = async () => {
      if (launchBodyId !== 'earth' || !missionTrajectory.length || !nearEarthRadiation?.environment?.zones?.length) {
        setRadiationIntersection(null);
        return;
      }
      try {
        const response = await fetch('/api/radiation/intersections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trajectory: missionTrajectory.map((point) => ({
              time_s: point.time_s,
              pos: [
                point.pos[0] * missionKmPerUnit,
                point.pos[1] * missionKmPerUnit,
                point.pos[2] * missionKmPerUnit,
              ],
            })),
          }),
        });
        const data = await response.json();
        setRadiationIntersection(data);
      } catch {
        setRadiationIntersection(null);
      }
    };
    analyzeRadiationIntersection();
  }, [launchBodyId, missionTrajectory, missionKmPerUnit, nearEarthRadiation]);

  useEffect(() => {
    const analyzeCislunarOps = async () => {
      if (!missionTrajectory.length || launchBodyId !== 'earth' || targetPlanet !== 'moon') {
        setCislunarOps(null);
        return;
      }
      try {
        const response = await fetch('/api/ops/cislunar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trajectory: missionTrajectory.map((point) => ({
              time_s: point.time_s,
              pos: [
                point.pos[0] * missionKmPerUnit,
                point.pos[1] * missionKmPerUnit,
                point.pos[2] * missionKmPerUnit,
              ],
            })),
            launchDate,
            targetId: targetPlanet,
            lat: launchLatitude,
            lon: launchLongitude,
            crewCount: 4,
            shieldingFactor: clamp(0.58 + shieldingMassKg / 1000, 0.58, 0.86),
            powerGenerationKw: 6.2,
            hotelLoadKw: 4.8,
          }),
        });
        const data = await response.json();
        setCislunarOps(data);
      } catch {
        setCislunarOps(null);
      }
    };
    analyzeCislunarOps();
  }, [missionTrajectory, missionKmPerUnit, launchDate, launchBodyId, targetPlanet, launchLatitude, launchLongitude, shieldingMassKg]);

  useEffect(() => {
    const analyzeTrajectoryDesign = async () => {
      if (!missionTrajectory.length) {
        setTrajectoryDesign(null);
        return;
      }
      try {
        const response = await fetch('/api/trajectory/design', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            launchDate,
            launchBodyId,
            targetBodyId: targetPlanet,
            departureAltitudeKm: Math.max(launchAltitudeKm, 180),
            arrivalAltitudeKm: targetPlanet === 'moon' ? 100 : 250,
            weatherWindKmh: weatherData?.wind_speed ?? 15,
            precipitationMm: weatherData?.precipitation ?? 0,
            radiationIndex: Math.max(nasaWeather?.radiationIndex ?? 1, nearEarthRadiation?.environment?.aggregateIndex ?? 1),
            dsnCoverage: clamp((dsnVisibility?.windows?.reduce((sum, item) => sum + item.durationMinutes, 0) ?? 0) / (72 * 60), 0, 1),
            currentPhaseAngleDeg: 0,
            targetPhaseAngleDeg: targetPlanet === 'moon' ? 35 : targetPlanet === 'mars' ? 44 : 25,
            crewed: missionType !== 'rover',
          }),
        });
        const data = await response.json();
        setTrajectoryDesign(response.ok ? data : null);
      } catch {
        setTrajectoryDesign(null);
      }
    };
    analyzeTrajectoryDesign();
  }, [missionTrajectory, launchDate, launchBodyId, targetPlanet, launchAltitudeKm, weatherData, nasaWeather, nearEarthRadiation, dsnVisibility, missionType]);

  useEffect(() => {
    const analyzeGround = async () => {
      try {
        const response = await fetch('/api/ground/constraints', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            launchSiteId: selectedLaunchSiteId,
            vehicleName: launchBodyId === 'earth' ? (missionType === 'lunar' ? 'Artemis' : 'Falcon 9') : 'Deep Space Vehicle',
            launchAzimuthDeg: targetPlanet === 'moon' ? 72 : targetPlanet === 'mars' ? 95 : 110,
            missionType,
            launchDate,
          }),
        });
        const data = await response.json();
        setGroundConstraints(response.ok ? data : null);
      } catch {
        setGroundConstraints(null);
      }
    };
    analyzeGround();
  }, [selectedLaunchSiteId, launchBodyId, missionType, targetPlanet, launchDate]);

  useEffect(() => {
    const analyzeSurface = async () => {
      try {
        const response = await fetch('/api/surface/environment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bodyId: targetPlanet,
            latitudeDeg: targetPlanet === 'moon' ? -89.5 : 4.5,
            longitudeDeg: 0,
            altitudeKm: 0,
            dateIso: `${launchDate}T12:00:00Z`,
          }),
        });
        const data = await response.json();
        setSurfaceEnvironment(response.ok ? data : null);
      } catch {
        setSurfaceEnvironment(null);
      }
    };
    analyzeSurface();
  }, [targetPlanet, launchDate]);

  useEffect(() => {
    const analyzeLaunchCommit = async () => {
      if (launchBodyId !== 'earth') {
        setLaunchConstraintAnalysis(null);
        return;
      }
      try {
        const response = await fetch('/api/launch/constraints', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lat: launchLatitude,
            lon: launchLongitude,
            maxQAltitudeKm: simResult?.best.maxQAltitudeKm ?? 11,
            atmosphereScaleHeightKm: launchBody.atmosphereScaleHeightKm ?? 8.5,
          }),
        });
        const data = await response.json();
        setLaunchConstraintAnalysis(response.ok ? data : null);
      } catch {
        setLaunchConstraintAnalysis(null);
      }
    };
    analyzeLaunchCommit();
  }, [launchBodyId, launchLatitude, launchLongitude, simResult?.best.maxQAltitudeKm, launchBody.atmosphereScaleHeightKm]);

  useEffect(() => {
    const analyzeConsumablesAndConsole = async () => {
      if (!missionTrajectory.length) {
        setConsumablesAnalysis(null);
        setOpsConsole(null);
        return;
      }
      try {
        const missionDurationHours = Math.max(24, (missionTrajectory[missionTrajectory.length - 1]?.time_s ?? 0) / 3600 || (trajectoryDesign?.abortBranches?.[0]?.timeToRecoveryDays ?? 1) * 24);
        const crewCount = 4;
        const oxygenRequiredKg = crewCount * 0.84 * (missionDurationHours / 24);
        const waterRequiredKg = crewCount * 3.2 * (missionDurationHours / 24);
        const propellantRequiredKg = Math.max(optResult?.fuelMass_kg ?? 0, Math.max(spacecraftMass * 0.18, missionDurationHours * 0.7));
        const commBudgetMinutes = Math.max(
          (dsnVisibility?.windows?.reduce((sum, item) => sum + item.durationMinutes, 0) ?? 0),
          missionDurationHours * 8 * 1.25,
        );
        const consumablesResponse = await fetch('/api/consumables/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            durationHours: missionDurationHours,
            initial: {
              powerKWh: Math.max(320, missionDurationHours * 1.8),
              thermalMarginC: 22,
              commMinutes: commBudgetMinutes,
              propellantKg: propellantRequiredKg * 1.2,
              crewHours: 0,
              oxygenKg: oxygenRequiredKg * 1.35,
              waterKg: waterRequiredKg * 1.35,
            },
            powerDrawKw: 4.8,
            powerGenerationKw: 6.2,
            thermalLoadCPerHour: 0.9,
            thermalRejectionCPerHour: 1.1,
            commMinutesPerHour: 8,
            propellantFlowKgPerHour: Math.max(0.2, (trajectoryDesign?.reservePolicy?.reserveDeltaVKmS ?? 0.4) * 8),
            crewCount,
          }),
        });
        const consumablesData = await consumablesResponse.json();
        setConsumablesAnalysis(consumablesResponse.ok ? consumablesData : null);

        const consoleResponse = await fetch('/api/ops/console', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            anomalies: gravityInfluence?.assessments?.filter((item) => item.willInfluence).map((item) => ({
              anomalyType: `${item.bodyName.toUpperCase()}_GRAVITY`,
              severity: item.influenceRatio > 0.8 ? 'HIGH' : 'MODERATE',
              confidence: item.influenceRatio,
            })) ?? [],
            goNoGoRules: cislunarOps?.analysis.goNoGo.rules ?? [],
            consumablesDepletions: consumablesData?.analysis?.depleted ?? [],
            telemetryFrame: telemetryFeed?.frame
              ? {
                  commStatus: telemetryFeed.frame.subsystemFlags?.[0] ?? 'OK',
                  radiationLevel: telemetryFeed.frame.radiationDoseRate,
                  thermalMarginC: 10,
                }
              : null,
          }),
        });
        const consoleData = await consoleResponse.json();
        setOpsConsole(consoleResponse.ok ? consoleData : null);
      } catch {
        setConsumablesAnalysis(null);
        setOpsConsole(null);
      }
    };
    analyzeConsumablesAndConsole();
  }, [missionTrajectory, trajectoryDesign, dsnVisibility, optResult, spacecraftMass, gravityInfluence, cislunarOps, telemetryFeed]);

  useEffect(() => {
    const solveTimeline = async () => {
      try {
        const response = await fetch('/api/timeline/solve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tasks: timelineTasks }),
        });
        const data = await response.json();
        setTimelineSolution(response.ok ? data : null);
      } catch {
        setTimelineSolution(null);
      }
    };
    solveTimeline();
  }, [timelineTasks]);

  useEffect(() => {
    const analyzeVehicle = async () => {
      try {
        const response = await fetch('/api/vehicle/multistage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stages: stageConfigs,
            payloadMassKg: Math.max(1000, spacecraftMass * 0.18),
            entryVelocityKmS: missionType === 'lunar' ? 11.1 : 7.8,
            noseRadiusM: Math.max(0.8, Math.cbrt((stlAnalysis?.volume ?? 6) / Math.PI)),
            stlAnalysis,
          }),
        });
        const data = await response.json();
        setMultistageAssessment(response.ok ? data : null);
      } catch {
        setMultistageAssessment(null);
      }
    };
    analyzeVehicle();
  }, [stageConfigs, spacecraftMass, missionType, stlAnalysis]);

  const runSgp4Analysis = useCallback(async () => {
    const records = parseTleText(tleInputText);
    if (!records.length) {
      setSgp4Propagation(null);
      setSgp4Conjunctions(null);
      setSgp4Residuals(null);
      addLog('No valid TLE records found for SGP4 analysis');
      return;
    }
    try {
      const [propagationResponse, conjunctionResponse] = await Promise.all([
        fetch('/api/sgp4/propagate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ records, epoch: `${launchDate}T12:00:00Z` }),
        }),
        fetch('/api/sgp4/conjunctions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ records, startTime: `${launchDate}T00:00:00Z`, horizonMinutes: 24 * 60, stepSeconds: 120 }),
        }),
      ]);
      const propagationData = await propagationResponse.json();
      const conjunctionData = await conjunctionResponse.json();
      setSgp4Propagation(propagationResponse.ok ? propagationData : null);
      setSgp4Conjunctions(conjunctionResponse.ok ? conjunctionData : null);

      const primaryState = propagationData?.states?.[0];
      if (primaryState) {
        const covarianceResponse = await fetch('/api/sgp4/covariance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            state: {
              positionKm: primaryState.positionKm,
              velocityKmS: primaryState.velocityKmS,
              sigmaPositionKm: 1.5,
              sigmaVelocityKmS: 0.002,
            },
            horizonMinutes: 180,
          }),
        });
        const covarianceData = await covarianceResponse.json();
        setCovariancePropagation(covarianceResponse.ok ? covarianceData : null);

        const targetPoint = missionTrajectory[Math.min(missionTrajectory.length - 1, Math.max(1, Math.floor(missionTrajectory.length * 0.7)))];
        if (targetPoint) {
          const targetingResponse = await fetch('/api/maneuver/target', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              currentPositionKm: primaryState.positionKm,
              currentVelocityKmS: primaryState.velocityKmS,
              targetPositionKm: [
                targetPoint.pos[0] * missionKmPerUnit,
                targetPoint.pos[1] * missionKmPerUnit,
                targetPoint.pos[2] * missionKmPerUnit,
              ],
              targetVelocityKmS: targetPoint.vel ?? [0, 0, 0],
              timeToGoHours: Math.max(2, ((targetPoint.time_s ?? 0) / 3600) - 1),
              thrustN: spacecraftThrust,
              massKg: spacecraftMass,
            }),
          });
          const targetingData = await targetingResponse.json();
          setManeuverTargeting(targetingResponse.ok ? targetingData : null);
        } else {
          setManeuverTargeting(null);
        }
      } else {
        setCovariancePropagation(null);
        setManeuverTargeting(null);
      }

      const observed = parseObservedStateText(observedStateText);
      if (observed.length && propagationData?.states?.length) {
        const residualResponse = await fetch('/api/sgp4/residuals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ predicted: propagationData.states, observed }),
        });
        const residualData = await residualResponse.json();
        setSgp4Residuals(residualResponse.ok ? residualData : null);
      } else {
        setSgp4Residuals(null);
      }
      addLog(`SGP4 screening complete for ${records.length} records`);
    } catch {
      setSgp4Propagation(null);
      setSgp4Conjunctions(null);
      setSgp4Residuals(null);
      setCovariancePropagation(null);
      setManeuverTargeting(null);
      addLog('SGP4 analysis failed');
    }
  }, [tleInputText, observedStateText, launchDate, addLog, missionTrajectory, missionKmPerUnit, spacecraftThrust, spacecraftMass]);

  const exportCcsdsProducts = useCallback(async () => {
    try {
      const points = missionTrajectory.map((point) => ({
        time_s: point.time_s,
        pos: [
          point.pos[0] * missionKmPerUnit,
          point.pos[1] * missionKmPerUnit,
          point.pos[2] * missionKmPerUnit,
        ],
        vel: point.vel ?? [0, 0, 0],
      }));
      const [oemResponse, opmResponse] = await Promise.all([
        fetch('/api/ccsds/oem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ points, metadata: { objectName: 'ARTEMIS-Q Trajectory', objectId: `${launchBodyId.toUpperCase()}-${targetPlanet.toUpperCase()}` } }),
        }),
        fetch('/api/ccsds/opm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            state: keplerian2ECI(keplerEl),
            epochIso: `${launchDate}T12:00:00Z`,
            metadata: { objectName: 'ARTEMIS-Q State', objectId: `${launchBodyId.toUpperCase()}-STATE` },
          }),
        }),
      ]);
      const [oemText, opmText] = await Promise.all([oemResponse.text(), opmResponse.text()]);
      setOemPreview(oemText);
      setOpmPreview(opmText);
      addLog('CCSDS OEM/OPM products generated');
    } catch {
      addLog('CCSDS export failed');
    }
  }, [missionTrajectory, missionKmPerUnit, launchBodyId, targetPlanet, keplerEl, launchDate, addLog]);

  const importCcsdsProduct = useCallback(async () => {
    if (!ccsdsImportText.trim()) {
      setCcsdsImportResult(null);
      return;
    }
    try {
      const response = await fetch('/api/ccsds/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: ccsdsImportText }),
      });
      const data = await response.json();
      setCcsdsImportResult(response.ok ? data : null);
      addLog(`Imported ${data?.points?.length ?? 0} CCSDS ephemeris samples`);
    } catch {
      setCcsdsImportResult(null);
      addLog('CCSDS import failed');
    }
  }, [ccsdsImportText, addLog]);

  const compareCurrentBaseline = useCallback(async () => {
    try {
      const response = await fetch('/api/baselines/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          before: importedMissionConfig ?? {},
          after: {
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
            keplerEl,
            policyProfile,
            shieldingMassKg,
          },
        }),
      });
      const data = await response.json();
      setBaselineComparison(response.ok ? data : null);
      addLog(`Baseline comparison generated: ${data?.comparison?.changedValues?.length ?? 0} changed fields`);
    } catch {
      setBaselineComparison(null);
      addLog('Baseline comparison failed');
    }
  }, [importedMissionConfig, launchBodyId, targetPlanet, launchDate, missionType, fuelType, launchLatitude, launchLongitude, launchAltitudeKm, spacecraftMass, spacecraftThrust, keplerEl, policyProfile, shieldingMassKg, addLog]);

  useEffect(() => {
    const analyzeEva = async () => {
      try {
        const response = await fetch('/api/eva/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            evaDurationHours,
            radiationDoseRateMsvHr: cislunarOps?.analysis?.dose?.peakDoseRateMsvHr ?? 0.12,
            commCoverageFraction: cislunarOps?.analysis?.consumables?.commCoverageFraction ?? 0.7,
            localTempC: surfaceEnvironment?.estimatedSurfaceTempC ?? -20,
            lifeSupportMarginHours: cislunarOps?.analysis?.consumables?.lifeSupportMarginHours ?? 72,
            daylight: surfaceEnvironment?.daylight ?? true,
          }),
        });
        const data = await response.json();
        setEvaPlan(response.ok ? data : null);
      } catch {
        setEvaPlan(null);
      }
    };
    analyzeEva();
  }, [evaDurationHours, cislunarOps, surfaceEnvironment]);

  useEffect(() => {
    const synthesizeFlightReview = async () => {
      try {
        const response = await fetch('/api/reports/flight-review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            missionName: `${launchBodyId} to ${targetPlanet}`,
            goNoGo: cislunarOps?.analysis?.goNoGo?.overall ?? (launchConstraintAnalysis?.analysis?.goForLaunch ? 'GO' : 'WATCH'),
            trajectoryDeltaV: trajectoryDesign?.patchedConic?.totalDeltaVKmS ?? (optResult?.totalDeltaV_ms ?? 0) / 1000,
            totalDoseMsv: cislunarOps?.analysis?.dose?.cumulativeDoseMsv ?? 0,
            conjunctionCount: sgp4Conjunctions?.conjunctions?.length ?? celestrakTraffic?.conjunctions?.length ?? 0,
            rangeGo: groundConstraints?.analysis?.rangeGo,
            launchGo: launchConstraintAnalysis?.analysis?.goForLaunch,
            opsStatus: opsConsole?.console?.status,
            provenance: [
              weatherData?.source ?? 'NO WEATHER',
              nasaWeather?.source ?? 'NO SPACE WEATHER',
              dsnVisibility?.source ?? 'NO DSN',
              trajectoryDesign?.source ?? 'NO TRAJECTORY DESIGN',
            ],
          }),
        });
        const data = await response.json();
        setFlightReview(response.ok ? data : null);
      } catch {
        setFlightReview(null);
      }
    };
    synthesizeFlightReview();
  }, [launchBodyId, targetPlanet, cislunarOps, launchConstraintAnalysis, trajectoryDesign, optResult, sgp4Conjunctions, celestrakTraffic, groundConstraints, opsConsole, weatherData, nasaWeather, dsnVisibility]);
  useEffect(() => {
    if (importedMissionConfig?.tleObjects?.length) {
      const lines = importedMissionConfig.tleObjects.flatMap((item) => [item.name, item.tle1, item.tle2]).join('\n');
      setTleInputText(lines);
    }
  }, [importedMissionConfig]);
  const missionStages = useMemo(() => {
    const derived = deriveTrajectoryStages(missionTrajectory, { kmPerUnit: missionKmPerUnit, targetPlanetId: targetPlanet, launchBodyId });
    const template = getFlightSequenceTemplate(targetPlanet, launchBodyId);
    return derived.length
      ? derived
      : template.map((stage, index) => ({
          sequence: index + 1,
          label: stage.label,
          progress: stage.progress,
          color: stageColor(stage.label),
          phase: stage.phase,
          driver: stage.driver,
        }));
  }, [missionTrajectory, missionKmPerUnit, targetPlanet, launchBodyId]);
  const vehicleTimelineStages = useMemo(
    () => deriveAscentTimelineStages(simResult, optResult?.physics.transferTime_days),
    [simResult, optResult?.physics.transferTime_days],
  );
  const displayedCrewHealth = useMemo(() => {
    if (launchBodyId === 'earth' && targetPlanet === 'moon' && cislunarOps?.analysis) {
      const dose = cislunarOps.analysis.dose;
      const consumables = cislunarOps.analysis.consumables;
      const unsafeDuration = dose.safeHavenWindows.reduce((sum, window) => sum + Math.max(0, window.endHour - window.startHour), 0);
      const missionDuration = Math.max(consumables.missionDurationHours, 1);
      const riskScore = clamp(
        0.42 * (dose.cumulativeDoseMsv / 35) +
        0.38 * (dose.peakDoseRateMsvHr / 0.32) +
        0.2 * (unsafeDuration / missionDuration),
        0,
        1.5,
      );
      const classification = classifyDisplayedCrewRisk(riskScore);
      const dominantSegment = dose.beltDoseMsv >= dose.deepSpaceDoseMsv
        ? {
            nodeName: 'Van Allen Passage',
            share: dose.cumulativeDoseMsv > 0 ? dose.beltDoseMsv / dose.cumulativeDoseMsv : 0,
          }
        : {
            nodeName: 'Deep Space Transit',
            share: dose.cumulativeDoseMsv > 0 ? dose.deepSpaceDoseMsv / dose.cumulativeDoseMsv : 0,
          };
      return {
        cumulativeDose: dose.cumulativeDoseMsv,
        peakExposure: dose.peakDoseRateMsvHr,
        unsafeDuration,
        riskScore,
        classification,
        embarkationDecision: embarkationFromDisplayedRisk(classification),
        dominantSegment,
        unitLabel: 'mSv',
        peakUnitLabel: 'mSv/h',
      };
    }
    if (!optResult?.crewRisk) return null;
    return {
      ...optResult.crewRisk,
      unitLabel: 'arb. dose',
      peakUnitLabel: 'dose-rate proxy',
    };
  }, [launchBodyId, targetPlanet, cislunarOps, optResult?.crewRisk]);
  const displayedMissionDecision = useMemo(() => {
    if (launchBodyId === 'earth' && targetPlanet === 'moon' && cislunarOps?.analysis && displayedCrewHealth) {
      const go = cislunarOps.analysis.goNoGo;
      const decision = go.overall === 'GO' ? 'CONTINUE' : go.overall === 'CONDITIONAL' ? 'REPLAN' : 'ABORT';
      const urgencyLevel = go.overall === 'GO' ? 'LOW' : go.overall === 'CONDITIONAL' ? 'MODERATE' : 'HIGH';
      return {
        decision,
        urgencyLevel,
        rationale: go.rationale,
        expectedRiskReduction: clamp(displayedCrewHealth.riskScore * (decision === 'ABORT' ? 0.9 : decision === 'REPLAN' ? 0.45 : 0), 0, 1.5),
        candidateActions: go.rules
          .filter((rule) => rule.status !== 'GO')
          .map((rule) => `${rule.rule}: ${rule.rationale}`),
      };
    }
    return optResult?.missionDecision ?? null;
  }, [launchBodyId, targetPlanet, cislunarOps, displayedCrewHealth, optResult?.missionDecision]);

  const ascentChartData = simResult?.best.steps.map((step) => ({
    time: step.time,
    altitude: step.altitude,
    velocity: step.velocity,
    q: step.q,
    pitch: step.pitch,
  })) ?? [];

  const annealData = optResult?.annealingHistory ?? [];
  const quantumLayerData = optResult?.qaoa.layers.map((layer, index) => ({
    layer: index + 1,
    energy: layer.energyExpectation,
    entropy: layer.entropyBits ?? 0,
    participation: layer.participationRatio ?? 0,
  })) ?? [];
  const quantumMarginalData = optResult?.qaoa.diagnostics?.qubitMarginals.map((p1, index) => ({
    qubit: `q${index}`,
    probabilityOne: p1,
  })) ?? [];
  const quantumZZData = optResult?.qaoa.diagnostics?.zzCorrelations.map((zz, index) => ({
    pair: `Z${index}Z${index + 1}`,
    correlation: zz,
  })) ?? [];
  const visualizerTitle = activeTab === 'vehicle'
    ? 'STL Aerodynamics Visualizer'
    : `${launchBody.name} to ${targetBody.name} Mission Visualizer`;

  return (
    <div className="min-h-screen bg-[#050810] text-slate-100">
      <div className="pointer-events-none fixed inset-0 opacity-[0.05]" style={{ backgroundImage: 'linear-gradient(to right, rgba(75,156,211,0.2) 1px, transparent 1px), linear-gradient(to bottom, rgba(75,156,211,0.2) 1px, transparent 1px)', backgroundSize: '42px 42px' }} />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-[1600px] flex-col px-4 py-4">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-black/40 px-5 py-4 backdrop-blur">
          <div>
            <div className="flex items-center gap-3">
              <img
                src="/logo.png"
                alt="ARTEMIS-Q logo"
                className="h-12 w-12 rounded-lg border border-slate-700 bg-slate-950/70 object-contain p-1 shadow-[0_8px_30px_rgba(0,0,0,0.35)]"
              />
              <div>
                <h1 className="text-xl font-bold uppercase tracking-[0.28em]">ARTEMIS-Q</h1>
                <p className="text-sm text-slate-400">Physics-informed mission analysis with explicit provenance and STL-driven ascent optimization.</p>
              </div>
            </div>
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
              title={visualizerTitle}
              icon={activeTab === 'vehicle' ? Wind : Globe}
              provenance={activeTab === 'vehicle' ? (stlAnalysis ? 'formula' : 'preset') : importedGraph ? 'formula' : 'preset'}
              className="flex-1"
            >
              {activeTab === 'vehicle' ? (
                stlAnalysis ? (
                  <AeroDynamicsVisualizer stlGeometry={stlVizGeometry} stlAnalysis={stlAnalysis} />
                ) : (
                  <div className="flex h-[420px] flex-col items-center justify-center gap-2 rounded-xl border border-slate-800 bg-black/40 px-6 text-center">
                    <p className="text-sm text-slate-300">
                      Upload an STL on this tab to inspect the vehicle’s aerodynamic cross-section, flow cues, and drag-driven trends in the main visualizer.
                    </p>
                    {stlAnalysis ? (
                      <p className="text-xs text-sky-200/90">Mesh ready ({stlFilename}).</p>
                    ) : (
                      <p className="max-w-md text-xs text-slate-500">
                        Without an STL, the aerodynamic viewer has no vehicle geometry to render. Upload a rocket mesh to drive frontal area and drag visualization.
                      </p>
                    )}
                  </div>
                )
              ) : (
                <>
                  <div className="relative h-[420px] overflow-hidden rounded-xl border border-slate-800 bg-black/40">
                    <Canvas>
                      <PerspectiveCamera makeDefault position={cislunarVisualizer ? [0, 72, 520] : [0, 80, 500]} />
                      <OrbitControls
                        ref={visualizerControlsRef}
                        enableDamping
                        dampingFactor={0.08}
                        rotateSpeed={0.72}
                        zoomSpeed={0.9}
                        panSpeed={0.82}
                        screenSpacePanning={false}
                        minDistance={cislunarVisualizer ? 55 : 80}
                        maxDistance={cislunarVisualizer ? 2200 : 1400}
                        minPolarAngle={0.18}
                        maxPolarAngle={Math.PI * 0.92}
                      />
                      <MissionSceneNavigator
                        controlsRef={visualizerControlsRef}
                        command={visualizerViewCommand}
                        trajectory={missionTrajectory}
                        stageList={missionStages}
                        cislunar={cislunarVisualizer}
                      />
                      <ambientLight intensity={0.45} />
                      <pointLight position={[500, 200, 200]} intensity={1.2} color="#fff9db" />
                      <MissionGlobe
                        launchDate={launchDate}
                        targetPlanetId={targetPlanet}
                        launchBodyId={launchBodyId}
                        preset={{ ...preset, nodes: missionGraph.nodes }}
                        pathNodeIds={optResult?.path ?? []}
                        keplerEl={keplerEl}
                        stageList={missionStages}
                        trajectory={missionTrajectory}
                        externalBodies={(solarBodies?.bodies ?? []).map((body) => {
                          const eph = systemEphemeris?.bodies?.find((item) => item.id === body.id);
                          return {
                            ...body,
                            pos: eph ? heliocentricHorizonsKmToScene(eph) : undefined,
                          };
                        })}
                        radiationEnvironment={nearEarthRadiation}
                      />
                    </Canvas>
                    <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
                      <div className="rounded-lg border border-slate-800/90 bg-slate-950/80 px-3 py-2 text-[11px] text-slate-300 shadow-xl backdrop-blur">
                        <p className="font-semibold text-slate-100">Visualizer Nav</p>
                        <p className="mt-1 text-slate-400">Drag to orbit, scroll to zoom, right-drag to pan.</p>
                      </div>
                      <div className="pointer-events-auto flex flex-wrap justify-end gap-2">
                        {([
                          { mode: 'fit', label: 'Fit Path' },
                          { mode: 'launch', label: `Focus ${launchBody.name}` },
                          { mode: 'target', label: `Focus ${targetBody.name}` },
                          { mode: 'reset', label: 'Reset View' },
                        ] as Array<{ mode: VisualizerViewMode; label: string }>).map((action) => (
                          <button
                            key={action.mode}
                            type="button"
                            className={cn(
                              'rounded-lg border px-3 py-1.5 text-[11px] font-semibold shadow-lg backdrop-blur transition',
                              visualizerViewCommand.mode === action.mode
                                ? 'border-sky-300/60 bg-sky-400/20 text-sky-100'
                                : 'border-slate-700/90 bg-slate-950/75 text-slate-300 hover:border-slate-500 hover:text-slate-100',
                            )}
                            onClick={() => setVisualizerViewCommand((previous) => ({ mode: action.mode, nonce: previous.nonce + 1 }))}
                          >
                            {action.label}
                          </button>
                        ))}
                      </div>
                    </div>
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
                  <div className="flex items-center justify-between text-sm text-slate-300">
                    <span>GOES Storm Level</span>
                    <span>{nearEarthRadiation?.goes?.stormLevel ?? '--'}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-slate-300">
                    <span>Traffic Alerts</span>
                    <span>{celestrakTraffic?.conjunctions?.length ?? 0}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-slate-300">
                    <span>DSN Windows</span>
                    <span>{dsnVisibility?.windows?.length ?? 0}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-slate-300">
                    <span>Gravity Triggers</span>
                    <span>{gravityInfluence?.assessments?.filter((item) => item.willInfluence).length ?? 0}</span>
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

            {displayedCrewHealth ? (
              <>
                <div className="grid gap-4 lg:grid-cols-2">
                  <DashboardCard title="Crew Health Panel" icon={ShieldAlert} provenance="formula">
                    <div className="grid grid-cols-2 gap-2">
                      <MetricBadge label="Cumulative Dose" value={displayedCrewHealth.cumulativeDose.toFixed(2)} unit={displayedCrewHealth.unitLabel} tone={displayedCrewHealth.cumulativeDose > (displayedCrewHealth.unitLabel === 'mSv' ? 35 : 18) ? 'bad' : 'warn'} />
                      <MetricBadge label="Peak Exposure" value={displayedCrewHealth.peakExposure.toFixed(2)} unit={displayedCrewHealth.peakUnitLabel} tone={displayedCrewHealth.peakExposure > (displayedCrewHealth.peakUnitLabel === 'mSv/h' ? 0.32 : 1) ? 'bad' : 'warn'} />
                      <MetricBadge label="Unsafe Duration" value={displayedCrewHealth.unsafeDuration.toFixed(1)} unit="hours" tone={displayedCrewHealth.unsafeDuration > 6 ? 'bad' : 'warn'} />
                      <MetricBadge label="Risk Score" value={displayedCrewHealth.riskScore.toFixed(2)} unit={displayedCrewHealth.classification} tone={displayedCrewHealth.riskScore > 1 ? 'bad' : displayedCrewHealth.riskScore > 0.6 ? 'warn' : 'good'} />
                    </div>
                    <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Embarkation</p>
                        <p className="text-sm text-slate-100">{displayedCrewHealth.embarkationDecision.replaceAll('_', ' ')}</p>
                      </div>
                      <StatusPill
                        value={displayedCrewHealth.classification}
                        tone={displayedCrewHealth.classification === 'SAFE' ? 'good' : displayedCrewHealth.classification === 'MONITOR' ? 'warn' : 'bad'}
                      />
                    </div>
                    <p className="mt-2 text-xs text-slate-400">
                      Dominant segment: {displayedCrewHealth.dominantSegment.nodeName} ({(displayedCrewHealth.dominantSegment.share * 100).toFixed(0)}% of cumulative modeled dose).
                    </p>
                  </DashboardCard>

                  <DashboardCard title="Mission Decision Panel" icon={AlertTriangle} provenance="formula">
                    {displayedMissionDecision ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <StatusPill
                            value={displayedMissionDecision.decision}
                            tone={displayedMissionDecision.decision === 'CONTINUE' ? 'good' : displayedMissionDecision.decision === 'REPLAN' ? 'warn' : 'bad'}
                          />
                          <StatusPill
                            value={displayedMissionDecision.urgencyLevel}
                            tone={displayedMissionDecision.urgencyLevel === 'LOW' ? 'good' : displayedMissionDecision.urgencyLevel === 'MODERATE' ? 'warn' : 'bad'}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <MetricBadge label="Risk Reduction" value={`${(displayedMissionDecision.expectedRiskReduction * 100).toFixed(0)}%`} unit="estimated" />
                          <MetricBadge label="Driver" value={launchBodyId === 'earth' && targetPlanet === 'moon' ? 'dose + ops rules' : optResult.medicalValidation?.dominantRiskDriver ?? '--'} unit="dominant factor" />
                          <MetricBadge label="Regret" value={optResult.regret?.regretScore.toFixed(2) ?? '--'} unit="utility gap" tone="warn" />
                          <MetricBadge label="VOI" value={optResult.voi?.valueOfWaiting.toFixed(2) ?? '--'} unit="value of waiting" tone={(optResult.voi?.valueOfWaiting ?? 0) > 0 ? 'good' : 'default'} />
                        </div>
                        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">
                          <p>{displayedMissionDecision.rationale}</p>
                          {optResult.hierarchy ? (
                            <div className="mt-2 space-y-1 text-xs text-slate-400">
                              <p>Low-level: {optResult.hierarchy.lowLevelAction}</p>
                              <p>Mid-level: {optResult.hierarchy.midLevelDecision}</p>
                              <p>High-level: {optResult.hierarchy.highLevelDecision}</p>
                            </div>
                          ) : null}
                          {displayedMissionDecision.candidateActions?.length ? (
                            <div className="mt-2 space-y-1 text-xs text-slate-400">
                              {displayedMissionDecision.candidateActions.map((action, index) => (
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
                          {bodyCatalog.map((body) => <option key={body.id} value={body.name} />)}
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
                          {bodyCatalog.map((planet) => (
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
                      <label className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                        Launch Site
                        <select className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" value={selectedLaunchSiteId} onChange={(event) => setSelectedLaunchSiteId(event.target.value)}>
                          {(launchSites?.sites ?? []).map((site) => (
                            <option key={site.id} value={site.id}>{site.name}</option>
                          ))}
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
                      <button className="rounded-lg border border-violet-400/30 bg-violet-400/10 px-4 py-3 text-sm font-semibold text-violet-200" onClick={exportCcsdsProducts}>
                        Generate OEM / OPM
                      </button>
                      <button className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm font-semibold text-amber-200" onClick={compareCurrentBaseline}>
                        Compare Baselines
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

                  <DashboardCard title="Body & Environment" icon={Globe} provenance={solarBodies?.source?.startsWith('LIVE') ? 'live-api' : 'formula'}>
                    <div className="space-y-3">
                      {(() => {
                        const selectedBody = solarBodies?.bodies?.find((body) => body.id === targetPlanet) ?? null;
                        return selectedBody ? (
                          <div className="grid grid-cols-2 gap-2">
                            <MetricBadge label="Body" value={selectedBody.englishName ?? selectedBody.name ?? targetPlanet} unit={selectedBody.bodyType ?? 'body'} />
                            <MetricBadge label="Radius" value={(selectedBody.meanRadius ?? targetBody.radiusKm).toFixed(0)} unit="km" />
                            <MetricBadge label="Gravity" value={(selectedBody.gravity ?? targetBody.standardGravity).toFixed(2)} unit="m/s²" />
                            <MetricBadge label="Orbital Period" value={(selectedBody.sideralOrbit ?? targetBody.orbit?.periodDays ?? 0).toFixed(1)} unit="days" />
                          </div>
                        ) : (
                          <p className="text-sm text-slate-400">Selected body metadata unavailable.</p>
                        );
                      })()}
                      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
                        <p>{nearEarthRadiation?.environment?.source ?? 'Radiation environment unavailable.'}</p>
                        {nearEarthRadiation?.goes?.observedAt ? (
                          <p className="mt-1">GOES observed: {new Date(nearEarthRadiation.goes.observedAt).toLocaleString()}</p>
                        ) : null}
                        {nearEarthRadiation?.donki?.windowEnd ? (
                          <p className="mt-1">DONKI window end: {new Date(nearEarthRadiation.donki.windowEnd).toLocaleDateString()}</p>
                        ) : null}
                        {nearEarthRadiation?.environment?.notes?.slice(0, 2).map((note, index) => (
                          <p key={index} className="mt-1">{note}</p>
                        ))}
                      </div>
                      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                        {radiationIntersection?.assessment ? (
                          <div className="space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              <MetricBadge label="Belt Risk" value={radiationIntersection.assessment.normalizedRiskIndex.toFixed(2)} unit="index" />
                              <MetricBadge label="Crossings" value={radiationIntersection.assessment.crossings.toFixed(0)} unit="zones" />
                              <MetricBadge label="In-Zone Path" value={radiationIntersection.assessment.totalTraversedDistanceKm.toFixed(0)} unit="km" />
                              <MetricBadge label="Peak Severity" value={radiationIntersection.assessment.maxZoneSeverity.toFixed(2)} unit="level" />
                            </div>
                            <div className="space-y-1 text-xs text-slate-400">
                              {radiationIntersection.assessment.zoneIntersections.filter((item) => item.entered).length ? radiationIntersection.assessment.zoneIntersections.filter((item) => item.entered).map((item) => (
                                <p key={item.label}>
                                  {item.label}: {item.traversedDistanceKm.toFixed(0)} km in-zone, exposure score {item.weightedExposureScore.toFixed(0)}
                                </p>
                              )) : (
                                <p>No modeled Van Allen belt penetration was detected on the current trajectory.</p>
                              )}
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-slate-400">Trajectory intersection scoring is available when the active path is Earth-centered.</p>
                        )}
                      </div>
                    </div>
                  </DashboardCard>

                  <DashboardCard title="Gravity Influence" icon={Rocket} provenance={gravityInfluence?.source?.startsWith('FORMULA') ? 'formula' : 'preset'}>
                    <div className="space-y-2">
                      {gravityInfluence?.assessments?.length ? gravityInfluence.assessments.slice(0, 4).map((item) => (
                        <div key={item.bodyId} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                          <div className="flex items-center justify-between text-sm text-slate-200">
                            <span>{item.bodyName}</span>
                            <span className={item.willInfluence ? 'text-amber-200' : 'text-slate-400'}>
                              {item.willInfluence ? 'Influential' : 'Minor'}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-slate-400">
                            Closest {item.closestApproachKm.toExponential(2)} km | SOI {item.sphereOfInfluenceKm.toExponential(2)} km | ratio {item.influenceRatio.toFixed(2)}
                          </div>
                        </div>
                      )) : (
                        <p className="text-sm text-slate-400">No planetary influence assessment is available for the current trajectory.</p>
                      )}
                    </div>
                  </DashboardCard>

                  <DashboardCard title="Crewed Cislunar Ops" icon={ShieldAlert} provenance={cislunarOps?.source?.includes('LIVE') ? 'live-api' : 'formula'}>
                    {cislunarOps?.analysis ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <MetricBadge label="Go / No-Go" value={cislunarOps.analysis.goNoGo.overall} unit="ops rule" tone={cislunarOps.analysis.goNoGo.overall === 'GO' ? 'good' : cislunarOps.analysis.goNoGo.overall === 'CONDITIONAL' ? 'warn' : 'bad'} />
                          <MetricBadge label="Dose" value={cislunarOps.analysis.dose.cumulativeDoseMsv.toFixed(1)} unit="mSv" tone={cislunarOps.analysis.dose.cumulativeDoseMsv < 25 ? 'good' : 'warn'} />
                          <MetricBadge label="Peak Dose Rate" value={cislunarOps.analysis.dose.peakDoseRateMsvHr.toFixed(2)} unit="mSv/h" tone={cislunarOps.analysis.dose.peakDoseRateMsvHr < 0.25 ? 'good' : 'warn'} />
                          <MetricBadge label="Beta Angle" value={cislunarOps.analysis.lighting.betaAngleDeg.toFixed(1)} unit="deg" />
                          <MetricBadge label="Longest Eclipse" value={cislunarOps.analysis.lighting.longestEclipseHours.toFixed(2)} unit="h" tone={cislunarOps.analysis.lighting.longestEclipseHours < 3.5 ? 'good' : 'warn'} />
                          <MetricBadge label="Comm Coverage" value={(cislunarOps.analysis.consumables.commCoverageFraction * 100).toFixed(0)} unit="%" tone={cislunarOps.analysis.consumables.commCoverageFraction > 0.6 ? 'good' : 'warn'} />
                          <MetricBadge label="Life Support" value={cislunarOps.analysis.consumables.lifeSupportMarginHours.toFixed(0)} unit="h margin" tone={cislunarOps.analysis.consumables.lifeSupportMarginHours > 168 ? 'good' : 'warn'} />
                          <MetricBadge label="Reserve Policy" value={cislunarOps.analysis.consumables.propellantReservePolicyPct.toFixed(1)} unit="% prop reserve" />
                        </div>
                        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
                          <p>{cislunarOps.analysis.goNoGo.rationale}</p>
                          {cislunarOps.analysis.dose.safeHavenRequired ? (
                            <p className="mt-1 text-amber-200">Safe-haven posture required during at least one elevated-dose segment.</p>
                          ) : null}
                          <div className="mt-2 space-y-1">
                            {cislunarOps.analysis.goNoGo.rules.slice(0, 4).map((rule) => (
                              <p key={rule.rule}>
                                {rule.rule}: <span className={rule.status === 'GO' ? 'text-emerald-300' : rule.status === 'WATCH' ? 'text-amber-300' : 'text-rose-300'}>{rule.status}</span> ({String(rule.value)}; {rule.threshold})
                              </p>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400">Crewed cislunar mission-ops analysis becomes available for Earth-to-Moon trajectories.</p>
                    )}
                  </DashboardCard>

                  <DashboardCard title="Trajectory Design" icon={ChevronRight} provenance={trajectoryDesign?.source?.startsWith('LIVE') ? 'live-api' : 'formula'}>
                    {trajectoryDesign ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <MetricBadge label="Lambert" value={trajectoryDesign.lambert.solved ? 'SOLVED' : 'REVIEW'} unit={`${trajectoryDesign.lambert.iterations} iter`} tone={trajectoryDesign.lambert.solved ? 'good' : 'warn'} />
                          <MetricBadge label="C3" value={trajectoryDesign.lambert.c3Km2S2.toFixed(2)} unit="km²/s²" />
                          <MetricBadge label="Total Δv" value={trajectoryDesign.patchedConic.totalDeltaVKmS.toFixed(2)} unit="km/s" tone="good" />
                          <MetricBadge label="Reserve" value={trajectoryDesign.reservePolicy.propellantReservePct.toFixed(1)} unit="% reserve" tone="warn" />
                          <MetricBadge label="Best Phasing" value={trajectoryDesign.phasing.bestDelayHours.toFixed(0)} unit="h delay" />
                          <MetricBadge label="Phase Residual" value={trajectoryDesign.phasing.residualDeg.toFixed(1)} unit="deg" tone={trajectoryDesign.phasing.residualDeg < 5 ? 'good' : 'warn'} />
                        </div>
                        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
                          <p>{trajectoryDesign.reservePolicy.rationale}</p>
                          <div className="mt-2 space-y-1">
                            {trajectoryDesign.gravityAssistSequences.slice(0, 3).map((item) => (
                              <p key={item.sequence.join('-')}>
                                {item.sequence.join(' → ')} | gain {item.estimatedDeltaVGainKmS.toFixed(2)} km/s | score {item.score.toFixed(2)}
                              </p>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-2">
                          {trajectoryDesign.abortBranches.map((branch) => (
                            <div key={branch.label} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-300">
                              <div className="flex items-center justify-between">
                                <span>{branch.label}</span>
                                <span className="text-sky-200">{branch.branchType}</span>
                              </div>
                              <p className="mt-1 text-slate-400">Δv {branch.deltaVKmS.toFixed(2)} km/s | recovery {branch.timeToRecoveryDays.toFixed(1)} d | risk x{branch.riskModifier.toFixed(2)}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400">Trajectory-design outputs appear once the active mission geometry is available.</p>
                    )}
                  </DashboardCard>

                  <DashboardCard title="Timeline Editor" icon={Gauge} provenance={timelineSolution ? 'formula' : 'preset'}>
                    <div className="space-y-3">
                      {timelineTasks.map((task, index) => (
                        <div key={task.id} className="grid grid-cols-[1.3fr_0.6fr_0.7fr] gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                          <label className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                            Task
                            <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-100" value={task.name} onChange={(event) => setTimelineTasks((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} />
                          </label>
                          <label className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                            Duration
                            <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-100" type="number" value={task.durationHours} onChange={(event) => setTimelineTasks((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, durationHours: +event.target.value } : item))} />
                          </label>
                          <label className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                            Resource
                            <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-100" value={task.resource ?? ''} onChange={(event) => setTimelineTasks((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, resource: event.target.value } : item))} />
                          </label>
                        </div>
                      ))}
                      {timelineSolution?.timeline ? (
                        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                          <div className="mb-2 grid grid-cols-2 gap-2">
                            <MetricBadge label="Total Duration" value={timelineSolution.timeline.totalDurationHours.toFixed(1)} unit="h" />
                            <MetricBadge label="Violations" value={String(timelineSolution.timeline.violations.length)} tone={timelineSolution.timeline.violations.length ? 'warn' : 'good'} />
                          </div>
                          <div className="space-y-2 text-xs text-slate-300">
                            {timelineSolution.timeline.tasks.map((task) => (
                              <div key={task.id} className="rounded border border-slate-800 bg-black/20 px-3 py-2">
                                <div className="flex items-center justify-between">
                                  <span>{task.name}</span>
                                  <span className={task.critical ? 'text-amber-200' : 'text-slate-400'}>{formatHour(task.scheduledStartHour)} → {formatHour(task.scheduledFinishHour)}</span>
                                </div>
                                <p className="mt-1 text-slate-500">Slack {task.slackHours.toFixed(1)} h {task.critical ? '| critical path' : ''}</p>
                              </div>
                            ))}
                            {timelineSolution.timeline.violations.map((violation) => (
                              <p key={violation} className="text-rose-300">{violation}</p>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </DashboardCard>

                  <DashboardCard title="Ground Range & Recovery" icon={Globe} provenance={groundConstraints?.source?.startsWith('FORMULA') ? 'formula' : 'preset'}>
                    {groundConstraints?.analysis ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <MetricBadge label="Range" value={groundConstraints.analysis.rangeGo ? 'GO' : 'NO-GO'} unit={groundConstraints.analysis.launchSite.name} tone={groundConstraints.analysis.rangeGo ? 'good' : 'bad'} />
                          <MetricBadge label="Pads" value={String(groundConstraints.analysis.padStatus.filter((pad) => pad.available).length)} unit="available" tone={groundConstraints.analysis.padStatus.some((pad) => pad.available) ? 'good' : 'bad'} />
                          <MetricBadge label="Corridors" value={String(groundConstraints.analysis.recoveryCorridors.length)} unit="recovery lanes" />
                          <MetricBadge label="Exclusions" value={String(groundConstraints.analysis.airspaceMaritimeExclusions.length)} unit="active zones" />
                        </div>
                        <GroundRangeOverlay analysis={groundConstraints.analysis} />
                        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
                          <p>{groundConstraints.analysis.rationale}</p>
                          <div className="mt-2 space-y-1">
                            {groundConstraints.analysis.padStatus.map((pad) => (
                              <p key={pad.padId}>{pad.padId.toUpperCase()}: <span className={pad.available ? 'text-emerald-300' : 'text-rose-300'}>{pad.available ? 'available' : 'blocked'}</span> ({pad.rationale})</p>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400">Ground-range scheduling and exclusion geometry appear after launch-site analysis resolves.</p>
                    )}
                  </DashboardCard>

                  <DashboardCard title="Consumables, Surface & Console" icon={AlertTriangle} provenance={opsConsole?.source?.startsWith('FORMULA') ? 'formula' : 'preset'}>
                    <div className="space-y-3">
                      {consumablesAnalysis?.analysis ? (
                        <div className="grid grid-cols-2 gap-2">
                          <MetricBadge label="Power" value={consumablesAnalysis.analysis.finalState.powerKWh.toFixed(1)} unit="kWh final" tone={consumablesAnalysis.analysis.finalState.powerKWh > 50 ? 'good' : 'warn'} />
                          <MetricBadge label="Propellant" value={consumablesAnalysis.analysis.finalState.propellantKg.toFixed(0)} unit="kg final" tone={consumablesAnalysis.analysis.finalState.propellantKg > 1000 ? 'good' : 'warn'} />
                          <MetricBadge label="Oxygen" value={consumablesAnalysis.analysis.finalState.oxygenKg.toFixed(1)} unit="kg final" tone={consumablesAnalysis.analysis.finalState.oxygenKg > 20 ? 'good' : 'warn'} />
                          <MetricBadge label="Water" value={consumablesAnalysis.analysis.finalState.waterKg.toFixed(1)} unit="kg final" tone={consumablesAnalysis.analysis.finalState.waterKg > 20 ? 'good' : 'warn'} />
                        </div>
                      ) : null}
                      {surfaceEnvironment ? (
                        <div className="grid grid-cols-2 gap-2">
                          <MetricBadge label="Surface Temp" value={surfaceEnvironment.estimatedSurfaceTempC.toFixed(1)} unit="°C" tone={Math.abs(surfaceEnvironment.estimatedSurfaceTempC) < 80 ? 'good' : 'warn'} />
                          <MetricBadge label="Solar Elevation" value={surfaceEnvironment.solarElevationDeg.toFixed(1)} unit="deg" />
                          <MetricBadge label="Local Gravity" value={surfaceEnvironment.localGravityMs2.toFixed(2)} unit="m/s²" />
                          <MetricBadge label="Dust Risk" value={surfaceEnvironment.dustOrRegolithRisk} unit={surfaceEnvironment.bodyId} tone={surfaceEnvironment.dustOrRegolithRisk === 'LOW' ? 'good' : 'warn'} />
                        </div>
                      ) : null}
                      {opsConsole?.console ? (
                        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <p className="text-sm text-slate-100">Mission Status Console</p>
                            <StatusPill value={opsConsole.console.status} tone={opsConsole.console.status === 'NOMINAL' ? 'good' : opsConsole.console.status === 'WATCH' ? 'warn' : 'bad'} />
                          </div>
                          <div className="space-y-2 text-xs text-slate-300">
                            {opsConsole.console.alarms.length ? opsConsole.console.alarms.slice(0, 6).map((alarm) => (
                              <div key={`${alarm.title}-${alarm.detail}`} className="rounded border border-slate-800 bg-black/20 px-3 py-2">
                                <div className="flex items-center justify-between">
                                  <span>{alarm.title}</span>
                                  <StatusPill value={alarm.severity} tone={alarm.severity === 'INFO' ? 'default' : alarm.severity === 'WATCH' ? 'warn' : 'bad'} />
                                </div>
                                <p className="mt-1 text-slate-500">{alarm.detail}</p>
                              </div>
                            )) : <p className="text-slate-500">No active alarms.</p>}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </DashboardCard>

                  <DashboardCard title="Crew EVA & Flight Review" icon={ShieldAlert} provenance={flightReview ? 'formula' : 'preset'}>
                    <div className="space-y-3">
                      <label className="block text-[10px] uppercase tracking-[0.14em] text-slate-500">
                        EVA Duration
                        <input className="mt-1 w-full" type="range" min={1} max={10} step={0.5} value={evaDurationHours} onChange={(event) => setEvaDurationHours(+event.target.value)} />
                        <span className="mt-1 block text-xs text-sky-200">{evaDurationHours.toFixed(1)} h</span>
                      </label>
                      {evaPlan?.eva ? (
                        <div className="grid grid-cols-2 gap-2">
                          <MetricBadge label="EVA" value={evaPlan.eva.constraintsSatisfied ? 'GO' : 'HOLD'} unit="constraint check" tone={evaPlan.eva.constraintsSatisfied ? 'good' : 'bad'} />
                          <MetricBadge label="Dose" value={evaPlan.eva.doseDuringEvaMsv.toFixed(2)} unit="mSv EVA" tone={evaPlan.eva.doseDuringEvaMsv < 2.5 ? 'good' : 'warn'} />
                          <MetricBadge label="Comm" value={(evaPlan.eva.commCoverageFraction * 100).toFixed(0)} unit="%" tone={evaPlan.eva.commCoverageFraction > 0.55 ? 'good' : 'warn'} />
                          <MetricBadge label="Margin" value={evaPlan.eva.consumablesMarginHours.toFixed(1)} unit="h life-support" tone={evaPlan.eva.consumablesMarginHours > 6 ? 'good' : 'warn'} />
                        </div>
                      ) : null}
                      {evaPlan?.eva ? (
                        <p className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs leading-relaxed text-slate-300">{evaPlan.eva.rationale}</p>
                      ) : null}
                      {flightReview?.report ? (
                        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <p className="text-sm text-slate-100">{flightReview.report.headline}</p>
                            <StatusPill value={flightReview.report.readiness} tone={flightReview.report.readiness === 'READY' ? 'good' : flightReview.report.readiness === 'CONDITIONAL' ? 'warn' : 'bad'} />
                          </div>
                          <div className="space-y-1 text-xs text-slate-400">
                            {flightReview.report.findings.slice(0, 4).map((item) => (
                              <p key={item}>• {item}</p>
                            ))}
                          </div>
                          <div className="mt-2 space-y-1 text-xs text-slate-300">
                            {flightReview.report.actions.map((item) => (
                              <p key={item}>{item}</p>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </DashboardCard>

                  <DashboardCard title="CCSDS & Baselines" icon={Atom} provenance={baselineComparison ? 'formula' : 'preset'}>
                    <div className="space-y-3">
                      <label className="block text-[10px] uppercase tracking-[0.14em] text-slate-500">
                        Import OEM / OPM-like text
                        <textarea className="mt-1 h-28 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100" value={ccsdsImportText} onChange={(event) => setCcsdsImportText(event.target.value)} placeholder="Paste CCSDS OEM/OPM text here..." />
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-200" onClick={importCcsdsProduct}>Import CCSDS</button>
                        <button className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-200" onClick={exportCcsdsProducts}>Refresh OEM / OPM</button>
                      </div>
                      {ccsdsImportResult ? (
                        <div className="grid grid-cols-2 gap-2">
                          <MetricBadge label="Imported Points" value={String(ccsdsImportResult.points.length)} unit="ephemeris rows" />
                          <MetricBadge label="Metadata Keys" value={String(Object.keys(ccsdsImportResult.metadata).length)} unit="parsed" />
                        </div>
                      ) : null}
                      {baselineComparison ? (
                        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-300">
                          <p>Before {baselineComparison.beforeVersion.versionHash} → After {baselineComparison.afterVersion.versionHash}</p>
                          <div className="mt-2 space-y-1 text-slate-500">
                            {baselineComparison.comparison.changedValues.slice(0, 5).map((item) => (
                              <p key={item.path}>{item.path}: {item.before} → {item.after}</p>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {(oemPreview || opmPreview) ? (
                        <div className="grid gap-2 lg:grid-cols-2">
                          <pre className="max-h-32 overflow-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-[10px] text-slate-400">{oemPreview.slice(0, 900)}</pre>
                          <pre className="max-h-32 overflow-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-[10px] text-slate-400">{opmPreview.slice(0, 900)}</pre>
                        </div>
                      ) : null}
                    </div>
                  </DashboardCard>

                  <DashboardCard title="Provenance Audit" icon={ShieldAlert}>
                    <SourceStatus
                      weatherData={weatherData}
                      openMeteoWeather={openMeteoWeather}
                      nasaWeather={nasaWeather}
                      solarBodies={solarBodies}
                      nearEarthRadiation={nearEarthRadiation}
                      gravityInfluence={gravityInfluence}
                      eonetEvents={eonetEvents}
                      celestrakTraffic={celestrakTraffic}
                      telemetryFeed={telemetryFeed}
                      dsnVisibility={dsnVisibility}
                      webGeoCalcMeta={webGeoCalcMeta}
                      stlAnalysis={stlAnalysis}
                      simResult={simResult}
                      trajectoryDesign={trajectoryDesign}
                      groundConstraints={groundConstraints}
                      launchConstraintAnalysis={launchConstraintAnalysis}
                      sgp4Propagation={sgp4Propagation}
                      multistageAssessment={multistageAssessment}
                    />
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

                  <DashboardCard title="Conjunction Panel" icon={ShieldAlert} provenance={importedGraph ? 'formula' : celestrakTraffic?.source?.startsWith('LIVE') ? 'live-api' : 'preset'}>
                    <ConjunctionPanel importedNodes={importedGraph?.nodes ?? []} externalThreats={celestrakTraffic?.conjunctions ?? []} />
                  </DashboardCard>

                  <DashboardCard title="SGP4 Orbital Ops" icon={Rocket} provenance={sgp4Propagation?.source?.startsWith('FORMULA') ? 'formula' : 'preset'}>
                    <div className="space-y-3">
                      <label className="block text-[10px] uppercase tracking-[0.14em] text-slate-500">
                        TLE Records
                        <textarea className="mt-1 h-36 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100" value={tleInputText} onChange={(event) => setTleInputText(event.target.value)} />
                      </label>
                      <button className="w-full rounded-lg border border-sky-400/30 bg-sky-400/10 px-4 py-3 text-sm font-semibold text-sky-200" onClick={() => void runSgp4Analysis()}>
                        Run SGP4 Propagation & TCA
                      </button>
                      {sgp4Propagation ? (
                        <div className="grid grid-cols-2 gap-2">
                          <MetricBadge label="Objects" value={String(sgp4Propagation.states.length)} unit="propagated" />
                          <MetricBadge label="Conjunctions" value={String(sgp4Conjunctions?.conjunctions.length ?? 0)} unit="screened" tone={(sgp4Conjunctions?.conjunctions.length ?? 0) > 0 ? 'warn' : 'good'} />
                        </div>
                      ) : null}
                      {sgp4Conjunctions?.conjunctions?.slice(0, 4).map((item) => (
                        <div key={`${item.objectA}-${item.objectB}`} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-300">
                          <div className="flex items-center justify-between">
                            <span>{item.objectA} vs {item.objectB}</span>
                            <span className="text-sky-200">{item.closestApproachKm.toFixed(2)} km</span>
                          </div>
                          <p className="mt-1 text-slate-500">{new Date(item.tcaIso).toLocaleString()} | rel vel {item.relativeVelocityKmS.toFixed(2)} km/s | P {item.collisionProbability.toExponential(2)}</p>
                        </div>
                      ))}
                    </div>
                  </DashboardCard>

                  <DashboardCard title="Navigation Residuals & Launch Commit" icon={AlertTriangle} provenance={launchConstraintAnalysis ? 'formula' : 'preset'}>
                    <div className="space-y-3">
                      <label className="block text-[10px] uppercase tracking-[0.14em] text-slate-500">
                        Observed State JSON
                        <textarea className="mt-1 h-28 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100" value={observedStateText} onChange={(event) => setObservedStateText(event.target.value)} placeholder='[{"id":"iss","positionKm":[...],"velocityKmS":[...]}]' />
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {launchConstraintAnalysis?.analysis ? (
                          <>
                            <MetricBadge label="Launch Commit" value={launchConstraintAnalysis.analysis.goForLaunch ? 'GO' : 'HOLD'} unit="weather / atmosphere" tone={launchConstraintAnalysis.analysis.goForLaunch ? 'good' : 'bad'} />
                            <MetricBadge label="ρ @ Max-Q" value={launchConstraintAnalysis.analysis.densityAtMaxQKgM3.toExponential(2)} unit="kg/m³" />
                            <MetricBadge label="Wind Score" value={launchConstraintAnalysis.analysis.windConstraintScore.toFixed(2)} unit="normalized" tone={launchConstraintAnalysis.analysis.windConstraintScore < 1 ? 'good' : 'warn'} />
                            <MetricBadge label="Upper Atmos" value={launchConstraintAnalysis.analysis.upperAtmospherePenalty.toFixed(2)} unit="penalty" tone="warn" />
                          </>
                        ) : null}
                      </div>
                      {sgp4Residuals?.residuals?.length ? (
                        <div className="space-y-2">
                          {sgp4Residuals.residuals.slice(0, 4).map((item) => (
                            <div key={item.id} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-300">
                              <div className="flex items-center justify-between">
                                <span>{item.id}</span>
                                <span className="text-sky-200">{item.positionResidualKm.toFixed(3)} km</span>
                              </div>
                              <p className="mt-1 text-slate-500">Velocity residual {item.velocityResidualKmS.toFixed(5)} km/s</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-400">Paste observed states and rerun SGP4 to compute orbit-determination residuals.</p>
                      )}
                    </div>
                  </DashboardCard>

                  <DashboardCard title="Covariance & Targeting" icon={Gauge} provenance={covariancePropagation ? 'formula' : 'preset'}>
                    <div className="space-y-3">
                      {covariancePropagation?.propagation ? (
                        <div className="grid grid-cols-2 gap-2">
                          <MetricBadge label="σ Position" value={covariancePropagation.propagation.sigmaPositionKm.toFixed(2)} unit="km" tone="warn" />
                          <MetricBadge label="σ Velocity" value={covariancePropagation.propagation.sigmaVelocityKmS.toExponential(2)} unit="km/s" />
                          <MetricBadge label="Along-Track" value={covariancePropagation.propagation.alongTrackSigmaKm.toFixed(2)} unit="km" />
                          <MetricBadge label="95% Miss" value={covariancePropagation.propagation.missDistance95Km.toFixed(2)} unit="km" tone={covariancePropagation.propagation.missDistance95Km < 10 ? 'good' : 'warn'} />
                        </div>
                      ) : (
                        <p className="text-sm text-slate-400">Run SGP4 propagation to seed covariance growth and uncertainty screening.</p>
                      )}
                      {maneuverTargeting?.targeting ? (
                        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <p className="text-sm text-slate-100">Maneuver Design</p>
                            <StatusPill value={maneuverTargeting.targeting.targetingQuality} tone={maneuverTargeting.targeting.targetingQuality === 'GOOD' ? 'good' : maneuverTargeting.targeting.targetingQuality === 'WATCH' ? 'warn' : 'bad'} />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <MetricBadge label="Δv" value={maneuverTargeting.targeting.deltaVMagnitudeKmS.toFixed(4)} unit="km/s" tone="good" />
                            <MetricBadge label="Burn" value={maneuverTargeting.targeting.burnDurationS.toFixed(1)} unit="s" />
                            <MetricBadge label="Closing V" value={maneuverTargeting.targeting.closingVelocityKmS.toFixed(4)} unit="km/s" />
                            <MetricBadge label="Arrival Error" value={maneuverTargeting.targeting.estimatedArrivalErrorKm.toFixed(2)} unit="km" tone={maneuverTargeting.targeting.estimatedArrivalErrorKm < 5 ? 'good' : 'warn'} />
                          </div>
                          <p className="mt-2 text-xs text-slate-500">Vector: {maneuverTargeting.targeting.deltaVVectorKmS.map((item) => item.toFixed(5)).join(', ')} km/s</p>
                        </div>
                      ) : null}
                    </div>
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

                  <DashboardCard title="Multi-Stage Vehicle" icon={Gauge} provenance={multistageAssessment ? 'formula' : 'preset'}>
                    <div className="space-y-3">
                      {stageConfigs.map((stage, index) => (
                        <div key={stage.name} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                          <label className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                            {stage.name} Dry
                            <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-100" type="number" value={stage.dryMassKg} onChange={(event) => setStageConfigs((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, dryMassKg: +event.target.value } : item))} />
                          </label>
                          <label className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                            Propellant
                            <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-100" type="number" value={stage.propellantMassKg} onChange={(event) => setStageConfigs((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, propellantMassKg: +event.target.value } : item))} />
                          </label>
                        </div>
                      ))}
                      {multistageAssessment ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-2">
                            <MetricBadge label="Total Δv" value={multistageAssessment.totalDeltaVKmS.toFixed(2)} unit="km/s" tone="good" />
                            <MetricBadge label="TPS Peak" value={multistageAssessment.tpsPeakHeatFluxKwM2.toFixed(2)} unit="kW/m²" tone="warn" />
                            <MetricBadge label="Structural Index" value={multistageAssessment.structuralIndex.toFixed(2)} unit="mesh-coupled" />
                            <MetricBadge label="Stages" value={String(multistageAssessment.stageAnalyses.length)} unit="active stack" />
                          </div>
                          <div className="space-y-2">
                            {multistageAssessment.stageAnalyses.map((stage) => (
                              <div key={stage.stageName} className="rounded-lg border border-slate-800 bg-black/20 px-3 py-2 text-xs text-slate-300">
                                <div className="flex items-center justify-between">
                                  <span>{stage.stageName}</span>
                                  <span className="text-sky-200">{stage.deltaVKmS.toFixed(2)} km/s</span>
                                </div>
                                <p className="mt-1 text-slate-500">
                                  burn {stage.burnTimeS.toFixed(0)} s | T/Wsl {stage.thrustToWeightSl.toFixed(2)} | CG shift {stage.cgShiftMeters.toFixed(2)} m | engine-out {stage.engineOutDeltaVKmS.toFixed(2)} km/s
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-slate-400">Stage-by-stage mass, separation, engine-out, CG, and TPS estimates update automatically from the current vehicle stack.</p>
                      )}
                    </div>
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
                  <DashboardCard title="Quantum Layer" icon={Atom} provenance={optResult ? 'formula' : 'preset'}>
                    <div className="space-y-3 text-sm text-slate-300">
                      <p>The quantum path now runs a simulated QAOA statevector evolution on a reduced mission cost Hamiltonian. It is still not hardware, but the amplitudes, phase evolution, and reported state distribution now come from an actual deterministic quantum simulation rather than a display-only heuristic.</p>
                      {optResult ? (
                        <div className="grid grid-cols-2 gap-2">
                          <MetricBadge label="QAOA Layers" value={String(optResult.qaoa.layers.length)} />
                          <MetricBadge label="Backend" value={optResult.qaoa.simulation?.backend ?? 'statevector'} unit="simulated" tone="good" />
                          <MetricBadge label="Approx Ratio" value={optResult.qaoa.approximationRatio.toFixed(4)} />
                          <MetricBadge label="Final Energy" value={optResult.qaoa.finalEnergy.toFixed(4)} />
                          <MetricBadge label="Qubits" value={String(optResult.qaoa.simulation?.qubits ?? '--')} unit="reduced basis" />
                          <MetricBadge label="Expected Saving" value={`${optResult.qaoa.quantumAdvantage_pct.toFixed(1)}%`} unit="vs naive baseline" tone="warn" />
                          <MetricBadge label="Optimal Mass" value={`${(optResult.qaoa.qaoaMatchPct ?? 0).toFixed(1)}%`} unit="probability mass" tone="good" />
                          <MetricBadge label="SA Improvement" value={`${(optResult.qaoa.classicalSAImprovement_pct ?? optResult.qaoa.quantumAdvantage_pct).toFixed(1)}%`} unit="vs baseline" />
                          <MetricBadge label="Shots" value={String(optResult.qaoa.simulation?.shots ?? '--')} unit="deterministic sample" />
                          <MetricBadge label="Entropy" value={optResult.qaoa.diagnostics?.entropyBits.toFixed(3) ?? '--'} unit="bits" />
                          <MetricBadge label="Part. Ratio" value={optResult.qaoa.diagnostics?.participationRatio.toFixed(2) ?? '--'} unit="effective states" />
                          <MetricBadge label="Avg Weight" value={optResult.qaoa.diagnostics?.averageHammingWeight.toFixed(2) ?? '--'} unit="1-bits per sample" />
                          <MetricBadge label="Grid" value={`${optResult.qaoa.simulation?.gammaGridSteps ?? '--'}×${optResult.qaoa.simulation?.betaGridSteps ?? '--'}`} unit="gamma/beta search" />
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
                          Uses the `/api/qaoa` rerun path so the simulated statevector layers can update without re-running the full annealer.
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

                  <DashboardCard title="Layer Diagnostics" icon={Atom} provenance={optResult ? 'formula' : 'preset'}>
                    {quantumLayerData.length ? (
                      <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={quantumLayerData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                          <XAxis dataKey="layer" stroke="#64748b" tick={{ fontSize: 10 }} />
                          <YAxis stroke="#64748b" tick={{ fontSize: 10 }} />
                          <Tooltip contentStyle={{ background: '#020617', border: '1px solid #334155' }} />
                          <Legend wrapperStyle={{ fontSize: 10 }} />
                          <Line type="monotone" dataKey="energy" stroke="#4B9CD3" dot={false} name="Energy" />
                          <Line type="monotone" dataKey="entropy" stroke="#f59e0b" dot={false} name="Entropy (bits)" />
                          <Line type="monotone" dataKey="participation" stroke="#22c55e" dot={false} name="Participation" />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className="text-sm text-slate-400">Run mission optimization to inspect per-layer quantum diagnostics.</p>
                    )}
                  </DashboardCard>

                  <DashboardCard title="Qubit Marginals" icon={Gauge} provenance={optResult ? 'formula' : 'preset'}>
                    {quantumMarginalData.length ? (
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={quantumMarginalData} margin={{ top: 4, right: 8, left: 0, bottom: 8 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                          <XAxis dataKey="qubit" stroke="#64748b" tick={{ fontSize: 9 }} />
                          <YAxis domain={[0, 1]} stroke="#64748b" tick={{ fontSize: 9 }} />
                          <Tooltip contentStyle={{ background: '#020617', border: '1px solid #334155' }} formatter={(value: number) => [`${(value * 100).toFixed(2)}%`, 'P(|1>)']} />
                          <Bar dataKey="probabilityOne" fill="#4B9CD3" radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className="text-sm text-slate-400">Qubit occupation probabilities appear after optimization.</p>
                    )}
                  </DashboardCard>

                  <DashboardCard title="ZZ Correlations" icon={Atom} provenance={optResult ? 'formula' : 'preset'}>
                    {quantumZZData.length ? (
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={quantumZZData} margin={{ top: 4, right: 8, left: 0, bottom: 8 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                          <XAxis dataKey="pair" stroke="#64748b" tick={{ fontSize: 9 }} />
                          <YAxis domain={[-1, 1]} stroke="#64748b" tick={{ fontSize: 9 }} />
                          <Tooltip contentStyle={{ background: '#020617', border: '1px solid #334155' }} formatter={(value: number) => [value.toFixed(3), '⟨ZiZj⟩']} />
                          <Bar dataKey="correlation" radius={[3, 3, 0, 0]}>
                            {quantumZZData.map((entry, index) => (
                              <Cell key={index} fill={entry.correlation >= 0 ? '#22c55e' : '#f97316'} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className="text-sm text-slate-400">Nearest-neighbor Z correlations appear after optimization.</p>
                    )}
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
                        <li>Mission graph node and edge values are now conditioned on live radiation, comm coverage, transfer design, and mission-distance data.</li>
                        <li>Conjunction analysis uses propagated state vectors for imported objects and live CelesTrak screening when available.</li>
                        <li>The quantum view uses a simulated QAOA statevector backend with rerunnable layer depth, not a display-only placeholder.</li>
                      </ul>
                      <p>What is still not NASA-grade:</p>
                      <ul className="list-disc pl-5 text-slate-400">
                        <li>Mission graph topology is still curated unless you import external mission objects or a custom graph.</li>
                        <li>Conjunction workflow is reduced-order propagation, not a certified operational CDM/TCA pipeline.</li>
                        <li>QAOA remains a classical simulation of a reduced Hamiltonian, not quantum-hardware execution.</li>
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
