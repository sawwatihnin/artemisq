import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { SimulatedAnnealer } from "./src/lib/optimizer.ts";
import { LaunchSimulator } from "./src/lib/simulator.ts";
import { fetchCelestrakGp, fetchCelestrakTrafficAssessment } from "./src/lib/celestrak.ts";
import { analyzeCrewedCislunarMissionOps } from "./src/lib/cislunarOps.ts";
import { fetchDonkiSpaceWeatherSummary } from "./src/lib/donki.ts";
import { fetchEonetEvents } from "./src/lib/eonet.ts";
import { assessTrajectoryGravityInfluence } from "./src/lib/gravityInfluence.ts";
import { computeDsnVisibility } from "./src/lib/groundStations.ts";
import {
  buildHorizonsTrajectory,
  buildHorizonsUrl,
  fetchHorizonsVectors,
  fetchHorizonsLaunchWindowEvaluations,
  fetchHorizonsTransferEstimate,
  getHorizonsMajorBodyId,
} from "./src/lib/horizons.ts";
import { fetchNoaaSpaceWeather, fetchNoaaSurfaceWeather } from "./src/lib/noaa.ts";
import { fetchOpenMeteoWeather } from "./src/lib/openMeteo.ts";
import { getLatestRadiationSnapshot, getRadiationSnapshotHistory, ingestLiveRadiationSnapshot } from "./src/lib/radiationIngest.ts";
import { assessTrajectoryRadiationIntersections } from "./src/lib/radiationIntersection.ts";
import { buildNearEarthRadiationEnvironment } from "./src/lib/radiationModel.ts";
import { fetchSolarBodies, fetchSolarBody, fetchSolarSkyPositions, mergeCelestialFallback } from "./src/lib/solarSystem.ts";
import { fetchGoesRadiationSummary } from "./src/lib/swpcGoes.ts";
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

  app.get("/api/ephemeris", async (req, res) => {
    const bodyId = String(req.query.body || 'mars').toLowerCase();
    const centerBodyId = String(req.query.centerBody || 'earth').toLowerCase();
    const date = String(req.query.date || new Date().toISOString().slice(0, 10));
    try {
      const rows = await fetchHorizonsVectors({
        COMMAND: `'${getHorizonsMajorBodyId(bodyId)}'`,
        CENTER: `'500@${getHorizonsMajorBodyId(centerBodyId)}'`,
        START_TIME: `'${date}'`,
        STOP_TIME: `'${date}'`,
        STEP_SIZE: `'1 d'`,
      });
      res.json({
        bodyId,
        centerBodyId,
        row: rows[0] ?? null,
        source: 'LIVE · JPL Horizons',
      });
    } catch (error: any) {
      res.status(502).json({ error: error?.message || 'Horizons ephemeris fetch failed', source: 'UPSTREAM ERROR' });
    }
  });

  app.get("/api/ephemeris/system", async (req, res) => {
    const centerBodyId = String(req.query.centerBody || 'earth').toLowerCase();
    const date = String(req.query.date || new Date().toISOString().slice(0, 10));
    const bodyIds = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
    try {
      const results = await Promise.all(bodyIds.map(async (bodyId) => {
        const rows = await fetchHorizonsVectors({
          COMMAND: `'${getHorizonsMajorBodyId(bodyId)}'`,
          CENTER: `'500@${getHorizonsMajorBodyId(centerBodyId)}'`,
          START_TIME: `'${date}'`,
          STOP_TIME: `'${date}'`,
          STEP_SIZE: `'1 d'`,
        });
        const row = rows[0];
        return row ? {
          id: bodyId,
          x: row.x,
          y: row.y,
          z: row.z,
          jd: row.jd,
        } : null;
      }));
      res.json({
        centerBodyId,
        date,
        bodies: results.filter(Boolean),
        source: 'LIVE · JPL Horizons',
      });
    } catch (error: any) {
      res.status(502).json({ error: error?.message || 'Horizons system ephemeris fetch failed', source: 'UPSTREAM ERROR' });
    }
  });

  // ── Solar System OpenData ──────────────────────────────────────────────────
  app.get("/api/bodies", async (_req, res) => {
    try {
      const bodies = await fetchSolarBodies();
      res.json({
        bodies: mergeCelestialFallback(bodies),
        source: 'LIVE · Solar System OpenData',
      });
    } catch (error: any) {
      res.status(502).json({ error: error?.message || 'Solar System OpenData fetch failed', source: 'UPSTREAM ERROR' });
    }
  });

  app.get("/api/body/:id", async (req, res) => {
    try {
      const body = await fetchSolarBody(String(req.params.id));
      res.json({
        body,
        source: 'LIVE · Solar System OpenData',
      });
    } catch (error: any) {
      res.status(502).json({ error: error?.message || 'Solar System OpenData body fetch failed', source: 'UPSTREAM ERROR' });
    }
  });

  app.get("/api/sky-positions", async (req, res) => {
    try {
      const positions = await fetchSolarSkyPositions({
        lon: Number(req.query.lon ?? -74.006),
        lat: Number(req.query.lat ?? 40.7128),
        elev: Number(req.query.elev ?? 0),
        datetime: String(req.query.datetime || new Date().toISOString().slice(0, 19)),
        zone: Number(req.query.zone ?? 0),
      });
      res.json({
        positions,
        source: 'LIVE · Solar System OpenData /positions',
      });
    } catch (error: any) {
      res.status(502).json({ error: error?.message || 'Sky positions fetch failed', source: 'UPSTREAM ERROR' });
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

  app.get("/api/radiation/near-earth", async (req, res) => {
    try {
      const [goes, donki] = await Promise.all([
        fetchGoesRadiationSummary(),
        fetchDonkiSpaceWeatherSummary(Number(req.query.days ?? 7)),
      ]);
      const environment = buildNearEarthRadiationEnvironment(goes, donki.radiationBoost);
      res.json({
        goes,
        donki,
        environment,
        source: `${goes.source} + ${donki.source}`,
      });
    } catch (error: any) {
      res.status(502).json({ error: error?.message || 'Near-Earth radiation fetch failed', source: 'UPSTREAM ERROR' });
    }
  });

  app.get("/api/radiation/live", async (req, res) => {
    try {
      const snapshot = await ingestLiveRadiationSnapshot(Number(req.query.days ?? 7));
      res.json(snapshot);
    } catch (error: any) {
      res.status(502).json({ error: error?.message || 'Live radiation ingest failed', source: 'UPSTREAM ERROR' });
    }
  });

  app.get("/api/radiation/live/latest", (_req, res) => {
    res.json({
      snapshot: getLatestRadiationSnapshot(),
      source: 'LIVE · NOAA SWPC GOES + NASA CCMC DONKI Ingest',
    });
  });

  app.get("/api/radiation/live/history", (req, res) => {
    res.json({
      snapshots: getRadiationSnapshotHistory(Number(req.query.limit ?? 12)),
      source: 'LIVE · NOAA SWPC GOES + NASA CCMC DONKI Ingest',
    });
  });

  app.post("/api/radiation/intersections", async (req, res) => {
    try {
      const trajectory = Array.isArray(req.body?.trajectory) ? req.body.trajectory : [];
      if (!trajectory.length) {
        return res.status(400).json({ error: 'trajectory is required' });
      }

      const days = Number(req.body?.days ?? req.query.days ?? 7);
      const snapshot = getLatestRadiationSnapshot() ?? await ingestLiveRadiationSnapshot(days);
      const assessment = assessTrajectoryRadiationIntersections(trajectory, snapshot.environment);
      res.json({
        assessment,
        snapshot,
        source: `${snapshot.source} + modeled trajectory intersection scoring`,
      });
    } catch (error: any) {
      res.status(502).json({ error: error?.message || 'Radiation intersection assessment failed', source: 'UPSTREAM ERROR' });
    }
  });

  app.post("/api/ops/cislunar", async (req, res) => {
    try {
      const trajectory = Array.isArray(req.body?.trajectory) ? req.body.trajectory : [];
      const launchDate = String(req.body?.launchDate || '');
      const targetId = String(req.body?.targetId || 'moon');
      const lat = Number(req.body?.lat ?? 28.5729);
      const lon = Number(req.body?.lon ?? -80.649);
      const crewCount = Number(req.body?.crewCount ?? 4);
      const shieldingFactor = Number(req.body?.shieldingFactor ?? 0.72);
      const powerGenerationKw = Number(req.body?.powerGenerationKw ?? 6.2);
      const hotelLoadKw = Number(req.body?.hotelLoadKw ?? 4.8);

      if (!trajectory.length || !launchDate) {
        return res.status(400).json({ error: 'trajectory and launchDate are required' });
      }

      const startTime = launchDate;
      const stopTime = new Date(new Date(`${launchDate}T00:00:00Z`).getTime() + 3 * 86400000).toISOString().slice(0, 10);
      const [weather, spaceWeather, snapshot, dsnVisibility] = await Promise.all([
        fetchNoaaSurfaceWeather(lat, lon).catch(() => null),
        fetchNoaaSpaceWeather(),
        getLatestRadiationSnapshot() ?? ingestLiveRadiationSnapshot(7),
        computeDsnVisibility({
          targetId,
          startTime,
          stopTime,
          stepSize: '2 h',
          minElevationDeg: 10,
        }).catch(() => null),
      ]);

      const analysis = analyzeCrewedCislunarMissionOps({
        trajectory,
        launchDate,
        radiationEnvironment: snapshot.environment,
        spaceWeather,
        weather,
        dsnVisibility,
        shieldingFactor,
        crewCount,
        powerGenerationKw,
        hotelLoadKw,
      });

      res.json({
        analysis,
        source: analysis.provenance.join(' + '),
      });
    } catch (error: any) {
      res.status(502).json({ error: error?.message || 'Cislunar ops analysis failed', source: 'UPSTREAM ERROR' });
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

  app.post("/api/gravity/influences", async (req, res) => {
    try {
      const trajectory = Array.isArray(req.body?.trajectory) ? req.body.trajectory : [];
      const bodyPositions = Array.isArray(req.body?.bodyPositions) ? req.body.bodyPositions : [];
      const assessments = assessTrajectoryGravityInfluence(trajectory, bodyPositions);
      res.json({
        assessments,
        source: 'FORMULA · sphere-of-influence and tidal-acceleration screening',
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || 'Gravity influence analysis failed', source: 'UPSTREAM ERROR' });
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
