# ARTEMIS-Q

ARTEMIS-Q is a browser-based mission analysis and vehicle simulation app for cislunar and interplanetary concept studies. It combines lightweight orbital mechanics, a reduced-order ascent dynamics model, live weather and space-weather feeds, STL-based vehicle geometry analysis, and interactive 3D visualization.

The current codebase is aimed at fast, physically credible analysis in real time. It is not a mission-certification tool.

## What It Does

### Mission analysis
- Builds and visualizes mission routes for lunar, orbital, and rover-style scenarios.
- Supports imported orbital objects and TLE/state-vector driven mission graphs.
- Generates only reachable imported edges from orbital geometry rather than treating every edge as valid.
- Shows event-based mission stages on the trajectory instead of fixed decorative markers.

### Ascent dynamics
- Uses a reduced-order 2D ascent model suitable for real-time interaction.
- Computes:
  - exponential atmosphere, `rho(h) = rho0 * exp(-h / H)`
  - drag, `D = 0.5 * rho * v^2 * Cd * A`
  - dynamic pressure, `q = 0.5 * rho * v^2`
  - thrust / drag / gravity net acceleration
  - time-varying mass with linear propellant burn
  - Max Q, peak drag, burnout / MECO, apogee, downrange, and stability score
- Colors the ascent path by dynamic pressure and marks Max Q and MECO on the vehicle visualizer.

### STL-driven vehicle workflow
- Lets users upload an STL on the Vehicle tab.
- Derives lightweight geometry metrics from the mesh, including:
  - frontal area
  - volume and surface area
  - estimated drag coefficient
  - center of mass / center of pressure heuristics
  - principal axis and projected areas
  - coarse mesh-panel loads and stress estimates
- Feeds the derived geometry into the ascent solver so the uploaded vehicle affects drag, stability, and the optimized ascent profile.

### Data sources
- Surface weather via OpenWeatherMap.
- Space weather via NASA DONKI.
- Solar-system body positions from the app’s internal lightweight ephemeris model.
- Local gravity adjusted by body, latitude, altitude, date, and longitude using reduced-order body/rotation/tidal terms.

### Visualization
- 3D mission scene with launch body, target body, additional solar-system bodies, transfer paths, and radiation overlays.
- Vehicle-page ascent visualizer driven from the actual ascent result returned by `/api/simulate`.
- Flight-sequence panels derived from computed mission / ascent events rather than hard-coded percentages.

### Quantum optimization
- Builds a reduced mission-routing QUBO from node, edge, continuity, and feasibility penalties.
- Runs a simulated QAOA backend over a reduced binary basis for the selected route length.
- Uses explicit complex amplitudes and a deterministic statevector evolution instead of the older display-only heuristic.
- Exposes:
  - layer-wise `gamma` / `beta`
  - expected energy
  - final basis-state probability distribution
  - deterministic shot-style counts sampled from the final probability mass
  - circuit visualization for the synthesized cost and mixer layers
- Keeps the classical simulated annealer as the main route search engine and uses simulated QAOA for quantum-side diagnostics and comparison.

## Architecture

### Frontend
- React
- TypeScript
- `@react-three/fiber` / `@react-three/drei`
- Recharts
- Tailwind utilities

### Backend
- Express server in [server.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/server.ts)
- API endpoints for:
  - `/api/weather`
  - `/api/space-weather`
  - `/api/simulate`
  - `/api/optimize`
  - `/api/qaoa`

### Core libraries
- Orbital mechanics and transfer visualization:
  [src/lib/orbital.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/orbital.ts)
- Celestial bodies / ephemeris helpers:
  [src/lib/celestial.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/celestial.ts)
- Ascent solver:
  [src/lib/simulator.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/simulator.ts)
- Ascent aero / stability helpers:
  [src/lib/ascentDynamics.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/ascentDynamics.ts)
- STL analysis:
  [src/lib/stlAnalyzer.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/stlAnalyzer.ts)
- Imported mission graph generation / conjunction:
  [src/lib/missionPlanner.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/missionPlanner.ts)
- Mission optimization / simulated QAOA:
  [src/lib/optimizer.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/optimizer.ts)

## Real vs Simulated

### Formula-driven today
- Hohmann transfer and classical orbital math
- Keplerian state propagation
- Reduced-order ascent dynamics
- Max Q, drag, Mach-regime Cd adjustment
- Rocket-equation-linked fuel sizing
- Body-aware gravity and atmosphere handling
- STL-derived geometry metrics and panel-load estimates
- Simulated statevector QAOA evolution on reduced mission Hamiltonians

### Still approximate
- Planetary positions use a lightweight internal ephemeris, not JPL SPICE kernels.
- Imported TLE handling is approximate and not a full SGP4 pipeline.
- Conjunction analysis is materially better than the original shell heuristic, but it is still not full operational OD / covariance tooling.
- STL structural and aerodynamic analysis is reduced-order engineering estimation, not CFD or FEA.
- The quantum / QAOA layer is still simulated and not connected to hardware backends such as IBM Quantum, IonQ, Braket, or D-Wave.

## Quantum Model

The quantum layer is implemented as a simulated backend, not a placeholder animation.

### What is encoded
- A reduced mission-routing objective is mapped into a QUBO-style binary energy model.
- Basis states represent reduced binary occupancy / path selections over the chosen route horizon.
- Infeasible states receive a large penalty so they are suppressed in the simulated distribution.

### What the simulator does
- Starts from a uniform superposition over the reduced basis.
- Applies a diagonal cost phase:
  `exp(-i * gamma * C(z))`
- Applies mixer rotations as repeated single-qubit X-rotations:
  `exp(-i * beta * X)`
- Performs a small grid search over `gamma` and `beta` per layer.
- Computes the final expectation value from the statevector probabilities.
- Converts final probabilities into deterministic shot-like counts for UI display.

### What it does not do
- No real quantum hardware execution
- No noise model
- No pulse-level control
- No provider SDK such as Qiskit, Cirq, Braket, or PennyLane
- No claim of quantum speedup

### Where it lives
- Core implementation:
  [src/lib/optimizer.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/optimizer.ts)
- Backend API wiring:
  [server.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/server.ts)
- Quantum UI:
  [src/App.tsx](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/App.tsx)

### Reported metrics
- `Approx Ratio`: final simulated QAOA energy divided by the best feasible basis energy in the reduced model
- `Optimal Mass`: probability mass assigned to the best feasible basis state
- `Expected Saving`: simulated QAOA energy improvement relative to the naive route baseline
- `Shots`: deterministic sample counts derived from the final statevector distribution for visualization only

## Setup

### Prerequisites
- Node.js 18+
- npm

### Environment variables
Create a `.env` file in the project root with:

```bash
NASA_API_KEY=your_nasa_key
OPENWEATHER_API_KEY=your_openweather_key
PORT=3000
```

If the API keys are missing, live endpoints should report unavailable / upstream errors rather than silently returning fake weather.

## Run

Install dependencies:

```bash
npm install
```

Start the app:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Type-check / lint:

```bash
npm run lint
```

## Vehicle Workflow

1. Open the `Vehicle` tab.
2. Upload an STL.
3. Review mesh-derived area, Cd, mass estimate, and stability hints.
4. Run `Run STL-Based Ascent Optimization`.
5. Inspect:
   - ascent path
   - Max Q
   - MECO
   - telemetry
   - stability score
   - stress / load outputs

If no STL is uploaded, the app falls back to a reference vehicle so the ascent solver can still run.

## Accuracy Notes

- The app now places ascent and mission stage markers from computed event times rather than arbitrary progress fractions.
- The vehicle visualizer is driven by the ascent solution returned from the backend, including STL-derived geometry inputs.
- The tool is intended for concept exploration and interactive trade studies. It should not be used as a substitute for SPICE-based flight design, SGP4-grade space surveillance workflows, CFD, or FEA.

## Verification

Current local verification target:

```bash
npm run lint
npm run build
```

Both should pass. The current production build may still emit a large bundle-size warning from Vite.
