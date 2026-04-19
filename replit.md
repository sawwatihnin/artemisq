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
