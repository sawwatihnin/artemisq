/**
 * Geocentric Moon position — truncated Meeus-style model (Astronomical Algorithms, Ch. 47).
 * Typical error: hundreds of km; suitable for mission visualization, not navigation.
 */

const D2R = Math.PI / 180;

function julianDateUt(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

/**
 * Geocentric Moon position [km] in Earth-centered equatorial frame (X toward vernal equinox, Z north).
 */
export function moonGeocentricPositionKm(date: Date): [number, number, number] {
  const JD = julianDateUt(date);
  const T = (JD - 2451545.0) / 36525;
  const T2 = T * T;
  const T3 = T2 * T;

  const Lp =
    (218.3164477 +
      481267.88123421 * T -
      0.0015786 * T2 +
      T3 / 538841 -
      (T3 * T) / 65194000) %
    360;
  const D =
    (297.8501921 +
      445267.1114034 * T -
      0.0018819 * T2 +
      T3 / 545868 -
      (T3 * T) / 113065000) %
    360;
  const M = (357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000) % 360;
  const Mp =
    (134.9633964 +
      477198.8675055 * T +
      0.0087414 * T2 +
      T3 / 69699 -
      (T3 * T) / 14712000) %
    360;
  const F =
    (93.272095 +
      483202.0175233 * T -
      0.0036539 * T2 -
      T3 / 3526000 +
      (T3 * T) / 863310000) %
    360;

  const LpR = Lp * D2R;
  const DR = D * D2R;
  const MR = M * D2R;
  const MpR = Mp * D2R;
  const FR = F * D2R;

  const lambda =
    LpR +
    D2R *
      (6.288774 * Math.sin(MpR) +
        1.274027 * Math.sin(2 * DR - MpR) +
        0.658314 * Math.sin(2 * DR) +
        0.213618 * Math.sin(2 * MpR) -
        0.185116 * Math.sin(MR) -
        0.114332 * Math.sin(2 * FR) +
        0.058793 * Math.sin(2 * DR - 2 * MpR));

  const beta =
    D2R *
    (5.128122 * Math.sin(FR) +
      0.280606 * Math.sin(MpR + FR) +
      0.277693 * Math.sin(MpR - FR) +
      0.173238 * Math.sin(2 * DR - FR) +
      0.055413 * Math.sin(2 * DR + FR - MpR) +
      0.046272 * Math.sin(2 * DR - MpR - FR) +
      0.032573 * Math.sin(2 * DR + FR));

  const eps = (23.439291 - 0.0130042 * T - 0.00000016 * T2 + 0.000000504 * T3) * D2R;

  const cl = Math.cos(lambda);
  const sl = Math.sin(lambda);
  const cb = Math.cos(beta);
  const sb = Math.sin(beta);

  const xEcl = cb * cl;
  const yEcl = cb * sl;
  const zEcl = sb;

  const xEq = xEcl;
  const yEq = yEcl * Math.cos(eps) - zEcl * Math.sin(eps);
  const zEq = yEcl * Math.sin(eps) + zEcl * Math.cos(eps);

  const rKm =
    385000.56 +
    20905.355 * Math.cos(MpR) -
    3699.11 * Math.cos(2 * DR - MpR) -
    2955.68 * Math.cos(2 * DR) +
    569.925 * Math.cos(2 * MpR);

  const mag = Math.hypot(xEq, yEq, zEq);
  const s = rKm / mag;
  return [xEq * s, yEq * s, zEq * s];
}

export function normalize3(v: [number, number, number]): [number, number, number] {
  const m = Math.hypot(v[0], v[1], v[2]);
  if (m < 1e-12) return [1, 0, 0];
  return [v[0] / m, v[1] / m, v[2] / m];
}

export function scale3(v: [number, number, number], s: number): [number, number, number] {
  return [v[0] * s, v[1] * s, v[2] * s];
}

/** Spherical interpolation between unit direction vectors. */
export function slerpUnitVectors(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  const ax = a[0];
  const ay = a[1];
  const az = a[2];
  const bx = b[0];
  const by = b[1];
  const bz = b[2];
  let dot = ax * bx + ay * by + az * bz;
  dot = Math.max(-1, Math.min(1, dot));
  const omega = Math.acos(dot);
  if (omega < 1e-8) {
    const u = 1 - t;
    return normalize3([ax * u + bx * t, ay * u + by * t, az * u + bz * t]);
  }
  const so = Math.sin(omega);
  const s0 = Math.sin((1 - t) * omega) / so;
  const s1 = Math.sin(t * omega) / so;
  return normalize3([ax * s0 + bx * s1, ay * s0 + by * s1, az * s0 + bz * s1]);
}
