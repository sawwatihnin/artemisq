import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Grid, OrbitControls, Sparkles, Text } from '@react-three/drei';
import * as THREE from 'three';
import { useStlVizGeometry } from '../lib/useStlVizGeometry';

const ASCENT_BG = '#f4f5f7';
const TRAJ_LINE_OPACITY = 0.55;

/** Pitch is degrees from vertical; freestream (air motion) opposes rocket velocity in the 2D mission plane (X downrange, Y up). */
function freestreamDirectionWorld(pitchDeg: number, out: THREE.Vector3): THREE.Vector3 {
  const r = (pitchDeg * Math.PI) / 180;
  return out.set(-Math.sin(r), -Math.cos(r), 0).normalize();
}

function updateAeroVertexColors(
  geom: THREE.BufferGeometry,
  stress: number[] | undefined,
  flowWorldUnit: THREE.Vector3,
  mach: number,
  qNorm: number,
  meshWorldMat: THREE.Matrix4,
  scratchN: THREE.Vector3,
): void {
  const posAttr = geom.attributes.position as THREE.BufferAttribute | undefined;
  const norAttr = geom.attributes.normal as THREE.BufferAttribute | undefined;
  const colAttr = geom.attributes.color as THREE.BufferAttribute | undefined;
  if (!posAttr || !norAttr || !colAttr) return;

  const n3 = new THREE.Matrix3();
  n3.getNormalMatrix(meshWorldMat);
  const transonic = mach > 0.88 && mach < 1.22 ? 1 : 0;
  const count = posAttr.count;
  const stressLen = stress?.length ?? 0;
  const stressOk = stressLen === count;

  for (let i = 0; i < count; i++) {
    scratchN.fromBufferAttribute(norAttr, i).applyNormalMatrix(n3).normalize();
    const headOn = Math.max(0, -scratchN.dot(flowWorldUnit));
    const st = stressOk ? (stress![i] ?? 0.12) : 0.12;
    const risk = Math.min(1, st * 0.52 + headOn * 0.48 + transonic * 0.2 + qNorm * 0.28);
    const c = new THREE.Color().setHSL(0.56 - risk * 0.52, 0.72, 0.52 - risk * 0.08);
    colAttr.setXYZ(i, c.r, c.g, c.b);
  }
  colAttr.needsUpdate = true;
}

export interface AscentVizStep {
  time: number;
  altitude: number;
  downrangeKm: number;
  q: number;
  velocity: number;
  dragN: number;
  pitch: number;
  mach: number;
  stress: number;
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
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: TRAJ_LINE_OPACITY });
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

export function interpolateAscentStep(steps: AscentVizStep[], t: number): AscentVizStep {
  if (steps.length === 0) {
    return { time: 0, altitude: 0, downrangeKm: 0, q: 0, velocity: 0, dragN: 0, pitch: 0, mach: 0, stress: 0 };
  }
  if (steps.length === 1 || t <= 0) return steps[0];
  const max = steps.length - 1;
  const u = Math.max(0, Math.min(max, t));
  const i0 = Math.floor(u);
  const i1 = Math.min(max, i0 + 1);
  const f = u - i0;
  const a = steps[i0];
  const b = steps[i1];
  const lerp = (x: number, y: number) => x + (y - x) * f;
  return {
    time: lerp(a.time, b.time),
    altitude: lerp(a.altitude, b.altitude),
    downrangeKm: lerp(a.downrangeKm, b.downrangeKm),
    q: lerp(a.q, b.q),
    velocity: lerp(a.velocity, b.velocity),
    dragN: lerp(a.dragN, b.dragN),
    pitch: lerp(a.pitch, b.pitch),
    mach: lerp(a.mach, b.mach),
    stress: lerp(a.stress, b.stress),
  };
}

function ProceduralRocket({ matRef }: { matRef: React.RefObject<THREE.MeshStandardMaterial | null> }) {
  return (
    <group scale={1.2}>
      <mesh position={[0, 9, 0]}>
        <coneGeometry args={[2.8, 7, 20]} />
        <meshStandardMaterial ref={matRef} color="#94a3b8" metalness={0.45} roughness={0.35} emissive="#1e293b" emissiveIntensity={0.25} />
      </mesh>
      <mesh position={[0, -2, 0]}>
        <cylinderGeometry args={[2.8, 3.4, 14, 20]} />
        <meshStandardMaterial color="#64748b" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, -12, 0]}>
        <cylinderGeometry args={[3.4, 2.2, 6, 16]} />
        <meshStandardMaterial color="#475569" metalness={0.55} roughness={0.45} />
      </mesh>
    </group>
  );
}

function DragArrowLive({
  playheadRef,
  steps,
  layout,
  qMax,
}: {
  playheadRef: React.MutableRefObject<number>;
  steps: AscentVizStep[];
  layout: { sx: number; sy: number };
  qMax: number;
}) {
  const lineObj = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const m = new THREE.LineBasicMaterial({ color: '#c2410c', transparent: true, opacity: 0.9 });
    return new THREE.Line(g, m);
  }, []);

  useEffect(() => {
    return () => {
      lineObj.geometry.dispose();
      (lineObj.material as THREE.Material).dispose();
    };
  }, [lineObj]);

  useFrame(() => {
    const s = interpolateAscentStep(steps, playheadRef.current);
    const pitchRad = (s.pitch * Math.PI) / 180;
    const x = (Number.isFinite(s.downrangeKm) ? s.downrangeKm : 0) * layout.sx;
    const y = (Number.isFinite(s.altitude) ? s.altitude : 0) * layout.sy;
    const z = 4;
    const len = THREE.MathUtils.clamp((s.dragN / 45000) * 48, 2, 62);
    const dir = new THREE.Vector3(-Math.sin(pitchRad), -Math.cos(pitchRad), 0).normalize();
    const attr = lineObj.geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    arr[0] = x;
    arr[1] = y;
    arr[2] = z;
    arr[3] = x + dir.x * len;
    arr[4] = y + dir.y * len;
    arr[5] = z + dir.z * len;
    attr.needsUpdate = true;
    const m = lineObj.material as THREE.LineBasicMaterial;
    const qn = qMax > 0 ? s.q / qMax : 0;
    m.opacity = 0.35 + qn * 0.55;
  });

  return <primitive object={lineObj} />;
}

function TelemetryBroadcaster({
  playheadRef,
  playing,
  onTick,
}: {
  playheadRef: React.MutableRefObject<number>;
  playing: boolean;
  onTick: (t: number) => void;
}) {
  const acc = useRef(0);
  useFrame(() => {
    if (!playing) return;
    acc.current += 1;
    if (acc.current % 3 === 0) onTick(playheadRef.current);
  });
  return null;
}

function TrajectoryScene({
  steps,
  maxQIndex,
  mecoIndex,
  playheadRef,
  playing,
  stlGeometry,
  stressPerVertex,
  principalAxis,
  mecoTime,
  controlsRef,
  vehiclePosRef,
  qMax,
  onTelemetryHead,
}: {
  steps: AscentVizStep[];
  maxQIndex: number;
  mecoIndex: number;
  playheadRef: React.MutableRefObject<number>;
  playing: boolean;
  stlGeometry: THREE.BufferGeometry | null;
  stressPerVertex: number[] | undefined;
  principalAxis: 'x' | 'y' | 'z';
  mecoTime: number;
  controlsRef: React.RefObject<any>;
  vehiclePosRef: React.MutableRefObject<THREE.Vector3>;
  qMax: number;
  onTelemetryHead: (t: number) => void;
}) {
  const { points, colors, mq, meco, layout } = useMemo(() => {
    if (!steps.length) {
      const c = new THREE.Vector3(110, 80, 0);
      return {
        points: [] as THREE.Vector3[],
        colors: [] as THREE.Color[],
        mq: c.clone(),
        meco: c.clone(),
        layout: { sx: 1, sy: 1, maxX: 1, maxY: 1 },
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
    const qMaxLocal = Math.max(...steps.map((s) => s.q));
    const cols = steps.map((s) => qToColor(s.q, qMin, qMaxLocal));
    const iQ = Math.min(maxQIndex, pts.length - 1);
    const iM = Math.min(mecoIndex, pts.length - 1);
    return {
      points: pts,
      colors: cols,
      mq: pts[iQ],
      meco: pts[iM],
      layout: { sx, sy, maxX, maxY },
    };
  }, [steps, maxQIndex, mecoIndex]);

  const vizGeom = useStlVizGeometry(stlGeometry, stressPerVertex);

  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const stlMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const stlMeshRef = useRef<THREE.Mesh>(null);
  const vehicleGroupRef = useRef<THREE.Group>(null);
  const windSheetsRef = useRef<THREE.Group>(null);
  const plumeRef = useRef<THREE.Mesh>(null);
  const scratchFlow = useRef(new THREE.Vector3());
  const scratchN = useRef(new THREE.Vector3());
  const colorFrame = useRef(0);

  const meshBasis = useMemo(() => {
    if (!stlGeometry) return { center: new THREE.Vector3(), scale: 1 };
    stlGeometry.computeBoundingBox();
    const box = stlGeometry.boundingBox!;
    const c = new THREE.Vector3();
    box.getCenter(c);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxD = Math.max(size.x, size.y, size.z, 1e-6);
    const fit = 26 / maxD;
    const scale = THREE.MathUtils.clamp(fit, 0.04, 220);
    return { center: c, scale };
  }, [stlGeometry]);

  const axisEuler = useMemo(() => {
    if (principalAxis === 'x') return [0, 0, Math.PI / 2] as [number, number, number];
    if (principalAxis === 'z') return [Math.PI / 2, 0, 0] as [number, number, number];
    return [0, 0, 0] as [number, number, number];
  }, [principalAxis]);

  const windStreakLayout = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => ({
        x: ((i % 8) - 3.5) * 14,
        y: -130 + (i % 11) * 26,
        z: (Math.floor(i / 8) - 2) * 16,
        len: 10 + (i % 6) * 2.5,
      })),
    [],
  );

  useFrame((_, delta) => {
    if (playing && steps.length > 0) {
      playheadRef.current += delta * 0.42;
      if (steps.length > 1 && playheadRef.current >= steps.length - 1) playheadRef.current = 0;
    }

    const s = interpolateAscentStep(steps, playheadRef.current);
    const dr = Number.isFinite(s.downrangeKm) ? s.downrangeKm : 0;
    const alt = Number.isFinite(s.altitude) ? s.altitude : 0;
    const x = dr * layout.sx;
    const y = alt * layout.sy;
    const z = 4;

    if (vehicleGroupRef.current) {
      vehicleGroupRef.current.position.set(x, y, z);
      const pitchRad = (s.pitch * Math.PI) / 180;
      vehicleGroupRef.current.rotation.order = 'YZX';
      vehicleGroupRef.current.rotation.set(0, 0, -pitchRad);
      const wobble = Math.sin(performance.now() * 0.003) * 0.05 * Math.min(1, s.q / Math.max(1e-6, qMax * 0.88));
      vehicleGroupRef.current.rotation.z += wobble;
      vehiclePosRef.current.set(x, y, z);
    }

    const qn = qMax > 0 ? Math.min(1, s.q / qMax) : 0;
    if (matRef.current) {
      matRef.current.emissive.setHSL(0.07 - qn * 0.12, 0.88, 0.15 + qn * 0.5 + s.stress * 0.25);
      matRef.current.emissiveIntensity = 0.4 + qn * 1.05 + s.stress * 0.55;
    }
    if (stlMatRef.current) {
      stlMatRef.current.emissive.setHSL(0.52 - qn * 0.32, 0.65, 0.08 + qn * 0.35 + s.stress * 0.18);
      stlMatRef.current.emissiveIntensity = 0.12 + qn * 0.65 + s.stress * 0.45;
    }

    const flow = freestreamDirectionWorld(s.pitch, scratchFlow.current);
    if (windSheetsRef.current) {
      windSheetsRef.current.position.set(x, y, z);
      const up = new THREE.Vector3(0, 1, 0);
      if (up.distanceToSquared(flow) < 1e-8) {
        windSheetsRef.current.quaternion.identity();
      } else {
        windSheetsRef.current.quaternion.setFromUnitVectors(up, flow);
      }
      const streamSpeed = 38 + s.mach * 42;
      for (const child of windSheetsRef.current.children) {
        child.position.y += delta * streamSpeed;
        if (child.position.y > 95) child.position.y = -140;
      }
    }

    colorFrame.current += 1;
    const vCount = vizGeom ? ((vizGeom.attributes.position as THREE.BufferAttribute)?.count ?? 0) : 0;
    const colorStride = vCount > 65_000 ? 6 : 3;
    if (vizGeom && stlMeshRef.current && colorFrame.current % colorStride === 0) {
      stlMeshRef.current.updateMatrixWorld(true);
      updateAeroVertexColors(vizGeom, stressPerVertex, flow, s.mach, qn, stlMeshRef.current.matrixWorld, scratchN.current);
    }

    if (plumeRef.current) {
      const thrustOn = s.time < mecoTime - 0.25;
      const sc = (thrustOn ? 0.9 + Math.sin(performance.now() * 0.02) * 0.1 : 0.08) * (stlGeometry ? meshBasis.scale : 1);
      plumeRef.current.scale.setScalar(sc);
      const mat = plumeRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = thrustOn ? 0.55 : 0.08;
    }

    const ctl = controlsRef.current;
    if (ctl) {
      ctl.target.lerp(vehiclePosRef.current, 0.065);
      ctl.update();
    }
  });

  const plumeY = -12 * (stlGeometry ? meshBasis.scale : 1.15);

  const showTrajectory = points.length >= 2;

  return (
    <>
      <color attach="background" args={[ASCENT_BG]} />
      <fog attach="fog" args={['#e8e9ec', 320, 980]} />
      <ambientLight intensity={0.82} />
      <directionalLight position={[120, 180, 80]} intensity={0.95} color="#ffffff" />
      <directionalLight position={[-80, 60, 140]} intensity={0.42} color="#dbeafe" />
      <pointLight position={[200, 100, 60]} intensity={0.35} color="#fef3c7" distance={900} decay={2} />

      <Grid
        args={[240, 240]}
        cellSize={14}
        cellThickness={0.45}
        cellColor="#c5cad4"
        sectionSize={42}
        sectionThickness={0.85}
        sectionColor="#9ca3b0"
        fadeDistance={620}
        fadeStrength={1}
        position={[110, 40, -12]}
        rotation={[Math.PI / 2, 0, 0]}
      />

      {showTrajectory ? <ColoredTrajectoryLine points={points} colors={colors} /> : null}

      <mesh position={[mq.x, mq.y, 0.5]}>
        <sphereGeometry args={[2.6, 18, 18]} />
        <meshBasicMaterial color="#f59e0b" />
      </mesh>
      <Text position={[mq.x + 10, mq.y + 12, 0]} fontSize={7} color="#b45309" anchorX="left" anchorY="middle">
        Max Q
      </Text>
      <mesh position={[meco.x, meco.y, 0.5]}>
        <sphereGeometry args={[2.6, 18, 18]} />
        <meshBasicMaterial color="#38bdf8" />
      </mesh>
      <Text position={[meco.x + 10, meco.y - 12, 0]} fontSize={7} color="#0369a1" anchorX="left" anchorY="middle">
        MECO
      </Text>

      <group ref={windSheetsRef}>
        {windStreakLayout.map((w, i) => (
          <mesh key={i} position={[w.x, w.y, w.z]}>
            <boxGeometry args={[w.len, 0.09, 0.09]} />
            <meshBasicMaterial color="#7dd3fc" transparent opacity={0.35} depthWrite={false} />
          </mesh>
        ))}
      </group>

      <group ref={vehicleGroupRef}>
        <group rotation={axisEuler}>
          {vizGeom ? (
            <group scale={[meshBasis.scale, meshBasis.scale, meshBasis.scale]}>
              <mesh
                ref={stlMeshRef}
                geometry={vizGeom}
                position={[-meshBasis.center.x, -meshBasis.center.y, -meshBasis.center.z]}
              >
                <meshStandardMaterial
                  ref={stlMatRef}
                  vertexColors
                  metalness={0.28}
                  roughness={0.48}
                  side={THREE.DoubleSide}
                  emissive="#e2e8f0"
                  emissiveIntensity={0.08}
                />
              </mesh>
            </group>
          ) : (
            <ProceduralRocket matRef={matRef} />
          )}
        </group>
        <mesh ref={plumeRef} position={[0, plumeY, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[3.2, 14, 12, 1, true]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.5} depthWrite={false} />
        </mesh>
        <Sparkles
          count={steps.length > 20 ? 48 : 24}
          scale={[14, 20, 12]}
          size={2.4}
          speed={0.5}
          opacity={0.55}
          color="#fbbf24"
          position={[0, 8, 4]}
        />
      </group>

      <DragArrowLive playheadRef={playheadRef} steps={steps} layout={layout} qMax={qMax} />
      <TelemetryBroadcaster playheadRef={playheadRef} playing={playing} onTick={onTelemetryHead} />
    </>
  );
}

export function AscentDynamicsVisualizer({
  steps,
  mecoTime,
  missionStages,
  transferTimeDays,
  stlGeometry,
  stressConcentrations,
  principalAxis = 'y',
}: {
  steps: AscentVizStep[];
  mecoTime: number;
  missionStages: MissionStage[];
  transferTimeDays?: number;
  stlGeometry: THREE.BufferGeometry | null;
  stressConcentrations?: number[];
  principalAxis?: 'x' | 'y' | 'z';
}) {
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [liveHead, setLiveHead] = useState(0);
  const playheadRef = useRef(0);
  const controlsRef = useRef<any>(null);
  const vehiclePosRef = useRef(new THREE.Vector3(110, 80, 4));

  const qMax = useMemo(() => (steps.length ? Math.max(...steps.map((s) => s.q)) : 1), [steps]);

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
    const last = steps.length ? steps.length - 1 : 0;
    setCursor(last);
    playheadRef.current = last;
    setLiveHead(last);
  }, [steps]);

  useEffect(() => {
    if (!playing) {
      playheadRef.current = cursor;
      setLiveHead(cursor);
    }
  }, [cursor, playing]);

  const telem = interpolateAscentStep(steps, playing ? liveHead : cursor);

  const ascentSpanOnTimeline = useMemo(() => {
    return (
      missionStages.find((s) => s.label === 'Stage Sep')?.progress ??
      missionStages.find((s) => s.label === 'MECO')?.progress ??
      0.12
    );
  }, [missionStages]);

  const missionDurationS = useMemo(() => {
    const d = transferTimeDays && transferTimeDays > 0 ? transferTimeDays : 5;
    return d * 86400;
  }, [transferTimeDays]);

  const maxQMapX = mecoTime > 0 ? (maxQTime / mecoTime) * ascentSpanOnTimeline : 0;
  const mecoMapX = ascentSpanOnTimeline;

  const scrubValue = playing ? Math.round(liveHead) : cursor;

  return (
    <div className="flex w-full min-w-0 flex-col gap-2">
      <div className="relative h-[560px] w-full min-h-[560px] overflow-hidden rounded-xl border border-slate-300 bg-[#f4f5f7]">
        <Canvas
          className="!h-full !w-full"
          gl={{ antialias: true, alpha: false }}
          camera={{ fov: 40, near: 0.35, far: 9000, position: [45, 118, 210] }}
          onCreated={({ gl }) => {
            gl.setClearColor(ASCENT_BG);
          }}
        >
          {steps.length >= 1 ? (
            <TrajectoryScene
              steps={steps}
              maxQIndex={maxQIndex}
              mecoIndex={mecoIndex}
              playheadRef={playheadRef}
              playing={playing}
              stlGeometry={stlGeometry}
              stressPerVertex={stressConcentrations}
              principalAxis={principalAxis}
              mecoTime={mecoTime}
              controlsRef={controlsRef}
              vehiclePosRef={vehiclePosRef}
              qMax={qMax}
              onTelemetryHead={(t) => {
                if (playing) setLiveHead(t);
              }}
            />
          ) : null}
          <OrbitControls
            ref={controlsRef}
            enableRotate
            minPolarAngle={0.35}
            maxPolarAngle={Math.PI / 2 + 0.35}
            minDistance={95}
            maxDistance={520}
            target={[110, 80, 0]}
            makeDefault
          />
          <Text position={[-42, 218, 0]} fontSize={7.5} color="#475569" anchorX="left" anchorY="top">
            Altitude (km)
          </Text>
          <Text position={[238, -14, 0]} fontSize={7.5} color="#475569" anchorX="left" anchorY="middle">
            Downrange (km)
          </Text>
        </Canvas>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between gap-2 bg-gradient-to-t from-white/90 to-transparent px-3 pb-3 pt-10">
          <div className="pointer-events-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded border border-slate-400 bg-white/95 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-sky-800 shadow-sm"
              onClick={() => setPlaying((p) => !p)}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <span className="text-[10px] text-slate-600">
              {stlGeometry
                ? 'Freestream follows flight pitch (deg from vertical). Hot colors ≈ stagnation + mesh load + transonic/q — not CFD.'
                : 'Placeholder stack · upload STL for your mesh'}
            </span>
          </div>
        </div>
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
          <div className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-amber-300" style={{ left: `${maxQMapX * 100}%` }} title="Max Q" />
          <div className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-sky-400" style={{ left: `${mecoMapX * 100}%` }} title="MECO" />
        </div>
        <p className="mt-1 text-[10px] text-slate-500">
          Markers map ascent events into the launch segment (MECO at T+{mecoTime.toFixed(0)} s). Cruise reference ~
          {(missionDurationS / 86400).toFixed(1)} d{transferTimeDays ? ' (from optimizer)' : ''}.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 font-mono text-[11px] text-slate-200">
        <div>
          <span className="text-slate-500">velocity</span> <span className="text-sky-200">{telem ? `${telem.velocity.toFixed(1)} m/s` : '—'}</span>
        </div>
        <div>
          <span className="text-slate-500">Mach</span> <span className="text-sky-200">{telem ? telem.mach.toFixed(2) : '—'}</span>
        </div>
        <div>
          <span className="text-slate-500">altitude</span> <span className="text-sky-200">{telem ? `${telem.altitude.toFixed(2)} km` : '—'}</span>
        </div>
        <div>
          <span className="text-slate-500">pitch</span> <span className="text-sky-200">{telem ? `${telem.pitch.toFixed(1)}°` : '—'}</span>
        </div>
        <div>
          <span className="text-slate-500">q</span> <span className="text-sky-200">{telem ? `${telem.q.toFixed(3)} kPa` : '—'}</span>
        </div>
        <div>
          <span className="text-slate-500">drag |D|</span> <span className="text-sky-200">{telem ? `${(telem.dragN / 1000).toFixed(2)} kN` : '—'}</span>
        </div>
        <div>
          <span className="text-slate-500">load proxy</span> <span className="text-sky-200">{telem ? telem.stress.toFixed(2) : '—'}</span>
        </div>
        <label className="col-span-2 mt-1 flex items-center gap-2 text-[10px] text-slate-400">
          <span className="shrink-0">Scrub T+{telem?.time.toFixed(1) ?? 0}s</span>
          <input
            className="w-full"
            type="range"
            min={0}
            max={Math.max(0, steps.length - 1)}
            value={scrubValue}
            onChange={(e) => {
              setPlaying(false);
              const v = +e.target.value;
              setCursor(v);
              playheadRef.current = v;
              setLiveHead(v);
            }}
            disabled={!steps.length}
          />
        </label>
      </div>

      <p className="text-[10px] leading-relaxed text-slate-500">
        Simulated airflow aligns with the solver’s relative-wind direction from pitch (vertical at liftoff, tilting with gravity turn). The STL is tinted by a reduced-order risk field: panel-stress heuristic, local windward exposure, transonic band, and dynamic pressure — illustrative only.
      </p>
    </div>
  );
}
