export interface DeltaVNodeLike {
  id: string;
  name?: string;
}

export interface DeltaVEdgeLike {
  from: string;
  to: string;
  deltaV_ms?: number;
  fuelCost?: number;
}

export interface DeltaVPhaseBreakdown {
  totalDeltaV: number;
  phases: {
    departure: number;
    midcourse: number;
    flyby: number;
    return: number;
  };
}

function edgeDeltaV(edge?: DeltaVEdgeLike): number {
  if (!edge) return 0;
  if (edge.deltaV_ms != null) return edge.deltaV_ms;
  return (edge.fuelCost ?? 0) * 45;
}

function classifyPhase(index: number, totalEdges: number, fromId: string, toId: string): keyof DeltaVPhaseBreakdown['phases'] {
  const lower = `${fromId} ${toId}`.toLowerCase();
  if (/moon|luna|flyby|gateway/.test(lower)) return 'flyby';
  if (/earth|return|home|reentry/.test(lower) && index >= Math.max(1, totalEdges - 2)) return 'return';
  if (index <= Math.max(0, Math.floor(totalEdges * 0.25))) return 'departure';
  if (index >= Math.max(1, totalEdges - 2)) return 'return';
  return 'midcourse';
}

export function computeDeltaVPhases(
  path: string[],
  edges: DeltaVEdgeLike[],
): DeltaVPhaseBreakdown {
  const phases: DeltaVPhaseBreakdown['phases'] = {
    departure: 0,
    midcourse: 0,
    flyby: 0,
    return: 0,
  };

  for (let i = 0; i < path.length - 1; i++) {
    const edge = edges.find((candidate) => candidate.from === path[i] && candidate.to === path[i + 1]);
    const deltaV = edgeDeltaV(edge);
    phases[classifyPhase(i, Math.max(path.length - 1, 1), path[i], path[i + 1])] += deltaV;
  }

  return {
    totalDeltaV: phases.departure + phases.midcourse + phases.flyby + phases.return,
    phases,
  };
}
