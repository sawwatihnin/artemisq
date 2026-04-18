export interface CalibrationPoint {
  predicted: number;
  observed: number;
}

export interface CalibrationParameters {
  radiationScale?: number;
  communicationScale?: number;
  costScale?: number;
}

export interface CalibrationResult {
  updatedParameters: CalibrationParameters;
  errorReduction: number;
}

function rmse(points: CalibrationPoint[]): number {
  if (!points.length) return 0;
  return Math.sqrt(points.reduce((sum, point) => sum + (point.observed - point.predicted) ** 2, 0) / points.length);
}

function leastSquaresScale(points: CalibrationPoint[]): number {
  const numerator = points.reduce((sum, point) => sum + point.predicted * point.observed, 0);
  const denominator = points.reduce((sum, point) => sum + point.predicted * point.predicted, 0);
  return denominator > 0 ? numerator / denominator : 1;
}

export function calibrateModel(
  predictions: Record<string, CalibrationPoint[]>,
  observations?: Record<string, number>,
): CalibrationResult {
  const updatedParameters: CalibrationParameters = {};
  let baselineError = 0;
  let updatedError = 0;

  for (const [key, points] of Object.entries(predictions)) {
    const observationShift = observations?.[key];
    const effectivePoints = observationShift == null
      ? points
      : points.map((point) => ({ predicted: point.predicted, observed: point.observed * observationShift }));
    const scale = leastSquaresScale(effectivePoints);
    baselineError += rmse(effectivePoints);
    updatedError += rmse(effectivePoints.map((point) => ({
      predicted: point.predicted * scale,
      observed: point.observed,
    })));
    if (key.toLowerCase().includes('radiation')) updatedParameters.radiationScale = scale;
    if (key.toLowerCase().includes('communication')) updatedParameters.communicationScale = scale;
    if (key.toLowerCase().includes('cost')) updatedParameters.costScale = scale;
  }

  return {
    updatedParameters,
    errorReduction: Math.max(0, baselineError - updatedError),
  };
}

export function updateParameters(
  params: CalibrationParameters,
  updates: CalibrationParameters,
): CalibrationParameters {
  return {
    radiationScale: (params.radiationScale ?? 1) * (updates.radiationScale ?? 1),
    communicationScale: (params.communicationScale ?? 1) * (updates.communicationScale ?? 1),
    costScale: (params.costScale ?? 1) * (updates.costScale ?? 1),
  };
}
