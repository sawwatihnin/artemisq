export interface PennyLaneFeature {
  name: string;
  value: number;
}

export interface PennyLaneRequest {
  missionName?: string;
  features: PennyLaneFeature[];
  epochs?: number;
  learningRate?: number;
  backendMode?: 'local-sim' | 'lightning-sim' | 'braket-local' | 'braket-aws';
  deviceArn?: string;
  shots?: number;
}

export interface PennyLaneResult {
  installed: boolean;
  available: boolean;
  source: string;
  backend?: string;
  executionMode?: 'simulator' | 'remote-simulator' | 'qpu';
  hardwareCapable?: boolean;
  hardwareExecuted?: boolean;
  deviceArn?: string;
  wires?: number;
  layers?: number;
  epochs?: number;
  trainingLoss?: number;
  fitScore?: number;
  utilityScore?: number;
  recommendation?: 'CONTINUE' | 'REPLAN' | 'ABORT';
  confidence?: number;
  probabilities?: {
    continue: number;
    replan: number;
    abort: number;
  };
  featureVector?: PennyLaneFeature[];
  featureImportance?: Array<{
    name: string;
    value: number;
    sensitivity: number;
  }>;
  executionObservables?: number[];
  explanation?: string[];
  error?: string;
  installHint?: string;
}
