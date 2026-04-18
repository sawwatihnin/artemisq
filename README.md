# ARTEMIS-Q: Quantum-Classical Orbital Optimizer

ARTEMIS-Q is a high-fidelity mission planning and simulation platform designed for the next generation of lunar and interplanetary exploration. It combines classical physics simulation, real-time satellite telemetry, and a hybrid classical-quantum optimization engine to solve complex routing problems in deep space.

## Core Features

### 1. Hybrid Orbital Optimization (QAOA/QUBO)
- **Advanced Pathfinding**: Multi-objective cost balancing (Fuel vs. Radiation vs. Connectivity).
- **Quantum Mapping**: Maps mission nodes to a Quadratic Unconstrained Binary Optimization (QUBO) problem.
- **Circuit Visualization**: Generates and visualizes mock Quantum Approximate Optimization Algorithm (QAOA) circuits (Gates, Qubits, and Rotation Angles).
- **Real-time Solving**: Uses simulated annealing to approximate quantum advantage in complex routing networks.

### 2. High-Fidelity Physics Simulator
- **Atmospheric Modeling**: Uses the International Standard Atmosphere (ISA) model to calculate altitude-dependent density and pressure (Troposphere through Stratosphere).
- **Thrust Compensation**: Real-time engine performance adjustment based on ambient atmospheric pressure.
- **Aero-Dynamics**: Calculates Mach number, Max Q (Maximum Dynamic Pressure), and structural risk factors.

### 3. Live NASA Data Integration
- **Space Weather (DONKI)**: Pulls live data from NASA's Database of Notifications, Knowledge, and Information (CME/Solar Flare activity).
- **Dynamic Radiation Risk**: Real-time mission costs are adjusted based on live solar flux and Coronal Mass Ejection (CME) data.
- **Surface Weather**: Real-time integration with OpenWeatherMap API for site-specific launch conditions at KSC Pad 39B.

### 4. Advanced 3D Visualization
- **Interactive Globe**: Three.js/React-Three-Fiber visualization of planetary departure and hazard zones.
- **Interplanetary Trajectories**: Supports missions to the Moon, Mars, Venus, and Jupiter with dynamic ephemeris-based positions.
- **STL Vehicle Design**: Upload custom .stl rocket models for real-time aerodynamic analysis and stress hotspot visualization.

## Technical Stack

- **Frontend**: React, TypeScript, Three.js (React Three Fiber), Framer Motion (react-motion), Recharts.
- **Backend**: Express.js (Node.js) with real-time API proxies for NASA and OpenWeatherMap.
- **Simulation**: Custom TypeScript implementation of ISA atmospheric models and orbital transfer splines.
- **Optimization**: Simulated Annealer for graph-based QUBO solving.

## Getting Started

### Prerequisites
- Node.js 18+
- API Keys:
  - `NASA_API_KEY`: Obtain from [api.nasa.gov](https://api.nasa.gov)
  - `OPENWEATHER_API_KEY`: Obtain from [openweathermap.org](https://openweathermap.org)

### Installation
1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure environment variables in `.env` (refer to `.env.example`).
4. Start the development server:
   ```bash
   npm run dev
   ```

## Disclaimer
*Quantum features are currently simulated as proof-of-concept mappings for QAOA/QUBO architectures. Real-world trajectory planning requires rigorous verification via JPL SPICE kernels or similar mission-critical tools.*
