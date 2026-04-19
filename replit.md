# ARTEMIS-Q

## Overview
ARTEMIS-Q is a comprehensive, interactive mission optimization and decision-support platform for space mission analysis. It covers cislunar, orbital, and interplanetary operations, integrating trajectory design, vehicle engineering, risk assessment, and mission operations into a single application.

## Tech Stack
- **Frontend**: React 19 with TypeScript, Three.js (via @react-three/fiber), Tailwind CSS 4, Recharts
- **Backend**: Node.js + Express (TypeScript), served via Vite middleware in development
- **Build Tool**: Vite 6
- **Package Manager**: npm
- **Python Worker**: PennyLane quantum ML, trimesh STL analysis (python/)

## Architecture
- `server.ts` — Express server that serves API routes and proxies Vite dev middleware
- `src/` — React frontend source code
  - `src/lib/` — Core physics/orbital mechanics engine modules
  - `src/components/` — UI components including 3D visualizers
  - `src/App.tsx` — Main application entry point
- `python/pennylane_worker.py` — Quantum simulation/ML Python worker
- `vite.config.ts` — Vite configuration with code splitting

## Data Integrations (External APIs, no keys required)
- NASA/JPL Horizons — ephemerides and trajectory data
- NASA DONKI — space weather events
- NASA EONET — natural events
- NOAA SWPC — GOES radiation/space weather
- NWS — surface weather
- CelesTrak — TLE data for Earth-orbiting objects
- Open-Meteo — fallback weather data
- Solar System OpenData — planetary body data

## Environment Variables
See `.env.example` for optional configuration:
- `GEMINI_API_KEY` — Google Gemini AI for recommendation layers
- `TELEMETRY_ACCESS_TOKEN` — Optional shared secret for telemetry endpoints
- `NASA_API_KEY` — Optional NASA API key (falls back to DEMO_KEY)

## Development
- Run: `npm run dev` (starts Express + Vite on port 5000)
- Build: `npm run build`
- Server listens on `0.0.0.0:5000` for Replit proxy compatibility

## Deployment
- Target: autoscale
- Build: `npm run build`
- Run: `node --import tsx/esm server.ts`

## Audit Notes (Apr 2026)
Earth-Moon Mission Visualizer fixes applied to `src/lib/orbital.ts` and `src/lib/horizons.ts`:
- Removed the duplicate-looking "extra blue line" by tilting the inbound arc ~10° out of the outbound plane (Rodrigues rotation about the orbital plane normal) and routing it to the opposite side of Earth (`reentryHat = -leoHat`).
- Default crewed-stay duration increased from 0.3 days to 3.0 days (Apollo-class mission realism), so the Moon meaningfully advances along its orbit between TLI arrival and TEI.
- Anchored the rendered Moon sphere to the spacecraft's *arrival* epoch (`sceneDate + lastOutbound.time_s`) so the outbound trajectory line visually terminates at the Moon.
- "Encounter" Flight Sequence event now snaps to exactly `tofS` so the marker lands on the outbound arc end at the Moon (previously drifted into the stay period).
- Added a numeric guard for degenerate cross product when `leoHat ∥ moonHat`.

Verified live data flow:
- Go/No-Go (`src/lib/cislunarOps.ts`) auto-updates from NOAA surface weather, NOAA SWPC space weather, near-Earth radiation environment, DSN visibility windows, and trajectory-derived eclipse/dose; wired through a memoized `cislunarMissionAnalysis` with full reactive deps in `App.tsx`.
- Launch constraints (`src/lib/launchConstraints.ts`) auto-update from live weather and atmospheric scale height.
- Quantum simulation: QAOA statevector simulation (`src/lib/optimizer.ts`) and PennyLane VQML worker (`python/pennylane_worker.py`) wired into the Quantum panel.
- Physics core (Hohmann, Keplerian + J2, SGP4, Meeus lunar ephemeris) verified mathematically sound.
