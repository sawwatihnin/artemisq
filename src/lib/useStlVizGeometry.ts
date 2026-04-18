import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

/** Clone STL and paint vertices from panel-stress heuristic (shared by ascent + aero views). */
export function useStlVizGeometry(
  stlGeometry: THREE.BufferGeometry | null,
  stressPerVertex: number[] | undefined,
): THREE.BufferGeometry | null {
  const vizGeom = useMemo(() => {
    if (!stlGeometry) return null;
    const g = stlGeometry.clone();
    const pos = g.attributes.position;
    const n = pos.count;
    const colors = new Float32Array(n * 3);
    const baseCool = new THREE.Color('#5b7fd1');
    const baseHot = new THREE.Color('#c2410c');
    for (let i = 0; i < n; i++) {
      const sv = stressPerVertex?.[i] ?? 0.12;
      const c = baseCool.clone().lerp(baseHot, Math.min(1, sv * 0.95));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  }, [stlGeometry, stressPerVertex]);

  useEffect(() => {
    return () => {
      vizGeom?.dispose();
    };
  }, [vizGeom]);

  return vizGeom;
}

export function windTunnelBodyEuler(principalAxis: 'x' | 'y' | 'z'): [number, number, number] {
  if (principalAxis === 'y') return [0, 0, Math.PI / 2];
  if (principalAxis === 'x') return [0, 0, Math.PI];
  return [0, Math.PI / 2, 0];
}
