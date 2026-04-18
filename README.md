# ARTEMIS-Q

ARTEMIS-Q is a probabilistic, crew-aware mission optimization and decision-support platform for cislunar, orbital, and interplanetary mission analysis. It combines trajectory design, sequential decision logic, uncertainty propagation, live environmental context, vehicle engineering analysis, and mission-operations tooling in a single interactive application.

The system is designed for physically grounded concept exploration and advanced trade studies. It is not a flight-certified or mission-assurance-grade operations stack.

## Scope

ARTEMIS-Q now spans four operational lanes:

- `Mission planning and trajectory analysis`
- `Launch/ascent and vehicle trade studies`
- `Near-Earth conjunction and orbital operations`
- `Crewed cislunar mission operations`

It includes:

- mission design and trajectory analysis
- Bayesian risk updating
- anomaly detection and response
- robust and sequential decision support
- flight dynamics and orbital-ops workflows
- multi-stage vehicle engineering
- launch/range/ground-system assessment
- crewed operations and EVA support
- CCSDS-style data workflow and provenance tracking

## Implemented Features

### Mission Design

- `Launch-window solver with real constraints`
  Uses weather, radiation, DSN coverage, transfer time, and delta-v penalties.
  Core math: [src/lib/trajectoryDesign.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/trajectoryDesign.ts)
  Backend: [server.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/server.ts)
  UI: [src/App.tsx](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/App.tsx)

- `Lambert / patched-conic transfer solving`
  Uses a universal-variable Lambert solver and patched-conic capture/departure estimates.

- `Plane-change and phasing optimization`
  Computes phase residual, synodic timing, and best delay.

- `Gravity-assist sequencing`
  Ranks candidate assist sequences using body ordering and delta-v gain heuristics informed by body properties.

- `Abort and contingency trajectory branches`
  Produces free-return, direct-return, and safe-haven style branches with time-to-recovery and risk modifiers.

- `Propellant margin and reserve policy modeling`
  Converts nominal and contingency delta-v into reserve policy and rationale.

### Probabilistic Risk and Decision Support

- `Bayesian risk updating`
  Prior/posterior risk updates from telemetry-like evidence.
  Module: [src/lib/bayes.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/bayes.ts)

- `Fault detection and isolation`
  Detects comm loss, propulsion deviation, and radiation spikes.
  Module: [src/lib/fdi.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/fdi.ts)

- `Multi-stage decision tree`
  Builds and evaluates sequential policies across future mission epochs.
  Module: [src/lib/decisionTree.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/decisionTree.ts)

- `Robust optimization`
  Compares expected-optimal and worst-case route behavior.
  Module: [src/lib/robust.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/robust.ts)

- `Constraint relaxation engine`
  Evaluates operationally useful constraint softening and its cost/risk impact.
  Module: [src/lib/relaxation.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/relaxation.ts)

- `Sensitivity analysis`
  Finite-difference style perturbation analysis over mission parameters.
  Module: [src/lib/sensitivity.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/sensitivity.ts)

- `Mission robustness score`
  Converts scenario/output variance into a robustness metric.
  Module: [src/lib/robustness.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/robustness.ts)

- `AI recommendation layer`
  Heuristic recommendation engine for shielding, weights, and policy profile.
  Module: [src/lib/recommender.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/recommender.ts)

- `Cross-system coupling model`
  Makes mass, delta-v, delay, dose, and cost coupling explicit.
  Module: [src/lib/coupling.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/coupling.ts)

### Flight Dynamics and Orbital Operations

- `SPICE / Horizons ephemeris ingestion`
  JPL Horizons is integrated through the backend, not directly from the browser.
  Modules/routes:
  - [src/lib/horizons.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/horizons.ts)
  - [server.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/server.ts)

- `Solar-system catalog and metadata`
  Solar System OpenData ingestion plus local fallback body catalog.
  Module: [src/lib/solarSystem.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/solarSystem.ts)

- `SGP4 for Earth-orbiting objects`
  Uses `satellite.js` propagation for TLE-driven orbital state propagation.
  Module: [src/lib/sgp4Ops.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/sgp4Ops.ts)

- `State covariance propagation`
  Includes modeled linearized covariance growth and 95% miss-distance estimation.
  Module: [src/lib/covariance.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/covariance.ts)

- `Real conjunction screening and TCA workflow`
  Performs propagated closest-approach screening with covariance-informed collision probability proxies.

- `Maneuver design and targeting`
  Computes impulsive targeting delta-v vector, burn duration, closing velocity, and arrival error estimate.
  Module: [src/lib/maneuverTargeting.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/maneuverTargeting.ts)

- `Navigation residual / orbit-determination support views`
  Compares predicted vs observed state vectors for residual analysis.

- `Gravity influence assessment`
  Detects whether a planned path meaningfully enters another body’s gravitational influence regime and feeds that into optimizer and replanner.
  Modules:
  - [src/lib/gravityInfluence.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/gravityInfluence.ts)
  - [src/lib/gravityRisk.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/gravityRisk.ts)

### Vehicle Engineering

- `True multi-stage rocket model`
  Stage-by-stage rocket-equation analysis with stack mass propagation.

- `Stage-by-stage separation logic`
  Carries ignition, burnout, and separation masses for each stage.

- `Engine-out / thrust-dispersion cases`
  Computes degraded performance under engine-out assumptions.

- `Thermal loads and TPS estimates`
  Uses a Sutton-Graves-style estimate for peak heat flux.

- `Better structural estimation from geometry`
  Uses STL-derived surface-area/volume ratios and mesh characteristics to influence structural index.

- `Tank mass fraction, CG shift, and controllability through burn`
  Computes CG shift and controllability index stage by stage.

- `STL-based aerodynamic and geometry workflow`
  Parses user STL geometry, derives:
  - frontal area
  - drag coefficient estimate
  - volume
  - surface area
  - estimated mass
  - principal axis
  - center of pressure
  - panel-load / stress-like mesh metrics

  Modules:
  - [src/lib/stlAnalyzer.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/stlAnalyzer.ts)
  - [src/components/AeroDynamicsVisualizer.tsx](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/components/AeroDynamicsVisualizer.tsx)

### Ascent and Launch Vehicle Studies

- `Reduced-order ascent dynamics`
  Includes atmosphere, drag, dynamic pressure, thrust-to-mass evolution, burnout, apogee, downrange, and stability scoring.

- `Launch/ascent flight-path optimization`
  Sweeps ascent profiles and returns the best candidate under max-Q and stability constraints.

- `Upper-atmosphere and launch commit constraints`
  Combines surface weather with modeled density-at-max-Q analysis.
  Module: [src/lib/launchConstraints.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/launchConstraints.ts)

### Operations

- `Timeline editor with constraints and dependencies`
  Editable task list with dependency solving, resource locking, critical-path marking, and latest-finish violation checks.
  Module: [src/lib/missionTimeline.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/missionTimeline.ts)

- `Consumables tracking: power, thermal, comm, prop, crew`
  Tracks depletion over time.
  Module: [src/lib/consumables.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/consumables.ts)

- `Fault detection / anomaly flags`
  FDI outputs are used to seed decision and console states.

- `Go/no-go rules engine`
  Implemented in crewed cislunar operations logic and launch constraints.

- `Console for live mission status and alarms`
  Builds alarms from anomalies, rules, consumables, and telemetry context.
  Module: [src/lib/opsConsole.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/opsConsole.ts)

- `Report generation for flight reviews`
  Mission report and flight-review synthesis are both present.
  Modules:
  - [src/lib/report.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/report.ts)
  - [src/lib/flightReview.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/flightReview.ts)

### Environment and Radiation

- `Radiation dose along trajectory, not just shells`
  Includes trajectory dose accumulation, not just visual Van Allen overlays.
  Module: [src/lib/cislunarOps.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/cislunarOps.ts)

- `Earth Van Allen belt zone overlay`
  Uses live NOAA/DONKI context with modeled zone structure.

- `Trajectory intersection scoring against those zones`
  Computes in-zone distance, crossings, weighted exposure, and normalized risk.
  Module: [src/lib/radiationIntersection.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/radiationIntersection.ts)

- `Eclipse / lighting / beta-angle analysis`
  Included in crewed cislunar ops.

- `Comms visibility to DSN / relay assets`
  Modeled DSN visibility using station geometry and Horizons target states.
  Module: [src/lib/groundStations.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/groundStations.ts)

- `Weather and upper-atmosphere launch constraints`
  Uses NOAA/Open-Meteo plus modeled atmosphere penalties.

- `Surface environment support for Moon/Mars ops`
  Computes local solar hour, solar elevation, gravity, temperature estimate, and dust/regolith risk.
  Module: [src/lib/surfaceOps.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/surfaceOps.ts)

### Crewed Mission Support

- `Crew dose accumulation`
- `Safe-haven logic`
- `EVA planning constraints`
- `Life-support margins`
- `Entry, landing, recovery constraints`

These are primarily implemented in:

- [src/lib/cislunarOps.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/cislunarOps.ts)
- [src/lib/eva.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/eva.ts)
- [src/lib/reentry.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/reentry.ts)

### Ground Systems

- `Launch site database`
- `Pad / range availability`
- `Keep-out zones`
- `Recovery corridor planning`
- `Airspace / maritime exclusion integration`

Implemented in:

- [src/lib/groundSystems.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/groundSystems.ts)

### Data Workflow

- `Import/export CCSDS/OEM/OPM-like formats`
- `Mission config versioning`
- `Compare runs and baselines`
- `Provenance and traceability on every output`

Implemented in:

- [src/lib/ccsds.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/ccsds.ts)
- [src/App.tsx](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/App.tsx)

### Quantum / Routing Layer

- classical simulated annealing route search
- QUBO construction
- simulated QAOA diagnostics
- circuit visualization
- state distribution view

Core implementation:

- [src/lib/optimizer.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/optimizer.ts)

## Live Data Integrations

### JPL Horizons

Used for:

- observer/vector ephemerides
- major-body state vectors
- system ephemerides
- backend trajectory generation
- launch-window geometry support

### NOAA

Used for:

- surface weather
- GOES proton/electron context
- SWPC space-weather summary

### NASA DONKI

Used for:

- flare/CME/SEP event context
- live event-driven radiation context

### Solar System OpenData

Used for:

- body metadata
- catalog browsing
- optional sky-position support

### CelesTrak

Used for:

- Earth-orbit object data
- external traffic screening support

### EONET

Used for:

- Earth-event overlays relevant to range/recovery context

### WebGeoCalc / SPICE Proxy

Used for:

- SPICE-style geometry workflow proxying where available

## Frontend Surfaces

The app is organized into:

- `mission`
- `physics`
- `vehicle`
- `quantum`

Key mission panels include:

- Mission Controls
- Flight Sequence
- Route Output
- Body & Environment
- Gravity Influence
- Crewed Cislunar Ops
- Trajectory Design
- Timeline Editor
- Ground Range & Recovery
- Consumables, Surface & Console
- Crew EVA & Flight Review
- CCSDS & Baselines
- Provenance Audit

Physics panels include:

- Keplerian Controls
- Orbital Physics
- Conjunction Panel
- SGP4 Orbital Ops
- Navigation Residuals & Launch Commit
- Covariance & Targeting
- Fuel Calculator

Vehicle panels include:

- STL Aerodynamics Visualizer
- Vehicle Inputs
- STL-Derived Geometry
- Multi-Stage Vehicle
- Best Flight Path
- Ascent Trace
- Stability & AI Summary

## Backend Routes

### Core

- `POST /api/optimize`
- `POST /api/qaoa`
- `POST /api/simulate`

### Ephemerides / astronomy

- `GET /api/horizons`
- `GET /api/horizons/trajectory`
- `GET /api/ephemeris`
- `GET /api/ephemeris/system`
- `GET /api/bodies`
- `GET /api/body/:id`
- `GET /api/sky-positions`

### Environment / radiation

- `GET /api/weather`
- `GET /api/noaa/weather`
- `GET /api/openmeteo/weather`
- `GET /api/space-weather`
- `GET /api/noaa/space-weather`
- `GET /api/donki/space-weather`
- `GET /api/radiation/near-earth`
- `GET /api/radiation/live`
- `GET /api/radiation/live/latest`
- `GET /api/radiation/live/history`
- `POST /api/radiation/intersections`

### Trajectory / orbital ops

- `POST /api/trajectory/design`
- `POST /api/sgp4/propagate`
- `POST /api/sgp4/conjunctions`
- `POST /api/sgp4/residuals`
- `POST /api/sgp4/covariance`
- `POST /api/maneuver/target`

### Vehicle / launch

- `POST /api/vehicle/multistage`
- `POST /api/launch/constraints`

### Ground / operations

- `GET /api/ground/launch-sites`
- `POST /api/ground/constraints`
- `POST /api/timeline/solve`
- `POST /api/consumables/analyze`
- `POST /api/surface/environment`
- `POST /api/ops/console`
- `POST /api/eva/plan`
- `POST /api/reports/flight-review`
- `GET /api/dsn/visibility`

### Data workflow

- `POST /api/ccsds/oem`
- `POST /api/ccsds/opm`
- `POST /api/ccsds/import`
- `POST /api/baselines/compare`

## Architecture

### Frontend

- React
- TypeScript
- `@react-three/fiber`
- `@react-three/drei`
- Recharts
- Tailwind utilities

### Backend

- Express
- TypeScript
- Vite-integrated dev server flow through [server.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/server.ts)

### Key Libraries

- orbital mechanics:
  [src/lib/orbital.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/orbital.ts)
- optimizer / QUBO / QAOA / mission logic:
  [src/lib/optimizer.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/optimizer.ts)
- ascent solver:
  [src/lib/simulator.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/simulator.ts)
- STL analysis:
  [src/lib/stlAnalyzer.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/stlAnalyzer.ts)
- imported graph / conjunction helpers:
  [src/lib/missionPlanner.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/missionPlanner.ts)

## Mathematical / Physical Basis

ARTEMIS-Q uses explicit mathematical models throughout the stack, including:

- rocket equation / propellant mass relationships
- universal-variable Lambert solving
- patched-conic departure/capture estimates
- SGP4 propagation
- residual / covariance growth calculations
- dynamic pressure and drag
- exponential atmosphere
- radiation dose accumulation
- eclipse and shadow geometry
- range/exclusion and corridor geometry
- multi-stage mass propagation and TPS heat-flux estimation

Not every subsystem is high-fidelity flight software. The code uses a mix of:

- live upstream data where available
- reduced-order but explicit physics
- mission-analysis heuristics where a public operational feed does not exist

## Realism Boundary

What is real and implemented:

- actual backend routes
- actual mathematical models
- actual live data integrations
- actual UI wiring to those routes
- actual type-checked and buildable code

What remains modeled rather than flight-certified:

- DSN visibility is modeled from station geometry and Horizons states, not official DSN scheduling
- covariance propagation is reduced-order, not a full OD covariance engine
- maneuver targeting is impulsive/reduced-order, not a full finite-burn targeting suite
- structural/aero estimates from STL are engineering approximations, not CFD or FEA
- surface environment and range scheduling are physically informed but not mission-authority systems
- quantum routing remains simulated, not hardware execution

## Environment Variables

Create a `.env` file in the project root as needed.

Useful variables:

```bash
PORT=3000
NASA_API_KEY=your_donki_key
SOLAR_SYSTEM_OPENDATA_TOKEN=your_token_if_required
NOAA_USER_AGENT=ARTEMIS-Q/1.0 (local mission console)
```

Notes:

- JPL Horizons does not require an API key for the public query flow used here.
- NOAA NWS / SWPC routes do not require an API key in the current integration.
- DONKI uses `NASA_API_KEY` when configured.
- Solar System OpenData may require a bearer token depending on current service policy.

## Setup

Install dependencies:

```bash
npm install
```

Run the app:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Type-check:

```bash
npm run lint
```

## Verification

Current local verification target:

```bash
npm run lint
npm run build
```

These should pass.

The production build may still emit a Vite large-bundle warning.

## Recommended Next Work

If the goal is to keep increasing realism instead of broadening scope, the next upgrades should be:

1. higher-fidelity official contact/scheduling data for DSN or relay assets
2. deeper orbit-determination / covariance modeling
3. finite-burn maneuver targeting
4. richer launch-range scheduling and geospatial exclusion layers
5. formal runtime resilience for live upstream feeds

## Summary

ARTEMIS-Q is no longer just a mission-route visualizer. It is now a broad mission-intelligence workbench covering:

- mission planning and transfer design
- orbital operations and conjunction support
- crew-aware cislunar operations
- vehicle and ascent trade studies
- ground/range and recovery planning
- live environmental context
- traceable import/export and baseline comparison

with explicit mathematical/physics logic and live-data integration where practical.
