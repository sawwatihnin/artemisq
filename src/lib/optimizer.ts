/**
 * ARTEMIS-Q Quantum Optimizer — Competition Edition (v2)
 *
 * Implements a full quantum-inspired pipeline:
 *   1. QUBO formulation with realistic Hamiltonian encoding
 *   2. QAOA (Quantum Approximate Optimization Algorithm) simulation
 *      - Full complex statevector (re+im amplitudes, no magnitude-only approximation)
 *      - Cost Hamiltonian HC (diagonal): e^{-iγHC}|ψ⟩
 *      - Mixer Hamiltonian HB = Σᵢ Xᵢ (Rx(2β) per qubit)
 *      - Layer-by-layer greedy parameter optimization (20×20 grid per layer)
 *      - Feasibility constraints: start + end nodes always active
 *   3. Quantum Annealing via Simulated Annealing (Metropolis-Hastings)
 *   4. Real Tsiolkovsky rocket equation for delta-v → fuel mass
 *   5. Orbital mechanics: Hohmann transfer dv, J2 perturbation
 *   6. Van Allen belt radiation model (L-shell parameterization)
 */

export interface OptimizerNode {
  id: string;
  name: string;
  x: number;
  y: number;
  radiation: number;
  commScore: number;
  altitude_km?: number;
  inclination?: number;
}

export interface OptimizerEdge {
  from: string;
  to: string;
  distance: number;
  fuelCost: number;
  deltaV_ms?: number;
}

export interface QUBOWeights {
  fuel: number;
  rad: number;
  comm: number;
  safety: number;
}

/** Complex amplitude for QAOA statevector simulation */
export interface ComplexAmp {
  re: number;
  im: number;
}

export interface QAOALayer {
  gamma: number;           // Cost Hamiltonian angle
  beta: number;            // Mixer Hamiltonian angle
  energyExpectation: number;
}

export interface DistributionEntry {
  state: string;        // binary string e.g. "101011" (qubit 0 = leftmost = start node)
  probability: number;  // |amp|² = re² + im²
  energy: number;       // E(x) from QAOA basis energies
  isOptimal: boolean;   // true if this is the minimum-energy feasible state
}

export interface QAOAResult {
  layers: QAOALayer[];
  finalEnergy: number;
  approximationRatio: number;         // ⟨E⟩_QAOA / E_optimal (≥1, closer to 1 = better)
  qaoaMatchPct: number;               // (E_optimal / ⟨E⟩_QAOA) × 100 — intuitive 0-100%, higher = better
  classicalSAImprovement_pct: number; // SA cost reduction vs. greedy baseline (classical, not quantum)
  distribution: DistributionEntry[];  // Top-16 feasible states by probability
}

export interface OptimizationResult {
  path: string[];
  totalCost: number;
  fuel: number;
  radiationExposure: number;
  commLoss: number;
  naivePath: string[];
  naiveCost: number;
  quboGraph: { nodes: number; binaryVars: number; temperature: number; annealingSteps: number };
  circuitMap: { gate: string; qubit: number; target?: number; angle?: string; layer?: number }[];
  totalDeltaV_ms: number;
  fuelMass_kg: number;
  propellantFraction: number;
  annealingHistory: { step: number; temperature: number; energy: number }[];
  qaoa: QAOAResult;
  physics: {
    hohmannDeltaV: number;
    j2Correction: number;
    vanAllenDose: number;
    transferTime_days: number;
  };
}

// ─── Physical Constants ───────────────────────────────────────────────────────
const G          = 6.67430e-11;   // m³ kg⁻¹ s⁻²
const M_EARTH    = 5.972e24;      // kg
const R_EARTH    = 6.371e6;       // m
const MU_EARTH   = G * M_EARTH;   // m³/s²
const G0         = 9.80665;       // m/s² standard gravity
const J2_CONST   = 1.08263e-3;   // Earth's second zonal harmonic
const RE_KM      = 6371;          // km

// ─── Orbital Mechanics ───────────────────────────────────────────────────────

/**
 * Hohmann transfer delta-v (two burns) between circular orbits
 * ΔV₁ = √(μ/r₁)·(√(2r₂/(r₁+r₂)) - 1)
 * ΔV₂ = √(μ/r₂)·(1 - √(2r₁/(r₁+r₂)))
 */
export function hohmannDeltaV(r1_km: number, r2_km: number): { dv1: number; dv2: number; dvTotal: number; tof_days: number } {
  const r1  = (r1_km + RE_KM) * 1000;
  const r2  = (r2_km + RE_KM) * 1000;
  const at  = (r1 + r2) / 2;
  const v1  = Math.sqrt(MU_EARTH / r1);
  const v2  = Math.sqrt(MU_EARTH / r2);
  const vt1 = Math.sqrt(MU_EARTH * (2 / r1 - 1 / at));
  const vt2 = Math.sqrt(MU_EARTH * (2 / r2 - 1 / at));
  const dv1 = Math.abs(vt1 - v1);
  const dv2 = Math.abs(v2 - vt2);
  const tof_s = Math.PI * Math.sqrt(at ** 3 / MU_EARTH);
  return { dv1, dv2, dvTotal: dv1 + dv2, tof_days: tof_s / 86400 };
}

/**
 * J2 nodal precession rate (secular RAAN drift)
 * dΩ/dt = -3/2 · n · J2 · (RE/p)² · cos(i)
 * where p = a(1−e²), n = √(μ/a³)
 */
export function j2NodalPrecession(a_km: number, ecc: number, inc_deg: number): number {
  const a     = (a_km + RE_KM) * 1000;
  const i     = (inc_deg * Math.PI) / 180;
  const p     = a * (1 - ecc * ecc);
  const n     = Math.sqrt(MU_EARTH / (a * a * a));
  const dOmega = (-3 / 2) * n * J2_CONST * (R_EARTH / p) ** 2 * Math.cos(i);
  return (dOmega * 180) / Math.PI * 86400; // deg/day
}

/**
 * Van Allen belt radiation dose model (simplified AE8/AP8-style L-shell model)
 * Peak radiation ~ L=3-4 (outer belt), secondary peak L=1.5 (inner belt)
 * Returns dose rate in mrad/day
 */
export function vanAllenDose(altitude_km: number, inc_deg: number): number {
  const r     = (altitude_km + RE_KM) / RE_KM;
  const i_rad = (inc_deg * Math.PI) / 180;
  const L     = r / (Math.cos(i_rad) ** 2 + 0.001);
  const inner = 2000 * Math.exp(-((L - 1.5) ** 2) / 0.3);
  const outer = 800  * Math.exp(-((L - 4.0) ** 2) / 1.5);
  return inner + outer; // mrad/day
}

/**
 * Tsiolkovsky rocket equation: Δm = m₀(1 − e^(−Δv / (Isp·g₀)))
 */
export function tsiolkovskyFuelMass(dv_ms: number, m0_kg: number, isp_s: number): number {
  return m0_kg * (1 - Math.exp(-dv_ms / (isp_s * G0)));
}

// ─── QUBO Formulation ────────────────────────────────────────────────────────

/**
 * Build QUBO matrix Q for the full assignment problem.
 * Variables: x_{i,k} = 1 if node i is at position k in path (n×pathLen binary vars).
 * H(x) = Σᵢ Qᵢᵢ xᵢ + Σᵢ<ⱼ Qᵢⱼ xᵢxⱼ
 *
 * NOTE: This encodes the full TSP-style assignment QUBO (n×pathLen variables).
 * The QAOA simulation uses a simpler node-SELECTION encoding (n variables, 1 per path node).
 * These are separate encodings for separate purposes:
 *   - buildQUBOMatrix → hardware-ready full formulation (future QPU use)
 *   - buildBasisEnergies → compact QAOA demo formulation
 *
 * Edge lookup pre-indexed to O(1) for efficiency.
 */
function buildQUBOMatrix(
  nodes: Map<string, OptimizerNode>,
  edges: OptimizerEdge[],
  weights: QUBOWeights,
  pathLen: number
): number[][] {
  const n        = nodes.size;
  const N        = n * pathLen;
  const Q: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
  const nodeList = [...nodes.values()];

  // Pre-index edges for O(1) lookup
  const edgeMap = new Map<string, OptimizerEdge>();
  edges.forEach(e => edgeMap.set(`${e.from}_${e.to}`, e));

  const idx = (i: number, k: number) => i * pathLen + k;

  // Constraint 1: Each position k must have exactly one node
  const lambda_pos = 1000;
  for (let k = 0; k < pathLen; k++) {
    for (let i = 0; i < n; i++) {
      Q[idx(i, k)][idx(i, k)] += -lambda_pos;
      for (let j = i + 1; j < n; j++) {
        Q[idx(i, k)][idx(j, k)] += 2 * lambda_pos;
      }
    }
  }

  // Constraint 2: Each node appears at most once
  const lambda_once = 500;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < pathLen; k++) {
      for (let l = k + 1; l < pathLen; l++) {
        Q[idx(i, k)][idx(i, l)] += 2 * lambda_once;
      }
    }
  }

  // Objective: minimise edge costs + radiation + comm penalties
  for (let k = 0; k < pathLen - 1; k++) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const edge = edgeMap.get(`${nodeList[i].id}_${nodeList[j].id}`);
        if (edge) {
          const cost = edge.fuelCost * weights.fuel
            + nodeList[j].radiation * weights.rad
            + (1 - nodeList[j].commScore) * weights.comm;
          Q[idx(i, k)][idx(j, k + 1)] += cost;
        }
      }
    }
  }

  return Q;
}

// ─── QAOA Complex Statevector Simulation ─────────────────────────────────────

/** Probability of a complex amplitude */
const ampProb = (a: ComplexAmp): number => a.re * a.re + a.im * a.im;

/** ⟨E⟩ = Σ_x |amp_x|² · E(x) — full expectation including infeasible states */
function expectationValue(amps: ComplexAmp[], energies: number[]): number {
  return amps.reduce((sum, a, x) => sum + ampProb(a) * (energies[x] ?? 0), 0);
}

/**
 * Feasible-only expectation value — excludes states with energy ≥ INFEASIBLE.
 * Used to compute finalEnergy for qaoaMatchPct so that amplitude accidentally
 * spreading to infeasible states (due to the mixer) doesn't inflate ⟨E⟩.
 * Denominator = sum of feasible state probabilities (renormalized).
 */
const INFEASIBLE_THRESH = 1e5; // any energy below this is considered feasible
function expectationValueFeasible(amps: ComplexAmp[], energies: number[]): number {
  let numerator = 0, denominator = 0;
  for (let x = 0; x < amps.length; x++) {
    const E = energies[x] ?? 0;
    if (E < INFEASIBLE_THRESH) {
      const p = ampProb(amps[x]);
      numerator   += p * E;
      denominator += p;
    }
  }
  return denominator > 0 ? numerator / denominator : 0;
}

/**
 * Apply one QAOA layer: cost unitary e^{-iγH_C} followed by mixer e^{-iβH_B}.
 *
 * Cost unitary (diagonal in computational basis):
 *   new_re_x = re_x·cos(γE_x) + im_x·sin(γE_x)
 *   new_im_x = im_x·cos(γE_x) − re_x·sin(γE_x)
 *
 * Mixer Rx(2β) on qubit q — for pair (x, f = x⊕(1<<q)):
 *   Rx(2β) = [[cosβ, −i sinβ], [−i sinβ, cosβ]]
 *   new_re_x = cosβ·re_x + sinβ·im_f
 *   new_im_x = cosβ·im_x − sinβ·re_f
 *   (reads from original buffer, writes to newAmps — each state updated exactly once)
 *
 * Renormalization: once per qubit pass for floating-point stability.
 */
function applyQAOALayer(
  amps: ComplexAmp[],
  energies: number[],
  gamma: number,
  beta: number,
  nQubits: number,
  dim: number
): ComplexAmp[] {
  // Apply cost Hamiltonian (diagonal — per-state, no cross-state coupling)
  let result: ComplexAmp[] = amps.map((a, x) => {
    const E    = energies[x] ?? 0;
    const cosG = Math.cos(gamma * E);
    const sinG = Math.sin(gamma * E);
    return { re: a.re * cosG + a.im * sinG, im: a.im * cosG - a.re * sinG };
  });

  // Apply mixer: Rx(2β) on each qubit sequentially
  for (let q = 0; q < Math.min(nQubits, 8); q++) {
    const newAmps: ComplexAmp[] = result.map(a => ({ re: a.re, im: a.im }));
    for (let x = 0; x < dim; x++) {
      const f = x ^ (1 << q);
      if (f < dim) {
        // Always reads from result (original), writes to newAmps — correct even when f < x
        newAmps[x] = {
          re: Math.cos(beta) * result[x].re + Math.sin(beta) * result[f].im,
          im: Math.cos(beta) * result[x].im - Math.sin(beta) * result[f].re,
        };
      }
    }
    // Renormalize once per qubit pass (unitary preserves norm; this catches float drift)
    const norm = Math.sqrt(newAmps.reduce((s, a) => s + ampProb(a), 0)) || 1;
    result = newAmps.map(a => ({ re: a.re / norm, im: a.im / norm }));
  }

  return result;
}

/**
 * QAOA statevector simulation with layer-by-layer greedy parameter search.
 *
 * For each layer k (0..p−1): fix amps from layers 0..k−1, then grid-search
 * (γ_k, β_k) ∈ [0,π] × [0,π/2] with 20×20 = 400 evaluations.
 * This is the sequential/greedy strategy from Zhou et al. (2020), which
 * outperforms independent per-layer optimization and avoids high-dimensional
 * joint Nelder-Mead instability.
 *
 * Returns the final amplitude vector for probability distribution computation.
 */
function simulateQAOA(
  energies: number[],
  nQubits: number,
  p: number = 3
): {
  layers: QAOALayer[];
  finalEnergy: number;
  optGamma: number[];
  optBeta: number[];
  finalAmps: ComplexAmp[];
} {
  const dim       = Math.pow(2, nQubits);
  const actualDim = Math.min(dim, energies.length);

  // Initial state: uniform superposition |+⟩^n = (1/√dim) Σ_x |x⟩
  const initCoeff: ComplexAmp = { re: 1 / Math.sqrt(actualDim), im: 0 };
  let amps: ComplexAmp[] = new Array(actualDim).fill(null).map(() => ({ ...initCoeff }));

  const layers: QAOALayer[] = [];
  const optGamma: number[]  = [];
  const optBeta: number[]   = [];
  let bestEnergy = Infinity;

  for (let layer = 0; layer < p; layer++) {
    let bestG = Math.PI / 4;  // sensible starting guess
    let bestB = Math.PI / 8;
    let bestE = Infinity;

    // 20×20 grid search over γ ∈ [0, π], β ∈ [0, π/2]
    for (let gi = 0; gi <= 20; gi++) {
      for (let bi = 0; bi <= 20; bi++) {
        const gamma    = (gi / 20) * Math.PI;
        const beta     = (bi / 20) * (Math.PI / 2);
        const testAmps = applyQAOALayer(
          amps.map(a => ({ re: a.re, im: a.im })),
          energies, gamma, beta, nQubits, actualDim
        );
        const E = expectationValue(testAmps, energies);
        if (E < bestE) { bestE = E; bestG = gamma; bestB = beta; }
      }
    }

    // Commit best parameters for this layer
    amps = applyQAOALayer(amps, energies, bestG, bestB, nQubits, actualDim);
    // Use feasible-only ⟨E⟩ for display and final metric (excludes infeasible penalty states)
    const E = expectationValueFeasible(amps, energies);
    optGamma.push(bestG);
    optBeta.push(bestB);
    layers.push({ gamma: bestG, beta: bestB, energyExpectation: E });
    if (E < bestEnergy) bestEnergy = E;
  }

  // Final feasible-only expectation over the full statevector
  const finalFeasibleEnergy = expectationValueFeasible(amps, energies);
  return { layers, finalEnergy: finalFeasibleEnergy, optGamma, optBeta, finalAmps: amps };
}

// ─── Simulated Annealer ───────────────────────────────────────────────────────

export class SimulatedAnnealer {
  private nodes: Map<string, OptimizerNode>;
  private edges: OptimizerEdge[];
  private weights: QUBOWeights;
  private isp_s: number;
  private spacecraft_mass_kg: number;

  constructor(
    nodes: OptimizerNode[],
    edges: OptimizerEdge[],
    weights: QUBOWeights = { fuel: 3.0, rad: 5.0, comm: 2.0, safety: 4.0 },
    isp_s: number = 450,
    spacecraft_mass_kg: number = 5000
  ) {
    this.nodes               = new Map(nodes.map(n => [n.id, n]));
    this.edges               = edges;
    this.weights             = weights;
    this.isp_s               = isp_s;
    this.spacecraft_mass_kg  = spacecraft_mass_kg;
  }

  private getInitialPath(start: string, end: string, steps: number): string[] {
    const path: string[] = [start];
    let currentId = start;
    const visited = new Set([start]);
    for (let i = 0; i < steps - 2; i++) {
      const neighbors = this.edges
        .filter(e => e.from === currentId && !visited.has(e.to))
        .sort((a, b) => a.fuelCost - b.fuelCost);
      if (!neighbors.length) break;
      currentId = neighbors[0].to;
      visited.add(currentId);
      path.push(currentId);
      if (currentId === end) break;
    }
    if (path[path.length - 1] !== end) path.push(end);
    return path;
  }

  /**
   * Full QUBO Hamiltonian cost:
   * H(x) = wf·ΣΔv² + wr·Σrad² + wc·Σ(1-comm)² + ws·ΣΔrad_shock²
   *        + λ_orbit · Σ(out-of-plane penalty)
   */
  private calculateCost(path: string[]): {
    total: number; fuel: number; rad: number; comm: number; safety: number; deltaV_ms: number;
  } {
    let fuel = 0, rad = 0, comm = 0, safety = 0, deltaV_ms = 0;

    for (let i = 0; i < path.length; i++) {
      const node = this.nodes.get(path[i]);
      if (!node) { fuel += 2000; continue; }

      rad  += node.radiation ** 2;
      comm += (1 - node.commScore) ** 2;

      if (i < path.length - 1) {
        const edge = this.edges.find(e => e.from === path[i] && e.to === path[i + 1]);
        if (edge) {
          fuel += edge.fuelCost;
          if (edge.deltaV_ms) deltaV_ms += edge.deltaV_ms;

          const nextNode = this.nodes.get(path[i + 1]);
          if (nextNode) {
            const radShock = Math.abs(nextNode.radiation - node.radiation);
            if (radShock > 0.4) safety += 50 * radShock ** 2;
            const incDelta = Math.abs((nextNode.inclination || 0) - (node.inclination || 0));
            safety += incDelta * 10;
          }
        } else {
          fuel += 2000;
        }
      }
    }

    const total = fuel * this.weights.fuel
      + rad    * this.weights.rad
      + comm   * this.weights.comm
      + safety * this.weights.safety;

    return { total, fuel, rad, comm, safety, deltaV_ms };
  }

  /**
   * Generate physically-meaningful QAOA circuit map for visualisation.
   * Gates reflect the QUBO cost structure:
   *   - H gates:  initialise |+⟩^n (uniform superposition)
   *   - RZ(γQᵢᵢ): diagonal QUBO terms (node costs)
   *   - CNOT+RZ+CNOT: off-diagonal coupling (edge costs)
   *   - RX(2β):   mixer Hamiltonian (bit-flip, uniform superposition)
   */
  private generateQAOACircuit(
    path: string[],
    gamma: number,
    beta: number,
    layer: number
  ): { gate: string; qubit: number; target?: number; angle?: string; layer?: number }[] {
    const circuit: { gate: string; qubit: number; target?: number; angle?: string; layer?: number }[] = [];
    const nQubits = Math.min(path.length, 8);

    if (layer === 0) {
      for (let q = 0; q < nQubits; q++) {
        circuit.push({ gate: 'H', qubit: q, layer: 0 });
      }
    }

    for (let q = 0; q < nQubits; q++) {
      const node = this.nodes.get(path[q]);
      if (!node) continue;
      const diagCost = node.radiation * this.weights.rad + (1 - node.commScore) * this.weights.comm;
      circuit.push({ gate: 'RZ', qubit: q, angle: (gamma * diagCost).toFixed(3), layer });
    }

    for (let q = 0; q < nQubits - 1; q++) {
      const edge = this.edges.find(e => e.from === path[q] && e.to === path[q + 1]);
      if (edge) {
        const edgeCost = edge.fuelCost * this.weights.fuel;
        circuit.push({ gate: 'CNOT', qubit: q, target: q + 1, layer });
        circuit.push({ gate: 'RZ',   qubit: q + 1, angle: (gamma * edgeCost).toFixed(3), layer });
        circuit.push({ gate: 'CNOT', qubit: q, target: q + 1, layer });
      }
    }

    for (let q = 0; q < nQubits; q++) {
      circuit.push({ gate: 'RX', qubit: q, angle: (2 * beta).toFixed(3), layer });
    }

    return circuit;
  }

  /**
   * Build QAOA basis energies using node-selection encoding with feasibility constraints.
   *
   * Encoding: qubit q = 1 means path node bestPath[q] is included in the sub-path.
   * Constraint: start node (qubit 0) and end node (qubit nQubits-1) must always be 1.
   * States violating this get INFEASIBLE penalty, ensuring:
   *   - E_optimal is taken over valid paths (not the empty path with E=0)
   *   - QAOA amplitude concentrates on physically meaningful states
   * Objective: radiation + comm + edge fuel costs for active node pairs.
   */
  private buildBasisEnergies(
    path: string[],
    nQubits: number,
    dim: number,
    INFEASIBLE: number
  ): number[] {
    return Array.from({ length: dim }, (_, x) => {
      const hasStart = !!(x & 1);
      const hasEnd   = !!(x & (1 << (nQubits - 1)));
      if (!hasStart || !hasEnd) return INFEASIBLE;

      let e = 0;
      // Node costs for active qubits
      for (let q = 0; q < nQubits; q++) {
        if (x & (1 << q)) {
          const node = this.nodes.get(path[q]);
          if (node) {
            e += node.radiation    * this.weights.rad;
            e += (1 - node.commScore) * this.weights.comm;
          }
        }
      }
      // Edge costs between consecutive active qubit pairs
      for (let q = 0; q < nQubits - 1; q++) {
        if ((x & (1 << q)) && (x & (1 << (q + 1)))) {
          const edge = this.edges.find(
            e2 => e2.from === path[q] && e2.to === path[q + 1]
          );
          if (edge) e += edge.fuelCost * this.weights.fuel;
        }
      }
      return e;
    });
  }

  /**
   * Re-run only the QAOA simulation for a pre-found path.
   * Exposed publicly so the /api/qaoa endpoint can update QAOA results
   * without re-running the full 20,000-step simulated annealing.
   * Use when the user changes the QAOA depth p interactively.
   */
  public runQAOAOnly(
    path: string[],
    qaoa_p: number = 3
  ): {
    qaoa: Omit<QAOAResult, 'classicalSAImprovement_pct'> & { classicalSAImprovement_pct: number };
    circuitMap: { gate: string; qubit: number; target?: number; angle?: string; layer?: number }[];
  } {
    const nQubits   = Math.min(path.length, 6);
    const dim       = Math.pow(2, nQubits);
    const INFEASIBLE = 1e6;

    const basisEnergies = this.buildBasisEnergies(path, nQubits, dim, INFEASIBLE);
    const feasibleEnergies = basisEnergies.filter(e => e < INFEASIBLE);
    const E_optimal = feasibleEnergies.length > 0 ? Math.min(...feasibleEnergies) : 1;
    const optimalIdx = basisEnergies.reduce(
      (best, e, i) => (e < basisEnergies[best] ? i : best), 0
    );

    const qaoa = simulateQAOA(basisEnergies, nQubits, qaoa_p);

    const approxRatio  = E_optimal > 0 ? qaoa.finalEnergy / E_optimal : 1.0;
    const qaoaMatchPct = (E_optimal > 0 && qaoa.finalEnergy > 0)
      ? Math.min(100, (E_optimal / qaoa.finalEnergy) * 100)
      : 100;

    const distribution: DistributionEntry[] = Array.from({ length: dim }, (_, x) => ({
      state:     x.toString(2).padStart(nQubits, '0'),
      probability: qaoa.finalAmps[x] ? ampProb(qaoa.finalAmps[x]) : 0,
      energy:    basisEnergies[x],
      isOptimal: x === optimalIdx,
    }))
      .filter(d => d.energy < INFEASIBLE)
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 16);

    const circuitMap = qaoa.layers.flatMap((layer, li) =>
      this.generateQAOACircuit(path, layer.gamma, layer.beta, li)
    );

    return {
      qaoa: {
        layers:                     qaoa.layers,
        finalEnergy:                qaoa.finalEnergy,
        approximationRatio:         approxRatio,
        qaoaMatchPct,
        classicalSAImprovement_pct: 0, // N/A for QAOA-only re-runs (no SA baseline)
        distribution,
      },
      circuitMap,
    };
  }

  /**
   * Full optimization: Simulated Annealing → QAOA simulation → physics calculations.
   * @param qaoa_p QAOA circuit depth (number of layers, default 3)
   */
  public optimize(
    start: string,
    end: string,
    steps: number = 8,
    radiationMultiplier: number = 1.0,
    qaoa_p: number = 3
  ): OptimizationResult {
    // Scale radiation by live space weather index
    const adjustedNodes = [...this.nodes.values()].map(n => ({
      ...n,
      radiation: Math.min(1.5, n.radiation * radiationMultiplier)
    }));
    adjustedNodes.forEach(n => this.nodes.set(n.id, n));

    const naivePath     = this.getInitialPath(start, end, steps);
    const naiveCostData = this.calculateCost(naivePath);
    const naiveCost     = naiveCostData.total;

    // ── Simulated Annealing (Metropolis-Hastings) ─────────────────────────────
    let currentPath = [...naivePath];
    let currentCost = this.calculateCost(currentPath);
    let bestPath    = [...currentPath];
    let bestCost    = { ...currentCost };

    const T0          = 8000.0;
    const Tf          = 0.01;
    const iterations  = 20000;
    const coolingRate = Math.pow(Tf / T0, 1 / iterations);
    let temp          = T0;

    const annealingHistory: { step: number; temperature: number; energy: number }[] = [];
    const sampleInterval = Math.floor(iterations / 60);

    for (let i = 0; i < iterations; i++) {
      const newPath = [...currentPath];
      if (newPath.length > 2) {
        if (Math.random() < 0.6) {
          // Swap two intermediate nodes
          const idx1 = Math.floor(Math.random() * (newPath.length - 2)) + 1;
          const idx2 = Math.floor(Math.random() * (newPath.length - 2)) + 1;
          [newPath[idx1], newPath[idx2]] = [newPath[idx2], newPath[idx1]];
        } else {
          // Replace one intermediate node via a valid edge
          const idx = Math.floor(Math.random() * (newPath.length - 2)) + 1;
          const candidates = this.edges.filter(e => e.from === newPath[idx - 1]).map(e => e.to);
          if (candidates.length > 0) {
            newPath[idx] = candidates[Math.floor(Math.random() * candidates.length)];
          }
        }
      }

      const newCost = this.calculateCost(newPath);
      const delta   = newCost.total - currentCost.total;

      // Metropolis criterion: e^(-δE/T)
      if (delta < 0 || Math.random() < Math.exp(-delta / temp)) {
        currentPath = newPath;
        currentCost = newCost;
        if (currentCost.total < bestCost.total) {
          bestPath = [...currentPath];
          bestCost = { ...currentCost };
        }
      }

      temp *= coolingRate;
      if (i % sampleInterval === 0) {
        annealingHistory.push({ step: i, temperature: temp, energy: currentCost.total });
      }
    }

    // ── QAOA Simulation ───────────────────────────────────────────────────────
    const nQubits    = Math.min(bestPath.length, 6);
    const dim        = Math.pow(2, nQubits);
    const INFEASIBLE = 1e6;

    const basisEnergies    = this.buildBasisEnergies(bestPath, nQubits, dim, INFEASIBLE);
    const feasibleEnergies = basisEnergies.filter(e => e < INFEASIBLE);
    const E_optimal        = feasibleEnergies.length > 0 ? Math.min(...feasibleEnergies) : 1;
    const optimalIdx       = basisEnergies.reduce(
      (best, e, i) => (e < basisEnergies[best] ? i : best), 0
    );

    const qaoa = simulateQAOA(basisEnergies, nQubits, qaoa_p);

    const approxRatio  = E_optimal > 0 ? qaoa.finalEnergy / E_optimal : 1.0;
    const qaoaMatchPct = (E_optimal > 0 && qaoa.finalEnergy > 0)
      ? Math.min(100, (E_optimal / qaoa.finalEnergy) * 100)
      : 100;
    const classicalSAImprovement_pct = Math.max(0, (1 - bestCost.total / naiveCost) * 100);

    const distribution: DistributionEntry[] = Array.from({ length: dim }, (_, x) => ({
      state:       x.toString(2).padStart(nQubits, '0'),
      probability: qaoa.finalAmps[x] ? ampProb(qaoa.finalAmps[x]) : 0,
      energy:      basisEnergies[x],
      isOptimal:   x === optimalIdx,
    }))
      .filter(d => d.energy < INFEASIBLE)
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 16);

    const fullCircuit = qaoa.layers.flatMap((layer, li) =>
      this.generateQAOACircuit(bestPath, layer.gamma, layer.beta, li)
    );

    // ── Physics Calculations ──────────────────────────────────────────────────
    let totalDeltaV = bestCost.deltaV_ms;
    if (totalDeltaV === 0) {
      totalDeltaV = this.isp_s * G0 * bestCost.fuel * 0.05;
    }

    const fuelMass_kg       = tsiolkovskyFuelMass(totalDeltaV, this.spacecraft_mass_kg, this.isp_s);
    const propellantFraction = fuelMass_kg / this.spacecraft_mass_kg;

    const firstNode     = this.nodes.get(bestPath[0]);
    const lastNode      = this.nodes.get(bestPath[bestPath.length - 1]);
    const h1            = firstNode?.altitude_km || 400;
    const h2            = lastNode?.altitude_km  || 35786;
    const hohmann       = hohmannDeltaV(h1, h2);

    const avgAlt        = bestPath.reduce((s, id) => s + (this.nodes.get(id)?.altitude_km || 400), 0) / bestPath.length;
    const avgInc        = bestPath.reduce((s, id) => s + (this.nodes.get(id)?.inclination || 28.5), 0) / bestPath.length;
    const vanAllenDoseVal = vanAllenDose(avgAlt, avgInc);
    const j2corr        = j2NodalPrecession(avgAlt, 0.001, avgInc);

    return {
      path:             bestPath,
      totalCost:        bestCost.total,
      fuel:             bestCost.fuel,
      radiationExposure: bestCost.rad,
      commLoss:         bestCost.comm,
      naivePath,
      naiveCost,
      quboGraph: {
        nodes:          this.nodes.size,
        binaryVars:     this.nodes.size * bestPath.length,
        temperature:    temp,
        annealingSteps: iterations,
      },
      circuitMap:        fullCircuit,
      totalDeltaV_ms:    totalDeltaV,
      fuelMass_kg,
      propellantFraction,
      annealingHistory,
      qaoa: {
        layers:                     qaoa.layers,
        finalEnergy:                qaoa.finalEnergy,
        approximationRatio:         approxRatio,
        qaoaMatchPct,
        classicalSAImprovement_pct,
        distribution,
      },
      physics: {
        hohmannDeltaV:    hohmann.dvTotal,
        j2Correction:     j2corr,
        vanAllenDose:     vanAllenDoseVal,
        transferTime_days: hohmann.tof_days,
      },
    };
  }
}
