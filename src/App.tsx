/**
 * ARTEMIS-Q Competition Edition
 * Quantum-Enhanced Orbital Mission Optimizer
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import * as THREE from 'three';
import {
  Rocket, Map as MapIcon, Activity, Settings, ShieldAlert, Zap,
  ChevronRight, Database, Cpu, Target, FlaskConical, Tractor,
  Save, Download, CheckCircle2, Atom, Satellite, Globe, AlertTriangle,
  TrendingDown, Gauge, Wind, Thermometer, Radio, BarChart3
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, LineChart, Line, ScatterChart, Scatter, ReferenceLine,
  Legend, BarChart, Bar, Cell
} from 'recharts';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Stars, Float, Text, Line as DreiLine } from '@react-three/drei';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  calculateArtemisTrajectory, getPlanetPosition, PLANETS,
  KeplerianElements, keplerian2ECI, propagateOrbit, generateOrbitPoints,
  computeHohmann, atmosphericDensity, estimateConjunctionRisk,
} from './lib/orbital';
import type { OptimizationResult, QUBOWeights, DistributionEntry } from './lib/optimizer';
import { SimulatedAnnealer, hohmannDeltaV, vanAllenDose, tsiolkovskyFuelMass, j2NodalPrecession } from './lib/optimizer';


function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

// ─── Types ───────────────────────────────────────────────────────────────────
// OptimizationResult is imported from ./lib/optimizer (single source of truth).
type MissionType = 'lunar' | 'orbital' | 'rover';
type FuelType = 'RP-1' | 'LH2' | 'Methane';
type PropellantType = { name: FuelType; isp_vac: number; isp_sl: number; density: number; color: string };


// ─── Constants ────────────────────────────────────────────────────────────────

const PROPELLANTS: Record<FuelType, PropellantType> = {
  'RP-1':    { name: 'RP-1',    isp_vac: 353, isp_sl: 311, density: 820,  color: '#f59e0b' },
  'LH2':     { name: 'LH2',     isp_vac: 453, isp_sl: 381, density: 71,   color: '#60a5fa' },
  'Methane': { name: 'Methane', isp_vac: 380, isp_sl: 330, density: 450,  color: '#34d399' },
};

const MISSION_PRESETS: Record<MissionType, { title: string; start: string; end: string; nodes: any[]; edges: any[] }> = {
  lunar: {
    title: 'Lunar Gateway Transfer',
    start: 'earth', end: 'moon',
    nodes: [
      { id: 'earth',   name: 'LEO Parking',         x: 10, y: 50, radiation: 0.08, commScore: 1.00, altitude_km: 400,   inclination: 28.5 },
      { id: 'v_allen', name: 'Van Allen Passage',    x: 28, y: 38, radiation: 0.92, commScore: 0.55, altitude_km: 15000, inclination: 28.5 },
      { id: 'l1',      name: 'EML-1 Gateway',        x: 50, y: 50, radiation: 0.15, commScore: 0.92, altitude_km: 326000,inclination: 5.1  },
      { id: 'loi',     name: 'Lunar Orbit Insertion',x: 73, y: 65, radiation: 0.35, commScore: 0.65, altitude_km: 380000,inclination: 90.0 },
      { id: 'moon',    name: 'Lunar Gateway (NRHO)', x: 92, y: 50, radiation: 0.20, commScore: 0.50, altitude_km: 384400,inclination: 90.0 },
    ],
    edges: [
      { from: 'earth',   to: 'v_allen', distance: 14600, fuelCost: 22,  deltaV_ms: 3130 },
      { from: 'earth',   to: 'l1',      distance: 325600,fuelCost: 48,  deltaV_ms: 3900 },
      { from: 'v_allen', to: 'l1',      distance: 311000,fuelCost: 18,  deltaV_ms: 900  },
      { from: 'v_allen', to: 'loi',     distance: 365400,fuelCost: 58,  deltaV_ms: 4200 },
      { from: 'l1',      to: 'loi',     distance: 58400, fuelCost: 24,  deltaV_ms: 1500 },
      { from: 'l1',      to: 'moon',    distance: 58400, fuelCost: 52,  deltaV_ms: 3200 },
      { from: 'loi',     to: 'moon',    distance: 4000,  fuelCost: 10,  deltaV_ms: 900  },
    ]
  },
  orbital: {
    title: 'GEO Satellite Deployment',
    start: 'leo', end: 'geo',
    nodes: [
      { id: 'leo',      name: 'LEO (400 km)',         x: 10, y: 50, radiation: 0.08, commScore: 1.00, altitude_km: 400,   inclination: 28.5 },
      { id: 'meo1',     name: 'MEO-Alpha (GPS Shell)',x: 35, y: 28, radiation: 0.55, commScore: 0.80, altitude_km: 20200, inclination: 55.0 },
      { id: 'meo2',     name: 'MEO-Beta (Glonass)',   x: 35, y: 72, radiation: 0.50, commScore: 0.78, altitude_km: 19100, inclination: 64.8 },
      { id: 'transfer', name: 'GTO Apogee (35786 km)',x: 65, y: 50, radiation: 0.28, commScore: 0.88, altitude_km: 35786, inclination: 0.0  },
      { id: 'geo',      name: 'GEO Station',          x: 90, y: 50, radiation: 0.18, commScore: 0.97, altitude_km: 35786, inclination: 0.0  },
    ],
    edges: [
      { from: 'leo',      to: 'meo1',     distance: 19800, fuelCost: 14, deltaV_ms: 2400 },
      { from: 'leo',      to: 'meo2',     distance: 18700, fuelCost: 13, deltaV_ms: 2300 },
      { from: 'meo1',     to: 'transfer', distance: 15586, fuelCost: 22, deltaV_ms: 1800 },
      { from: 'meo2',     to: 'transfer', distance: 16686, fuelCost: 21, deltaV_ms: 1700 },
      { from: 'leo',      to: 'transfer', distance: 35386, fuelCost: 42, deltaV_ms: 3900 },
      { from: 'transfer', to: 'geo',      distance: 0,     fuelCost: 18, deltaV_ms: 1500 },
    ]
  },
  rover: {
    title: 'Surface Rover Traversal',
    start: 'base', end: 'crater',
    nodes: [
      { id: 'base',   name: 'Artemis Base Camp', x: 10, y: 50, radiation: 0.12, commScore: 0.95, altitude_km: 0, inclination: 0 },
      { id: 'ridge',  name: 'Shackleton Ridge',  x: 30, y: 32, radiation: 0.28, commScore: 1.00, altitude_km: 0, inclination: 0 },
      { id: 'slope',  name: 'North Slope (Shadow)',x:55, y: 62, radiation: 0.65, commScore: 0.22, altitude_km: 0, inclination: 0 },
      { id: 'plains', name: 'Borealis Plains',   x: 70, y: 38, radiation: 0.18, commScore: 0.82, altitude_km: 0, inclination: 0 },
      { id: 'crater', name: 'Ice Deposit Site',  x: 90, y: 55, radiation: 0.30, commScore: 0.70, altitude_km: 0, inclination: 0 },
    ],
    edges: [
      { from: 'base',   to: 'ridge',  distance: 28,  fuelCost: 14, deltaV_ms: 0 },
      { from: 'base',   to: 'slope',  distance: 48,  fuelCost: 38, deltaV_ms: 0 },
      { from: 'ridge',  to: 'plains', distance: 42,  fuelCost: 11, deltaV_ms: 0 },
      { from: 'slope',  to: 'crater', distance: 38,  fuelCost: 22, deltaV_ms: 0 },
      { from: 'plains', to: 'crater', distance: 22,  fuelCost: 8,  deltaV_ms: 0 },
      { from: 'ridge',  to: 'crater', distance: 60,  fuelCost: 18, deltaV_ms: 0 },
    ]
  }
};

const MISSION_SCENARIOS = [
  { id: 'artemis-ii',    name: 'Artemis II Lunar Flyby',    target: 'moon',    mode: 'lunar',   fuel: 'LH2',     date: '2025-11-20', mass: 26500,  thrust: 111200 },
  { id: 'mars-rover',    name: 'Mars Rover Survey',         target: 'mars',    mode: 'rover',   fuel: 'Methane', date: '2026-07-15', mass: 15000,  thrust: 90000  },
  { id: 'venus-orbit',   name: 'Venus Orbital Insertion',   target: 'venus',   mode: 'orbital', fuel: 'RP-1',    date: '2026-10-10', mass: 18000,  thrust: 95000  },
  { id: 'jupiter-flyby', name: 'Europa Clipper Path',       target: 'jupiter', mode: 'orbital', fuel: 'LH2',     date: '2027-04-12', mass: 6065,   thrust: 445000 },
];

// ─── Utility Components ───────────────────────────────────────────────────────

// Carolina Blue = #4B9CD3  (replaces all turquoise/cyan accents)
const CB = '#4B9CD3';
const CB_DIM = '#3a7aa8';

const DashboardCard = ({ children, title, icon: Icon, className, accent = false, headerRight }: any) => (
  <div className={cn(
    "bg-bg-card border rounded-lg overflow-hidden flex flex-col",
    accent ? "border-[#4B9CD3]/40 shadow-[0_0_16px_rgba(75,156,211,0.07)]" : "border-slate-800 shadow-[0_0_20px_rgba(0,0,0,0.5)]",
    className
  )}>
    <div className={cn(
      "px-4 py-2.5 border-b flex items-center justify-between",
      accent ? "border-[#4B9CD3]/20 bg-[#4B9CD3]/5" : "border-slate-800 bg-black/30"
    )}>
      <div className="flex items-center gap-2">
        <Icon className="w-3.5 h-3.5" style={{ color: accent ? CB : CB_DIM }} />
        <span className="text-[11px] font-semibold tracking-[1.2px] text-slate-300 uppercase">{title}</span>
      </div>
      {headerRight ?? <div className="w-1.5 h-1.5 rounded-full" style={{ background: accent ? CB : CB_DIM, opacity: accent ? 1 : 0.4 }} />}
    </div>
    <div className="p-4 flex-1">{children}</div>
  </div>
);


const MetricBadge = ({ label, value, unit, color = CB, warning = false }: any) => (
  <div className={cn(
    "p-2 rounded border text-center",
    warning ? "border-red-500/40 bg-red-500/5" : "border-slate-700 bg-slate-900/60"
  )}>
    <p className="text-[9px] text-slate-400 uppercase tracking-wider mb-0.5">{label}</p>
    <p className="font-bold" style={{ color, fontSize: '14px', lineHeight: 1 }}>{value}</p>
    {unit && <p className="text-[9px] text-slate-500 mt-0.5">{unit}</p>}
  </div>
);

// ─── Quantum Circuit Visualizer ────────────────────────────────────────────────

const QuantumCircuit = ({ gates }: { gates: any[] }) => {
  const GATE_COLORS: Record<string, string> = {
    H: '#a78bfa', RX: '#4B9CD3', RZ: '#4ade80', CNOT: '#f87171', X: '#fbbf24',
  };
  const layers = gates.reduce((acc: any, g) => {
    const l = g.layer ?? 0;
    if (!acc[l]) acc[l] = [];
    acc[l].push(g);
    return acc;
  }, {});
  const nQubits = Math.max(...gates.map(g => Math.max(g.qubit, g.target ?? 0))) + 1;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[300px] p-2">
        {Array.from({ length: nQubits }, (_, q) => (
          <div key={q} className="flex items-center gap-0.5 mb-1.5">
            <span className="text-[9px] text-slate-400 w-6 shrink-0">q{q}</span>
            <div className="flex-1 h-px bg-slate-700 relative flex items-center gap-0.5">
              {Object.entries(layers).map(([l, gs]: any) => {
                const gate = gs.find((g: any) => g.qubit === q || g.target === q);
                if (!gate) return <div key={l} className="w-7 shrink-0" />;
                const color = GATE_COLORS[gate.gate] || '#94a3b8';
                return (
                  <div key={l}
                    className="w-7 h-6 rounded border text-center flex flex-col items-center justify-center shrink-0 relative"
                    style={{ borderColor: color, backgroundColor: color + '28' }}>
                    <span className="text-[8px] font-bold" style={{ color }}>{gate.gate}</span>
                    {gate.angle && <span className="text-[8px]" style={{ color: color + 'dd' }}>{gate.angle}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div className="flex gap-2 mt-2 flex-wrap">
          {Object.entries(GATE_COLORS).map(([g, c]) => (
            <div key={g} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-sm" style={{ background: c }} />
              <span className="text-[9px] text-slate-400">{g}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── Annealing Chart ──────────────────────────────────────────────────────────

const AnnealingChart = ({ history }: { history: { step: number; temperature: number; energy: number }[] }) => (
  <ResponsiveContainer width="100%" height={100}>
    <LineChart data={history} margin={{ top: 4, right: 4, bottom: 4, left: -24 }}>
      <CartesianGrid strokeDasharray="2 2" stroke="#ffffff0a" />
      <XAxis dataKey="step" tick={{ fontSize: 8, fill: '#94a3b8' }} />
      <YAxis tick={{ fontSize: 8, fill: '#94a3b8' }} />
      <Tooltip contentStyle={{ background: '#0d1224', border: '1px solid #334155', fontSize: 10, color: '#e2e8f0' }} />
      <Line type="monotone" dataKey="energy" stroke="#4B9CD3" dot={false} strokeWidth={1.5} name="Energy" />
      <Line type="monotone" dataKey="temperature" stroke="#f59e0b" dot={false} strokeWidth={1} strokeDasharray="3 2" name="Temp" />
      <Legend wrapperStyle={{ fontSize: 9, color: '#94a3b8' }} />
    </LineChart>
  </ResponsiveContainer>
);

// ─── Quantum Distribution Chart ───────────────────────────────────────────────

const QuantumDistribution = ({ distribution, nQubits }: { distribution: DistributionEntry[]; nQubits: number }) => {
  if (!distribution || distribution.length === 0) return null;
  const maxProb = Math.max(...distribution.map(d => d.probability));
  return (
    <div className="space-y-1">
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={distribution} margin={{ top: 4, right: 4, bottom: 24, left: 0 }} layout="vertical">
          <CartesianGrid strokeDasharray="2 2" stroke="#ffffff0a" horizontal={false} />
          <XAxis type="number" domain={[0, maxProb * 1.1]} tick={{ fontSize: 8, fill: '#94a3b8' }}
            tickFormatter={(v: number) => `${(v * 100).toFixed(1)}%`} />
          <YAxis type="category" dataKey="state" tick={{ fontSize: 7, fill: '#94a3b8' }} width={48} />
          <Tooltip
            contentStyle={{ background: '#0d1224', border: '1px solid #334155', fontSize: 9, color: '#e2e8f0' }}
            formatter={(val: any, _: any, entry: any) => [
              `${(val * 100).toFixed(2)}% (E=${entry.payload.energy?.toFixed(2)})`,
              entry.payload.isOptimal ? '★ Optimal state' : 'State'
            ]}
          />
          <Bar dataKey="probability" radius={[0, 2, 2, 0]}>
            {distribution.map((entry, i) => (
              <Cell key={i} fill={entry.isOptimal ? '#fbbf24' : '#4B9CD3'} opacity={entry.isOptimal ? 1 : 0.75} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-[8px] text-slate-500 text-center leading-tight px-2">
        Higher <span className="text-[#4B9CD3]">p</span> concentrates amplitude on low-energy feasible
        paths — this is quantum interference. <span className="text-[#fbbf24]">Gold</span> = brute-force optimal.
      </p>
    </div>
  );
};

// ─── 2D Graph Overlay ─────────────────────────────────────────────────────────

const Graph2DOverlay = ({ preset, optResult }: { preset: any; optResult: OptimizationResult | null }) => {
  const W = 340, H = 240, PAD = 24;
  const innerW = W - PAD * 2, innerH = H - PAD * 2;
  const toSVG = (x: number, y: number) => ({
    cx: PAD + (x / 100) * innerW,
    cy: PAD + (y / 100) * innerH,
  });

  const optPath = optResult?.path ?? [];

  // Radiation heatmap: 0 (green) → 1 (red)
  const radColor = (rad: number) => {
    const r = Math.round(255 * rad);
    const g = Math.round(255 * (1 - rad));
    return `rgb(${r},${g},60)`;
  };

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="rounded bg-slate-900/80">
      {/* Edges */}
      {preset.edges.map((edge: any, i: number) => {
        const from = preset.nodes.find((n: any) => n.id === edge.from);
        const to   = preset.nodes.find((n: any) => n.id === edge.to);
        if (!from || !to) return null;
        const s = toSVG(from.x, from.y), t = toSVG(to.x, to.y);
        const isOptEdge = optPath.some((_, idx) =>
          idx < optPath.length - 1 && optPath[idx] === edge.from && optPath[idx + 1] === edge.to
        );
        const sw = Math.max(0.5, Math.min(3, (edge.fuelCost / 200)));
        return (
          <g key={i}>
            <line x1={s.cx} y1={s.cy} x2={t.cx} y2={t.cy}
              stroke={isOptEdge ? '#4B9CD3' : '#334155'}
              strokeWidth={isOptEdge ? sw + 1.5 : sw}
              className={isOptEdge ? 'path-animated' : ''}
              markerEnd="url(#arrow)"
            />
            {edge.deltaV_ms && (
              <text x={(s.cx + t.cx) / 2} y={(s.cy + t.cy) / 2 - 3}
                fontSize="6" fill="#64748b" textAnchor="middle">
                {(edge.deltaV_ms / 1000).toFixed(2)} km/s
              </text>
            )}
          </g>
        );
      })}

      {/* Nodes */}
      {preset.nodes.map((node: any) => {
        const { cx, cy } = toSVG(node.x, node.y);
        const r = 5 + node.radiation * 6;
        const inPath = optPath.includes(node.id);
        return (
          <g key={node.id}>
            <circle cx={cx} cy={cy} r={r} fill={radColor(node.radiation)}
              stroke={inPath ? '#fbbf24' : '#1e293b'} strokeWidth={inPath ? 2 : 1} opacity={0.9} />
            <text x={cx} y={cy - r - 2} fontSize="7" fill="#e2e8f0" textAnchor="middle"
              style={{ fontFamily: 'monospace' }}>
              {node.name ?? node.id}
            </text>
          </g>
        );
      })}

      {/* Arrow marker */}
      <defs>
        <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 z" fill="#4B9CD3" opacity="0.6" />
        </marker>
      </defs>

      {/* Legend */}
      <g transform={`translate(${PAD},${H - 14})`}>
        <rect x={0} y={0} width={8} height={8} fill="#4B9CD3" rx={1} />
        <text x={11} y={7} fontSize="6" fill="#94a3b8">Optimal path</text>
        <rect x={80} y={0} width={8} height={8} fill="#fbbf24" rx={1} />
        <text x={91} y={7} fontSize="6" fill="#94a3b8">Path nodes</text>
        <text x={160} y={7} fontSize="6" fill="#94a3b8">Node size ∝ radiation</text>
      </g>
    </svg>
  );
};

// ─── Orbital Visualizer Components ────────────────────────────────────────────

function Earth3D() {
  return (
    <group>
      <mesh>
        <sphereGeometry args={[20, 64, 64]} />
        <meshStandardMaterial color="#0a1a2f" emissive="#001020" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh scale={1.02}>
        <sphereGeometry args={[20, 64, 64]} />
        <meshStandardMaterial color="#0066ff" transparent opacity={0.04} side={THREE.BackSide} />
      </mesh>
      {/* Terminator (day/night) */}
      <mesh rotation={[0, Math.PI / 4, Math.PI / 6]} scale={1.01}>
        <sphereGeometry args={[20, 32, 32]} />
        <meshStandardMaterial color="#ffffff" transparent opacity={0.02} wireframe />
      </mesh>
    </group>
  );
}

function VanAllenBelt({ inner = true }: { inner?: boolean }) {
  const r = inner ? 32 : 55;
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[r, inner ? 4 : 8, 8, 64]} />
      <meshBasicMaterial color={inner ? "#ff4400" : "#ff9900"} transparent opacity={0.06} />
    </mesh>
  );
}

function OrbitLine({ elements, color = '#4B9CD3', opacity = 0.8, scale = 0.05 }: { elements: KeplerianElements; color?: string; opacity?: number; scale?: number }) {
  const points = useMemo(() => generateOrbitPoints(elements, 200, scale), [elements, scale]);
  return (
    <DreiLine points={points} color={color} lineWidth={1.5} transparent opacity={opacity} />
  );
}

function MissionGlobe({ launchDate, targetPlanetId, optResult, preset, keplerEl }: any) {
  const planetPos = useMemo(() => getPlanetPosition(launchDate, targetPlanetId), [launchDate, targetPlanetId]);
  const trajectory = useMemo(() => calculateArtemisTrajectory(launchDate, targetPlanetId), [launchDate, targetPlanetId]);
  const planet = PLANETS[targetPlanetId] || PLANETS.moon;

  const projectedNodes = useMemo(() => {
    const R = 24;
    return preset.nodes.map((n: any) => {
      const phi = (n.x / 100) * Math.PI * 2;
      const theta = (n.y / 100) * Math.PI;
      return {
        ...n,
        pos3d: [
          -R * Math.sin(theta) * Math.cos(phi),
          R * Math.cos(theta),
          R * Math.sin(theta) * Math.sin(phi),
        ] as [number, number, number],
      };
    });
  }, [preset]);

  const pathNodeIds = optResult?.path || [];

  return (
    <group>
      <Earth3D />
      <VanAllenBelt inner />
      <VanAllenBelt inner={false} />

      {/* Current orbit from Keplerian elements */}
      {keplerEl && (
        <OrbitLine elements={keplerEl} color="#00f2ff" opacity={0.5} scale={0.05} />
      )}

      {/* Planet destination */}
      <mesh position={planetPos}>
        <sphereGeometry args={[planet.radius, 32, 32]} />
        <meshStandardMaterial color={planet.color} roughness={0.8} />
      </mesh>

      {/* Trajectory arc — optimized path: solid Carolina Blue */}
      {trajectory.length > 0 && (
        <DreiLine
          points={trajectory.map(t => t.pos)}
          color="#4B9CD3"
          lineWidth={2}
          transparent
          opacity={0.9}
        />
      )}

      {/* Baseline (naive) path — dashed style via low opacity */}
      {optResult?.naivePath && (
        <DreiLine
          points={trajectory.map(t => [t.pos[0] * 1.06, t.pos[1] * 1.06, t.pos[2] * 1.06] as [number,number,number])}
          color="#6b7280"
          lineWidth={1}
          transparent
          opacity={0.25}
        />
      )}

      {/* Graph nodes */}
      {projectedNodes.map((node: any) => {
        const inPath = pathNodeIds.includes(node.id);
        return (
          <group key={node.id}>
            {node.radiation > 0.5 && (
              <mesh position={node.pos3d}>
                <sphereGeometry args={[node.radiation * 18, 24, 24]} />
                <meshBasicMaterial color="#ff3b3b" transparent opacity={node.radiation * 0.08} />
              </mesh>
            )}
            <mesh position={node.pos3d}>
              <sphereGeometry args={[inPath ? 2.2 : 1.5, 16, 16]} />
              <meshBasicMaterial color={inPath ? "#4B9CD3" : (node.radiation > 0.6 ? "#f87171" : "#64748b")} />
            </mesh>
            <Text
              position={[node.pos3d[0], node.pos3d[1] + 6, node.pos3d[2]]}
              fontSize={3.5}
              color={inPath ? "#4B9CD3" : "#94a3b8"}
              anchorX="center"
            >
              {node.name}
            </Text>
          </group>
        );
      })}

      {/* Trajectory milestone labels */}
      {trajectory.filter(t => t.label).map((t, i) => (
        <group key={i} position={t.pos}>
          <mesh>
            <sphereGeometry args={[2.5, 16, 16]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        </group>
      ))}

      <Stars radius={800} depth={500} count={12000} factor={10} saturation={0} fade speed={0.5} />
    </group>
  );
}

// ─── Fuel Calculator Panel ────────────────────────────────────────────────────

function FuelCalculator({ missionType, fuelType }: { missionType: MissionType; fuelType: FuelType }) {
  const [m0, setM0] = useState(10000);
  const [dv, setDv] = useState(3900);
  const prop = PROPELLANTS[fuelType];
  const mf = tsiolkovskyFuelMass(dv, m0, prop.isp_vac);
  const mProp = mf;
  const mDry = m0 - mf;
  const massRatio = m0 / mDry;
  const propFraction = mf / m0;

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-slate-300 uppercase font-bold tracking-widest">Tsiolkovsky Rocket Equation</p>
      <div className="bg-slate-900/80 border border-slate-700 p-2 rounded font-mono text-[10px] text-amber-400">
        Δm = m₀ · (1 - e^(-Δv / (Isp · g₀)))
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <label className="text-[9px] text-slate-400 uppercase">Initial Mass (kg)
          <input type="number" value={m0} onChange={e => setM0(+e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 text-[10px] p-1 mt-0.5 text-slate-200 rounded" />
        </label>
        <label className="text-[9px] text-slate-400 uppercase">Δv Required (m/s)
          <input type="number" value={dv} onChange={e => setDv(+e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 text-[10px] p-1 mt-0.5 text-slate-200 rounded" />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-slate-700/50">
        <MetricBadge label="Propellant Mass" value={mProp.toFixed(0)} unit="kg" color="#f59e0b" />
        <MetricBadge label="Mass Ratio" value={massRatio.toFixed(3)} unit="m₀/m_dry" color="#a78bfa" />
        <MetricBadge label="Prop. Fraction" value={(propFraction * 100).toFixed(1)} unit="%" color="#4ade80" />
        <MetricBadge label={`Isp (${fuelType})`} value={prop.isp_vac} unit="s (vacuum)" color={CB} />
      </div>
      <div className="bg-slate-900/60 p-1.5 rounded border border-slate-700/50">
        <div className="flex gap-0 h-3 rounded overflow-hidden">
          <div style={{ width: `${propFraction * 100}%`, background: prop.color }} className="transition-all duration-300" />
          <div style={{ width: `${(1 - propFraction) * 100}%`, background: '#334155' }} />
        </div>
        <div className="flex justify-between mt-1 text-[9px] text-slate-400">
          <span>Propellant {(propFraction * 100).toFixed(0)}%</span>
          <span>Dry mass {((1 - propFraction) * 100).toFixed(0)}%</span>
        </div>
      </div>
    </div>
  );
}

// ─── Physics Panel ────────────────────────────────────────────────────────────

function PhysicsPanel({ keplerEl, fuelType }: { keplerEl: KeplerianElements; fuelType: FuelType }) {
  const prop = PROPELLANTS[fuelType];
  const h1 = keplerEl.a - 6371;
  const h2 = 35786;
  const hohmann = computeHohmann(h1, h2);
  const j2 = j2NodalPrecession(h1, keplerEl.e, keplerEl.i);
  const dose = vanAllenDose(h1, keplerEl.i);
  const atm = atmosphericDensity(h1);

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-slate-300 uppercase font-bold tracking-widest">Live Orbital Physics</p>

      <div className="bg-slate-900/80 border border-slate-700 p-2.5 rounded font-mono text-[10px] space-y-1">
        <div><span className="text-amber-400">Hohmann ΔV₁ =</span> <span className="text-green-400 font-bold">{hohmann.dv1_ms.toFixed(1)}</span> <span className="text-slate-400">m/s</span></div>
        <div><span className="text-amber-400">Hohmann ΔV₂ =</span> <span className="text-green-400 font-bold">{hohmann.dv2_ms.toFixed(1)}</span> <span className="text-slate-400">m/s</span></div>
        <div><span className="text-amber-400">TOF =</span> <span className="text-green-400 font-bold">{hohmann.tof_days.toFixed(2)}</span> <span className="text-slate-400">days</span></div>
        <div><span className="text-amber-400">J2 RAAN drift =</span> <span className="text-green-400 font-bold">{j2.toFixed(4)}</span> <span className="text-slate-400">°/day</span></div>
        <div><span className="text-amber-400">Van Allen dose =</span> <span className={cn("font-bold", dose > 500 ? "text-red-400" : "text-green-400")}>{dose.toFixed(1)}</span> <span className="text-slate-400">mrad/day</span></div>
        <div><span className="text-amber-400">Atm. density =</span> <span className="text-green-400 font-bold">{atm.toExponential(2)}</span> <span className="text-slate-400">kg/m³</span></div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <MetricBadge label="v_circ" value={hohmann.v_circ1_kms.toFixed(2)} unit="km/s" color={CB} />
        <MetricBadge label="Isp" value={prop.isp_vac} unit="s (vac)" color={prop.color} />
        <MetricBadge label="Total ΔV" value={(hohmann.dvTotal_ms / 1000).toFixed(2)} unit="km/s" color="#a78bfa" />
      </div>
    </div>
  );
}

// ─── Satellite Conjunction Panel ──────────────────────────────────────────────

function ConjunctionPanel({ altitude, inclination }: { altitude: number; inclination: number }) {
  const threats = useMemo(() => {
    // Simulate known debris shells (ISS orbit, Starlink, Iridium, debris field)
    const shells = [
      { name: 'ISS Shell',      alt: 415, inc: 51.6  },
      { name: 'Starlink V1',    alt: 550, inc: 53.0  },
      { name: 'Iridium Belt',   alt: 780, inc: 86.4  },
      { name: 'ASAT Debris',    alt: 500, inc: 97.0  },
      { name: 'GPS Debris',     alt: 20200, inc: 55.0 },
    ];
    return shells.map(s => {
      const risk = estimateConjunctionRisk(altitude, inclination, s.alt, s.inc);
      return {
        ...s,
        ...risk,
        level: risk.probability > 0.005 ? 'high' : risk.probability > 0.001 ? 'medium' : 'low'
      };
    }).sort((a, b) => b.probability - a.probability);
  }, [altitude, inclination]);

  const riskColor = (l: string) => l === 'high' ? '#f87171' : l === 'medium' ? '#fbbf24' : '#34d399';

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] text-slate-300 uppercase font-bold tracking-widest">Conjunction Analysis (TCA)</p>
      {threats.map((t, i) => (
        <div key={i} className="flex items-center gap-2 p-2 rounded border border-slate-700/60 bg-slate-900/40 text-[9px]">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ background: riskColor(t.level) }} />
          <span className="text-slate-300 flex-1 truncate">{t.name}</span>
          <span className="text-slate-200 font-bold">{t.closestApproach_km.toFixed(1)} km</span>
          <span style={{ color: riskColor(t.level) }} className="font-bold uppercase text-[8px] w-12 text-right">{t.level}</span>
        </div>
      ))}
    </div>
  );
}

// ─── QAOA Energy Chart ────────────────────────────────────────────────────────

const QAOAChart = ({ layers }: { layers: any[] }) => (
  <div>
    <p className="text-[9px] text-slate-300 uppercase font-bold tracking-widest mb-1.5">QAOA Energy Landscape (p={layers.length})</p>
    <ResponsiveContainer width="100%" height={80}>
      <LineChart data={layers.map((l, i) => ({ p: i + 1, E: l.energyExpectation, γ: l.gamma.toFixed(2), β: l.beta.toFixed(2) }))}>
        <CartesianGrid strokeDasharray="2 2" stroke="#ffffff08" />
        <XAxis dataKey="p" tick={{ fontSize: 8, fill: '#94a3b8' }} label={{ value: 'Layer p', position: 'right', fontSize: 8, fill: '#94a3b8' }} />
        <YAxis tick={{ fontSize: 8, fill: '#94a3b8' }} />
        <Tooltip contentStyle={{ background: '#0d1224', border: '1px solid #334155', fontSize: 9, color: '#e2e8f0' }}
          formatter={(v: any, name: string) => [typeof v === 'number' ? v.toFixed(4) : v, name]} />
        <Line type="monotone" dataKey="E" stroke="#a78bfa" dot={{ r: 3, fill: '#a78bfa' }} strokeWidth={2} name="⟨E⟩ Expectation" />
      </LineChart>
    </ResponsiveContainer>
  </div>
);

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [activeTab, setActiveTab] = useState<'mission' | 'physics' | 'quantum'>('mission');
  const [missionType, setMissionType] = useState<MissionType>('lunar');
  const [fuelType, setFuelType] = useState<FuelType>('LH2');
  const [windSpeed, setWindSpeed] = useState(0);
  const [launchDate, setLaunchDate] = useState(new Date().toISOString().split('T')[0]);
  const [targetPlanet, setTargetPlanet] = useState('moon');
  const [spacecraftMass, setSpacecraftMass] = useState(26500);
  const [spacecraftThrust, setSpacecraftThrust] = useState(111200);

  const [weatherData, setWeatherData] = useState<any>(null);
  const [nasaWeather, setNasaWeather] = useState<any>(null);
  const [tleData, setTleData] = useState<any>(null);

  const [optimizing, setOptimizing] = useState(false);
  const [qaoa_p, setQaoa_p] = useState(3);
  const [qaoaRerunning, setQaoaRerunning] = useState(false);
  const [showGraph2D, setShowGraph2D] = useState(false);
  const [weightsChanged, setWeightsChanged] = useState(false);
  const [weights, setWeights] = useState<QUBOWeights>({ fuel: 3.0, rad: 5.0, comm: 2.0, safety: 4.0 });
  const [optResult, setOptResult] = useState<OptimizationResult | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [logLines, setLogLines] = useState<string[]>([
    '> ARTEMIS-Q Competition Edition v2.0',
    '> Quantum optimizer ready',
    '> Awaiting mission parameters...',
  ]);

  const updateWeight = (key: keyof QUBOWeights, val: number) => {
    setWeights(prev => ({ ...prev, [key]: val }));
    if (optResult) setWeightsChanged(true);
  };

  const addLog = useCallback((msg: string) => {
    setLogLines(prev => [...prev.slice(-20), `> ${msg}`]);
  }, []);

  // Keplerian elements (live editable)
  const [keplerEl, setKeplerEl] = useState<KeplerianElements>({
    a: 6778,    // 400 km altitude
    e: 0.0008,
    i: 51.6,
    raan: 247,
    argp: 130,
    nu: 0,
  });

  const updateKepler = (key: keyof KeplerianElements, val: number) =>
    setKeplerEl(prev => ({ ...prev, [key]: val }));

  const preset = MISSION_PRESETS[missionType];

  // ── Data Fetch ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchAll = async () => {
      try {
        addLog('Fetching surface weather (OpenWeather API)...');
        const wxRes = await fetch('/api/weather');
        const wx = await wxRes.json();
        setWeatherData(wx);
        if (wx.wind_speed) setWindSpeed(Math.round(wx.wind_speed / 3.6));
        addLog(`Weather: ${wx.temp?.toFixed(1)}°C | Wind: ${wx.wind_speed?.toFixed(1)} km/h [${wx.source}]`);

        addLog('Fetching space weather (NASA DONKI)...');
        const nasaRes = await fetch('/api/space-weather');
        const nasa = await nasaRes.json();
        setNasaWeather(nasa);
        addLog(`Space weather: Radiation index ${nasa.radiationIndex?.toFixed(2)}x [${nasa.source}]`);
      } catch (e) {
        addLog('WARNING: External API unavailable, using simulated data');
      }
    };
    fetchAll();
  }, []);

  // ── Optimize ────────────────────────────────────────────────────────────────
  const handleOptimize = async () => {
    setOptimizing(true);
    setOptResult(null);
    setWeightsChanged(false);
    addLog(`Initialising QUBO formulation (${preset.nodes.length} nodes × ${preset.edges.length} edges)...`);
    addLog(`Encoding Hamiltonian: H = Σ wf·Δv² + wr·rad² + wc·(1-comm)² + ws·safety`);

    try {
      const res = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes: preset.nodes,
          edges: preset.edges,
          weights,
          start: preset.start,
          end: preset.end,
          steps: 8,
          date: launchDate,
          radiationIndex: nasaWeather?.radiationIndex || 1.0,
          isp_s: PROPELLANTS[fuelType].isp_vac,
          spacecraft_mass_kg: spacecraftMass,
          qaoa_p,
        })
      });
      const data: OptimizationResult = await res.json();
      setOptResult(data);
      addLog(`Annealing complete: ${data.quboGraph?.annealingSteps?.toLocaleString()} iterations`);
      addLog(`QAOA p=${data.qaoa?.layers?.length ?? qaoa_p}: ⟨E⟩ = ${data.qaoa?.finalEnergy?.toFixed(4)}`);
      addLog(`QAOA Match: ${data.qaoa?.qaoaMatchPct?.toFixed(1)}% of brute-force optimal`);
      addLog(`SA improvement: ${data.qaoa?.classicalSAImprovement_pct?.toFixed(1)}% over greedy baseline`);
      addLog(`Total Δv = ${data.totalDeltaV_ms?.toFixed(0)} m/s | Fuel = ${data.fuelMass_kg?.toFixed(0)} kg`);
    } catch (e) {
      addLog('ERROR: Optimization failed — check server');
      console.error(e);
    } finally {
      setOptimizing(false);
    }
  };

  // ── QAOA Re-run (p-depth change, no SA) ───────────────────────────────────
  const handleQAOARerun = async (newP: number) => {
    if (!optResult) return;
    setQaoaRerunning(true);
    addLog(`Re-running QAOA with p=${newP} (keeping SA path)...`);
    try {
      const res = await fetch('/api/qaoa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bestPath: optResult.path,
          nodes: preset.nodes,
          edges: preset.edges,
          weights,
          qaoa_p: newP,
        }),
      });
      const data = await res.json();
      setOptResult(prev => prev ? {
        ...prev,
        qaoa: { ...prev.qaoa, ...data.qaoa },
        circuitMap: data.circuitMap,
      } : null);
      addLog(`QAOA p=${newP}: ⟨E⟩ = ${data.qaoa?.finalEnergy?.toFixed(4)}, Match = ${data.qaoa?.qaoaMatchPct?.toFixed(1)}%`);
    } catch (e) {
      addLog('ERROR: QAOA re-run failed');
    } finally {
      setQaoaRerunning(false);
    }
  };

  // ── Save/Load ───────────────────────────────────────────────────────────────
  const saveConfig = () => {
    setSaveStatus('saving');
    localStorage.setItem('artemisq_config', JSON.stringify({
      targetPlanet, missionType, fuelType, launchDate, windSpeed, keplerEl, spacecraftMass, weights, qaoa_p
    }));
    setTimeout(() => { setSaveStatus('saved'); setTimeout(() => setSaveStatus('idle'), 2000); }, 600);
  };
  const loadConfig = () => {
    const s = localStorage.getItem('artemisq_config');
    if (s) {
      const c = JSON.parse(s);
      setTargetPlanet(c.targetPlanet); setMissionType(c.missionType);
      setFuelType(c.fuelType); setLaunchDate(c.launchDate);
      setWindSpeed(c.windSpeed); if (c.keplerEl) setKeplerEl(c.keplerEl);
      if (c.spacecraftMass) setSpacecraftMass(c.spacecraftMass);
      if (c.weights) setWeights(c.weights);
      if (c.qaoa_p) setQaoa_p(c.qaoa_p);
      setOptResult(null);
      addLog('Configuration loaded from local storage');
    }
  };

  // ── Derived metrics ─────────────────────────────────────────────────────────
  const altitude = keplerEl.a - 6371;
  const currentDragDensity = atmosphericDensity(altitude);
  const currentVADose = vanAllenDose(altitude, keplerEl.i);
  const currentJ2 = j2NodalPrecession(altitude, keplerEl.e, keplerEl.i);
  const hohmannToGEO = computeHohmann(altitude, 35786);

  return (
    <div className="min-h-screen bg-bg-dark text-slate-200 font-mono selection:bg-[#4B9CD3]/20 flex flex-col">
      {/* Background grid */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.025] overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#4B9CD3_1px,transparent_1px),linear-gradient(to_bottom,#4B9CD3_1px,transparent_1px)] bg-[size:48px_48px]" />
      </div>

      <div className="relative z-10 flex-1 flex flex-col overflow-hidden">
        {/* ── Header ── */}
        <header className="h-[58px] border-b border-slate-800 bg-black/60 backdrop-blur-sm flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-7 h-7 [clip-path:polygon(50%_0%,100%_100%,0%_100%)]" style={{ background: CB }} />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-[3px] text-slate-100 uppercase leading-none">ARTEMIS-Q</h1>
              <p className="text-[9px] text-slate-500 tracking-widest uppercase mt-0.5">Quantum Orbital Intelligence System</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Weather strip */}
            {weatherData && (
              <div className="hidden md:flex items-center gap-2 text-[9px] text-slate-300 border border-slate-700 bg-slate-900/60 px-3 py-1.5 rounded">
                <Thermometer className="w-3 h-3 text-red-400" />
                <span>{weatherData.temp?.toFixed(1)}°C</span>
                <Wind className="w-3 h-3" style={{ color: CB }} />
                <span>{weatherData.wind_speed?.toFixed(0)} km/h</span>
                <div className={cn("w-1.5 h-1.5 rounded-full", weatherData.source === 'LIVE' ? "bg-green-400 animate-pulse" : "bg-yellow-400")} />
                <span className="text-slate-400">{weatherData.source}</span>
              </div>
            )}

            {/* Tab nav */}
            <nav className="flex items-center gap-1 bg-bg-card rounded-md p-1 border border-slate-700">
              {([
                { id: 'mission', icon: MapIcon,  label: 'Mission'  },
                { id: 'physics', icon: Gauge,     label: 'Physics'  },
                { id: 'quantum', icon: Atom,      label: 'Quantum'  },
              ] as const).map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className="px-3 py-1.5 rounded-sm text-[9px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all"
                  style={activeTab === tab.id
                    ? { background: CB, color: '#000' }
                    : { color: '#94a3b8' }}>
                  <tab.icon className="w-3 h-3" />{tab.label}
                </button>
              ))}
            </nav>

            {/* Scenario picker */}
            <select onChange={e => {
              const s = MISSION_SCENARIOS.find(sc => sc.id === e.target.value);
              if (s) {
                setTargetPlanet(s.target); setMissionType(s.mode as MissionType);
                setFuelType(s.fuel as FuelType); setLaunchDate(s.date);
                setSpacecraftMass(s.mass); setSpacecraftThrust(s.thrust);
                setOptResult(null); addLog(`Scenario loaded: ${s.name}`);
              }
            }}
              className="bg-slate-900 border border-slate-700 text-[9px] text-slate-300 font-bold uppercase p-2 rounded focus:outline-none cursor-pointer">
              <option value="">— Scenarios —</option>
              {MISSION_SCENARIOS.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </header>

        {/* ── Main Grid ── */}
        <main className="flex-1 overflow-hidden p-3 grid grid-cols-[1fr_360px] gap-3">

          {/* ── LEFT: Visualisation ── */}
          <section className="flex flex-col gap-3 overflow-hidden min-w-0">

            {/* Globe / 3D view */}
            <DashboardCard
              title={`${preset.title} — ${PLANETS[targetPlanet]?.name}`}
              icon={Globe} className="flex-1 min-h-0" accent
              headerRight={
                <button
                  onClick={() => setShowGraph2D(v => !v)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded border text-[8px] font-bold uppercase transition-all"
                  style={showGraph2D
                    ? { background: `${CB}30`, borderColor: CB, color: CB }
                    : { background: '#0f172a', borderColor: '#334155', color: '#94a3b8' }}
                >
                  {showGraph2D ? '🌍 3D' : '📊 2D'}
                </button>
              }
            >
              <div className="w-full h-full rounded-sm bg-black/50 border border-slate-800 overflow-hidden" style={{ minHeight: 320 }}>
                {showGraph2D ? (
                  <div className="w-full h-full flex items-center justify-center p-2">
                    <Graph2DOverlay preset={preset} optResult={optResult} />
                  </div>
                ) : (
                  <Canvas>
                    <PerspectiveCamera makeDefault position={[0, 80, 500]} />
                    <OrbitControls minDistance={80} maxDistance={1200} />
                    <ambientLight intensity={0.3} />
                    <pointLight position={[500, 200, 200]} intensity={1.2} color="#fff8e1" />
                    <pointLight position={[-200, -100, -200]} intensity={0.3} color="#0022ff" />
                    <MissionGlobe
                      launchDate={launchDate}
                      targetPlanetId={targetPlanet}
                      optResult={optResult}
                      preset={preset}
                      keplerEl={keplerEl}
                    />
                  </Canvas>
                )}
              </div>
            </DashboardCard>

            {/* Status console */}
            <div className="h-[70px] shrink-0 bg-slate-950 border border-slate-700 rounded overflow-hidden p-2 font-mono text-[9px]">
              <div className="overflow-y-auto h-full space-y-0.5">
                {logLines.map((line, i) => (
                  <div key={i} className={cn("leading-tight",
                    line.includes('ERROR') ? 'text-red-400' :
                    line.includes('WARNING') ? 'text-amber-400' :
                    line.includes('QAOA') || line.includes('Quantum') ? 'text-purple-400' :
                    line.includes('complete') || line.includes('loaded') ? 'text-green-400' :
                    'text-slate-400'
                  )}>{line}</div>
                ))}
              </div>
            </div>

            {/* Bottom charts row */}
            <div className="h-[160px] shrink-0 grid grid-cols-3 gap-3">
              {/* Annealing history */}
              <DashboardCard title="Annealing Convergence" icon={TrendingDown}>
                {optResult?.annealingHistory?.length ? (
                  <AnnealingChart history={optResult.annealingHistory} />
                ) : (
                  <div className="h-full flex items-center justify-center text-[9px] text-slate-500">Run optimizer to view convergence</div>
                )}
              </DashboardCard>

              {/* QAOA layers */}
              <DashboardCard title="QAOA Expectation" icon={Atom}>
                {optResult?.qaoa?.layers?.length ? (
                  <QAOAChart layers={optResult.qaoa.layers} />
                ) : (
                  <div className="h-full flex items-center justify-center text-[9px] text-slate-500">QAOA data pending</div>
                )}
              </DashboardCard>

              {/* Key metrics */}
              <DashboardCard title="Mission Metrics" icon={Zap}>
                {optResult ? (
                  <div className="grid grid-cols-2 gap-1.5 h-full content-start">
                    <MetricBadge label="Δv Total" value={(optResult.totalDeltaV_ms / 1000).toFixed(2)} unit="km/s" color={CB} />
                    <MetricBadge label="Fuel Mass" value={optResult.fuelMass_kg.toFixed(0)} unit="kg" color="#f59e0b" />
                    <MetricBadge label="Q-Advantage" value={`${optResult.qaoa.quantumAdvantage_pct.toFixed(1)}%`} unit="cost saving" color="#a78bfa" />
                    <MetricBadge label="VA Dose" value={optResult.physics.vanAllenDose.toFixed(0)} unit="mrad/day"
                      color={optResult.physics.vanAllenDose > 500 ? "#f87171" : "#34d399"}
                      warning={optResult.physics.vanAllenDose > 500} />
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-[9px] text-slate-500">Optimize mission first</div>
                )}
              </DashboardCard>
            </div>
          </section>

          {/* ── RIGHT: Controls ── */}
          <aside className="flex flex-col gap-3 overflow-y-auto overflow-x-hidden">

            {/* ── Mission Tab ── */}
            <AnimatePresence mode="wait">
              {activeTab === 'mission' && (
                <motion.div key="mission" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex flex-col gap-3">

                  <DashboardCard title="Mission Configuration" icon={Settings}>
                    <div className="space-y-3">
                      <div>
                        <label className="text-[9px] text-slate-400 uppercase font-bold block mb-1.5">Mission Mode</label>
                        {(Object.keys(MISSION_PRESETS) as MissionType[]).map(t => (
                          <button key={t} onClick={() => { setMissionType(t); setOptResult(null); }}
                            className="w-full mb-1 p-2 rounded border text-left text-[10px] font-bold transition-all"
                            style={missionType === t
                              ? { background: `${CB}18`, borderColor: CB, color: CB }
                              : { background: '#0f172a', borderColor: '#334155', color: '#94a3b8' }}>
                            {MISSION_PRESETS[t].title}
                          </button>
                        ))}
                      </div>

                      <div>
                        <label className="text-[9px] text-slate-400 uppercase font-bold block mb-1.5">Destination</label>
                        <div className="flex flex-wrap gap-1">
                          {Object.values(PLANETS).map(p => (
                            <button key={p.id} onClick={() => setTargetPlanet(p.id)}
                              className="flex-1 min-w-[54px] py-1.5 text-[9px] font-bold border rounded transition-all"
                              style={targetPlanet === p.id
                                ? { background: CB, color: '#000', borderColor: CB }
                                : { background: '#0f172a', borderColor: '#334155', color: '#94a3b8' }}>
                              {p.name}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="text-[9px] text-slate-400 uppercase font-bold block mb-1.5">Propellant</label>
                        <div className="flex gap-1">
                          {(['RP-1', 'LH2', 'Methane'] as FuelType[]).map(f => (
                            <button key={f} onClick={() => setFuelType(f)}
                              className="flex-1 py-1.5 text-[9px] font-bold border rounded transition-all"
                              style={fuelType === f
                                ? { background: PROPELLANTS[f].color, color: '#000', borderColor: PROPELLANTS[f].color }
                                : { background: '#0f172a', borderColor: '#334155', color: '#94a3b8' }}>
                              {f}
                            </button>
                          ))}
                        </div>
                        <p className="text-[9px] text-slate-500 mt-1.5">Isp vac: {PROPELLANTS[fuelType].isp_vac} s &nbsp;|&nbsp; ρ: {PROPELLANTS[fuelType].density} kg/m³</p>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-[9px] text-slate-400 uppercase">Launch Date
                          <input type="date" value={launchDate} onChange={e => setLaunchDate(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 text-[10px] p-1.5 mt-0.5 text-slate-200 rounded" />
                        </label>
                        <label className="text-[9px] text-slate-400 uppercase">S/C Mass (kg)
                          <input type="number" value={spacecraftMass} onChange={e => setSpacecraftMass(+e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 text-[10px] p-1.5 mt-0.5 text-slate-200 rounded" />
                        </label>
                      </div>

                      <div>
                        <label className="text-[9px] text-slate-400 uppercase font-bold flex justify-between">
                          Surface Wind <span className="text-slate-200">{windSpeed} m/s</span>
                        </label>
                        <input type="range" min="-30" max="30" step="1" value={windSpeed}
                          onChange={e => setWindSpeed(+e.target.value)} className="w-full mt-1" style={{ accentColor: CB }} />
                      </div>

                      {/* QUBO Weight Sliders */}
                      <div className="space-y-2 border border-slate-800 rounded p-2.5">
                        <p className="text-[9px] text-slate-400 uppercase font-bold">QUBO Weights</p>
                        {([
                          { key: 'fuel',   label: 'w_fuel (ΔV)',    color: '#f59e0b' },
                          { key: 'rad',    label: 'w_rad (Radiation)', color: '#f87171' },
                          { key: 'comm',   label: 'w_comm (Signal)', color: CB },
                          { key: 'safety', label: 'w_safety',        color: '#4ade80' },
                        ] as const).map(({ key, label, color }) => (
                          <div key={key}>
                            <div className="flex justify-between text-[9px] mb-0.5">
                              <span className="text-slate-400">{label}</span>
                              <span className="font-bold" style={{ color }}>{weights[key].toFixed(1)}</span>
                            </div>
                            <input type="range" min={0} max={10} step={0.5} value={weights[key]}
                              onChange={e => updateWeight(key, +e.target.value)}
                              className="w-full" style={{ accentColor: color }} />
                          </div>
                        ))}
                      </div>

                      <button onClick={handleOptimize} disabled={optimizing}
                        id="run-optimizer-btn"
                        className={cn(
                          'w-full py-3 font-black uppercase text-[10px] tracking-widest rounded transition-all disabled:opacity-50 border-2',
                          weightsChanged && !optimizing ? 'stale-pulse' : 'border-transparent'
                        )}
                        style={{ background: CB, color: '#000' }}>
                        {optimizing ? (
                          <span className="flex items-center justify-center gap-2">
                            <span className="w-3 h-3 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                            Quantum Optimizing...
                          </span>
                        ) : weightsChanged ? 'Weights Changed — Re-run →' : 'Run Quantum Optimizer →'}
                      </button>

                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={saveConfig} disabled={saveStatus !== 'idle'}
                          className="flex items-center justify-center gap-1.5 py-2 bg-slate-900 border border-slate-700 rounded text-[9px] font-bold uppercase text-slate-400 hover:text-slate-200 transition-colors">
                          {saveStatus === 'saved' ? <CheckCircle2 className="w-3 h-3 text-green-400" /> : <Save className="w-3 h-3" />}
                          {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved!' : 'Save Config'}
                        </button>
                        <button onClick={loadConfig}
                          className="flex items-center justify-center gap-1.5 py-2 bg-slate-900 border border-slate-700 rounded text-[9px] font-bold uppercase text-slate-400 hover:text-slate-200 transition-colors">
                          <Download className="w-3 h-3" /> Load Config
                        </button>
                      </div>
                    </div>
                  </DashboardCard>

                  {/* ── Mission Output Panel (NEW) ── */}
                  {optResult && (() => {
                    // Derive TCA from first conjunction threat for this orbit
                    const pathNode = preset.nodes.find((n: any) => n.id === optResult.path[0]);
                    const alt = pathNode?.altitude_km ?? 400;
                    const inc = pathNode?.inclination ?? 28.5;
                    const shells = [
                      { alt: 415, inc: 51.6 }, { alt: 550, inc: 53.0 },
                      { alt: 780, inc: 86.4 }, { alt: 500, inc: 97.0 },
                    ];
                    const closestApproach = Math.min(...shells.map(s =>
                      estimateConjunctionRisk(alt, inc, s.alt, s.inc).closestApproach_km
                    ));
                    const riskLevel = closestApproach < 2 ? 'HIGH' : closestApproach < 10 ? 'MEDIUM' : 'LOW';
                    const riskColor = riskLevel === 'HIGH' ? '#f87171' : riskLevel === 'MEDIUM' ? '#fbbf24' : '#4ade80';
                    const commCoverage = (optResult.path.reduce((s: number, id: string) => {
                      const n = preset.nodes.find((nd: any) => nd.id === id);
                      return s + (n?.commScore ?? 0);
                    }, 0) / optResult.path.length * 100);

                    return (
                      <DashboardCard title="Mission Output" icon={Satellite} accent>
                        <div className="space-y-0">
                          {[
                            { label: 'Total ΔV',              value: `${(optResult.totalDeltaV_ms / 1000).toFixed(3)} km/s`,              color: CB },
                            { label: 'Propellant Mass',        value: `${optResult.fuelMass_kg.toFixed(0)} kg`,                             color: '#f59e0b' },
                            { label: 'Propellant Fraction',    value: `${(optResult.propellantFraction * 100).toFixed(1)}%`,                 color: '#f59e0b' },
                            { label: 'Closest Approach (TCA)', value: `${closestApproach.toFixed(2)} km`,                                   color: riskColor },
                            { label: 'Collision Risk',         value: riskLevel,                                                             color: riskColor },
                            { label: 'Radiation Score',        value: `${optResult.radiationExposure.toFixed(3)}`,                          color: optResult.radiationExposure > 1.5 ? '#f87171' : '#4ade80' },
                            { label: 'Comm. Coverage',         value: `${commCoverage.toFixed(1)}%`,                                        color: commCoverage > 70 ? '#4ade80' : '#fbbf24' },
                            { label: 'Mission Time',           value: `${optResult.physics.transferTime_days.toFixed(2)} days`,              color: '#a78bfa' },
                            { label: 'Quantum Advantage',      value: `${optResult.qaoa.quantumAdvantage_pct.toFixed(1)}% cost reduction`,  color: CB },
                          ].map(({ label, value, color }) => (
                            <div key={label} className="flex items-center justify-between py-1.5 border-b border-slate-800">
                              <span className="text-[10px] text-slate-400">{label}</span>
                              <span className="text-[11px] font-bold font-mono" style={{ color }}>{value}</span>
                            </div>
                          ))}
                        </div>
                      </DashboardCard>
                    );
                  })()}

                  {/* ── Path Rationale (NEW) ── */}
                  {optResult && (() => {
                    const radScore = optResult.radiationExposure;
                    const commScore = 1 - optResult.commLoss;
                    const saving = ((1 - optResult.totalCost / optResult.naiveCost) * 100).toFixed(0);
                    const bullets: string[] = [];
                    if (radScore < 0.5) bullets.push(`Avoids high-density Van Allen belt — radiation score ${(radScore).toFixed(2)} (${radScore < 0.3 ? 'low' : 'moderate'} exposure)`);
                    else bullets.push(`Routes through partial radiation zone — ${(optResult.physics.vanAllenDose).toFixed(0)} mrad/day dose monitored`);
                    if (commScore > 0.7) bullets.push(`Maintains strong comm. window coverage (${(commScore * 100).toFixed(0)}%) — no blackout gaps along path`);
                    else bullets.push(`Trades ${((1 - commScore) * 100).toFixed(0)}% comms loss for lower fuel expenditure along shadow corridor`);
                    bullets.push(`Quantum optimizer reduced total mission cost by ${saving}% vs. greedy baseline — ${optResult.quboGraph.annealingSteps.toLocaleString()} annealing steps`);

                    return (
                      <DashboardCard title="Path Rationale" icon={Database}>
                        <ul className="space-y-2">
                          {bullets.map((b, i) => (
                            <li key={i} className="flex gap-2 text-[10px] text-slate-300 leading-snug">
                              <span className="mt-0.5 shrink-0 w-1.5 h-1.5 rounded-full" style={{ background: CB }} />
                              {b}
                            </li>
                          ))}
                        </ul>
                      </DashboardCard>
                    );
                  })()}

                  {/* Optimization Results (existing, cleaned up) */}
                  {optResult && (
                    <DashboardCard title="Optimization Details" icon={Target} accent>
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-1.5">
                          <MetricBadge label="Cost Saved" value={`${((1 - optResult.totalCost / optResult.naiveCost) * 100).toFixed(1)}%`} color="#4ade80" />
                          <MetricBadge label="QUBO Vars" value={optResult.quboGraph.binaryVars} color="#a78bfa" />
                          <MetricBadge label="Transfer Time" value={optResult.physics.transferTime_days.toFixed(1)} unit="days" color={CB} />
                          <MetricBadge label="Prop. Fraction" value={`${(optResult.propellantFraction * 100).toFixed(1)}%`} color="#f59e0b" />
                        </div>

                        <div>
                          <p className="text-[9px] text-slate-400 uppercase mb-1.5">Optimal Path</p>
                          <div className="flex flex-wrap gap-1">
                            {optResult.path.map((id, i) => (
                              <span key={i} className="flex items-center gap-0.5">
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold border"
                                  style={{ background: `${CB}18`, borderColor: `${CB}55`, color: CB }}>{id}</span>
                                {i < optResult.path.length - 1 && <ChevronRight className="w-2.5 h-2.5 text-slate-600" />}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-1.5 pt-1 border-t border-slate-800">
                          <p className="text-[9px] text-slate-400 uppercase">Space Weather Inputs</p>
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-slate-400">CME Radiation Index</span>
                            <span className={cn("font-bold", (nasaWeather?.radiationIndex || 1) > 1.2 ? "text-red-400" : "text-green-400")}>
                              {(nasaWeather?.radiationIndex || 1.0).toFixed(2)}×
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-slate-400">Anneal Temp Final</span>
                            <span className="text-slate-200 font-bold">{optResult.quboGraph.temperature.toExponential(2)} K</span>
                          </div>
                        </div>
                      </div>
                    </DashboardCard>
                  )}

                  {/* Fuel Calculator */}
                  <DashboardCard title="Fuel Calculator (Tsiolkovsky)" icon={Rocket}>
                    <FuelCalculator missionType={missionType} fuelType={fuelType} />
                  </DashboardCard>
                </motion.div>
              )}

              {/* ── Physics Tab ── */}
              {activeTab === 'physics' && (
                <motion.div key="physics" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex flex-col gap-3">
                  <DashboardCard title="Keplerian Elements" icon={Globe} accent>
                    <div className="space-y-2.5">
                      {([
                        { key: 'a',    label: 'Semi-major axis a',  min: 6571,  max: 42164, step: 10,    fmt: (v: number) => `${(v-6371).toFixed(0)} km alt` },
                        { key: 'e',    label: 'Eccentricity e',     min: 0,     max: 0.9,   step: 0.001, fmt: (v: number) => v.toFixed(4) },
                        { key: 'i',    label: 'Inclination i',      min: 0,     max: 180,   step: 0.1,   fmt: (v: number) => `${v.toFixed(1)}°` },
                        { key: 'raan', label: 'RAAN Ω',             min: 0,     max: 360,   step: 0.5,   fmt: (v: number) => `${v.toFixed(1)}°` },
                        { key: 'argp', label: 'Arg. Perigee ω',     min: 0,     max: 360,   step: 0.5,   fmt: (v: number) => `${v.toFixed(1)}°` },
                        { key: 'nu',   label: 'True anomaly ν',     min: 0,     max: 360,   step: 1,     fmt: (v: number) => `${v.toFixed(1)}°` },
                      ] as const).map(({ key, label, min, max, step, fmt }) => (
                        <label key={key} className="flex flex-col gap-0.5">
                          <div className="flex justify-between text-[9px]">
                            <span className="text-slate-400 uppercase">{label}</span>
                            <span className="font-bold" style={{ color: CB }}>{fmt(keplerEl[key as keyof KeplerianElements] as number)}</span>
                          </div>
                          <input type="range" min={min} max={max} step={step}
                            value={keplerEl[key as keyof KeplerianElements] as number}
                            onChange={e => updateKepler(key as keyof KeplerianElements, +e.target.value)}
                            style={{ accentColor: CB }} className="w-full" />
                        </label>
                      ))}
                    </div>
                  </DashboardCard>

                  <DashboardCard title="Live Orbital Physics" icon={Cpu}>
                    <PhysicsPanel keplerEl={keplerEl} fuelType={fuelType} />
                  </DashboardCard>

                  <DashboardCard title="Conjunction Analysis" icon={ShieldAlert}>
                    <ConjunctionPanel altitude={altitude} inclination={keplerEl.i} />
                  </DashboardCard>

                  <DashboardCard title="Fuel Calculator" icon={Rocket}>
                    <FuelCalculator missionType={missionType} fuelType={fuelType} />
                  </DashboardCard>
                </motion.div>
              )}

              {/* ── Quantum Tab ── */}
              {activeTab === 'quantum' && (
                <motion.div key="quantum" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex flex-col gap-3">
                  <DashboardCard title="QUBO Formulation" icon={Atom} accent>
                    <div className="space-y-2">
                      <p className="text-[10px] text-slate-300 leading-relaxed">
                        Quadratic Unconstrained Binary Optimization encodes the mission planning problem as a spin-glass Hamiltonian.
                      </p>
                      <div className="bg-slate-900/80 border border-slate-700 p-2.5 rounded font-mono text-[10px] space-y-1">
                        <div className="text-amber-400">H(x) = Σᵢ Qᵢᵢ xᵢ + Σᵢ&lt;ⱼ Qᵢⱼ xᵢxⱼ</div>
                        <div className="text-slate-500">xᵢₖ ∈ &#123;0,1&#125;: node i at step k</div>
                        <div className="text-slate-300">HC = Σ wf·fuelCost² + Σ wr·rad² + Σ wc·(1-comm)²</div>
                        <div className="text-slate-300">HB = Σᵢ Xᵢ  (mixer — uniform superposition)</div>
                        <div className="text-[9px] text-slate-500 mt-1">U(γ,β) = e&#123;-iβH_B&#125; · e&#123;-iγH_C&#125; per layer</div>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        <MetricBadge label="QUBO Vars" value={optResult ? `${optResult.quboGraph.binaryVars}` : '-'} unit="binary vars" color="#a78bfa" />
                        <MetricBadge label="w_fuel" value={weights.fuel.toFixed(1)} color="#f59e0b" />
                        <MetricBadge label="w_rad" value={weights.rad.toFixed(1)} color="#f87171" />
                        <MetricBadge label="w_comm" value={weights.comm.toFixed(1)} color={CB} />
                        <MetricBadge label="w_safety" value={weights.safety.toFixed(1)} color="#4ade80" />
                        <MetricBadge label="Penalty λ" value="1000" color="#a78bfa" />
                      </div>
                    </div>
                  </DashboardCard>

                  {/* QAOA Circuit Depth Slider + circuit display */}
                  <DashboardCard title="QAOA Circuit" icon={Cpu}>
                    <div className="space-y-2">
                      {/* p-depth slider */}
                      <div className="space-y-1.5 border border-slate-800 rounded p-2.5">
                        <div className="flex items-center justify-between text-[9px]">
                          <span className="text-slate-400 uppercase font-bold">Circuit Depth p</span>
                          <span className="font-bold" style={{ color: CB }}>p = {qaoa_p}</span>
                        </div>
                        <input type="range" min={1} max={5} step={1} value={qaoa_p}
                          onChange={e => setQaoa_p(+e.target.value)}
                          className="w-full" style={{ accentColor: CB }} />
                        <div className="flex justify-between text-[7px] text-slate-600">
                          {[1,2,3,4,5].map(v => <span key={v}>{v}</span>)}
                        </div>
                        <button
                          onClick={() => handleQAOARerun(qaoa_p)}
                          disabled={!optResult || qaoaRerunning}
                          className="w-full py-1.5 text-[9px] font-bold uppercase tracking-widest rounded border transition-all disabled:opacity-40"
                          style={{ borderColor: CB, color: CB, background: `${CB}18` }}>
                          {qaoaRerunning ? (
                            <span className="flex items-center justify-center gap-1.5">
                              <span className="w-2.5 h-2.5 border border-[#4B9CD3]/40 border-t-[#4B9CD3] rounded-full animate-spin" />
                              Re-running QAOA...
                            </span>
                          ) : !optResult ? 'Run optimizer first' : `Re-run QAOA (p=${qaoa_p}) →`}
                        </button>
                      </div>

                      <div className="bg-slate-900/80 border border-slate-700 p-2.5 rounded font-mono text-[10px] space-y-1">
                        <div className="text-amber-400">U(γ,β) = e&#123;-iβH_B&#125; · e&#123;-iγH_C&#125;</div>
                        <div className="text-slate-300">|ψ₀⟩ = H^⊗n|0⟩  (uniform superposition)</div>
                        <div className="text-slate-300">|ψ_p⟩ = U(γ_p,β_p)···U(γ₁,β₁)|ψ₀⟩</div>
                        <div className="text-[9px] text-slate-500">Full complex amplitudes: re+im ✓ | Grid 20×20/layer ✓</div>
                      </div>
                      {optResult?.circuitMap?.length ? (
                        <QuantumCircuit gates={optResult.circuitMap.slice(0, Math.max(60, (optResult.qaoa.layers.length) * 20 + 20))} />
                      ) : (
                        <div className="text-[10px] text-slate-500 text-center py-4">Run optimizer to generate circuit</div>
                      )}
                    </div>
                  </DashboardCard>

                  {/* QAOA Probability Distribution */}
                  {optResult?.qaoa?.distribution && optResult.qaoa.distribution.length > 0 && (
                    <DashboardCard title="Probability Distribution" icon={BarChart3}>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-[9px]">
                          <span className="text-slate-400">Feasible basis states, sorted by amplitude</span>
                          <span className="font-bold" style={{ color: CB }}>n={optResult.path.length} qubits</span>
                        </div>
                        <QuantumDistribution
                          distribution={optResult.qaoa.distribution}
                          nQubits={optResult.path.length}
                        />
                      </div>
                    </DashboardCard>
                  )}

                  {optResult?.qaoa && (
                    <DashboardCard title="QAOA Metrics" icon={Zap}>
                      <div className="space-y-2">
                        {optResult.qaoa.layers.map((l, i) => (
                          <div key={i} className="flex items-center gap-2 text-[10px] border-b border-slate-800 pb-1.5">
                            <span className="text-slate-400 w-14">Layer {i + 1}</span>
                            <span className="text-amber-400">γ={l.gamma.toFixed(3)}</span>
                            <span style={{ color: CB }}>β={l.beta.toFixed(3)}</span>
                            <span className="ml-auto text-green-400 font-bold">⟨E⟩={l.energyExpectation.toFixed(4)}</span>
                          </div>
                        ))}
                        <div className="grid grid-cols-2 gap-1.5 pt-1">
                          <MetricBadge label="QAOA Match %" value={`${optResult.qaoa.qaoaMatchPct?.toFixed(1) ?? '-'}%`} color="#4ade80" />
                          <MetricBadge label="Approx. Ratio" value={optResult.qaoa.approximationRatio.toFixed(4)} color="#a78bfa" />
                          <MetricBadge label="Final ⟨E⟩" value={optResult.qaoa.finalEnergy.toFixed(4)} color={CB} />
                          <MetricBadge label="SA Improvement" value={`${optResult.qaoa.classicalSAImprovement_pct?.toFixed(1) ?? '-'}%`} color="#f59e0b" />
                        </div>
                        <p className="text-[8px] text-slate-500 pt-1 border-t border-slate-800">
                          QAOA Match = E_optimal / ⟨E⟩ × 100% — how close QAOA gets to the brute-force QUBO optimum.
                          SA Improvement = classical cost reduction vs. greedy baseline (not quantum).
                        </p>
                      </div>
                    </DashboardCard>
                  )}

                  <DashboardCard title="Simulated Annealing" icon={TrendingDown}>
                    <div className="space-y-2">
                      <div className="bg-slate-900/80 border border-slate-700 p-2.5 rounded font-mono text-[10px] space-y-1">
                        <div className="text-amber-400">P(accept) = e^(-ΔE / T)</div>
                        <div className="text-slate-300">T(k) = T₀ · α^k,  α = (T_f/T₀)^(1/N)</div>
                        <div className="text-slate-300">N = 20,000 iterations</div>
                        <div className="text-slate-300">T₀ = 8000 K → T_f = 0.01 K</div>
                        <div className="text-[9px] text-slate-500">Metropolis-Hastings criterion · swap + replace moves</div>
                      </div>
                      {optResult && (
                        <div className="grid grid-cols-2 gap-1.5">
                          <MetricBadge label="Final Temp" value={optResult.quboGraph.temperature.toExponential(1)} unit="K" color="#f59e0b" />
                          <MetricBadge label="Iterations" value={optResult.quboGraph.annealingSteps.toLocaleString()} color="#4ade80" />
                        </div>
                      )}
                    </div>
                  </DashboardCard>
                </motion.div>
              )}
            </AnimatePresence>
          </aside>
        </main>

        <footer className="h-7 border-t border-slate-800 bg-slate-950/80 px-4 flex items-center justify-between text-[9px] text-slate-500 uppercase tracking-widest">
          <span>Artemis-Q v2.0 — Competition Edition</span>
          <span className="flex items-center gap-2">
            <span className="w-1 h-1 rounded-full animate-pulse" style={{ background: CB }} />
            QUBO · QAOA · Tsiolkovsky · J2/J3 · Van Allen · SGP4
          </span>
          <span>© 2026 Hackathon</span>
        </footer>
      </div>
    </div>
  );
}
