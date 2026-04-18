import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { SimulatedAnnealer } from "./src/lib/optimizer.ts";
import { LaunchSimulator } from "./src/lib/simulator.ts";
import { fetchCelestrakGp, fetchCelestrakTrafficAssessment } from "./src/lib/celestrak.ts";
import { fetchDonkiSpaceWeatherSummary } from "./src/lib/donki.ts";
import { fetchEonetEvents } from "./src/lib/eonet.ts";
import { computeDsnVisibility } from "./src/lib/groundStations.ts";
import {
  buildHorizonsTrajectory,
  buildHorizonsUrl,
  fetchHorizonsLaunchWindowEvaluations,
  fetchHorizonsTransferEstimate,
} from "./src/lib/horizons.ts";
import { fetchNoaaSpaceWeather, fetchNoaaSurfaceWeather } from "./src/lib/noaa.ts";
import { fetchOpenMeteoWeather } from "./src/lib/openMeteo.ts";
import { getLatestTelemetryFrame, getTelemetryHistory, ingestTelemetryFrame } from "./src/lib/telemetryHub.ts";
import { fetchWebGeoCalcMetadata, submitWebGeoCalcRequest } from "./src/lib/webgeocalc.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  app.use(express.json());

  // ── JPL Horizons ───────────────────────────────────────────────────────────
  app.get("/api/horizons", async (req, res) => {
    const raw = req.query;
    const required = ['COMMAND', 'CENTER', 'START_TIME', 'STOP_TIME'] as const;
    for (const key of required) {
      if (!raw[key]) {
        return res.status(400).json({ error: `${key} is required` });
      }
    }

    try {
      const url = buildHorizonsUrl({
        COMMAND: String(raw.COMMAND),
        CENTER: String(raw.CENTER),
        START_TIME: String(raw.START_TIME),
        STOP_TIME: String(raw.STOP_TIME),
        STEP_SIZE: raw.STEP_SIZE ? String(raw.STEP_SIZE) : undefined,
        EPHEM_TYPE: raw.EPHEM_TYPE as 'OBSERVER' | 'VECTORS' | 'ELEMENTS' | undefined,
        OUT_UNITS: raw.OUT_UNITS as 'KM-S' | 'AU-D' | 'KM-D' | undefined,
        REF_SYSTEM: raw.REF_SYSTEM as 'ICRF' | 'B1950' | undefined,
        VEC_TABLE: raw.VEC_TABLE ? String(raw.VEC_TABLE) : undefined,
        VEC_CORR: raw.VEC_CORR as 'NONE' | 'LT' | 'LT+S' | undefined,
        OBJ_DATA: raw.OBJ_DATA as 'YES' | 'NO' | undefined,
        CSV_FORMAT: raw.CSV_FORMAT as 'YES' | 'NO' | undefined,
        CAL_FORMAT: raw.CAL_FORMAT as 'CAL' | 'JD' | 'BOTH' | undefined,
        TIME_TYPE: raw.TIME_TYPE as 'UT' | 'TT' | 'TDB' | undefined,
        MAKE_EPHEM: raw.MAKE_EPHEM as 'YES' | 'NO' | undefined,
      });
      const response = await fetch(url);
      const text = await response.text();
      res.status(response.status).type('application/json').send(text);
    } catch (error: any) {
      res.status(502).json({ error: error?.message || "Horizons fetch failed" });
    }
  });

  app.get("/api/horizons/trajectory", async (req, res) => {
    const launchDate = String(req.query.launchDate || '');
    const destinationId = String(req.query.destinationId || '');
    const launchBodyId = String(req.query.launchBodyId || 'earth');
    if (!launchDate || !destinationId) {
      return res.status(400).json({ error: "launchDate and destinationId are required" });
    }

    try {
      const keplerEl = {
        a: Number(req.query.a ?? 6778),
        e: Number(req.query.e ?? 0.0008),
        i: Number(req.query.i ?? 51.6),
        raan: Number(req.query.raan ?? 247),
        argp: Number(req.query.argp ?? 130),
        nu: Number(req.query.nu ?? 0),
      };
      const trajectory = await buildHorizonsTrajectory({
        launchDate,
        destinationId,
        launchBodyId,
        keplerEl,
      });
      res.json({
        source: "LIVE · JPL Horizons",
        trajectory,
      });
    } catch (error: any) {
      res.status(502).json({ error: error?.message || "Horizons trajectory build failed" });
    }
  });

  // ── Weather ────────────────────────────────────────────────────────────────
  app.get("/api/weather", async (req, res) => {
    const lat = req.query.lat || 28.5729;  // KSC Pad 39B
    const lon = req.query.lon || -80.6490;
    try {
      const weather = await fetchNoaaSurfaceWeather(Number(lat), Number(lon));
      res.json(weather);
    } catch (error: any) {
      try {
        const fallback = await fetchOpenMeteoWeather(Number(lat), Number(lon));
        res.json({
          ...fallback,
          source: `${fallback.source} (NOAA fallback)`,
        });
      } catch (fallbackError: any) {
        res.status(502).json({ error: fallbackError?.message || error?.message || "Weather fetch failed", source: "UPSTREAM ERROR" });
      }
    }
  });

  app.get("/api/noaa/weather", async (req, res) => {
    const lat = Number(req.query.lat || 28.5729);
    const lon = Number(req.query.lon || -80.6490);
    try {
      const weather = await fetchNoaaSurfaceWeather(lat, lon);
      res.json(weather);
    } catch (error: any) {
      res.status(502).json({ error: error?.message || "NOAA weather fetch failed", source: "UPSTREAM ERROR" });
    }
  });

  app.get("/api/openmeteo/weather", async (req, res) => {
    const lat = Number(req.query.lat || 28.5729);
    const lon = Number(req.query.lon || -80.6490);
    try {
      const weather = await fetchOpenMeteoWeather(lat, lon);
      res.json(weather);
    } catch (error: any) {
      res.status(502).json({ error: error?.message || "Open-Meteo fetch failed", source: "UPSTREAM ERROR" });
    }
  });

  // ── Space Weather (NOAA SWPC) ──────────────────────────────────────────────
  app.get("/api/space-weather", async (req, res) => {
    try {
      const days = Number(req.query.days ?? 7);
      const [noaaResult, donkiResult] = await Promise.allSettled([
        fetchNoaaSpaceWeather(),
        fetchDonkiSpaceWeatherSummary(days),
      ]);

      if (noaaResult.status !== 'fulfilled') {
        throw noaaResult.reason;
      }

      const noaa = noaaResult.value;
      if (donkiResult.status !== 'fulfilled') {
        return res.json({
          ...noaa,
          source: `${noaa.source} (DONKI unavailable)`,
        });
      }

      const donki = donkiResult.value;
      res.json({
        ...noaa,
        radiationIndex: Number((noaa.radiationIndex * donki.radiationBoost).toFixed(3)),
        eventCount: noaa.eventCount + donki.eventCount,
        donki,
        source: `${noaa.source} + ${donki.source}`,
      });
    } catch (error: any) {
      res.status(502).json({ error: error?.message || "Space weather fetch failed", source: "UPSTREAM ERROR" });
    }
  });

  app.get("/api/noaa/space-weather", async (_req, res) => {
    try {
      const spaceWeather = await fetchNoaaSpaceWeather();
      res.json(spaceWeather);
    } catch (error: any) {
      res.status(502).json({ error: error?.message || "NOAA SWPC fetch failed", source: "UPSTREAM ERROR" });
    }
  });

  app.get("/api/donki/space-weather", async (req, res) => {
    try {
      const donki = await fetchDonkiSpaceWeatherSummary(Number(req.query.days ?? 7));
      res.json(donki);
    } catch (error: any) {
      res.status(502).json({ error: error?.message || "DONKI fetch failed", source: "UPSTREAM ERROR" });
    }
  });

  // ── Telemetry Ingest ───────────────────────────────────────────────────────
  app.post("/api/telemetry/ingest", (req, res) => {
    try {
      const frame = ingestTelemetryFrame(req.body);
      res.status(201).json({ ok: true, frame });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Telemetry ingest failed" });
    }
  });

  app.get("/api/telemetry/latest", (_req, res) => {
    res.json({
      frame: getLatestTelemetryFrame(),
      source: 'LIVE · External Telemetry Ingest',
    });
  });

  app.get("/api/telemetry/history", (req, res) => {
    res.json({
      frames: getTelemetryHistory(Number(req.query.limit ?? 50)),
      source: 'LIVE · External Telemetry Ingest',
    });
  });

  // ── CelesTrak ───────────────────────────────────────────────────────────────
  app.get("/api/celestrak/gp", async (req, res) => {
    try {
      const records = await fetchCelestrakGp({
        group: req.query.group ? String(req.query.group) : undefined,
        name: req.query.name ? String(req.query.name) : undefined,
        catnr: req.query.catnr ? String(req.query.catnr) : undefined,
        format: 'JSON',
      });
      res.json({
        records,
        source: 'LIVE · CelesTrak GP',
      });
    } catch (error: any) {
      res.status(502).json({ error: error?.message || "CelesTrak fetch failed", source: "UPSTREAM ERROR" });
    }
  });

  app.get("/api/celestrak/conjunctions", async (req, res) => {
    try {
      const assessment = await fetchCelestrakTrafficAssessment({
        group: req.query.group ? String(req.query.group) : 'STATIONS',
        name: req.query.name ? String(req.query.name) : undefined,
        catnr: req.query.catnr ? String(req.query.catnr) : undefined,
        limit: Number(req.query.limit ?? 12),
        horizonSeconds: Number(req.query.horizonSeconds ?? 86400),
        dtSeconds: Number(req.query.dtSeconds ?? 120),
      });
      res.json(assessment);
    } catch (error: any) {
      res.status(502).json({ error: error?.message || "CelesTrak conjunction screening failed", source: "UPSTREAM ERROR" });
    }
  });

  // ── EONET ───────────────────────────────────────────────────────────────────
  app.get("/api/eonet/events", async (req, res) => {
    try {
      const events = await fetchEonetEvents({
        status: (req.query.status ? String(req.query.status) : 'open') as 'open' | 'closed' | 'all',
        limit: Number(req.query.limit ?? 6),
        days: Number(req.query.days ?? 14),
        category: req.query.category ? String(req.query.category) : undefined,
        source: req.query.source ? String(req.query.source) : undefined,
        bbox: req.query.bbox ? String(req.query.bbox) : undefined,
      });
      res.json(events);
    } catch (error: any) {
      res.status(502).json({ error: error?.message || "EONET fetch failed", source: "UPSTREAM ERROR" });
    }
  });

  // ── WebGeocalc ──────────────────────────────────────────────────────────────
  app.get("/api/webgeocalc/metadata", async (_req, res) => {
    try {
      const metadata = await fetchWebGeoCalcMetadata();
      res.json({
        ...metadata,
        source: 'LIVE · NAIF WebGeocalc',
      });
    } catch (error: any) {
      res.status(502).json({ error: error?.message || "WebGeocalc metadata fetch failed", source: "UPSTREAM ERROR" });
    }
  });

  app.post("/api/webgeocalc/query", async (req, res) => {
    try {
      const result = await submitWebGeoCalcRequest(
        String(req.body.path || ''),
        req.body.payload,
        (req.body.method === 'GET' ? 'GET' : 'POST'),
      );
      res.json({
        result,
        source: 'LIVE · NAIF WebGeocalc',
      });
    } catch (error: any) {
      res.status(502).json({ error: error?.message || "WebGeocalc query failed", source: "UPSTREAM ERROR" });
    }
  });

  // ── Ground Station / DSN Visibility ────────────────────────────────────────
  app.get("/api/dsn/visibility", async (req, res) => {
    const targetId = String(req.query.targetId || 'moon');
    const startTime = String(req.query.startTime || new Date().toISOString().slice(0, 10));
    const stopTime = String(req.query.stopTime || new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10));
    try {
      const summary = await computeDsnVisibility({
        targetId,
        startTime,
        stopTime,
        stepSize: req.query.stepSize ? String(req.query.stepSize) : '1 h',
        minElevationDeg: Number(req.query.minElevationDeg ?? 10),
      });
      res.json(summary);
    } catch (error: any) {
      res.status(502).json({ error: error?.message || "DSN visibility computation failed", source: "UPSTREAM ERROR" });
    }
  });

  // ── Optimize ────────────────────────────────────────────────────────────────
  app.post("/api/optimize", async (req, res) => {
    const {
      nodes, edges, weights, start, end, steps,
      date, radiationIndex, isp_s = 450, spacecraft_mass_kg = 5000,
      missionProfile,
      monteCarloRuns = 80,
      qaoa_p = 3,
      targetPlanet,
      launchBodyId = 'earth',
      keplerEl,
    } = req.body;

    try {
      const year = date ? new Date(date).getFullYear() : new Date().getFullYear();
      const solarOffset = (year - 2019) % 11;
      const baseRadiation = 1 + Math.sin((solarOffset / 11) * Math.PI) * 0.5;
      const finalMultiplier = baseRadiation * (radiationIndex || 1.0);
      let resolvedMissionProfile = missionProfile;

      if (date && targetPlanet) {
        try {
          const offsets = missionProfile?.launchWindowOffsetsHours ?? [0, 6, 12, 24, 36];
          const transferEstimate = await fetchHorizonsTransferEstimate({
            launchDate: date,
            destinationId: targetPlanet,
            launchBodyId,
            keplerEl,
          });
          const launchWindows = await fetchHorizonsLaunchWindowEvaluations({
            launchDate: date,
            destinationId: targetPlanet,
            launchBodyId,
            offsetsHours: offsets,
            baseRadiation: Math.max(0.2, finalMultiplier),
            baseCommunication: 0.82,
            keplerEl,
          });
          resolvedMissionProfile = {
            ...missionProfile,
            externalTransferTimeDays: transferEstimate.transferTimeDays,
            externalLaunchWindows: launchWindows,
          };
        } catch {
          resolvedMissionProfile = missionProfile;
        }
      }

      const annealer = new SimulatedAnnealer(nodes, edges, weights, isp_s, spacecraft_mass_kg);
      const result = annealer.optimize(start, end, steps, finalMultiplier, resolvedMissionProfile, monteCarloRuns, qaoa_p);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Optimization failed" });
    }
  });

  // ── QAOA-Only Re-run ──────────────────────────────────────────────────────
  app.post("/api/qaoa", (req, res) => {
    const {
      bestPath, nodes, edges, weights, qaoa_p = 3,
      isp_s = 450, spacecraft_mass_kg = 5000,
    } = req.body;

    if (!bestPath || !nodes || !edges || !weights) {
      return res.status(400).json({ error: "bestPath, nodes, edges, and weights are required" });
    }

    try {
      const annealer = new SimulatedAnnealer(nodes, edges, weights, isp_s, spacecraft_mass_kg);
      const result = annealer.runQAOAOnly(bestPath, qaoa_p);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "QAOA re-run failed" });
    }
  });

  // ── Launch Simulate ─────────────────────────────────────────────────────────
  app.post("/api/simulate", (req, res) => {
    const {
      mass,
      thrust,
      frontalArea,
      dragCoeff,
      fuel,
      wind,
      pressure,
      exitArea,
      propellantMassFraction,
      targetDeltaV_ms,
      maxQThresholdKpa,
      geometryHints,
      dt,
      maxTime,
      body,
      optimizePath,
    } = req.body;
    try {
      if (!Number.isFinite(mass) || mass <= 0) {
        return res.status(400).json({ error: "Mass must be a positive number" });
      }
      if (!Number.isFinite(thrust) || thrust <= 0) {
        return res.status(400).json({ error: "Thrust must be a positive number" });
      }
      if (!Number.isFinite(frontalArea) || frontalArea <= 0) {
        return res.status(400).json({ error: "Frontal area must be a positive number" });
      }
      if (!Number.isFinite(dragCoeff) || dragCoeff <= 0) {
        return res.status(400).json({ error: "Drag coefficient must be a positive number" });
      }
      const sim = new LaunchSimulator(mass, thrust, frontalArea, dragCoeff, fuel, wind, pressure);
      const config = {
        exitArea,
        propellantMassFraction,
        targetDeltaV_ms,
        maxQThresholdKpa,
        geometryHints,
        dt,
        maxTime,
        body,
      };
      if (optimizePath) {
        return res.json(sim.optimizeFlightPath(config));
      }
      return res.json(sim.simulate(config));
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Simulation failed" });
    }
  });

  // ── Vite Dev Server ─────────────────────────────────────────────────────────
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
    root: __dirname,
  });
  app.use(vite.middlewares);
  app.use("*", (req, res, next) => {
    if (req.originalUrl.startsWith("/api")) return next();
    res.sendFile(path.resolve(__dirname, "index.html"));
  });

  app.listen(PORT, () => {
    console.log(`ARTEMIS-Q server running → http://localhost:${PORT}`);
  });
}

startServer().catch(console.error);
