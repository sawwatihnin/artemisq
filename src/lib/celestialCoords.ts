/**
 * Astronomical coordinate utilities for ARTEMIS-Q.
 *
 * All conversions follow Meeus, "Astronomical Algorithms" 2nd ed., and the
 * IAU 1976/J2000 conventions used by SPICE and JPL Horizons. All inputs are
 * UTC dates; UT1−UTC ≈ 0 is assumed (≤1 s error, well within visualizer
 * accuracy). Equatorial RA/Dec are referenced to the J2000 mean equator and
 * equinox; for visualizer-time positions (within decades of J2000) the drift
 * from the true equator is below the visual resolution of the panel.
 *
 * Earth shape uses WGS-84 (a = 6378.137 km, f = 1/298.257223563) so that
 * sub-vehicle latitude/longitude reproductions match GPS / NORAD outputs.
 */

const EARTH_EQUATORIAL_RADIUS_KM = 6378.137;
const EARTH_FLATTENING = 1 / 298.257223563;
const EARTH_E2 = EARTH_FLATTENING * (2 - EARTH_FLATTENING); // first eccentricity squared
const J2000_JD = 2451545.0;
const SECONDS_PER_DAY = 86400;

/** Julian Day number from a JS Date (UTC). Meeus eq. 7.1 (Gregorian). */
export function julianDayUT(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

/** Centuries from J2000.0 in UT (used for sidereal-time computations). */
export function centuriesFromJ2000UT(date: Date): number {
  return (julianDayUT(date) - J2000_JD) / 36525;
}

/**
 * Greenwich Mean Sidereal Time in radians, 0..2π. Meeus eq. 12.4 (IAU 1982),
 * accurate to ~0.1 s/century — well within visualizer resolution.
 */
export function gmstRad(date: Date): number {
  const jd = julianDayUT(date);
  const T = (jd - J2000_JD) / 36525;
  const gmstSec = 67310.54841
    + (876600 * 3600 + 8640184.812866) * T
    + 0.093104 * T * T
    - 6.2e-6 * T * T * T;
  const gmstHours = ((gmstSec / 3600) % 24 + 24) % 24;
  return (gmstHours * 15 * Math.PI) / 180;
}

/** Earth-Centered Inertial (ECI, J2000 equatorial) → Right Ascension (h), Declination (deg). */
export function eciToRaDec(x: number, y: number, z: number): { raHours: number; decDeg: number; rangeKm: number } {
  const r = Math.hypot(x, y, z);
  if (r === 0) return { raHours: 0, decDeg: 0, rangeKm: 0 };
  let raRad = Math.atan2(y, x);
  if (raRad < 0) raRad += 2 * Math.PI;
  const decRad = Math.asin(Math.max(-1, Math.min(1, z / r)));
  return {
    raHours: (raRad * 180) / Math.PI / 15,
    decDeg: (decRad * 180) / Math.PI,
    rangeKm: r,
  };
}

/** Format RA in HMS — e.g. 14ʰ 32ᵐ 18.4ˢ. */
export function formatRaHMS(raHours: number): string {
  const total = ((raHours % 24) + 24) % 24;
  const h = Math.floor(total);
  const mFloat = (total - h) * 60;
  const m = Math.floor(mFloat);
  const s = (mFloat - m) * 60;
  return `${h.toString().padStart(2, '0')}ʰ ${m.toString().padStart(2, '0')}ᵐ ${s.toFixed(1)}ˢ`;
}

/** Format Declination in DMS with sign — e.g. +28° 17′ 04″. */
export function formatDecDMS(decDeg: number): string {
  const sign = decDeg >= 0 ? '+' : '−';
  const abs = Math.abs(decDeg);
  const d = Math.floor(abs);
  const mFloat = (abs - d) * 60;
  const m = Math.floor(mFloat);
  const s = (mFloat - m) * 60;
  return `${sign}${d.toString().padStart(2, '0')}° ${m.toString().padStart(2, '0')}′ ${s.toFixed(1)}″`;
}

/** Rotate ECI (J2000 equatorial) about Z by GMST → ECEF (Earth-Centered Earth-Fixed). */
export function eciToEcefKm(x: number, y: number, z: number, date: Date): [number, number, number] {
  const theta = gmstRad(date);
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [c * x + s * y, -s * x + c * y, z];
}

/**
 * ECEF → geodetic latitude/longitude/altitude on the WGS-84 ellipsoid.
 * Iterative Bowring solution; converges in ≤4 iterations for any altitude.
 */
export function ecefToGeodetic(x: number, y: number, z: number): { latDeg: number; lonDeg: number; altKm: number } {
  const a = EARTH_EQUATORIAL_RADIUS_KM;
  const e2 = EARTH_E2;
  const lonRad = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  // Pole guard: when p ≈ 0 the iterative latitude equation degenerates;
  // return the closed-form polar solution directly.
  if (p < 1e-9) {
    const polarLatRad = z >= 0 ? Math.PI / 2 : -Math.PI / 2;
    const N = a / Math.sqrt(1 - e2);
    return { latDeg: (polarLatRad * 180) / Math.PI, lonDeg: 0, altKm: Math.abs(z) - N * (1 - e2) };
  }
  let latRad = Math.atan2(z, p * (1 - e2));
  let altKm = 0;
  for (let i = 0; i < 6; i++) {
    const sinLat = Math.sin(latRad);
    const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
    altKm = p / Math.cos(latRad) - N;
    const newLat = Math.atan2(z, p * (1 - e2 * N / (N + altKm)));
    if (Math.abs(newLat - latRad) < 1e-10) {
      latRad = newLat;
      break;
    }
    latRad = newLat;
  }
  let lonDeg = (lonRad * 180) / Math.PI;
  if (lonDeg > 180) lonDeg -= 360;
  if (lonDeg < -180) lonDeg += 360;
  return { latDeg: (latRad * 180) / Math.PI, lonDeg, altKm };
}

/** ECI (J2000 equatorial) → geodetic latitude/longitude/altitude on WGS-84 (sub-vehicle point). */
export function eciToGeodetic(x: number, y: number, z: number, date: Date): { latDeg: number; lonDeg: number; altKm: number } {
  const [ex, ey, ez] = eciToEcefKm(x, y, z, date);
  return ecefToGeodetic(ex, ey, ez);
}

/**
 * Apparent Sun direction in ECI (J2000) at the given date — unit vector.
 * Low-precision Meeus algorithm (Ch. 25), accurate to ~0.01° — used for
 * day/night terminator lighting.
 */
export function sunDirectionEci(date: Date): [number, number, number] {
  const T = centuriesFromJ2000UT(date);
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T; // mean longitude (deg)
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T; // mean anomaly (deg)
  const Mrad = (M * Math.PI) / 180;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mrad)
    + (0.019993 - 0.000101 * T) * Math.sin(2 * Mrad)
    + 0.000289 * Math.sin(3 * Mrad);
  const trueLon = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambdaApp = trueLon - 0.00569 - 0.00478 * Math.sin((omega * Math.PI) / 180);
  const epsilon0 = 23.439291 - 0.0130042 * T - 1.64e-7 * T * T + 5.04e-7 * T * T * T;
  const epsilon = epsilon0 + 0.00256 * Math.cos((omega * Math.PI) / 180);
  const lamRad = (lambdaApp * Math.PI) / 180;
  const epsRad = (epsilon * Math.PI) / 180;
  const x = Math.cos(lamRad);
  const y = Math.cos(epsRad) * Math.sin(lamRad);
  const z = Math.sin(epsRad) * Math.sin(lamRad);
  return [x, y, z];
}

/** Mean obliquity of the ecliptic (deg) at date — Earth axial tilt for rendering. */
export function obliquityOfEclipticDeg(date: Date): number {
  const T = centuriesFromJ2000UT(date);
  return 23.439291 - 0.0130042 * T - 1.64e-7 * T * T + 5.04e-7 * T * T * T;
}

/** Local Mean Solar Time (hours, 0–24) at the given longitude. */
export function localMeanSolarTimeHours(date: Date, lonDeg: number): number {
  const utcHours = date.getUTCHours()
    + date.getUTCMinutes() / 60
    + date.getUTCSeconds() / 3600;
  const lst = utcHours + lonDeg / 15;
  return ((lst % 24) + 24) % 24;
}

/**
 * Convert a visualizer-scene point back to ECI km. The cislunar scene uses
 * a direct ECI→scene scaling with no axis swap; the heliocentric scene swaps
 * the y/z axes (see {@link heliocentricHorizonsKmToScene} in `celestial.ts`).
 */
export function sceneToEciKm(
  pos: [number, number, number],
  isCislunar: boolean,
  scaleKmPerUnit: number,
): [number, number, number] {
  if (isCislunar) {
    return [pos[0] * scaleKmPerUnit, pos[1] * scaleKmPerUnit, pos[2] * scaleKmPerUnit];
  }
  // Heliocentric scene encoding: scene = [x, z, y]·s ⇒ km = [x, z, y]/s after un-swap
  return [pos[0] * scaleKmPerUnit, pos[2] * scaleKmPerUnit, pos[1] * scaleKmPerUnit];
}

/** Pretty geodetic latitude with hemisphere — e.g. 28.573° N. */
export function formatLat(latDeg: number): string {
  return `${Math.abs(latDeg).toFixed(4)}° ${latDeg >= 0 ? 'N' : 'S'}`;
}

/** Pretty geodetic longitude with hemisphere — e.g. 80.649° W. */
export function formatLon(lonDeg: number): string {
  return `${Math.abs(lonDeg).toFixed(4)}° ${lonDeg >= 0 ? 'E' : 'W'}`;
}
