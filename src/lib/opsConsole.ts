export interface OpsAlarmInput {
  anomalies?: Array<{ anomalyType?: string; severity?: string; confidence?: number }>;
  goNoGoRules?: Array<{ rule: string; status: string; rationale: string }>;
  consumablesDepletions?: Array<{ resource: string; timeHour: number }>;
  telemetryFrame?: { commStatus?: string; radiationLevel?: number; thermalMarginC?: number } | null;
}

export interface OpsAlarm {
  title: string;
  severity: 'INFO' | 'WATCH' | 'ALERT';
  detail: string;
}

export interface OpsConsoleSummary {
  status: 'NOMINAL' | 'WATCH' | 'ALERT';
  alarms: OpsAlarm[];
}

export function buildOpsConsole(input: OpsAlarmInput): OpsConsoleSummary {
  const alarms: OpsAlarm[] = [];

  for (const anomaly of input.anomalies ?? []) {
    if (!anomaly.anomalyType) continue;
    alarms.push({
      title: anomaly.anomalyType,
      severity: anomaly.severity === 'CRITICAL' || anomaly.severity === 'HIGH' ? 'ALERT' : 'WATCH',
      detail: `FDI flagged ${anomaly.anomalyType} with confidence ${(anomaly.confidence ?? 0).toFixed(2)}.`,
    });
  }

  for (const rule of input.goNoGoRules ?? []) {
    if (rule.status === 'GO') continue;
    alarms.push({
      title: `RULE ${rule.rule.toUpperCase()}`,
      severity: rule.status === 'NO_GO' ? 'ALERT' : 'WATCH',
      detail: rule.rationale,
    });
  }

  for (const depletion of input.consumablesDepletions ?? []) {
    alarms.push({
      title: `${depletion.resource.toUpperCase()} DEPLETION`,
      severity: 'ALERT',
      detail: `${depletion.resource} reaches depletion at T+${depletion.timeHour.toFixed(1)} h.`,
    });
  }

  if ((input.telemetryFrame?.radiationLevel ?? 0) > 1.2) {
    alarms.push({
      title: 'RADIATION WATCH',
      severity: 'WATCH',
      detail: `Live radiation level ${(input.telemetryFrame?.radiationLevel ?? 0).toFixed(2)} exceeds nominal corridor.`,
    });
  }
  if ((input.telemetryFrame?.thermalMarginC ?? 20) < 5) {
    alarms.push({
      title: 'THERMAL MARGIN LOW',
      severity: 'ALERT',
      detail: `Thermal margin ${(input.telemetryFrame?.thermalMarginC ?? 0).toFixed(1)} C requires intervention.`,
    });
  }
  if ((input.telemetryFrame?.commStatus ?? 'OK') !== 'OK') {
    alarms.push({
      title: 'COMM STATUS DEGRADED',
      severity: 'WATCH',
      detail: `Telemetry comm status ${input.telemetryFrame?.commStatus}.`,
    });
  }

  const status = alarms.some((alarm) => alarm.severity === 'ALERT')
    ? 'ALERT'
    : alarms.some((alarm) => alarm.severity === 'WATCH')
      ? 'WATCH'
      : 'NOMINAL';

  return { status, alarms };
}
