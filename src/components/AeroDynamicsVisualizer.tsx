import type { RefObject } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import * as THREE from 'three';
import {
  cdMachMultiplier,
  dragForceN,
  dynamicPressurePa,
  isaTemperatureK,
  RHO0_SEA_LEVEL,
  speedOfSoundMs,
} from '../lib/ascentDynamics';
import type { STLAnalysis } from '../lib/stlAnalyzer';
import { useStlVizGeometry, windTunnelBodyEuler } from '../lib/useStlVizGeometry';

function WindSheets({ mach }: { mach: number }) {
  const group = useRef<THREE.Group>(null);
  const speed = 22 + mach * 38;
  useFrame((_, dt) => {
    if (!group.current) return;
    for (const child of group.current.children) {
      child.position.x += dt * speed;
      if (child.position.x > 95) child.position.x = -115;
    }
  });

  const sheets = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        y: (i - 6.5) * 5.5,
        z: (i % 4) * 3 - 4.5,
        x: -80 + i * 11,
        len: 28 + (i % 5) * 4,
      })),
    [],
  );

  return (
    <group ref={group}>
      {sheets.map((s, i) => (
        <mesh key={i} position={[s.x, s.y, s.z]}>
          <boxGeometry args={[s.len, 0.06, 0.06]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.22} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function AeroVehicleScene({
  vizGeom,
  meshBasis,
  principalAxis,
  mach,
  cdBase,
  area,
  stlMatRef,
}: {
  vizGeom: THREE.BufferGeometry | null;
  meshBasis: { center: THREE.Vector3; scale: number };
  principalAxis: 'x' | 'y' | 'z';
  mach: number;
  cdBase: number;
  area: number;
  stlMatRef: RefObject<THREE.MeshStandardMaterial | null>;
}) {
  const align = windTunnelBodyEuler(principalAxis);
  const qn = Math.min(1, mach / 3);

  useFrame(() => {
    if (stlMatRef.current) {
      stlMatRef.current.emissive.setHSL(0.52 - qn * 0.35, 0.75, 0.12 + qn * 0.35);
      stlMatRef.current.emissiveIntensity = 0.2 + qn * 0.85;
    }
  });

  const cdEff = cdBase * cdMachMultiplier(mach);

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[40, 60, 20]} intensity={1.1} color="#fff8f0" />
      <directionalLight position={[-30, 20, -40]} intensity={0.4} color="#38bdf8" />

      <WindSheets mach={mach} />

      <group rotation={align}>
        {vizGeom ? (
          <group scale={[meshBasis.scale, meshBasis.scale, meshBasis.scale]}>
            <mesh geometry={vizGeom} position={[-meshBasis.center.x, -meshBasis.center.y, -meshBasis.center.z]}>
              <meshStandardMaterial
                ref={stlMatRef}
                vertexColors
                metalness={0.42}
                roughness={0.36}
                emissive="#0c1220"
                emissiveIntensity={0.2}
              />
            </mesh>
          </group>
        ) : (
          <group scale={1.15}>
            <mesh position={[0, 9, 0]}>
              <coneGeometry args={[2.6, 7, 18]} />
              <meshStandardMaterial color="#94a3b8" metalness={0.45} roughness={0.35} />
            </mesh>
            <mesh position={[0, -2, 0]}>
              <cylinderGeometry args={[2.6, 3.2, 14, 18]} />
              <meshStandardMaterial color="#64748b" metalness={0.5} roughness={0.4} />
            </mesh>
          </group>
        )}
      </group>

      {mach >= 0.98 ? (
        <mesh position={[-18, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <coneGeometry args={[14, 28, 20, 1, true]} />
          <meshBasicMaterial color="#60a5fa" transparent opacity={0.06} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ) : null}

      <Text position={[-45, 38, 0]} fontSize={5.5} color="#94a3b8" anchorX="left" anchorY="top">
        Flow +X · Cd,eff = {cdBase.toFixed(2)} × μ(M) = {cdEff.toFixed(3)}
      </Text>
      <Text position={[-45, 30, 0]} fontSize={5} color="#64748b" anchorX="left" anchorY="top">
        A_ref = {area.toFixed(2)} m² (STL frontal)
      </Text>
    </>
  );
}

export function AeroDynamicsVisualizer({
  stlGeometry,
  stlAnalysis,
}: {
  stlGeometry: THREE.BufferGeometry | null;
  stlAnalysis: STLAnalysis | null;
}) {
  const [mach, setMach] = useState(0.85);
  const [autoSweep, setAutoSweep] = useState(false);
  const stlMatRef = useRef<THREE.MeshStandardMaterial>(null);

  const principalAxis = stlAnalysis?.principalAxis ?? 'y';
  const cdBase = stlAnalysis?.dragCoeff ?? 0.48;
  const area = stlAnalysis?.frontalArea ?? 18;

  const vizGeom = useStlVizGeometry(stlGeometry, stlAnalysis?.stressConcentrations);

  const meshBasis = useMemo(() => {
    if (!stlGeometry) return { center: new THREE.Vector3(), scale: 1 };
    stlGeometry.computeBoundingBox();
    const box = stlGeometry.boundingBox!;
    const c = new THREE.Vector3();
    box.getCenter(c);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxD = Math.max(size.x, size.y, size.z, 1e-6);
    return { center: c, scale: 26 / maxD };
  }, [stlGeometry]);

  const T0 = isaTemperatureK(0);
  const a0 = speedOfSoundMs(T0);
  const vMs = mach * a0;
  const qPa = dynamicPressurePa(RHO0_SEA_LEVEL, vMs);
  const cdEff = cdBase * cdMachMultiplier(mach);
  const dragN = dragForceN(RHO0_SEA_LEVEL, vMs, cdEff, area);

  const cdCurve = useMemo(() => {
    const pts: Array<{ mach: number; cd: number }> = [];
    for (let m = 0; m <= 40; m += 1) {
      const mv = m * 0.1;
      pts.push({ mach: Number(mv.toFixed(2)), cd: Number((cdBase * cdMachMultiplier(mv)).toFixed(4)) });
    }
    return pts;
  }, [cdBase]);

  useEffect(() => {
    if (!autoSweep) return;
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      setMach((m) => {
        const next = m + dt * 0.28;
        return next > 3.6 ? 0.2 : next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [autoSweep]);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 font-mono text-[10px] text-slate-300">
        <p className="mb-1 text-sky-200/90">Sea-level wind-tunnel reference (ρ = {RHO0_SEA_LEVEL} kg/m³)</p>
        <p>q = ½ρV² = <span className="text-amber-200">{(qPa / 1000).toFixed(3)} kPa</span></p>
        <p>D = ½ρV² Cd,eff A = <span className="text-amber-200">{(dragN / 1000).toFixed(2)} kN</span></p>
        <p className="mt-1 text-slate-500">Cd,eff uses the same piecewise Mach multiplier as the ascent solver.</p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_220px]">
        <div className="h-[300px] min-h-[300px] overflow-hidden rounded-xl border border-slate-800 bg-[#030712]">
          <Canvas
            className="!h-full !w-full"
            camera={{ position: [-48, 28, 52], fov: 42, near: 0.2, far: 400 }}
            gl={{ antialias: true, alpha: false }}
            onCreated={({ gl }) => gl.setClearColor('#030712')}
          >
            <AeroVehicleScene
              vizGeom={vizGeom}
              meshBasis={meshBasis}
              principalAxis={principalAxis}
              mach={mach}
              cdBase={cdBase}
              area={area}
              stlMatRef={stlMatRef}
            />
            <group position={[-32, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <mesh>
                <cylinderGeometry args={[0.12, 0.12, 42, 8]} />
                <meshBasicMaterial color="#f97316" transparent opacity={0.75} />
              </mesh>
            </group>
            <OrbitControls enablePan enableZoom target={[0, 0, 0]} minDistance={28} maxDistance={140} />
          </Canvas>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
            Mach
            <input
              className="mt-1 w-full"
              type="range"
              min={15}
              max={360}
              step={1}
              value={Math.round(mach * 100)}
              onChange={(e) => {
                setAutoSweep(false);
                setMach(+e.target.value / 100);
              }}
            />
            <span className="text-sky-200">{mach.toFixed(2)}</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-400">
            <input type="checkbox" checked={autoSweep} onChange={(e) => setAutoSweep(e.target.checked)} />
            Auto-sweep Mach
          </label>
          <div className="grid grid-cols-2 gap-1 text-[10px] text-slate-400">
            <span>V</span>
            <span className="text-right text-slate-200">{vMs.toFixed(0)} m/s</span>
            <span>Cd,eff</span>
            <span className="text-right text-slate-200">{cdEff.toFixed(3)}</span>
          </div>
        </div>
      </div>

      <div className="h-[140px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={cdCurve} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="mach" stroke="#64748b" tick={{ fontSize: 9 }} label={{ value: 'Mach', fill: '#64748b', fontSize: 10 }} />
            <YAxis stroke="#64748b" tick={{ fontSize: 9 }} width={36} label={{ value: 'Cd', angle: -90, fill: '#64748b', fontSize: 10 }} />
            <Tooltip contentStyle={{ background: '#020617', border: '1px solid #334155', fontSize: 11 }} />
            <Line type="monotone" dataKey="cd" stroke="#38bdf8" dot={false} strokeWidth={2} name="Cd,eff" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="text-[10px] leading-relaxed text-slate-500">
        Same uploaded STL as ascent: frontal area and base Cd drive the curves; animated sheets approximate oncoming flow; faint cone marks a qualitative supersonic shock cue (not CFD).
      </p>
    </div>
  );
}
