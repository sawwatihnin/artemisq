# ARTEMIS-Q

ARTEMIS-Q is a quantum-focused, physics-informed mission design and decision-support application for cislunar, orbital, and interplanetary studies. It combines mission routing, trajectory design, environmental context, crew-risk assessment, vehicle engineering, orbital operations, simulated QAOA, and PennyLane quantum machine learning in a single interactive app.

The system is intended for advanced trade studies and mission-intelligence workflows. It is not flight-certified mission software.

## 🚀 About The Project

### Inspiration

ARTEMIS-Q was inspired by the decision complexity of crewed spaceflight, especially missions in the Artemis class where the question is not only how to reach the Moon, but whether the mission should proceed under uncertain environmental, operational, and human-health conditions. For a quantum-computing hackathon, what made this especially compelling was that mission planning naturally behaves like a combinatorial decision problem with competing objectives, constrained transitions, uncertainty, and high-stakes tradeoffs.

In crewed missions, the optimization target changes fundamentally. A path that looks efficient from a propulsion standpoint may still be unacceptable if it crosses elevated radiation regions at the wrong time, loses communications during a critical phase, leaves too little contingency margin, or exposes the crew to an unjustifiable cumulative or acute dose burden.

That tension motivated the project:

> How do you move from “find the best trajectory” to “decide whether this mission is safe, robust, explainable, and worth flying at all?”

ARTEMIS-Q was built as an answer to that question. It is not only a route planner. It is a radiation-aware mission intelligence platform for adaptive spaceflight decision-making, with quantum-inspired optimization and quantum machine learning used as part of the mission-analysis stack.

### What We Built

We built a full-stack mission analysis and decision-support system that combines:

- trajectory design and route optimization
- crew-risk and radiation-readiness assessment
- live weather, space-weather, and ephemeris context
- launch, ground, and recovery constraint analysis
- orbital operations and conjunction workflows
- vehicle engineering and ascent trade studies
- decision support for continue / replan / abort logic
- QUBO-style mission encoding
- simulated QAOA diagnostics and route-analysis layers
- PennyLane variational QML for mission-decision scoring
- quantum-simulation-backed analytical layers

At its core, ARTEMIS-Q evaluates a mission as a coupled system rather than as an isolated transfer problem. It treats physics, dose, communication, uncertainty, timing, reserves, anomalies, and cost as interacting variables that must be assessed together, and it uses quantum-style representations where they are natural fits for structured decision landscapes.

### Why Quantum Fits This Problem

Mission planning under uncertainty has several properties that map well onto quantum-inspired and hybrid quantum workflows:

- the route problem can be represented as a binary decision structure over nodes and mission epochs
- competing mission objectives can be written as a weighted energy or cost function
- there are many locally attractive but operationally weak solutions
- decision support benefits from compact surrogate models over nonlinear coupled features

That makes ARTEMIS-Q a good fit for two quantum-oriented layers:

- `QUBO / simulated QAOA`
  for reduced mission-path and route-energy analysis
- `PennyLane QML`
  for hybrid variational decision scoring over mission risk features

The app is honest about its current runtime model: these are simulation-backed quantum methods, not hardware execution. But they are real computational layers in the decision pipeline, not cosmetic visualizations.

### Mission-Decision Intelligence Framing

The system is designed around the idea that mission planning for human spaceflight is not a single-objective optimization problem.

Instead of optimizing only for delta-v or transfer time, ARTEMIS-Q asks:

- Is the route operationally feasible?
- Is the crew exposure acceptable?
- Are communication and contingency margins strong enough?
- What happens if conditions worsen?
- What is the financially and operationally justified response?

That is why the platform includes route optimization, stochastic analysis, decision logic, benchmarking, crew-health modeling, and explainability together in the same workflow.

### Mathematical Modeling

The mission-planning layer can be interpreted as a discrete decision problem over mission nodes and transitions, which is why it is amenable to QUBO-style treatment.

Let:

- `x_(i,t) ∈ {0,1}` indicate that the spacecraft occupies node `i` at mission epoch `t`

Then a simplified mission objective is:

```text
J =
  λ_f Fuel(x)
+ λ_r Radiation(x)
+ λ_c CommPenalty(x)
+ λ_s Safety(x)
+ λ_t Time(x)
+ λ_u Uncertainty(x)
```

subject to:

- valid start/end node constraints
- path continuity constraints
- feasible edge-transition constraints
- time/resource feasibility
- mission-rule or safety-rule constraints

In the actual app, these terms are driven by the route graph, transfer design, live environment context, reserve logic, and mission-risk terms produced by the backend analysis modules.

In the quantum-inspired view, the same problem can be seen as minimizing an energy-like objective over binary mission decisions:

```text
min_x  x^T Q x
```

where `Q` encodes path continuity, mission penalties, and weighted route costs. ARTEMIS-Q does not currently send that Hamiltonian to real quantum hardware, but it does use a simulated QAOA-style layer to inspect the structure of that reduced optimization landscape.

### Crew Health And Radiation Modeling

ARTEMIS-Q explicitly models crew exposure as part of mission viability.

A simplified cumulative dose expression is:

```text
D_total = Σ_t R(i,t) Δt S
```

where:

- `R(i,t)` is the environment-dependent dose-rate proxy or modeled dose rate
- `Δt` is time spent in that regime
- `S` is the shielding / attenuation term

Peak acute exposure is treated separately:

```text
D_peak = max_t R(i,t)
```

The crew-risk side then combines cumulative dose, peak exposure, and unsafe-duration logic:

```text
Risk = α D_total + β D_peak + γ T_unsafe
```

Within the app, this is mapped into interpretable crew posture and embarkation guidance, including:

- `SAFE`
- `MONITOR`
- `HIGH_RISK`
- `DO_NOT_EMBARK`

The cislunar operations layer also evaluates:

- safe-haven windows
- life-support margin
- comm coverage fraction
- eclipse burden
- beta-angle and electrical survival posture

### Decision Intelligence

ARTEMIS-Q evaluates mission-control style options such as:

- `CONTINUE`
- `REPLAN`
- `ABORT`

Each option is compared across:

- crew risk
- mission success likelihood
- delta-v impact
- schedule impact
- operational constraints
- communications posture
- expected cost

A simplified expected-cost framing is:

```text
ExpectedCost =
  C_direct
+ C_indirect
+ P_failure C_failure
```

The real system also computes replan and regret-oriented comparisons, so the output is not only “what is cheapest,” but “what is safest and most defensible under uncertainty.”

### Quantum Machine Learning Layer

ARTEMIS-Q also includes a PennyLane-based variational QML worker for mission-decision scoring.

The QML layer operates on normalized mission features such as:

- crew risk
- cost pressure
- communication penalty
- delta-v pressure
- uncertainty
- radiation pressure
- schedule pressure
- confidence gap

These are mapped to a classical utility target:

```text
U(x) =
  0.30(1 - crew_risk)
+ 0.18(1 - cost_pressure)
+ 0.12(1 - comm_penalty)
+ 0.10(1 - delta_v_pressure)
+ 0.08(1 - uncertainty)
+ 0.12(1 - radiation_pressure)
+ 0.04(1 - schedule_pressure)
+ 0.06(1 - confidence_gap)
```

The PennyLane circuit then uses:

- `AngleEmbedding(inputs * π, rotation="Y")`
- `StronglyEntanglingLayers(theta)`
- expectation values `⟨Zi⟩`

to produce a variational regression output:

```text
ŷ(x) = mean((1 - ⟨Zi⟩) / 2)
```

with loss:

```text
L = mean((ŷ(x) - U(x))²)
```

This output is then interpreted as mission utility and mapped into:

- `CONTINUE`
- `REPLAN`
- `ABORT`

So the quantum component is not just a chart. It is a live inference layer inside the app’s mission-decision workflow.

### What The App Does

In practical terms, ARTEMIS-Q lets a user:

- choose launch and target bodies
- evaluate trajectories and flight sequences
- inspect live planetary/mission geometry
- overlay radiation and environment context
- run mission optimization and compare route outcomes
- inspect crew-health posture and mission decisions
- analyze launch/ascent behavior and vehicle geometry
- screen Earth-orbit operations with SGP4 and conjunction tools
- assess launch sites, recovery corridors, and keep-out zones
- export, compare, and version mission baselines
- inspect simulated QAOA and PennyLane QML decision layers

### How We Built It

ARTEMIS-Q is a modular full-stack system with both classical and quantum-analysis layers.

Frontend:

- React
- TypeScript
- Vite
- Three.js / `@react-three/fiber` / `@react-three/drei`
- Recharts

Backend:

- Express
- TypeScript analysis modules
- Python PennyLane worker for QML inference

Core design principles:

- every panel should be backed by a route or analysis module, not a static mock
- live sources should be labeled clearly
- modeled outputs should be distinguishable from live API outputs
- mission decisions should be interpretable, not black-box only

Representative modules:

- `optimizer.ts` for route and mission optimization
- `optimizer.ts` also for QUBO / simulated QAOA outputs
- `trajectoryDesign.ts` for transfer design
- `cislunarOps.ts` for crewed mission operations
- `sgp4Ops.ts` for orbital operations
- `multiStage.ts` and `stlAnalyzer.ts` for vehicle engineering
- `groundSystems.ts` and `missionTimeline.ts` for operations and planning
- `pennylane_worker.py` for local QML analysis

### Challenges We Ran Into

#### 1. Balancing realism and tractability

A fully faithful flight-dynamics, biomedical, comm-network, and range-operations system would be far beyond the scope of an interactive application. The challenge was choosing models that were explicit and meaningful without pretending to be flight-certified.

#### 2. Coupling many domains

The app sits at the intersection of:

- optimization
- astrodynamics
- environmental modeling
- crew-health risk
- operational decision support
- cost/economic reasoning
- quantum-style optimization
- hybrid quantum-classical learning

Making those domains talk to each other coherently was much harder than implementing any one of them in isolation.

#### 3. Making the quantum layer meaningful

A common hackathon failure mode is to bolt quantum onto a project after the fact. The harder problem was making the quantum pieces structurally relevant:

- the route problem had to look like a real binary optimization problem
- the QAOA layer had to reflect a reduced Hamiltonian, not a decorative widget
- the QML layer had to operate on mission features that actually matter to decisions

That required treating quantum methods as part of the analytical architecture, not just the presentation layer.

#### 4. Reasoning under uncertainty

Space missions do not fail because a nominal path looks bad. They fail because conditions shift, assumptions break, or margins collapse. Modeling uncertainty across weather, radiation, comm, conjunctions, and mission timing was central to the architecture.

#### 5. Explainability

Mission support tools must justify their outputs. A continue / replan / abort recommendation is not useful if it cannot be traced back to dose, communications, timing, cost, or rule violations. That requirement drove the emphasis on rationale strings, provenance labels, validation panels, and comparison boards.

#### 6. Integrating live sources without collapsing the app

The app depends on multiple external sources. That creates a practical challenge: upstream APIs can fail, rate-limit, or become unavailable. The system therefore needs both live ingestion and graceful fallback behavior.

### Accomplishments That We’re Proud Of

- turning a trajectory-planning concept into a broader mission-intelligence platform
- embedding simulated QAOA and PennyLane QML in a way that is computationally relevant to the app
- integrating live JPL Horizons, NOAA, DONKI, CelesTrak, EONET, and related context into the workflow
- building a crew-aware cislunar operations layer instead of treating crew risk as an afterthought
- connecting vehicle, environment, routing, ground systems, and decision logic in one UI
- adding finite-burn-informed maneuver targeting, validation, and mission playback tooling
- exposing a simulated quantum layer and a PennyLane QML layer while staying explicit about realism boundaries

### What We Learned

- the “best” mission is rarely the one with the lowest nominal delta-v
- crew safety changes the optimization problem qualitatively, not just numerically
- uncertainty and explainability matter as much as raw optimization quality
- a reduced-order model is still extremely valuable if its assumptions are explicit
- interactive tooling becomes far more useful when it connects planning, operations, engineering, and environment in one place
- quantum methods are most useful here when they augment structured decision-making, not when they replace the physics

### What’s Next For ArtemisQ

The next major improvements are higher-fidelity and operational-depth upgrades, especially:

- deeper finite-burn targeting and dispersions
- stronger orbit-determination and covariance workflows
- improved DSN / relay scheduling realism
- better benchmark and calibration suites
- richer scenario and replay workflows
- additional validation against mission-class envelopes
- deeper hybrid quantum experiments over richer mission-state encodings
- stronger quantum-vs-classical comparative studies for route and decision quality

### Final Thought

ARTEMIS-Q is ultimately about more than finding a path.

It is about using quantum-inspired optimization, hybrid QML, physics, and live mission context to decide whether a mission is safe, robust, explainable, and justified for human flight.

## What The App Does

ARTEMIS-Q spans four operational lanes:

- `Mission planning and trajectory analysis`
- `Launch/ascent and vehicle trade studies`
- `Near-Earth conjunction and orbital operations`
- `Crewed cislunar mission operations`

It supports:

- mission-graph optimization with uncertainty
- launch-window and transfer design
- crew-aware risk and dose evaluation
- anomaly-aware decision support
- live weather, space-weather, and ephemeris context
- SGP4 propagation and conjunction screening
- STL-based vehicle geometry and ascent analysis
- multi-stage rocket assessment
- ground/range and recovery analysis
- CCSDS-style import/export and baseline comparison
- simulated QAOA and PennyLane QML layers

## Major Capabilities

### Mission Design

- `Launch-window solver with real constraints`
  Uses weather, radiation, communications, and transfer penalties to rank candidate windows.

- `Lambert / patched-conic transfer solving`
  Includes a universal-variable Lambert solver and patched-conic departure/capture estimates.

- `Plane-change and phasing optimization`
  Computes phase residuals, synodic timing, and best-delay estimates.

- `Gravity-assist sequencing`
  Ranks candidate assist chains and estimated delta-v gains.

- `Abort and contingency trajectory branches`
  Produces free-return, direct-return, and safe-haven style contingency branches.

- `Propellant margin and reserve policy modeling`
  Converts nominal and contingency delta-v needs into reserve policy and rationale.

### Probabilistic Mission Intelligence

- Bayesian risk updating
- fault detection and isolation
- sequential mission-decision logic
- robust / worst-case optimization
- constraint relaxation studies
- sensitivity and robustness scoring
- recommendation logic for policy / shielding / weights
- explicit physics-risk-cost coupling

Core modules:

- [src/lib/bayes.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/bayes.ts)
- [src/lib/fdi.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/fdi.ts)
- [src/lib/decisionTree.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/decisionTree.ts)
- [src/lib/robust.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/robust.ts)
- [src/lib/relaxation.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/relaxation.ts)
- [src/lib/sensitivity.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/sensitivity.ts)
- [src/lib/robustness.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/robustness.ts)
- [src/lib/recommender.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/recommender.ts)
- [src/lib/coupling.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/coupling.ts)

### Flight Dynamics And Orbital Operations

- JPL Horizons backend ephemeris ingestion
- Solar System OpenData body catalog and metadata
- SGP4 propagation for Earth-orbiting objects
- conjunction screening and TCA workflow
- covariance propagation and miss-distance estimation
- maneuver targeting and navigation residuals
- modeled DSN visibility support
- gravity-influence assessment against major bodies

Core modules:

- [src/lib/horizons.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/horizons.ts)
- [src/lib/solarSystem.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/solarSystem.ts)
- [src/lib/sgp4Ops.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/sgp4Ops.ts)
- [src/lib/covariance.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/covariance.ts)
- [src/lib/maneuverTargeting.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/maneuverTargeting.ts)
- [src/lib/groundStations.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/groundStations.ts)
- [src/lib/gravityInfluence.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/gravityInfluence.ts)
- [src/lib/gravityRisk.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/gravityRisk.ts)

### Vehicle Engineering And Ascent

- true multi-stage stack analysis
- stage separation mass propagation
- engine-out / degraded-performance estimates
- TPS heat-flux estimation
- STL-derived geometry and aerodynamic indicators
- CG shift and controllability through burn
- browser-side ascent solver and flight-path optimization

Core modules:

- [src/lib/multiStage.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/multiStage.ts)
- [src/lib/stlAnalyzer.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/stlAnalyzer.ts)
- [src/components/AeroDynamicsVisualizer.tsx](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/components/AeroDynamicsVisualizer.tsx)
- [src/lib/simulator.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/simulator.ts)
- [src/lib/ascentDynamics.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/ascentDynamics.ts)

### Operations, Crew, And Ground Systems

- timeline editor with dependencies and resource locking
- mission playback scrubber tied to the current trajectory
- consumables propagation
- live mission status console and alarm synthesis
- crewed cislunar dose / lighting / comm / consumables analysis
- EVA planning constraints
- flight-review report synthesis
- launch site / pad / keep-out / recovery corridor analysis
- CCSDS-like import/export and baseline comparison
- benchmark validation against mission envelopes

Core modules:

- [src/lib/missionTimeline.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/missionTimeline.ts)
- [src/lib/consumables.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/consumables.ts)
- [src/lib/opsConsole.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/opsConsole.ts)
- [src/lib/cislunarOps.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/cislunarOps.ts)
- [src/lib/eva.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/eva.ts)
- [src/lib/flightReview.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/flightReview.ts)
- [src/lib/groundSystems.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/groundSystems.ts)
- [src/lib/ccsds.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/ccsds.ts)
- [src/lib/validation.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/validation.ts)

### Environment And Radiation

- NOAA surface weather ingestion
- NOAA SWPC live space weather
- NASA DONKI event context
- GOES-informed near-Earth radiation context
- Van Allen belt overlay and trajectory intersection scoring
- eclipse / lighting / beta-angle analysis
- surface environment support for Moon/Mars operations
- EONET Earth-event context

Core modules:

- [src/lib/noaa.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/noaa.ts)
- [src/lib/donki.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/donki.ts)
- [src/lib/swpcGoes.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/swpcGoes.ts)
- [src/lib/radiationIngest.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/radiationIngest.ts)
- [src/lib/radiationModel.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/radiationModel.ts)
- [src/lib/radiationIntersection.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/radiationIntersection.ts)
- [src/lib/surfaceOps.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/surfaceOps.ts)
- [src/lib/eonet.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/eonet.ts)

## App Pages And Panels

The app has four main pages: `Mission`, `Physics`, `Vehicle`, and `Quantum`.

### Shared Top Section

The large top visual area changes by tab:

- `Mission / Physics / Quantum`
  Main mission visualizer with:
  - live or fallback ephemeris-driven body placement
  - mission trajectory rendering
  - numbered stage markers
  - camera controls and quick-focus navigation

- `Vehicle`
  `STL Aerodynamics Visualizer`

Shared summary cards under the visualizer:

- `Mission Metrics`
- `Ascent Metrics`
- `Live Strip`
- `Analysis Console`

When optimization is available, the center section also shows:

- `Crew Health Panel`
- `Mission Decision Panel`
- `Replan Comparison Board`
- `Verification Summary`
- `Launch & Shielding Trade Space`
- `Uncertainty & Reentry`
- `Phase Breakdown`
- `Stakeholder Board`
- `Digital Twin`
- `Mission Command`

### Mission Page

Right-side mission page cards:

- `Mission Controls`
- `Flight Sequence`
- `Route Output`
- `Body & Environment`
- `Gravity Influence`
- `Crewed Cislunar Ops`
- `Trajectory Design`
- `Timeline Editor`
  Includes the `Mission Playback` scrubber
- `Ground Range & Recovery`
- `Consumables, Surface & Console`
- `Benchmark Validation`
- `Crew EVA & Flight Review`
- `CCSDS & Baselines`
- `Provenance Audit`

### Physics Page

- `Keplerian Controls`
- `Orbital Physics`
- `Conjunction Panel`
- `SGP4 Orbital Ops`
- `Navigation Residuals & Launch Commit`
- `Covariance & Targeting`
- `Fuel Calculator`

### Vehicle Page

- `Vehicle Inputs`
- `STL-Derived Geometry`
- `Multi-Stage Vehicle`
- `Best Flight Path`
- `Ascent Trace`
- `Stability & AI summary`

### Quantum Page

- `Quantum Layer`
- `PennyLane QML`
- `Quantum Circuit`
- `State Distribution`
- `Layer Diagnostics`
- `Qubit Marginals`
- `ZZ Correlations`
- `Annealing History`
- `Reality Boundary`

## Backend API Surface

### Core Optimization And Simulation

- `POST /api/optimize`
- `POST /api/qaoa`
- `POST /api/qml/pennylane`
- `POST /api/simulate`

### Ephemerides And Astronomy

- `GET /api/horizons`
- `GET /api/horizons/trajectory`
- `GET /api/ephemeris`
- `GET /api/ephemeris/system`
- `GET /api/bodies`
- `GET /api/body/:id`
- `GET /api/sky-positions`

### Environment And Radiation

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
- `POST /api/ops/cislunar`

### Trajectory And Orbital Ops

- `POST /api/trajectory/design`
- `POST /api/sgp4/propagate`
- `POST /api/sgp4/conjunctions`
- `POST /api/sgp4/residuals`
- `POST /api/sgp4/covariance`
- `POST /api/maneuver/target`
- `POST /api/gravity/influences`
- `GET /api/dsn/visibility`
- `GET /api/celestrak/gp`
- `GET /api/celestrak/conjunctions`
- `GET /api/webgeocalc/metadata`
- `POST /api/webgeocalc/query`

### Vehicle, Launch, And Ground

- `POST /api/vehicle/multistage`
- `POST /api/launch/constraints`
- `GET /api/ground/launch-sites`
- `POST /api/ground/constraints`

### Operations And Crew

- `POST /api/timeline/solve`
- `POST /api/validation/benchmarks`
- `POST /api/consumables/analyze`
- `POST /api/surface/environment`
- `POST /api/ops/console`
- `POST /api/eva/plan`
- `POST /api/reports/flight-review`

### Data Workflow And Telemetry

- `POST /api/ccsds/oem`
- `POST /api/ccsds/opm`
- `POST /api/ccsds/import`
- `POST /api/baselines/compare`
- `POST /api/telemetry/ingest`
- `GET /api/telemetry/latest`
- `GET /api/telemetry/history`
- `GET /api/eonet/events`

## Mathematical And Physical Basis

ARTEMIS-Q uses explicit formulas throughout the stack. Examples:

- rocket equation / propellant mass:
  `Δv = Isp g0 ln(m0 / mf)`
- Lambert and patched-conic transfer estimates
- SGP4 propagation
- covariance growth and miss-distance estimation
- dynamic pressure:
  `q = 0.5 ρ v²`
- simplified atmosphere and drag
- radiation dose accumulation along trajectory
- belt-zone intersection scoring
- eclipse and beta-angle analysis
- stage-by-stage mass propagation
- TPS heat-flux estimation
- finite-burn targeting and dispersion envelopes
- benchmark validation against mission envelopes

Key mathematical engines:

- [src/lib/orbital.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/orbital.ts)
- [src/lib/trajectoryDesign.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/trajectoryDesign.ts)
- [src/lib/optimizer.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/optimizer.ts)
- [src/lib/maneuverTargeting.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/maneuverTargeting.ts)
- [src/lib/cislunarOps.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/cislunarOps.ts)
- [src/lib/simulator.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/simulator.ts)

## Quantum And QML

ARTEMIS-Q has two distinct quantum-style layers.

### Simulated QAOA

Implemented in:

- [src/lib/optimizer.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/optimizer.ts)

Used for:

- reduced mission-cost Hamiltonian diagnostics
- QAOA layer visualization
- state distribution and marginal/correlation displays

This is classical simulation, not hardware execution.

### PennyLane QML

Implemented in:

- [python/pennylane_worker.py](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/python/pennylane_worker.py)
- [src/lib/pennylane.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/lib/pennylane.ts)
- `POST /api/qml/pennylane` in [server.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/server.ts)

Used for:

- hybrid mission-decision scoring
- `CONTINUE / REPLAN / ABORT` recommendation
- class probabilities
- local feature sensitivity analysis

Current feature vector:

- `crew_risk`
- `cost_pressure`
- `comm_penalty`
- `delta_v_pressure`
- `uncertainty`
- `radiation_pressure`
- `schedule_pressure`
- `confidence_gap`

Classical utility target:

```text
U(x) =
  0.30(1 - crew_risk)
+ 0.18(1 - cost_pressure)
+ 0.12(1 - comm_penalty)
+ 0.10(1 - delta_v_pressure)
+ 0.08(1 - uncertainty)
+ 0.12(1 - radiation_pressure)
+ 0.04(1 - schedule_pressure)
+ 0.06(1 - confidence_gap)
```

Quantum model:

- `AngleEmbedding(inputs * π, rotation="Y")`
- `StronglyEntanglingLayers(theta)`
- outputs `⟨Zi⟩`
- regression output:

```text
ŷ(x) = mean((1 - ⟨Zi⟩) / 2)
```

Loss:

```text
L = mean((ŷ(x) - U(x))²)
```

Policy thresholds:

- `CONTINUE` if utility `>= 0.68`
- `REPLAN` if `0.42 <= utility < 0.68`
- `ABORT` otherwise

Supported QML backends in this build:

- `default.qubit`
- `lightning.qubit`

Current runtime model:

- local PennyLane simulation only
- no AWS Braket / no direct QPU execution

## Live Data Integrations

- `JPL Horizons`
  Ephemerides, backend trajectory generation, system positions

- `NOAA NWS`
  Surface weather

- `NOAA SWPC`
  Space weather, GOES radiation context

- `NASA DONKI`
  CME/flare/SEP context

- `Solar System OpenData`
  Body metadata and catalog browsing

- `CelesTrak`
  Earth-orbiting object context

- `NASA EONET`
  Earth events for range/recovery context

- `WebGeoCalc / SPICE proxy`
  SPICE-style metadata/query proxying

## Architecture

### Frontend

- React
- TypeScript
- `@react-three/fiber`
- `@react-three/drei`
- Recharts
- Tailwind

Primary UI file:

- [src/App.tsx](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/src/App.tsx)

### Backend

- Express
- TypeScript
- Vite-based dev flow through [server.ts](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/server.ts)

### Python Worker

- PennyLane QML worker:
  [python/pennylane_worker.py](/Users/mohammadaghamohammadi/Desktop/Projects/artemisq/python/pennylane_worker.py)

## Realism Boundary

What is real in the current app:

- real backend routes
- real UI wiring to those routes
- real mathematical models
- real live-data integrations where public feeds exist
- real quantum simulation via PennyLane and simulated QAOA

What remains modeled rather than mission-authority grade:

- mission graph topology is still curated unless you import your own config/graph
- DSN visibility is modeled from geometry and ephemerides, not official scheduling
- covariance propagation is reduced-order, not full OD covariance
- maneuver targeting is finite-burn-informed but still reduced-order, not a certified GN&C targeting tool
- STL-derived aero/structure estimates are approximations, not CFD/FEA
- range/recovery logic is formula-driven, not an official range operations system
- QAOA is classically simulated
- PennyLane QML uses local quantum simulation only

## Environment Variables

Optional configuration:

- `TELEMETRY_ACCESS_TOKEN`
- `SOLAR_SYSTEM_OPENDATA_TOKEN`
- `NASA_API_KEY`
- `NOAA_USER_AGENT`
- `PORT`

Notes:

- JPL Horizons does not require an API key in this integration path
- NOAA NWS / SWPC do not require API keys here
- DONKI uses `NASA_API_KEY` when configured
- Solar System OpenData may require a bearer token depending on service policy

## Setup

Install dependencies:

```bash
npm install
```

Run development server:

```bash
npm run dev
```

Type-check:

```bash
npm run typecheck
```

Build:

```bash
npm run build
```

## Verification

Current local verification target:

```bash
npm run typecheck
npm run build
```

The build may still emit a large bundle warning because of the 3D and charting stack.

## Summary

ARTEMIS-Q is a mission-intelligence workbench that combines:

- mission design
- trajectory analysis
- uncertainty-aware routing
- crew and radiation assessment
- orbital operations
- vehicle and ascent analysis
- ground/range and recovery planning
- mission reporting and provenance
- quantum-simulation-backed analysis

in one application with explicit formulas, live-data context, and page-level operational tooling.
