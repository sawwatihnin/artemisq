import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

export interface AerodynamicHotspot {
  /** Centroid of the cluster in mesh-local coordinates (same units as STL). */
  centroid: [number, number, number];
  /** Total facing-windward area aggregated into this hotspot [m^2]. */
  area: number;
  /** Newtonian pressure coefficient Cp = 2·cos²θ at the cluster centroid (0..2). */
  cp: number;
  /** Share of total Newtonian drag this cluster contributes (0..1). */
  dragShare: number;
  /** 0 (mild) → 1 (severe); ranks visual badge colour and ordering. */
  severity: number;
  /** Plain-language explanation of why this region is non-aerodynamic. */
  reason: string;
  /** Engineering recommendation to mitigate the hotspot. */
  recommendation: string;
}

export interface STLAnalysis {
  /**
   * Windward-projected area Σ max(0, n̂·ŵ)·A_face [m²]. Equals the true
   * silhouette area for convex bodies; for non-convex meshes it is a
   * conservative upper bound (hidden back-side windward facets are not
   * occluded). Used as the reference area for `dragCoeff`.
   */
  frontalArea: number;
  /** Bounding-box projection in the flow direction [m²] — coarse over-estimate. */
  boundingBoxFrontalArea: number;
  volume: number; // m^3
  surfaceArea: number; // m^2
  estimatedMass: number; // kg (assumes structural fill factor; see provenance)
  fillFactor: number; // 0..1 fraction of bounding-box volume modelled as solid mass
  dragCoeff: number; // Newtonian-derived Cd at zero AoA, referenced to frontalArea
  dragCoeffMethod: 'newtonian-impact';
  centerOfMass: [number, number, number];
  centerOfPressure: [number, number, number];
  principalAxis: 'x' | 'y' | 'z';
  projectedAreaByAxis: { x: number; y: number; z: number };
  bounds: { width: number, height: number, depth: number };
  materialStrength: number; // Pa (N/m^2)
  stressConcentrations: number[]; // Per vertex normalized (0-1)
  panelLoads: Array<{ station: number; area: number; loadCoefficient: number; pressurePa: number; stressPa: number }>;
  /** Top non-aerodynamic features detected by Newtonian Cp · area screening. */
  aerodynamicHotspots: AerodynamicHotspot[];
}

export interface STLAnalyzeWithMesh {
  analysis: STLAnalysis;
  /** Cloned geometry for Three.js visualization (caller owns lifecycle / dispose). */
  geometry: THREE.BufferGeometry;
}

export class STLAnalyzer {
  private loader: STLLoader;

  constructor() {
    this.loader = new STLLoader();
  }

  /**
   * Parse STL once; return analysis plus a **clone** of the mesh for R3F (safe to dispose independently).
   */
  public async parseWithGeometry(file: File): Promise<STLAnalyzeWithMesh> {
    const arrayBuffer = await file.arrayBuffer();
    const geometry = this.loader.parse(arrayBuffer);
    geometry.computeBoundingBox();
    geometry.computeVertexNormals();
    const analysis = this.buildAnalysis(geometry);
    return { analysis, geometry: geometry.clone() };
  }

  public async analyze(file: File): Promise<STLAnalysis> {
    const { analysis } = await this.parseWithGeometry(file);
    return analysis;
  }

  private buildAnalysis(geometry: THREE.BufferGeometry): STLAnalysis {
    const box = geometry.boundingBox!;
    const size = new THREE.Vector3();
    box.getSize(size);

    const width = size.x;
    const height = size.y;
    const depth = size.z;

    const principalAxis = this.estimatePrincipalAxis(size);
    const boundingBoxFrontalArea = principalAxis === 'x'
      ? height * depth
      : principalAxis === 'y'
        ? width * depth
        : width * height;
    const projectedAreaByAxis = {
      x: height * depth,
      y: width * depth,
      z: width * height,
    };
    const volume = this.calculateVolume(geometry);
    const surfaceArea = this.calculateSurfaceArea(geometry);

    // Newtonian impact aerodynamics: integrates per-triangle Cp = 2·cos²θ
    // against the actual mesh, yielding a windward-projected area
    // (Σ cosθ·A — equal to the silhouette for convex bodies, conservative
    // upper bound otherwise) and a geometry-derived drag coefficient
    // (no fineness-ratio lookup).
    const newtonian = this.computeNewtonianAero(geometry, principalAxis);
    const frontalArea = newtonian.projectedArea > 1e-6
      ? newtonian.projectedArea
      : boundingBoxFrontalArea;
    const dragCoeff = newtonian.dragCoeff;

    // Mass: STL describes outer mold line; assume aerospace structural fill
    // factor of 0.15 (skin + internal structure ≈ 15% of bounding-box solid).
    // This is documented via fillFactor so callers can override or audit.
    const densityAluminum = 2700;
    const materialStrength = 310e6;
    const fillFactor = 0.15;
    const estimatedMass = volume * densityAluminum * fillFactor;

    const dynamicPressureRefPa = 45000; // Mach ~1 at sea level — used only for
    // the static panel-load preview; the live visualizer recomputes with the
    // user-selected Mach.
    const panelLoads = this.calculatePanelLoads(geometry, principalAxis, box, dynamicPressureRefPa);
    const stressConcentrations = this.calculateStressConcentrations(geometry, panelLoads, principalAxis, box);
    const centerOfPressure = this.calculateCenterOfPressure(geometry, principalAxis);

    return {
      frontalArea,
      boundingBoxFrontalArea,
      volume,
      surfaceArea,
      estimatedMass,
      fillFactor,
      dragCoeff,
      dragCoeffMethod: 'newtonian-impact',
      centerOfMass: [0, height * 0.4, 0],
      centerOfPressure,
      principalAxis,
      projectedAreaByAxis,
      bounds: { width, height, depth },
      materialStrength,
      stressConcentrations,
      panelLoads,
      aerodynamicHotspots: newtonian.hotspots,
    };
  }

  /**
   * Newtonian impact aerodynamics integrated over the actual STL surface.
   *
   * For each triangle with outward normal n̂ and area A, define
   *   cosθ = max(0, n̂·ŵ)        (windward-facing fraction)
   *   Cp   = 2·cosθ²              (Newtonian pressure coefficient)
   * The drag contribution is Cp·cosθ·A and the projected silhouette
   * contribution is cosθ·A. Then
   *   A_proj = Σ cosθ·A
   *   Cd     = (1/A_proj) · Σ Cp·cosθ·A = 2·(Σ cosθ³·A)/(Σ cosθ·A)
   *
   * Hotspots are the triangles whose individual drag contribution
   * Cp·cosθ·A is largest; they are the geometric features that most
   * degrade aerodynamic efficiency and are the targets for redesign.
   */
  private computeNewtonianAero(
    geometry: THREE.BufferGeometry,
    principalAxis: 'x' | 'y' | 'z',
  ): { projectedArea: number; dragCoeff: number; hotspots: AerodynamicHotspot[] } {
    const position = geometry.attributes.position;
    const flow = principalAxis === 'x'
      ? new THREE.Vector3(1, 0, 0)
      : principalAxis === 'y'
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(0, 0, 1);

    interface FaceContribution {
      centroid: THREE.Vector3;
      area: number;        // m²
      cosTheta: number;    // n̂·ŵ for windward faces (0..1)
      cp: number;          // 2·cosθ²
      dragMetric: number;  // Cp·cosθ·A — relative drag contribution
    }
    const faces: FaceContribution[] = [];
    let projectedArea = 0;
    let dragNumerator = 0; // Σ Cp·cosθ·A = Σ 2·cosθ³·A

    const v1 = new THREE.Vector3();
    const v2 = new THREE.Vector3();
    const v3 = new THREE.Vector3();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const cross = new THREE.Vector3();

    for (let i = 0; i < position.count; i += 3) {
      v1.fromBufferAttribute(position, i);
      v2.fromBufferAttribute(position, i + 1);
      v3.fromBufferAttribute(position, i + 2);
      e1.subVectors(v2, v1);
      e2.subVectors(v3, v1);
      cross.crossVectors(e1, e2);
      const twoArea = cross.length();
      if (twoArea < 1e-9) continue;
      const area = twoArea * 0.5;
      const normal = cross.divideScalar(twoArea);
      const cosTheta = Math.max(0, normal.dot(flow));
      if (cosTheta <= 0) continue;
      const cp = 2 * cosTheta * cosTheta;
      const dragMetric = cp * cosTheta * area;
      const centroid = new THREE.Vector3()
        .add(v1).add(v2).add(v3).multiplyScalar(1 / 3);
      projectedArea += cosTheta * area;
      dragNumerator += dragMetric;
      faces.push({ centroid, area, cosTheta, cp, dragMetric });
    }

    const dragCoeff = projectedArea > 1e-9 ? dragNumerator / projectedArea : 0.5;
    const hotspots = this.clusterHotspots(faces, dragNumerator, geometry);
    return { projectedArea, dragCoeff, hotspots };
  }

  /**
   * Greedy spatial clustering of high-drag triangles. Iteratively picks the
   * single highest-drag-metric face, absorbs all faces within a radius
   * proportional to the bounding-box diagonal, and emits a hotspot for the
   * cluster. Stops at a fixed cap or when remaining faces are well below
   * the cluster threshold.
   */
  private clusterHotspots(
    faces: Array<{ centroid: THREE.Vector3; area: number; cosTheta: number; cp: number; dragMetric: number }>,
    totalDragMetric: number,
    geometry: THREE.BufferGeometry,
  ): AerodynamicHotspot[] {
    if (!faces.length || totalDragMetric <= 0) return [];

    const box = geometry.boundingBox!;
    const diag = new THREE.Vector3().subVectors(box.max, box.min).length();
    const clusterRadius = Math.max(1e-3, diag * 0.06);

    const sorted = [...faces].sort((a, b) => b.dragMetric - a.dragMetric);
    const used = new Uint8Array(sorted.length);
    const peakDrag = sorted[0]?.dragMetric ?? 0;
    // Seed gate: a face must individually carry ≥ 18% of the worst face's
    // drag contribution (Cp·cosθ·A) to be considered the centre of a hotspot.
    const minPeak = peakDrag * 0.18;

    const hotspots: AerodynamicHotspot[] = [];
    const maxHotspots = 6;

    for (let i = 0; i < sorted.length && hotspots.length < maxHotspots; i++) {
      if (used[i]) continue;
      const seed = sorted[i];
      if (seed.dragMetric < minPeak) break;

      let totalArea = 0;
      let totalDrag = 0;
      let weightedCp = 0;
      const centroid = new THREE.Vector3();

      for (let j = i; j < sorted.length; j++) {
        if (used[j]) continue;
        const face = sorted[j];
        if (face.centroid.distanceTo(seed.centroid) <= clusterRadius) {
          used[j] = 1;
          totalArea += face.area;
          totalDrag += face.dragMetric;
          weightedCp += face.cp * face.area;
          centroid.addScaledVector(face.centroid, face.area);
        }
      }

      if (totalArea <= 0) continue;
      centroid.multiplyScalar(1 / totalArea);
      const cp = weightedCp / totalArea;
      const dragShare = totalDragMetric > 0 ? totalDrag / totalDragMetric : 0;
      const severity = Math.min(1, dragShare / 0.18 + (cp / 2) * 0.4);

      const { reason, recommendation } = this.diagnoseHotspot(cp, dragShare);
      hotspots.push({
        centroid: [centroid.x, centroid.y, centroid.z],
        area: totalArea,
        cp,
        dragShare,
        severity,
        reason,
        recommendation,
      });
    }

    return hotspots;
  }

  private diagnoseHotspot(cp: number, dragShare: number): { reason: string; recommendation: string } {
    if (cp > 1.6) {
      return {
        reason: `Near-flat face perpendicular to flow (Cp ≈ ${cp.toFixed(2)}, contributing ${(dragShare * 100).toFixed(1)}% of body drag).`,
        recommendation: 'Replace the bluff face with a tangent-ogive or conic transition; target Cp < 0.8 by reducing local angle of attack to ≤ 45°.',
      };
    }
    if (cp > 0.9) {
      return {
        reason: `Steep windward facet (Cp ≈ ${cp.toFixed(2)}, ${(dragShare * 100).toFixed(1)}% of body drag) acts as a localized brake.`,
        recommendation: 'Round, fillet, or sweep this surface; a 30–45° ramp would cut Cp by roughly half via Newtonian theory.',
      };
    }
    return {
      reason: `Broad windward area (Cp ≈ ${cp.toFixed(2)}, ${(dragShare * 100).toFixed(1)}% of body drag) — modest individual angle but large projected footprint.`,
      recommendation: 'Reduce projected width or extend a fairing aft of this region to lower local cosθ and shed pressure load.',
    };
  }

  private estimatePrincipalAxis(size: THREE.Vector3): 'x' | 'y' | 'z' {
    if (size.y >= size.x && size.y >= size.z) return 'y';
    if (size.x >= size.z) return 'x';
    return 'z';
  }

  private calculateStressConcentrations(
    geometry: THREE.BufferGeometry,
    panelLoads: Array<{ station: number; area: number; loadCoefficient: number; pressurePa: number; stressPa: number }>,
    principalAxis: 'x' | 'y' | 'z',
    box: THREE.Box3,
  ): number[] {
    const position = geometry.attributes.position;
    const vertexCount = position.count;
    const stress = new Array(vertexCount).fill(0);

    const axisIndex = principalAxis === 'x' ? 0 : principalAxis === 'y' ? 1 : 2;
    const axisMin = axisIndex === 0 ? box.min.x : axisIndex === 1 ? box.min.y : box.min.z;
    const axisMax = axisIndex === 0 ? box.max.x : axisIndex === 1 ? box.max.y : box.max.z;
    const span = Math.max(1e-6, axisMax - axisMin);
    const maxStress = Math.max(1, ...panelLoads.map((panel) => panel.stressPa));

    for (let i = 0; i < vertexCount; i++) {
      const axisCoord =
        axisIndex === 0 ? position.getX(i) :
        axisIndex === 1 ? position.getY(i) :
        position.getZ(i);
      const normalized = Math.min(0.999, Math.max(0, (axisCoord - axisMin) / span));
      const panel = panelLoads[Math.min(panelLoads.length - 1, Math.floor(normalized * panelLoads.length))];
      stress[i] = Math.max(0.02, Math.min(1, panel.stressPa / maxStress));
    }

    return stress;
  }

  private calculateVolume(geometry: THREE.BufferGeometry): number {
    let volume = 0;
    const position = geometry.attributes.position;
    const faces = position.count / 3;
    
    for (let i = 0; i < faces; i++) {
        const v1 = new THREE.Vector3().fromBufferAttribute(position, i * 3 + 0);
        const v2 = new THREE.Vector3().fromBufferAttribute(position, i * 3 + 1);
        const v3 = new THREE.Vector3().fromBufferAttribute(position, i * 3 + 2);
        volume += v1.dot(v2.cross(v3)) / 6.0;
    }
    return Math.abs(volume);
  }

  private calculateSurfaceArea(geometry: THREE.BufferGeometry): number {
    let area = 0;
    const position = geometry.attributes.position;
    const faces = position.count / 3;
    
    for (let i = 0; i < faces; i++) {
        const v1 = new THREE.Vector3().fromBufferAttribute(position, i * 3 + 0);
        const v2 = new THREE.Vector3().fromBufferAttribute(position, i * 3 + 1);
        const v3 = new THREE.Vector3().fromBufferAttribute(position, i * 3 + 2);
        
        const edge1 = new THREE.Vector3().subVectors(v2, v1);
        const edge2 = new THREE.Vector3().subVectors(v3, v1);
        area += edge1.cross(edge2).length() * 0.5;
    }
    return area;
  }

  private calculateCenterOfPressure(geometry: THREE.BufferGeometry, principalAxis: 'x' | 'y' | 'z'): [number, number, number] {
    const position = geometry.attributes.position;
    let areaWeighted = 0;
    const cp = new THREE.Vector3();
    const axisVector =
      principalAxis === 'x' ? new THREE.Vector3(1, 0, 0) :
      principalAxis === 'y' ? new THREE.Vector3(0, 1, 0) :
      new THREE.Vector3(0, 0, 1);

    for (let i = 0; i < position.count; i += 3) {
      const v1 = new THREE.Vector3().fromBufferAttribute(position, i);
      const v2 = new THREE.Vector3().fromBufferAttribute(position, i + 1);
      const v3 = new THREE.Vector3().fromBufferAttribute(position, i + 2);
      const centroid = new THREE.Vector3().add(v1).add(v2).add(v3).multiplyScalar(1 / 3);
      const normal = new THREE.Vector3().subVectors(v2, v1).cross(new THREE.Vector3().subVectors(v3, v1));
      const area = normal.length() * 0.5;
      const directionalWeight = Math.max(0.05, Math.abs(normal.normalize().dot(axisVector)));
      const weight = area * directionalWeight;
      cp.addScaledVector(centroid, weight);
      areaWeighted += weight;
    }

    if (!areaWeighted) return [0, 0, 0];
    cp.multiplyScalar(1 / areaWeighted);
    return [cp.x, cp.y, cp.z];
  }

  private calculatePanelLoads(
    geometry: THREE.BufferGeometry,
    principalAxis: 'x' | 'y' | 'z',
    box: THREE.Box3,
    dynamicPressurePa: number = 45000,
  ): Array<{ station: number; area: number; loadCoefficient: number; pressurePa: number; stressPa: number }> {
    const position = geometry.attributes.position;
    const axisIndex = principalAxis === 'x' ? 0 : principalAxis === 'y' ? 1 : 2;
    const axisMin = axisIndex === 0 ? box.min.x : axisIndex === 1 ? box.min.y : box.min.z;
    const axisMax = axisIndex === 0 ? box.max.x : axisIndex === 1 ? box.max.y : box.max.z;
    const span = Math.max(1e-6, axisMax - axisMin);
    const flowDirection =
      principalAxis === 'x' ? new THREE.Vector3(1, 0, 0) :
      principalAxis === 'y' ? new THREE.Vector3(0, 1, 0) :
      new THREE.Vector3(0, 0, 1);
    const buckets = Array.from({ length: 6 }, (_, index) => ({
      station: (index + 0.5) / 6,
      area: 0,
      loadCoefficient: 0,
      pressurePa: 0,
      stressPa: 0,
    }));

    for (let i = 0; i < position.count; i += 3) {
      const v1 = new THREE.Vector3().fromBufferAttribute(position, i);
      const v2 = new THREE.Vector3().fromBufferAttribute(position, i + 1);
      const v3 = new THREE.Vector3().fromBufferAttribute(position, i + 2);
      const centroid = new THREE.Vector3().add(v1).add(v2).add(v3).multiplyScalar(1 / 3);
      const normal = new THREE.Vector3().subVectors(v2, v1).cross(new THREE.Vector3().subVectors(v3, v1));
      const area = normal.length() * 0.5;
      const axisCoord = axisIndex === 0 ? centroid.x : axisIndex === 1 ? centroid.y : centroid.z;
      const normalized = Math.min(0.999, Math.max(0, (axisCoord - axisMin) / span));
      const bucketIndex = Math.min(5, Math.floor(normalized * 6));
      const normalizedNormal = normal.normalize();
      const loadCoefficient = Math.max(0.02, Math.abs(normalizedNormal.dot(flowDirection)));
      const pressurePa = dynamicPressurePa * loadCoefficient;
      const panelForce = pressurePa * area;
      const sectionModulus = Math.max(1e-4, area * 0.08);
      const bendingMoment = panelForce * Math.abs(axisCoord - axisMin);
      const stressPa = bendingMoment / sectionModulus;
      buckets[bucketIndex].area += area;
      buckets[bucketIndex].loadCoefficient += loadCoefficient * area;
      buckets[bucketIndex].pressurePa += pressurePa * area;
      buckets[bucketIndex].stressPa += stressPa * area;
    }

    return buckets.map((bucket) => ({
      station: bucket.station,
      area: bucket.area,
      loadCoefficient: bucket.area > 0 ? bucket.loadCoefficient / bucket.area : 0,
      pressurePa: bucket.area > 0 ? bucket.pressurePa / bucket.area : 0,
      stressPa: bucket.area > 0 ? bucket.stressPa / bucket.area : 0,
    }));
  }
}
