export type ScenarioType = 'NOMINAL' | 'SOLAR_STORM' | 'COMM_BLACKOUT' | 'PROPULSION_ANOMALY' | 'DELAYED_LAUNCH';

export interface ScenarioNodeState {
  communicationWindow: number[];
  radiationField: number[];
  fuelMultiplier: number[];
  communicationReliability: number[];
  gravityPenalty?: number[];
  gravityAssistPotential?: number[];
  gravityBodyId?: string;
  gravityBodyName?: string;
}

export interface ScenarioMissionProfile {
  horizon: number;
  nodeStates: Record<string, ScenarioNodeState>;
  launchOffsetHours?: number;
}

export interface ScenarioApplication {
  scenarioType: ScenarioType;
  profile: ScenarioMissionProfile;
  summary: string;
}

export function applyScenario(
  profile: ScenarioMissionProfile,
  scenarioType: ScenarioType,
): ScenarioApplication {
  const cloned: ScenarioMissionProfile = {
    ...profile,
    nodeStates: Object.fromEntries(
      Object.entries(profile.nodeStates).map(([nodeId, state]) => [nodeId, {
        communicationWindow: [...state.communicationWindow],
        radiationField: [...state.radiationField],
        fuelMultiplier: [...state.fuelMultiplier],
        communicationReliability: [...state.communicationReliability],
        gravityPenalty: state.gravityPenalty ? [...state.gravityPenalty] : undefined,
        gravityAssistPotential: state.gravityAssistPotential ? [...state.gravityAssistPotential] : undefined,
        gravityBodyId: state.gravityBodyId,
        gravityBodyName: state.gravityBodyName,
      }]),
    ),
  };

  const middle = Math.max(0, Math.floor(profile.horizon * 0.5));

  if (scenarioType === 'SOLAR_STORM') {
    for (const state of Object.values(cloned.nodeStates)) {
      for (let t = Math.max(0, middle - 1); t <= Math.min(profile.horizon - 1, middle + 1); t++) {
        state.radiationField[t] *= 1.55;
      }
    }
    return { scenarioType, profile: cloned, summary: 'Solar storm injection amplified radiation across the central mission epochs.' };
  }

  if (scenarioType === 'COMM_BLACKOUT') {
    for (const state of Object.values(cloned.nodeStates)) {
      for (let t = Math.max(0, middle - 1); t <= Math.min(profile.horizon - 1, middle); t++) {
        state.communicationWindow[t] = 0;
        state.communicationReliability[t] *= 0.45;
      }
    }
    return { scenarioType, profile: cloned, summary: 'Communication blackout injection removed tracking coverage during mid-mission epochs.' };
  }

  if (scenarioType === 'PROPULSION_ANOMALY') {
    for (const state of Object.values(cloned.nodeStates)) {
      for (let t = 0; t < profile.horizon; t++) {
        state.fuelMultiplier[t] *= 1.12;
      }
    }
    return { scenarioType, profile: cloned, summary: 'Propulsion anomaly injection increased effective fuel consumption across the mission.' };
  }

  if (scenarioType === 'DELAYED_LAUNCH') {
    cloned.launchOffsetHours = (cloned.launchOffsetHours ?? 0) + 24;
    return { scenarioType, profile: cloned, summary: 'Delayed launch injection shifted the mission start by 24 hours.' };
  }

  return { scenarioType, profile: cloned, summary: 'Nominal scenario retained baseline mission conditions.' };
}
