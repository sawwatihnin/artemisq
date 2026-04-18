import { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';

export interface AscentVizStep {
  time: number;
  altitude: number;
  downrangeKm: number;
  q: number;
  velocity: number;
  dragN: number;
}

interface MissionStage {
  label: string;
  progress: number;
  color: string;
}

function qToColor(q: number, qMin: number, qMax: number): THREE.Color {
  const t = qMax > qMin ? Math.max(0, Math.min(1, (q - qMin) / (qMax - qMin))) : 0;
  const c = new THREE.Color();
  c.setHSL(0.58 - t * 0.48, 0.92, 0.5);
  return c;
}

/** Classic GL line (vertex colors); avoids Line2 / orthographic zoom pitfalls. */
function ColoredTrajectoryLine({ points, colors }: { points: THREE.Vector3[]; colors: THREE.Color[] }) {
  const lineObject = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const pos = new Float32Array(points.length * 3);
    const col = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      pos[i * 3] = points[i].x;
      pos[i * 3 + 1] = points[i].y;
      pos[i * 3 + 2] = points[i].z;
      col[i * 3] = colors[i].r;
      col[i * 3 + 1] = colors[i].g;
      col[i * 3 + 2] = colors[i].b;
    }
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true });
    return new THREE.Line(geom, mat);
  }, [points, colors]);

  useEffect(() => {
    return () => {
      lineObject.geometry.dispose();
      const m = lineObject.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m.dispose();
    };
  }, [lineObject]);

  return <primitive object={lineObject} />;
}

function TrajectoryPath({ steps, maxQIndex, mecoIndex }: { steps: AscentVizStep[]; maxQIndex: number; mecoIndex: number }) {
    const { points, colors, mq, meco } = useMemo(() => {
    if (!steps.length) {
      const c = new THREE.Vector3(110, 80, 0);
      return {
        points: [] as THREE.Vector3[],
        colors: [] as THREE.Color[],
        mq: c.clone(),
        meco: c.clone(),
      };
    }
    const dr = steps.map((s) => (Number.isFinite(s.downrangeKm) ? s.downrangeKm : 0));
    const alt = steps.map((s) => (Number.isFinite(s.altitude) ? s.altitude : 0));
    const maxX = Math.max(1e-6, ...dr);
    const maxY = Math.max(1e-6, ...alt);
    const sx = 220 / maxX;
    const sy = 180 / maxY;
    const pts = steps.map((s, i) => new THREE.Vector3(dr[i] * sx, alt[i] * sy, 0));
    const qMin = Math.min(...steps.map((s) => s.q));
    const qMax = Math.max(...steps.map((s) => s.q));
    const cols = steps.map((s) => qToColor(s.q, qMin, qMax));
    const iQ = Math.min(maxQIndex, pts.length - 1);
    const iM = Math.min(mecoIndex, pts.length - 1);
    return {
      points: pts,
      colors: cols,
      mq: pts[iQ],
      meco: pts[iM],
    };
  }, [steps, maxQIndex, mecoIndex]);

  if (points.length < 2) return null;

  return (
    <group>
      <ColoredTrajectoryLine points={points} colors={colors} />
      <mesh position={[mq.x, mq.y, 0.4]}>
        <sphereGeometry args={[2.8, 20, 20]} />
        <meshBasicMaterial color="#f59e0b" />
      </mesh>
      <Text position={[mq.x + 10, mq.y + 12, 0]} fontSize={7} color="#fcd34d" anchorX="left" anchorY="middle">
        Max Q
      </Text>
      <mesh position={[meco.x, meco.y, 0.4]}>
        <sphereGeometry args={[2.8, 20, 20]} />
        <meshBasicMaterial color="#38bdf8" />
      </mesh>
      <Text position={[meco.x + 10, meco.y - 12, 0]} fontSize={7} color="#7dd3fc" anchorX="left" anchorY="middle">
        MECO
      </Text>
    </group>
  );
}

export function AscentDynamicsVisualizer({
  steps,
  mecoTime,
  missionStages,
  transferTimeDays,
}: {
  steps: AscentVizStep[];
  mecoTime: number;
  missionStages: MissionStage[];
  transferTimeDays?: number;
}) {
  const [cursor, setCursor] = useState(0);

  const maxQIndex = useMemo(() => {
    if (!steps.length) return 0;
    let ix = 0;
    for (let i = 1; i < steps.length; i++) {
      if (steps[i].q > steps[ix].q) ix = i;
    }
    return ix;
  }, [steps]);

  const maxQTime = steps[maxQIndex]?.time ?? 0;

  const mecoIndex = useMemo(() => {
    if (!steps.length) return 0;
    let best = 0;
    let bestDt = Infinity;
    for (let i = 0; i < steps.length; i++) {
      const dt = Math.abs(steps[i].time - mecoTime);
      if (dt < bestDt) {
        bestDt = dt;
        best = i;
      }
    }
    return best;
  }, [steps, mecoTime]);

  useEffect(() => {
    setCursor(steps.length ? steps.length - 1 : 0);
  }, [steps]);

  const telem = steps[Math.min(cursor, Math.max(0, steps.length - 1))];

  const ascentSpanOnTimeline = useMemo(() => {
    return missionStages.find((s) => s.label === 'Stage Sep')?.progress ?? 0.12;
  }, [missionStages]);

  const missionDurationS = useMemo(() => {
    const d = transferTimeDays && transferTimeDays > 0 ? transferTimeDays : 5;
    return d * 86400;
  }, [transferTimeDays]);

  const maxQMapX = mecoTime > 0 ? (maxQTime / mecoTime) * ascentSpanOnTimeline : 0;
  const mecoMapX = ascentSpanOnTimeline;

  return (
    <div className="flex w-full min-w-0 flex-col gap-2">
      <div className="relative h-[420px] w-full min-h-[420px] overflow-hidden rounded-xl border border-slate-800 bg-[#030712]">
        <Canvas
          className="!h-full !w-full"
          gl={{ antialias: true, alpha: false }}
          camera={{ fov: 38, near: 0.4, far: 8000, position: [120, 95, 260] }}
          onCreated={({ gl }) => {
            gl.setClearColor('#030712');
          }}
        >
          <ambientLight intensity={0.95} />
          <directionalLight position={[80, 120, 140]} intensity={0.55} />
          {steps.length > 1 ? <TrajectoryPath steps={steps} maxQIndex={maxQIndex} mecoIndex={mecoIndex} /> : null}
          <OrbitControls
            enableRotate={false}
            minDistance={80}
            maxDistance={900}
            target={[110, 80, 0]}
            makeDefault
          />
          <Text position={[-35, 202, 0]} fontSize={7.5} color="#94a3b8" anchorX="left" anchorY="top">
            Altitude (km)
          </Text>
          <Text position={[228, -8, 0]} fontSize={7.5} color="#94a3b8" anchorX="left" anchorY="middle">
            Downrange (km)
          </Text>
        </Canvas>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2">
        <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">Mission timeline (ascent segment)</p>
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-800">
          {missionStages.map((s, i) => {
            const prev = i === 0 ? 0 : missionStages[i - 1].progress;
            const w = (s.progress - prev) * 100;
            return (
              <div
                key={s.label}
                title={s.label}
                className="absolute top-0 h-full"
                style={{ left: `${prev * 100}%`, width: `${w}%`, background: s.color, opacity: 0.55 }}
              />
            );
          })}
          <div
            className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-amber-300"
            style={{ left: `${maxQMapX * 100}%` }}
            title="Max Q"
          />
          <div
            className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-sky-400"
            style={{ left: `${mecoMapX * 100}%` }}
            title="MECO"
          />
        </div>
        <p className="mt-1 text-[10px] text-slate-500">
          Markers map ascent events into the launch segment of the mission template (MECO at T+{mecoTime.toFixed(0)} s). Cruise reference ~
          {(missionDurationS / 86400).toFixed(1)} d{transferTimeDays ? ' (from optimizer)' : ''}.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 font-mono text-[11px] text-slate-200">
        <div>
          <span className="text-slate-500">velocity</span>{' '}
          <span className="text-sky-200">{telem ? `${telem.velocity.toFixed(1)} m/s` : '—'}</span>
        </div>
        <div>
          <span className="text-slate-500">altitude</span>{' '}
          <span className="text-sky-200">{telem ? `${telem.altitude.toFixed(2)} km` : '—'}</span>
        </div>
        <div>
          <span className="text-slate-500">q (dynamic pressure)</span>{' '}
          <span className="text-sky-200">{telem ? `${telem.q.toFixed(3)} kPa` : '—'}</span>
        </div>
        <div>
          <span className="text-slate-500">drag |D|</span>{' '}
          <span className="text-sky-200">{telem ? `${(telem.dragN / 1000).toFixed(2)} kN` : '—'}</span>
        </div>
        <label className="col-span-2 mt-1 flex items-center gap-2 text-[10px] text-slate-400">
          <span className="shrink-0">Scrub T+{telem?.time.toFixed(1) ?? 0}s</span>
          <input
            className="w-full"
            type="range"
            min={0}
            max={Math.max(0, steps.length - 1)}
            value={cursor}
            onChange={(e) => setCursor(+e.target.value)}
            disabled={!steps.length}
          />
        </label>
      </div>

      <p className="text-[10px] leading-relaxed text-slate-500">
        Trajectory uses q = ½ρv² and D = ½ρv²CdA with piecewise Mach on Cd; ρ(h) = ρ₀e^(−h/H). Colors: blue (low q) → red (high q). Markers: Max Q, MECO / burnout.
      </p>
    </div>
  );
}
