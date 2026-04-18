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
  const PORT = 3000;
  app.use(express.json());

  // ── Weather ────────────────────────────────────────────────────────────────
  app.get("/api/weather", async (req, res) => {
    const lat = req.query.lat || 28.5729;  // KSC Pad 39B
    const lon = req.query.lon || -80.6490;
    const apiKey = process.env.OPENWEATHER_API_KEY;

    if (!apiKey) {
      return res.json({
        temp: 24.5, wind_speed: 12.4, precipitation: 0.1,
        pressure: 101.325, humidity: 72,
        source: "SIMULATED (No OPENWEATHER_API_KEY)"
      });
    }
    try {
      const r = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`);
      const d: any = await r.json();
      res.json({
        temp: d.main.temp,
        wind_speed: d.wind.speed * 3.6,
        precipitation: d.rain?.['1h'] || 0,
        pressure: d.main.pressure / 10,
        humidity: d.main.humidity,
        source: "LIVE · OpenWeatherMap"
      });
    } catch {
      res.status(500).json({ error: "Weather fetch failed" });
    }
  });

  // ── Space Weather (NASA DONKI) ──────────────────────────────────────────────
  app.get("/api/space-weather", async (req, res) => {
    const apiKey = process.env.NASA_API_KEY;
    if (!apiKey) {
      return res.json({ radiationIndex: 1.0, eventCount: 0, source: "SIMULATED (No NASA_API_KEY)" });
    }
    try {
      const now = new Date();
      const start = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];
      const r = await fetch(`https://api.nasa.gov/DONKI/CME?startDate=${start}&api_key=${apiKey}`);
      const cmes: any[] = await r.json();
      const radiationIndex = 1.0 + (Array.isArray(cmes) ? cmes.length * 0.15 : 0);
      res.json({ radiationIndex, eventCount: Array.isArray(cmes) ? cmes.length : 0, source: "LIVE · NASA DONKI" });
    } catch {
      res.json({ radiationIndex: 1.0, eventCount: 0, source: "NASA API ERROR" });
    }
  });

  // ── Optimize ────────────────────────────────────────────────────────────────
  app.post("/api/optimize", (req, res) => {
    const {
      nodes, edges, weights, start, end, steps,
      date, radiationIndex, isp_s = 450, spacecraft_mass_kg = 5000
    } = req.body;

    try {
      const year = date ? new Date(date).getFullYear() : new Date().getFullYear();
      const solarOffset = (year - 2019) % 11;
      const baseRadiation = 1 + Math.sin((solarOffset / 11) * Math.PI) * 0.5;
      const finalMultiplier = baseRadiation * (radiationIndex || 1.0);

      const annealer = new SimulatedAnnealer(nodes, edges, weights, isp_s, spacecraft_mass_kg);
      const result = annealer.optimize(start, end, steps, finalMultiplier);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Optimization failed" });
    }
  });

  // ── Launch Simulate ─────────────────────────────────────────────────────────
  app.post("/api/simulate", (req, res) => {
    const { mass, thrust, frontalArea, dragCoeff, fuel, wind, pressure } = req.body;
    try {
      const sim = new LaunchSimulator(mass, thrust, frontalArea, dragCoeff, fuel, wind, pressure);
      res.json(sim.simulate());
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
