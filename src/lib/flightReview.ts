export interface FlightReviewReport {
  headline: string;
  readiness: 'READY' | 'CONDITIONAL' | 'NOT_READY';
  findings: string[];
  actions: string[];
  provenance: string[];
}

export function buildFlightReviewReport(input: {
  missionName: string;
  goNoGo?: string;
  trajectoryDeltaV?: number;
  totalDoseMsv?: number;
  conjunctionCount?: number;
  rangeGo?: boolean;
  launchGo?: boolean;
  opsStatus?: string;
  provenance?: string[];
}): FlightReviewReport {
  const blockers = [
    input.goNoGo && input.goNoGo !== 'GO',
    input.rangeGo === false,
    input.launchGo === false,
    input.opsStatus === 'ALERT',
  ].filter(Boolean).length;

  const readiness = blockers >= 2 ? 'NOT_READY' : blockers === 1 ? 'CONDITIONAL' : 'READY';
  const findings = [
    `Mission ${input.missionName} readiness assessed as ${readiness.toLowerCase().replace('_', ' ')}.`,
    `Trajectory requirement is ${(input.trajectoryDeltaV ?? 0).toFixed(2)} km/s and modeled dose is ${(input.totalDoseMsv ?? 0).toFixed(1)} mSv.`,
    `Conjunction watchlist contains ${input.conjunctionCount ?? 0} screened events.`,
    `Ground/range is ${input.rangeGo ? 'go' : 'restricted'} and launch commit is ${input.launchGo ? 'go' : 'hold'}.`,
  ];
  const actions = [
    readiness === 'READY' ? 'Proceed to final mission board with nominal watchstanding.' : 'Close the open constraint set before committing irreversible burns.',
    (input.totalDoseMsv ?? 0) > 25 ? 'Reduce crew exposure through timing, shielding, or safe-haven posture.' : 'Maintain current crew-radiation posture.',
    (input.conjunctionCount ?? 0) > 0 ? 'Review TCA workflow and maneuver targeting options for tracked conjunctions.' : 'No conjunction response burn is currently required.',
  ];

  return {
    headline: `${input.missionName}: ${readiness.replace('_', ' ')}`,
    readiness,
    findings,
    actions,
    provenance: input.provenance ?? [],
  };
}
