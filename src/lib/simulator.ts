/**
 * ARTEMIS-Q Launch Stability Simulator
 * Simplified physics model for ascent stability
 */

export interface SimulationStep {
  time: number;
  altitude: number; // km
  velocity: number; // m/s
  q: number; // dynamic pressure (kPa)
  stress: number; // 0 to 1
  risk: string | null;
  g: number; // local gravity acceleration
  rho: number; // air density
  pitch: number; // degrees from vertical
  mach: number;
}

export type FuelType = 'RP-1' | 'LH2' | 'Methane';

export interface SimulationResult {
  steps: SimulationStep[];
  stabilityScore: number;
  failurePoints: string[];
  maxQTime: number;
  maxQValue: number;
  mecoTime: number;
  stressHotspots: { part: string; intensity: number; position: [number, number, number] }[];
  payloadDelivered: number; // kg
}

export class LaunchSimulator {
  private massInitial: number; // kg
  private thrustSeaLevel: number; // N
  private frontalArea: number; // m^2
  private dragCoeff: number; // Cd
  private fuelIsp: number; // s
  private burnRate: number; // kg/s
  private windSpeed: number; // m/s
  private surfacePressure: number; // kPa
  
  private readonly R_EARTH = 6371000; // meters
  private readonly G_ACCEL = 9.80665; // m/s^2

  constructor(
    mass: number, 
    thrust: number, 
    frontalArea: number, 
    dragCoeff: number = 0.5,
    fuel: FuelType = 'RP-1',
    wind: number = 0,
    pressure: number = 101.325
  ) {
    this.massInitial = mass;
    this.thrustSeaLevel = thrust;
    this.frontalArea = frontalArea;
    this.dragCoeff = dragCoeff;
    this.windSpeed = wind;
    this.surfacePressure = pressure;

    // Specific impulse (sea level approximation)
    switch(fuel) {
      case 'LH2': this.fuelIsp = 360; break; // Vacuum is higher, sea level lower
      case 'Methane': this.fuelIsp = 310; break;
      case 'RP-1': 
      default: this.fuelIsp = 285; break;
    }
    
    // Constant burn rate derived from SL thrust and Isp: F = Isp * g0 * mdot
    this.burnRate = this.thrustSeaLevel / (this.fuelIsp * this.G_ACCEL);
  }

  private getAtmosphere(altitudeMeters: number): { rho: number; p: number; temp: number } {
    const P0 = this.surfacePressure; // kPa
    const T0 = 288.15; // K
    const g = 9.80665;
    const R = 287.05; // J/(kg·K)
    const L = 0.0065; // K/m (Troposphere lapse rate)
    
    let temp, pressure, density;

    if (altitudeMeters < 11000) {
      // Troposphere
      temp = T0 - L * altitudeMeters;
      pressure = P0 * Math.pow(1 - (L * altitudeMeters) / T0, (g / (L * R)));
      density = pressure / (0.28705 * temp); // Ideal gas law: P = rho * R_specific * T
    } else if (altitudeMeters < 20000) {
      // Lower Stratosphere (Isothermal)
      const T11 = T0 - L * 11000;
      const P11 = P0 * Math.pow(1 - (L * 11000) / T0, (g / (L * R)));
      temp = T11;
      pressure = P11 * Math.exp(-g * (altitudeMeters - 11000) / (R * T11));
      density = pressure / (0.28705 * temp);
    } else {
      // Upper Atmosphere (Simplified exponential decay)
      temp = 216.65;
      pressure = 22.63 * Math.exp(-(altitudeMeters - 20000) / 6300);
      density = pressure / (0.28705 * temp);
    }

    return { rho: density, p: pressure, temp };
  }

  private getGravity(altitudeMeters: number): number {
    return this.G_ACCEL * Math.pow(this.R_EARTH / (this.R_EARTH + altitudeMeters), 2);
  }

  public simulate(): SimulationResult {
    const steps: SimulationStep[] = [];
    const dt = 1.0; 
    let altitude = 0.0;
    let velocity = 0.0;
    let currentMass = this.massInitial;
    let time = 0;
    
    let maxQValue = 0;
    let maxQTime = 0;
    const mecoTime = 150; 

    const failurePoints: string[] = [];

    while (time < 300) { 
      const { rho, p, temp } = this.getAtmosphere(altitude);
      const g = this.getGravity(altitude);
      
      // Dynamic pressure calculation with relative wind
      const relVelocity = velocity + (altitude < 20000 ? this.windSpeed : 0);
      const q = 0.5 * rho * relVelocity * relVelocity / 1000; // kPa

      if (q > maxQValue) {
        maxQValue = q;
        maxQTime = time;
      }

      // Drag Force
      const F_drag = 0.5 * rho * velocity * velocity * this.dragCoeff * this.frontalArea;
      
      // Pitch Program (Pitch Kick at 100m/s)
      let pitch = 0; // degrees from vertical
      if (velocity > 60) {
        pitch = Math.min(85, (velocity - 60) * 0.15); 
      }

      // Thrust adjustment for ambient pressure
      // F = F_vac - P_ambient * A_exit
      // Here we assume nozzle area is roughly proportional to frontal area for stability
      const nozzleArea = this.frontalArea * 0.4; 
      const vacuumThrust = this.thrustSeaLevel + (101.325 * nozzleArea);
      const thrust = time < mecoTime ? (vacuumThrust - p * nozzleArea) : 0;

      // Resolve forces
      const pitchRad = pitch * (Math.PI / 180);
      const F_net_axial = (thrust - F_drag) - (currentMass * g * Math.cos(pitchRad));
      const acceleration = F_net_axial / currentMass;

      velocity += acceleration * dt;
      if (velocity < 0) velocity = 0;
      altitude += velocity * dt * Math.cos(pitchRad); // Vertical component

      if (time < mecoTime) {
        currentMass -= this.burnRate * dt;
      }

      // Stress Analysis
      const mach = velocity / 340;
      let stress = q / 38.0; 
      if (mach > 0.9 && mach < 1.2) stress += 0.3; // Max shock load
      if (acceleration > 40) stress += (acceleration - 40) * 0.01; // G-force loading
      if (Math.abs(this.windSpeed) > 15 && altitude < 15000) stress += 0.15; // Aero-shear

      let risk: string | null = null;
      if (stress > 0.92) risk = "CRITICAL: BEYOND DESIGN LIMITS";
      else if (Math.abs(mach - 1) < 0.05) risk = "TRANSONIC SHOCK";
      else if (time === maxQTime) risk = "MAX-Q (DYNAMIC PRESSURE PEAK)";

      steps.push({
        time,
        altitude: altitude / 1000,
        velocity,
        q,
        stress: Math.min(1, stress),
        risk,
        g,
        rho,
        pitch,
        mach
      });

      if (stress > 0.99 && !failurePoints.includes("Aeroelastic divergence - Structural loss")) {
        failurePoints.push("Aeroelastic divergence - Structural loss");
      }

      time += dt;
      if (altitude < -5 && time > 5) break; 
      if (altitude > 250000) break; // Orbit achieved
    }

    const maxStress = Math.max(...steps.map(s => s.stress));
    const stressHotspots: { part: string; intensity: number; position: [number, number, number] }[] = [
      { part: "Nose Cone (Heat Shield)", intensity: maxStress * 0.95, position: [0, 2.6, 0] },
      { part: "Payload Fairing Latches", intensity: maxStress * 1.1, position: [0, 2.0, 0] },
      { part: "Interstage Grid Fins", intensity: maxStress * 0.85, position: [0, 0, 0] },
      { part: "Thrust Structure", intensity: maxStress * 0.8, position: [0, -2.2, 0] }
    ];

    const stabilityScore = Math.max(0, 100 - (maxQValue * 2.0) - (failurePoints.length * 40));

    return {
      steps,
      stabilityScore,
      failurePoints,
      maxQTime,
      maxQValue,
      mecoTime,
      stressHotspots,
      payloadDelivered: currentMass - (this.massInitial * 0.1) // Assume 10% dry mass baseline
    };
  }
}
