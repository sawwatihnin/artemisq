export interface ConsumablesState {
  powerKWh: number;
  thermalMarginC: number;
  commMinutes: number;
  propellantKg: number;
  crewHours: number;
  oxygenKg: number;
  waterKg: number;
}

export interface ConsumablesStep {
  timeHour: number;
  state: ConsumablesState;
}

export interface ConsumablesAnalysisResult {
  timeline: ConsumablesStep[];
  depleted: Array<{ resource: keyof ConsumablesState; timeHour: number }>;
  finalState: ConsumablesState;
}

export function analyzeConsumables(params: {
  durationHours: number;
  dtHours?: number;
  initial: ConsumablesState;
  powerDrawKw: number;
  powerGenerationKw: number;
  thermalLoadCPerHour: number;
  thermalRejectionCPerHour: number;
  commMinutesPerHour: number;
  propellantFlowKgPerHour: number;
  crewCount: number;
}): ConsumablesAnalysisResult {
  const dtHours = params.dtHours ?? 1;
  const state: ConsumablesState = { ...params.initial };
  const timeline: ConsumablesStep[] = [{ timeHour: 0, state: { ...state } }];
  const depleted: Array<{ resource: keyof ConsumablesState; timeHour: number }> = [];

  for (let t = dtHours; t <= params.durationHours + 1e-9; t += dtHours) {
    state.powerKWh += (params.powerGenerationKw - params.powerDrawKw) * dtHours;
    state.thermalMarginC += (params.thermalRejectionCPerHour - params.thermalLoadCPerHour) * dtHours;
    state.commMinutes = Math.max(0, state.commMinutes - params.commMinutesPerHour * dtHours);
    state.propellantKg = Math.max(0, state.propellantKg - params.propellantFlowKgPerHour * dtHours);
    state.crewHours += params.crewCount * dtHours;
    state.oxygenKg = Math.max(0, state.oxygenKg - params.crewCount * 0.84 * (dtHours / 24));
    state.waterKg = Math.max(0, state.waterKg - params.crewCount * 3.2 * (dtHours / 24));

    (Object.keys(state) as Array<keyof ConsumablesState>).forEach((key) => {
      if (state[key] <= 0 && !depleted.some((item) => item.resource === key)) {
        depleted.push({ resource: key, timeHour: t });
      }
    });

    timeline.push({ timeHour: t, state: { ...state } });
  }

  return {
    timeline,
    depleted,
    finalState: { ...state },
  };
}
