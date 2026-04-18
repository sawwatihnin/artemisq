export interface MissionResourceVector {
  fuel: number;
  timeHours: number;
  crewHours: number;
}

export interface MissionPortfolioRequest {
  id: string;
  name: string;
  expectedCost: number;
  expectedRisk: number;
  successProbability: number;
  priority: number;
  resources: MissionResourceVector;
}

export interface PortfolioResources {
  fuel: number;
  timeHours: number;
  crewHours: number;
}

export interface MissionPortfolioPlan extends MissionPortfolioRequest {
  funded: boolean;
  portfolioScore: number;
}

export interface MissionPortfolioResult {
  missionPlans: MissionPortfolioPlan[];
  resourceAllocation: {
    fuelUsed: number;
    timeUsed: number;
    crewHoursUsed: number;
  };
  tradeoffs: string[];
}

function missionUtility(mission: MissionPortfolioRequest): number {
  return 140 * mission.priority * mission.successProbability - 90 * mission.expectedRisk - 0.000002 * mission.expectedCost;
}

function dominatesDemand(a: PortfolioResources, b: MissionResourceVector): boolean {
  return a.fuel >= b.fuel && a.timeHours >= b.timeHours && a.crewHours >= b.crewHours;
}

function subtractResources(a: PortfolioResources, b: MissionResourceVector): PortfolioResources {
  return {
    fuel: a.fuel - b.fuel,
    timeHours: a.timeHours - b.timeHours,
    crewHours: a.crewHours - b.crewHours,
  };
}

export function allocateResources(
  missions: MissionPortfolioRequest[],
  resources: PortfolioResources,
): MissionPortfolioResult['resourceAllocation'] & { selectedMissionIds: string[] } {
  const ranked = [...missions].sort((a, b) => {
    const aDensity = missionUtility(a) / Math.max(1, a.resources.fuel + 0.8 * a.resources.timeHours + 0.4 * a.resources.crewHours);
    const bDensity = missionUtility(b) / Math.max(1, b.resources.fuel + 0.8 * b.resources.timeHours + 0.4 * b.resources.crewHours);
    return bDensity - aDensity;
  });

  let remaining = { ...resources };
  const selectedMissionIds: string[] = [];

  for (const mission of ranked) {
    if (!dominatesDemand(remaining, mission.resources)) continue;
    selectedMissionIds.push(mission.id);
    remaining = subtractResources(remaining, mission.resources);
  }

  return {
    selectedMissionIds,
    fuelUsed: resources.fuel - remaining.fuel,
    timeUsed: resources.timeHours - remaining.timeHours,
    crewHoursUsed: resources.crewHours - remaining.crewHours,
  };
}

export function optimizeMissionPortfolio(
  missions: MissionPortfolioRequest[],
  resources: PortfolioResources,
): MissionPortfolioResult {
  const allocation = allocateResources(missions, resources);
  const selected = new Set(allocation.selectedMissionIds);
  const missionPlans = missions.map((mission) => ({
    ...mission,
    funded: selected.has(mission.id),
    portfolioScore: missionUtility(mission),
  }));

  const funded = missionPlans.filter((mission) => mission.funded);
  const deferred = missionPlans.filter((mission) => !mission.funded);

  return {
    missionPlans,
    resourceAllocation: {
      fuelUsed: allocation.fuelUsed,
      timeUsed: allocation.timeUsed,
      crewHoursUsed: allocation.crewHoursUsed,
    },
    tradeoffs: [
      funded.length
        ? `Funded missions: ${funded.map((mission) => mission.name).join(', ')}.`
        : 'No mission fit within the current shared resource envelope.',
      deferred.length
        ? `Deferred missions were excluded by shared fuel/time/crew constraints: ${deferred.map((mission) => mission.name).join(', ')}.`
        : 'All candidate missions fit within the shared portfolio constraints.',
      `Portfolio resource utilization is ${allocation.fuelUsed.toFixed(0)} fuel units, ${allocation.timeUsed.toFixed(0)} h, and ${allocation.crewHoursUsed.toFixed(0)} crew-h.`,
    ],
  };
}
