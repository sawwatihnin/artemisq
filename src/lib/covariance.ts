export interface CovarianceState {
  positionKm: [number, number, number];
  velocityKmS: [number, number, number];
  sigmaPositionKm: number;
  sigmaVelocityKmS: number;
}

export interface CovariancePropagationResult {
  horizonMinutes: number;
  sigmaPositionKm: number;
  sigmaVelocityKmS: number;
  radialSigmaKm: number;
  alongTrackSigmaKm: number;
  crossTrackSigmaKm: number;
  covarianceTrace: number;
  missDistance95Km: number;
  source: string;
}

function mag(v: [number, number, number]): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function propagateStateCovariance(params: {
  state: CovarianceState;
  horizonMinutes: number;
  processNoisePositionKm?: number;
  processNoiseVelocityKmS?: number;
}): CovariancePropagationResult {
  const dt = Math.max(0, params.horizonMinutes) * 60;
  const radiusKm = Math.max(6378, mag(params.state.positionKm));
  const speedKmS = Math.max(0.001, mag(params.state.velocityKmS));
  const orbitalRate = speedKmS / radiusKm;
  const qPos = params.processNoisePositionKm ?? 0.02;
  const qVel = params.processNoiseVelocityKmS ?? 0.00002;

  const sigmaVelocityKmS = Math.sqrt(params.state.sigmaVelocityKmS ** 2 + qVel ** 2 * dt);
  const freeDriftSigma = Math.sqrt(params.state.sigmaPositionKm ** 2 + (dt * sigmaVelocityKmS) ** 2);
  const curvatureAmplifier = 1 + clamp(orbitalRate * dt / 25, 0, 0.8);
  const sigmaPositionKm = Math.sqrt(freeDriftSigma ** 2 + (qPos * dt / 60) ** 2) * curvatureAmplifier;

  const radialSigmaKm = sigmaPositionKm * 0.8;
  const alongTrackSigmaKm = sigmaPositionKm * (1.2 + clamp(dt / 5400, 0, 1.5));
  const crossTrackSigmaKm = sigmaPositionKm * 0.65;
  const covarianceTrace = radialSigmaKm ** 2 + alongTrackSigmaKm ** 2 + crossTrackSigmaKm ** 2;
  const missDistance95Km = 2.4477 * Math.sqrt(covarianceTrace / 3);

  return {
    horizonMinutes: params.horizonMinutes,
    sigmaPositionKm,
    sigmaVelocityKmS,
    radialSigmaKm,
    alongTrackSigmaKm,
    crossTrackSigmaKm,
    covarianceTrace,
    missDistance95Km,
    source: 'FORMULA-DRIVEN · Linearized state covariance growth',
  };
}
