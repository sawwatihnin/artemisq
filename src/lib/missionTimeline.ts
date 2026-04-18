export interface TimelineTask {
  id: string;
  name: string;
  durationHours: number;
  earliestStartHour?: number;
  latestFinishHour?: number;
  dependencies?: string[];
  resource?: string;
}

export interface TimelineResultTask extends TimelineTask {
  scheduledStartHour: number;
  scheduledFinishHour: number;
  slackHours: number;
  critical: boolean;
}

export interface TimelineSolveResult {
  tasks: TimelineResultTask[];
  totalDurationHours: number;
  criticalPath: string[];
  violations: string[];
}

function topoSort(tasks: TimelineTask[]): TimelineTask[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const inDegree = new Map(tasks.map((task) => [task.id, 0]));
  for (const task of tasks) {
    for (const dep of task.dependencies ?? []) {
      if (byId.has(dep)) inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
    }
  }
  const queue = tasks.filter((task) => (inDegree.get(task.id) ?? 0) === 0);
  const ordered: TimelineTask[] = [];
  while (queue.length) {
    const next = queue.shift()!;
    ordered.push(next);
    for (const task of tasks) {
      if ((task.dependencies ?? []).includes(next.id)) {
        inDegree.set(task.id, (inDegree.get(task.id) ?? 1) - 1);
        if ((inDegree.get(task.id) ?? 0) === 0) queue.push(task);
      }
    }
  }
  return ordered.length === tasks.length ? ordered : tasks;
}

export function solveMissionTimeline(tasks: TimelineTask[]): TimelineSolveResult {
  const ordered = topoSort(tasks);
  const finishByTask = new Map<string, number>();
  const lastByResource = new Map<string, number>();
  const violations: string[] = [];
  const scheduled: TimelineResultTask[] = [];

  for (const task of ordered) {
    const depFinish = Math.max(0, ...(task.dependencies ?? []).map((dep) => finishByTask.get(dep) ?? 0));
    const resourceReady = task.resource ? lastByResource.get(task.resource) ?? 0 : 0;
    const scheduledStartHour = Math.max(depFinish, resourceReady, task.earliestStartHour ?? 0);
    const scheduledFinishHour = scheduledStartHour + task.durationHours;
    if (task.latestFinishHour != null && scheduledFinishHour > task.latestFinishHour) {
      violations.push(`${task.name} misses its latest finish by ${(scheduledFinishHour - task.latestFinishHour).toFixed(1)} h`);
    }
    finishByTask.set(task.id, scheduledFinishHour);
    if (task.resource) lastByResource.set(task.resource, scheduledFinishHour);
    scheduled.push({
      ...task,
      scheduledStartHour,
      scheduledFinishHour,
      slackHours: Math.max(0, (task.latestFinishHour ?? scheduledFinishHour) - scheduledFinishHour),
      critical: false,
    });
  }

  const totalDurationHours = Math.max(0, ...scheduled.map((task) => task.scheduledFinishHour));
  const criticalPath = scheduled
    .filter((task) => Math.abs(task.scheduledFinishHour - totalDurationHours) < 1e-6 || task.slackHours < 0.5)
    .map((task) => task.id);

  for (const task of scheduled) {
    task.critical = criticalPath.includes(task.id);
  }

  return {
    tasks: scheduled,
    totalDurationHours,
    criticalPath,
    violations,
  };
}
