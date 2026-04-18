/**
 * ARTEMIS-Q Launch Stability Simulator
 * Physics-informed 2D ascent model with configurable gravity-turn guidance.
 */

import {
  assessAscentStability,
  cdMachMultiplier,
  exponentialDensity,
  isaTemperatureK,
  propellantMassFromDeltaV,
  speedOfSoundMs,
  type AscentStabilityFlag,
  type GeometryStabilityHints,
} from './ascentDynamics';
import { evaluateFlightRisk, type RiskAnalysis } from './risk';

export interface FlightPathProgram {
  /** Begin pitch program once inertial speed exceeds this (m/s). */
  pitchKickSpeed: number;
  /** Linear pitch ramp after kick: pitch_deg = min(maxPitch, max(0, t - pitchRampDelayS) * pitchRateDegPerSec). */
  pitchRateDegPerSec: number;
  maxPitchDeg: number; // deg from vertical
  /** Optional delay (s) after speed gate before pitch begins ramping; defaults to 0. */
  pitchRampDelayS?: number;
}

export interface SimulationConfig {
  dt?: number;
  maxTime?: number;
  launchAltitudeMeters?: number;
  exitArea?: number;
  propellantMassFraction?: number;
  /** If set with a positive value, propellant mass is taken from the Tsiolkovsky / rocket equation (same as Fuel panel). */
  targetDeltaV_ms?: number;
  /** Dynamic pressure threshold for Max-Q warnings (kPa). */
  maxQThresholdKpa?: number;
  /** STL / vehicle heuristics for stability scoring. */
  geometryHints?: GeometryStabilityHints | null;
  flightPath?: FlightPathProgram;
  body?: {
    radiusMeters: number;
    muMeters3s2: number;
    atmosphereScaleHeightKm?: number;
    surfaceDensityKgM3?: number;
  };
}

export interface SimulationStep {
  time: number;
  altitude: number; // km
  velocity: number; // m/s
  q: number; // dynamic pressure (kPa)
  dragN: number;
  downrangeKm: number;
  accel_ms2: number;
  stress: number; // 0 to 1
  risk: string | null;
  riskScore?: number;
  thermalStress?: number;
  g: number; // local gravity acceleration
  rho: number; // air density
  pitch: number; // degrees from vertical
  mach: number;
  cdEffective: number;
}

export type FuelType = 'RP-1' | 'LH2' | 'Methane';

export interface SimulationResult {
  steps: SimulationStep[];
  stabilityScore: number;
  ascentFlags: AscentStabilityFlag[];
  failurePoints: string[];
  maxQTime: number;
  maxQValue: number;
  maxQAltitudeKm: number;
  peakDragN: number;
  mecoTime: number;
  stressHotspots: { part: string; intensity: number; position: [number, number, number] }[];
  /** Mass above dry mass at end of integration (typically unburned propellant), not payload to orbit. */
  residualMass_kg: number;
  apogeeKm: number;
  downrangeKm: number;
  peakAccelerationGs: number;
  burnoutVelocity: number;
  finalAltitudeKm: number;
  source: 'formula-driven';
  flightPath: FlightPathProgram;
  riskAnalysis: RiskAnalysis;
  aiSummary: {
    max_q_kpa: number;
    peak_drag_n: number;
    stability_score: number;
    max_q_altitude_km: number;
    meco_time_s: number;
  };
}

export interface FlightPathOptimizationResult {
  best: SimulationResult;
  candidates: Array<{
    score: number;
    stabilityScore: number;
    apogeeKm: number;
    maxQValue: number;
    peakAccelerationGs: number;
    flightPath: FlightPathProgram;
  }>;
  source: 'formula-driven';
}

interface FuelProperties {
  ispSeaLevel: number;
  ispVacuum: number;
}

export class LaunchSimulator {
  private massInitial: number;
  private thrustSeaLevel: number;
  private frontalArea: number;
  private dragCoeff: number;
  private fuel: FuelProperties;
  private windSpeed: number;
  private surfacePressureKPa: number;

  private readonly R_EARTH = 6371000;
  private readonly G_ACCEL = 9.80665;
  private readonly SEA_LEVEL_PRESSURE_PA = 101325;

  constructor(
    mass: number,
    thrust: number,
    frontalArea: number,
    dragCoeff: number = 0.5,
    fuel: FuelType = 'RP-1',
    wind: number = 0,
    pressure: number = 101.325,
  ) {
    this.massInitial = mass;
    this.thrustSeaLevel = thrust;
    this.frontalArea = Math.max(frontalArea, 0.1);
    this.dragCoeff = Math.max(dragCoeff, 0.05);
    this.windSpeed = wind;
    this.surfacePressureKPa = pressure;

    switch (fuel) {
      case 'LH2':
        this.fuel = { ispSeaLevel: 360, ispVacuum: 450 };
        break;
      case 'Methane':
        this.fuel = { ispSeaLevel: 320, ispVacuum: 370 };
        break;
      case 'RP-1':
      default:
        this.fuel = { ispSeaLevel: 300, ispVacuum: 350 };
        break;
    }
  }

  private getAtmosphere(altitudeMeters: number, config?: SimulationConfig['body']): { rho: number; pPa: number; temp: number } {
    if (config) {
      const scaleKm = config.atmosphereScaleHeightKm;
      const rho0Default = config.surfaceDensityKgM3 ?? 1.225;
      if (scaleKm != null && scaleKm > 0) {
        const scaleHeightMeters = scaleKm * 1000;
        const rho = exponentialDensity(Math.max(0, altitudeMeters), rho0Default, scaleHeightMeters);
        const temp = isaTemperatureK(Math.max(0, altitudeMeters));
        const pPa = rho * 287.05 * temp;
        return { rho, pPa, temp };
      }
      if (config.surfaceDensityKgM3 != null && config.surfaceDensityKgM3 > 0) {
        const rho = exponentialDensity(Math.max(0, altitudeMeters), config.surfaceDensityKgM3, 8500);
        const temp = isaTemperatureK(Math.max(0, altitudeMeters));
        const pPa = rho * 287.05 * temp;
        return { rho, pPa, temp };
      }
      return { rho: 0, pPa: 0, temp: 150 };
    }
    const P0 = this.surfacePressureKPa * 1000;
    const T0 = 288.15;
    const g = 9.80665;
    const R = 287.05;
    const L = 0.0065;

    let temp: number;
    let pressure: number;

    if (altitudeMeters < 11000) {
      temp = T0 - L * altitudeMeters;
      pressure = P0 * Math.pow(1 - (L * altitudeMeters) / T0, g / (L * R));
    } else if (altitudeMeters < 20000) {
      const T11 = T0 - L * 11000;
      const P11 = P0 * Math.pow(1 - (L * 11000) / T0, g / (L * R));
      temp = T11;
      pressure = P11 * Math.exp((-g * (altitudeMeters - 11000)) / (R * T11));
    } else {
      temp = 216.65;
      const P20 = 5474.89;
      pressure = P20 * Math.exp(-(altitudeMeters - 20000) / 6300);
    }

    return { rho: pressure / (R * temp), pPa: pressure, temp };
  }

  private getGravity(altitudeMeters: number, config?: SimulationConfig['body']): number {
    if (config) {
      return config.muMeters3s2 / Math.pow(config.radiusMeters + altitudeMeters, 2);
    }
    return this.G_ACCEL * Math.pow(this.R_EARTH / (this.R_EARTH + altitudeMeters), 2);
  }

  private getFlightPath(time: number, speed: number, guidance: FlightPathProgram): number {
    if (speed < guidance.pitchKickSpeed) return 0;
    const delayS = guidance.pitchRampDelayS ?? 0;
    const pitch = Math.max(0, time - delayS) * guidance.pitchRateDegPerSec;
    return Math.min(guidance.maxPitchDeg, pitch);
  }

  public simulate(config: SimulationConfig = {}): SimulationResult {
    const dt = config.dt ?? 0.5;
    const maxTime = config.maxTime ?? 420;
    const launchAltitude = config.launchAltitudeMeters ?? 0;
    const bodyConfig = config.body;
    const exitArea = config.exitArea ?? Math.max(0.2, this.frontalArea * 0.16);
    const propellantMassFraction = Math.min(0.93, Math.max(0.45, config.propellantMassFraction ?? 0.88));
    const maxQThresholdKpa = config.maxQThresholdKpa ?? 42;
    const flightPath = config.flightPath ?? {
      pitchKickSpeed: 85,
      pitchRateDegPerSec: 0.18,
      maxPitchDeg: 72,
    };

    let dryMass: number;
    if (config.targetDeltaV_ms != null && Number.isFinite(config.targetDeltaV_ms) && config.targetDeltaV_ms > 0) {
      const mp = propellantMassFromDeltaV(this.massInitial, config.targetDeltaV_ms, this.fuel.ispVacuum);
      dryMass = Math.max(this.massInitial * 0.05, this.massInitial - mp);
    } else {
      dryMass = this.massInitial * (1 - propellantMassFraction);
    }
    let currentMass = this.massInitial;
    let altitude = launchAltitude;
    let downrange = 0;
    let vx = 0;
    let vy = 0;
    let time = 0;

    const steps: SimulationStep[] = [];
    const failurePoints: string[] = [];
    let maxQValue = 0;
    let maxQTime = 0;
    let maxQAltitudeKm = 0;
    let peakDragN = 0;
    let peakAccelerationGs = 0;
    let minMassAscent = this.massInitial;
    let apogee = altitude;
    let burnoutVelocity = 0;
    let mecoTime = maxTime;

    while (time <= maxTime) {
      const { rho, pPa, temp } = this.getAtmosphere(Math.max(0, altitude), bodyConfig);
      const g = this.getGravity(Math.max(0, altitude), bodyConfig);
      const speed = Math.hypot(vx, vy);
      const pitch = this.getFlightPath(time, speed, flightPath);
      const pitchRad = (pitch * Math.PI) / 180;
      const relWindX = altitude < 20000 ? vx - this.windSpeed : vx;
      const relWindY = vy;
      const relSpeed = Math.hypot(relWindX, relWindY);
      const qPa = 0.5 * rho * relSpeed * relSpeed;
      const q = qPa / 1000;
      const aSound = speedOfSoundMs(temp);
      const mach = relSpeed / Math.max(200, aSound);
      const cdEff = this.dragCoeff * cdMachMultiplier(mach);

      if (q > maxQValue) {
        maxQValue = q;
        maxQTime = time;
        maxQAltitudeKm = altitude / 1000;
      }

      const isp = this.fuel.ispSeaLevel + (this.fuel.ispVacuum - this.fuel.ispSeaLevel) * (1 - Math.min(1, pPa / this.SEA_LEVEL_PRESSURE_PA));
      const mdot = currentMass > dryMass ? this.thrustSeaLevel / (Math.max(isp, 1) * this.G_ACCEL) : 0;
      const thrust = mdot > 0
        ? this.thrustSeaLevel + (this.SEA_LEVEL_PRESSURE_PA - pPa) * exitArea
        : 0;

      if (mdot === 0 && mecoTime === maxTime) {
        mecoTime = time;
        burnoutVelocity = speed;
      }

      const thrustX = thrust * Math.sin(pitchRad);
      const thrustY = thrust * Math.cos(pitchRad);
      const drag = 0.5 * rho * relSpeed * relSpeed * cdEff * this.frontalArea;
      peakDragN = Math.max(peakDragN, drag);
      const dragX = relSpeed > 0 ? drag * (relWindX / relSpeed) : 0;
      const dragY = relSpeed > 0 ? drag * (relWindY / relSpeed) : 0;

      const ax = (thrustX - dragX) / currentMass;
      const ay = (thrustY - dragY) / currentMass - g;
      const accelMag = Math.hypot(ax, ay);
      const accelGs = Math.hypot(ax, ay + g) / this.G_ACCEL;
      peakAccelerationGs = Math.max(peakAccelerationGs, accelGs);

      vx += ax * dt;
      vy += ay * dt;
      downrange += vx * dt;
      altitude += vy * dt;
      apogee = Math.max(apogee, altitude);

      if (mdot > 0) {
        currentMass = Math.max(dryMass, currentMass - mdot * dt);
      }
      minMassAscent = Math.min(minMassAscent, currentMass);

      let stress = q / maxQThresholdKpa;
      if (mach > 0.92 && mach < 1.15) stress += 0.22;
      if (accelGs > 4.5) stress += (accelGs - 4.5) * 0.07;
      if (Math.abs(this.windSpeed) > 18 && altitude < 15000) stress += 0.12;

      let risk: string | null = null;
      if (stress > 0.98) risk = 'CRITICAL: STRUCTURAL LIMIT';
      else if (q > maxQThresholdKpa) risk = 'HIGH MAX-Q';
      else if (Math.abs(mach - 1) < 0.05) risk = 'TRANSONIC SHOCK';
      else if (time === maxQTime) risk = 'MAX-Q';

      steps.push({
        time,
        altitude: altitude / 1000,
        velocity: Math.hypot(vx, vy),
        q,
        dragN: drag,
        downrangeKm: downrange / 1000,
        accel_ms2: accelMag,
        stress: Math.min(1, stress),
        risk,
        g,
        rho,
        pitch,
        mach,
        cdEffective: cdEff,
      });

      if (stress > 0.99 && !failurePoints.includes('Structural overload')) {
        failurePoints.push('Structural overload');
      }

      if (altitude < -50 && time > 5) {
        failurePoints.push('Vehicle impact');
        break;
      }

      if (altitude > 250000 && vy > 0) {
        break;
      }

      if (mdot === 0 && vy < -50 && altitude > 1000) {
        break;
      }

      time += dt;
    }

    const maxStress = steps.length ? Math.max(...steps.map((step) => step.stress)) : 0;
    const { score: heuristicScore, flags: ascentFlags } = assessAscentStability({
      maxQ_kPa: maxQValue,
      maxQThreshold_kPa: maxQThresholdKpa,
      peakAccelG: peakAccelerationGs,
      minMassDuringAscent_kg: minMassAscent,
      peakDragN,
      geometry: config.geometryHints ?? undefined,
    });
    const riskAnalysis = evaluateFlightRisk(
      steps.map((step) => ({
        time: step.time,
        q: step.q,
        stress: step.stress,
        mach: step.mach,
        altitude: step.altitude,
      })),
      { maxQkPa: maxQThresholdKpa },
    );

    const riskByTime = new Map(riskAnalysis.profile.map((point) => [point.time, point]));
    for (const step of steps) {
      const point = riskByTime.get(step.time);
      if (!point) continue;
      step.riskScore = point.riskScore;
      step.thermalStress = point.thermalStress;
      if (!step.risk && point.flags.length) {
        step.risk = point.flags[0].replaceAll('_', ' ');
      }
    }

    const stressHotspots = [
      { part: 'Nose Cone', intensity: maxStress * 0.9, position: [0, 2.6, 0] as [number, number, number] },
      { part: 'Interstage', intensity: maxStress * 1.0, position: [0, 0.6, 0] as [number, number, number] },
      { part: 'Tank Dome', intensity: maxStress * 0.84, position: [0, -1.0, 0] as [number, number, number] },
      { part: 'Thrust Structure', intensity: maxStress * 0.78, position: [0, -2.2, 0] as [number, number, number] },
    ];

    const legacyPenalty = failurePoints.length * 12 + Math.max(0, peakAccelerationGs - 6) * 6;
    const stabilityScore = Math.max(0, heuristicScore - legacyPenalty);

    return {
      steps,
      stabilityScore,
      ascentFlags,
      failurePoints,
      maxQTime,
      maxQValue,
      maxQAltitudeKm,
      peakDragN,
      mecoTime,
      stressHotspots,
      residualMass_kg: Math.max(0, currentMass - dryMass),
      apogeeKm: apogee / 1000,
      downrangeKm: downrange / 1000,
      peakAccelerationGs,
      burnoutVelocity,
      finalAltitudeKm: altitude / 1000,
      source: 'formula-driven',
      flightPath,
      riskAnalysis,
      aiSummary: {
        max_q_kpa: maxQValue,
        peak_drag_n: peakDragN,
        stability_score: stabilityScore,
        max_q_altitude_km: maxQAltitudeKm,
        meco_time_s: mecoTime,
      },
    };
  }

  public optimizeFlightPath(config: SimulationConfig = {}): FlightPathOptimizationResult {
    const candidates: FlightPathOptimizationResult['candidates'] = [];
    let bestResult: SimulationResult | null = null;
    let bestScore = -Infinity;

    for (const pitchKickSpeed of [60, 80, 100, 120]) {
      for (const pitchRateDegPerSec of [0.12, 0.16, 0.2, 0.24]) {
        for (const maxPitchDeg of [55, 65, 75, 82]) {
          const result = this.simulate({
            ...config,
            flightPath: { pitchKickSpeed, pitchRateDegPerSec, maxPitchDeg },
          });
          const score =
            result.apogeeKm * 0.32 +
            result.finalAltitudeKm * 0.28 +
            result.burnoutVelocity * 0.01 +
            result.stabilityScore * 1.2 -
            result.maxQValue * 1.4 -
            Math.max(0, result.peakAccelerationGs - 5.5) * 18 -
            result.failurePoints.length * 80;

          candidates.push({
            score,
            stabilityScore: result.stabilityScore,
            apogeeKm: result.apogeeKm,
            maxQValue: result.maxQValue,
            peakAccelerationGs: result.peakAccelerationGs,
            flightPath: result.flightPath,
          });

          if (score > bestScore) {
            bestScore = score;
            bestResult = result;
          }
        }
      }
    }

    return {
      best: bestResult ?? this.simulate(config),
      candidates: candidates.sort((a, b) => b.score - a.score).slice(0, 8),
      source: 'formula-driven',
    };
  }
}
