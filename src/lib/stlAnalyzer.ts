import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

export interface STLAnalysis {
  frontalArea: number; // m^2
  volume: number; // m^3
  surfaceArea: number; // m^2
  estimatedMass: number; // kg
  dragCoeff: number; // estimated Cd
  centerOfMass: [number, number, number];
  centerOfPressure: [number, number, number];
  principalAxis: 'x' | 'y' | 'z';
  projectedAreaByAxis: { x: number; y: number; z: number };
  bounds: { width: number, height: number, depth: number };
  materialStrength: number; // Pa (N/m^2)
  stressConcentrations: number[]; // Per vertex normalized (0-1)
  panelLoads: Array<{ station: number; area: number; loadCoefficient: number; pressurePa: number; stressPa: number }>;
}

export class STLAnalyzer {
  private loader: STLLoader;

  constructor() {
    this.loader = new STLLoader();
  }

  public async analyze(file: File): Promise<STLAnalysis> {
    const arrayBuffer = await file.arrayBuffer();
    const geometry = this.loader.parse(arrayBuffer);
    
    geometry.computeBoundingBox();
    geometry.computeVertexNormals();
    
    const box = geometry.boundingBox!;
    const size = new THREE.Vector3();
    box.getSize(size);

    const width = size.x;
    const height = size.y;
    const depth = size.z;

    const principalAxis = this.estimatePrincipalAxis(size);
    const projectedAreaByAxis = {
      x: height * depth,
      y: width * depth,
      z: width * height,
    };
    const frontalArea = projectedAreaByAxis[principalAxis];
    const volume = this.calculateVolume(geometry);
    const surfaceArea = this.calculateSurfaceArea(geometry);

    // Estimates
    const densityAluminum = 2700; // kg/m^3
    const materialStrength = 310e6; // 6061-T6 Aluminum yield strength (approx 310 MPa)
    const estimatedMass = volume * densityAluminum * 0.15;

    const finenessRatio = height / Math.max(width, depth);
    let dragCoeff = 0.5;
    if (finenessRatio > 5) dragCoeff = 0.3;
    if (finenessRatio > 10) dragCoeff = 0.25;
    if (finenessRatio < 2) dragCoeff = 0.8;

    // Calculate stress concentrations based on local curvature/normals
    const panelLoads = this.calculatePanelLoads(geometry, principalAxis, box);
    const stressConcentrations = this.calculateStressConcentrations(geometry, panelLoads, principalAxis, box);
    const centerOfPressure = this.calculateCenterOfPressure(geometry, principalAxis);

    return {
      frontalArea,
      volume,
      surfaceArea,
      estimatedMass,
      dragCoeff,
      centerOfMass: [0, height * 0.4, 0],
      centerOfPressure,
      principalAxis,
      projectedAreaByAxis,
      bounds: { width, height, depth },
      materialStrength,
      stressConcentrations,
      panelLoads,
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
  ): Array<{ station: number; area: number; loadCoefficient: number; pressurePa: number; stressPa: number }> {
    const position = geometry.attributes.position;
    const dynamicPressurePa = 45000;
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
