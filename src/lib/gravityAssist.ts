export interface GravityAssistNodeLike {
  id: string;
  name: string;
  altitude_km?: number;
  gravityAssistStrength?: number;
}

export interface GravityAssistContribution {
  nodeId: string;
  nodeName: string;
  deltaVBonusFraction: number;
}

export interface GravityAssistResult {
  adjustedDeltaV_ms: number;
  totalBonusFraction: number;
  contributions: GravityAssistContribution[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function inferNodeAssistStrength(node: GravityAssistNodeLike): number {
  if (node.gravityAssistStrength != null) return node.gravityAssistStrength;
  const key = `${node.id} ${node.name}`.toLowerCase();
  if (/moon|luna|flyby|lagrange|gateway/.test(key)) return 0.08;
  if (/earth|geo/.test(key)) return 0.03;
  const altitudeTerm = 1 / Math.sqrt(1 + Math.max(node.altitude_km ?? 400, 0) / 2000);
  return 0.02 * altitudeTerm;
}

export function applyGravityAssist(
  path: string[],
  nodes: GravityAssistNodeLike[],
  baseDeltaV_ms: number,
): GravityAssistResult {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const contributions: GravityAssistContribution[] = [];

  for (const nodeId of path.slice(1, -1)) {
    const node = byId.get(nodeId);
    if (!node) continue;
    const deltaVBonusFraction = clamp(inferNodeAssistStrength(node), 0, 0.16);
    if (deltaVBonusFraction <= 0.005) continue;
    contributions.push({
      nodeId,
      nodeName: node.name,
      deltaVBonusFraction,
    });
  }

  const totalBonusFraction = clamp(contributions.reduce((sum, item) => sum + item.deltaVBonusFraction, 0), 0, 0.28);
  return {
    adjustedDeltaV_ms: baseDeltaV_ms * (1 - totalBonusFraction),
    totalBonusFraction,
    contributions,
  };
}
