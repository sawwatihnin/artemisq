import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { SimulatedAnnealer } from "./src/lib/optimizer.ts";
import { LaunchSimulator } from "./src/lib/simulator.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  app.use(express.json());

  // ── Weather ────────────────────────────────────────────────────────────────
  app.get("/api/weather", async (req, res) => {
    const lat = req.query.lat || 28.5729;  // KSC Pad 39B
    const lon = req.query.lon || -80.6490;
    const apiKey = process.env.OPENWEATHER_API_KEY;

    if (!apiKey) {
      return res.status(503).json({
        error: "OPENWEATHER_API_KEY is not configured",
        source: "UNAVAILABLE"
      });
    }
    try {
      const r = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`);
      if (!r.ok) {
        return res.status(502).json({
          error: `OpenWeatherMap HTTP ${r.status}`,
          source: "UPSTREAM ERROR",
        });
      }
      const d: any = await r.json();
      const cod = d.cod;
      if (cod !== undefined && Number(cod) !== 200) {
        return res.status(502).json({
          error: typeof d.message === "string" ? d.message : "Weather API error",
          source: "UPSTREAM ERROR",
        });
      }
      if (!d.main || typeof d.main.temp !== "number") {
        return res.status(502).json({ error: "Invalid weather payload", source: "UPSTREAM ERROR" });
      }
      res.json({
        temp: d.main.temp,
        wind_speed: (d.wind?.speed ?? 0) * 3.6,
        precipitation: d.rain?.['1h'] || 0,
        pressure: d.main.pressure / 10,
        humidity: d.main.humidity,
        source: "LIVE · OpenWeatherMap"
      });
    } catch {
      res.status(502).json({ error: "Weather fetch failed", source: "UPSTREAM ERROR" });
    }
  });

  // ── Space Weather (NASA DONKI) ──────────────────────────────────────────────
  app.get("/api/space-weather", async (req, res) => {
    const apiKey = process.env.NASA_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: "NASA_API_KEY is not configured", source: "UNAVAILABLE" });
    }
    try {
      const now = new Date();
      const start = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];
      const r = await fetch(`https://api.nasa.gov/DONKI/CME?startDate=${start}&api_key=${apiKey}`);
      if (!r.ok) {
        return res.status(502).json({
          error: `NASA DONKI HTTP ${r.status}`,
          source: "UPSTREAM ERROR",
        });
      }
      const cmes: unknown = await r.json();
      if (!Array.isArray(cmes)) {
        return res.status(502).json({
          error: "Unexpected NASA DONKI response",
          source: "UPSTREAM ERROR",
        });
      }
      const radiationIndex = 1.0 + cmes.length * 0.15;
      res.json({ radiationIndex, eventCount: cmes.length, source: "LIVE · NASA DONKI" });
    } catch {
      res.status(502).json({ error: "NASA API error", source: "UPSTREAM ERROR" });
    }
  });

  // ── Optimize ────────────────────────────────────────────────────────────────
  app.post("/api/optimize", (req, res) => {
    const {
      nodes, edges, weights, start, end, steps,
      date, radiationIndex, isp_s = 450, spacecraft_mass_kg = 5000,
      missionProfile,
      monteCarloRuns = 80,
      qaoa_p = 3,
    } = req.body;

    try {
      const year = date ? new Date(date).getFullYear() : new Date().getFullYear();
      const solarOffset = (year - 2019) % 11;
      const baseRadiation = 1 + Math.sin((solarOffset / 11) * Math.PI) * 0.5;
      const finalMultiplier = baseRadiation * (radiationIndex || 1.0);

      const annealer = new SimulatedAnnealer(nodes, edges, weights, isp_s, spacecraft_mass_kg);
      const result = annealer.optimize(start, end, steps, finalMultiplier, missionProfile, monteCarloRuns, qaoa_p);
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
