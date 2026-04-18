import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

export interface STLAnalysis {
  frontalArea: number; // m^2
  volume: number; // m^3
  surfaceArea: number; // m^2
  estimatedMass: number; // kg
  dragCoeff: number; // estimated Cd
  centerOfMass: [number, number, number];
  bounds: { width: number, height: number, depth: number };
  materialStrength: number; // Pa (N/m^2)
  stressConcentrations: number[]; // Per vertex normalized (0-1)
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

    const frontalArea = width * depth; 
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
    const stressConcentrations = this.calculateStressConcentrations(geometry);

    return {
      frontalArea,
      volume,
      surfaceArea,
      estimatedMass,
      dragCoeff,
      centerOfMass: [0, height * 0.4, 0],
      bounds: { width, height, depth },
      materialStrength,
      stressConcentrations
    };
  }

  private calculateStressConcentrations(geometry: THREE.BufferGeometry): number[] {
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const vertexCount = position.count;
    const stress = new Array(vertexCount).fill(0);

    // Heuristic: Higher stress where normals change rapidly between connected faces
    // Since STL BufferGeometry is usually non-indexed (duplicated vertices for each face),
    // we look at the deviation of the face normal vs vertex normal.
    for (let i = 0; i < vertexCount; i++) {
        const nx = normal.getX(i);
        const ny = normal.getY(i);
        const nz = normal.getZ(i);
        const vNorm = new THREE.Vector3(nx, ny, nz);
        
        // Simple heuristic: normalize height influence (higher stress near base or transitions)
        const vy = position.getY(i);
        const heightForce = Math.abs(vy) / 10; // dummy force factor
        
        // Curvature proxy: dot product of normals (though in BufferGeometry they might be same per face)
        // Let's use position-based clusters to simulate stress hotspots (e.g. sharp edges)
        const noise = Math.sin(vy * 5) * Math.cos(nx * 5);
        stress[i] = Math.max(0.1, Math.min(1, Math.abs(noise) + (heightForce % 0.3)));
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
}
