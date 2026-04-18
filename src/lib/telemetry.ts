export interface TelemetryPoint {
  t: number;
  nodeId: string;
  nodeName: string;
  radiation: number;
  communicationOpen: boolean;
  riskScore: number;
}

export interface MissionTimelineEvent {
  timeIndex: number;
  event: string;
  severity: 'INFO' | 'WATCH' | 'ALERT';
  detail: string;
}

export interface TelemetryTimeline {
  events: MissionTimelineEvent[];
  peakRadiationIndex: number;
  maxRiskIndex: number;
}

export function simulateMissionTimeline(
  path: string[],
  timeline: TelemetryPoint[],
): TelemetryTimeline {
  const events: MissionTimelineEvent[] = [];
  if (!timeline.length) return { events, peakRadiationIndex: 0, maxRiskIndex: 0 };

  events.push({
    timeIndex: 0,
    event: 'LAUNCH',
    severity: 'INFO',
    detail: `Mission departs from ${timeline[0].nodeName}.`,
  });

  const peakRadiationIndex = timeline.reduce((best, point, index, all) => point.radiation > all[best].radiation ? index : best, 0);
  const maxRiskIndex = timeline.reduce((best, point, index, all) => point.riskScore > all[best].riskScore ? index : best, 0);

  for (let i = 1; i < timeline.length; i++) {
    const point = timeline[i];
    const nodeLabel = `${point.nodeId} ${point.nodeName}`.toLowerCase();
    if (i === 1) {
      events.push({ timeIndex: i, event: 'TLI', severity: 'INFO', detail: `Trans-lunar injection staging begins toward ${point.nodeName}.` });
    }
    if (/moon|luna|gateway|flyby/.test(nodeLabel)) {
      events.push({ timeIndex: i, event: 'FLYBY', severity: 'INFO', detail: `Lunar encounter geometry enters ${point.nodeName}.` });
    }
    if (!point.communicationOpen) {
      events.push({ timeIndex: i, event: 'COMM BLACKOUT', severity: 'WATCH', detail: `Communication outage at ${point.nodeName}.` });
    }
    if (point.riskScore >= 70) {
      events.push({ timeIndex: i, event: 'DECISION TRIGGER', severity: 'ALERT', detail: `Mission risk score reached ${point.riskScore.toFixed(1)} at ${point.nodeName}.` });
    }
  }

  events.push({
    timeIndex: peakRadiationIndex,
    event: 'PEAK RADIATION',
    severity: timeline[peakRadiationIndex].radiation > 1 ? 'ALERT' : 'WATCH',
    detail: `Peak radiation observed at ${timeline[peakRadiationIndex].nodeName}.`,
  });

  return {
    events: events.sort((a, b) => a.timeIndex - b.timeIndex),
    peakRadiationIndex,
    maxRiskIndex,
  };
}
