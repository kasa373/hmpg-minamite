export const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export function normDeg(v) {
  const x = v % 360;
  return x < 0 ? x + 360 : x;
}

export function wrapLon(v) {
  let x = ((v + 180) % 360 + 360) % 360 - 180;
  if (x === -180) x = 180;
  return x;
}

export function raDecToVec(raDeg, decDeg) {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const c = Math.cos(dec);
  return [c * Math.cos(ra), c * Math.sin(ra), Math.sin(dec)];
}

export function vecToRaDec(v) {
  const ra = Math.atan2(v[1], v[0]) * RAD;
  const dec = Math.asin(Math.max(-1, Math.min(1, v[2]))) * RAD;
  return [normDeg(ra), dec];
}

function rot3z(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, s, 0, -s, c, 0, 0, 0, 1];
}

function rot3y(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, -s, 0, 1, 0, s, 0, c];
}

function mul3(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return o;
}

export function apply3(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** Mean equator of date, from J2000. Identity at J2000. */
export function precessionMatrix(jd) {
  const T = (jd - 2451545.0) / 36525;
  const sec = Math.PI / (180 * 3600);
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T) * sec;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T) * sec;
  const theta = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T) * sec;
  return mul3(mul3(rot3z(-z), rot3y(theta)), rot3z(-zeta));
}

export function julianDate(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

export function gmstDeg(jd) {
  const T = (jd - 2451545.0) / 36525;
  const g = 280.46061837
    + 360.98564736629 * (jd - 2451545.0)
    + 0.000387933 * T * T
    - (T * T * T) / 38710000;
  return normDeg(g);
}

/** Rows are east, north, up. Multiplies an equatorial unit vector of date. */
export function horizontalMatrix(latDeg, lstDeg) {
  const lat = latDeg * DEG;
  const lst = lstDeg * DEG;
  const sinL = Math.sin(lst);
  const cosL = Math.cos(lst);
  const sinP = Math.sin(lat);
  const cosP = Math.cos(lat);
  return [
    -sinL, cosL, 0,
    -cosL * sinP, -sinL * sinP, cosP,
    cosL * cosP, sinL * cosP, sinP,
  ];
}

export function equatorialOfHorizontal(altDeg, azDeg, latDeg, lstDeg) {
  const alt = altDeg * DEG;
  const az = azDeg * DEG;
  const e = Math.cos(alt) * Math.sin(az);
  const n = Math.cos(alt) * Math.cos(az);
  const u = Math.sin(alt);
  const m = horizontalMatrix(latDeg, lstDeg);
  return vecToRaDec([
    e * m[0] + n * m[3] + u * m[6],
    e * m[1] + n * m[4] + u * m[7],
    e * m[2] + n * m[5] + u * m[8],
  ]);
}

function obliquity(jd) {
  const T = (jd - 2451545.0) / 36525;
  return (23.439291 - 0.0130042 * T) * DEG;
}

function eclipticToEquatorial(lonDeg, latDeg, jd) {
  const lon = lonDeg * DEG;
  const lat = latDeg * DEG;
  const eps = obliquity(jd);
  const cb = Math.cos(lat);
  const sb = Math.sin(lat);
  const cl = Math.cos(lon);
  const sl = Math.sin(lon);
  const ce = Math.cos(eps);
  const se = Math.sin(eps);
  const x = cb * cl;
  const y = cb * sl * ce - sb * se;
  const z = cb * sl * se + sb * ce;
  return [normDeg(Math.atan2(y, x) * RAD), Math.asin(Math.max(-1, Math.min(1, z))) * RAD];
}

export function sunEcliptic(jd) {
  const T = (jd - 2451545.0) / 36525;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const Mr = M * DEG;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mr)
    + (0.019993 - 0.000101 * T) * Math.sin(2 * Mr)
    + 0.000289 * Math.sin(3 * Mr);
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * DEG);
  return normDeg(lambda);
}

export function sunRaDec(jd) {
  return eclipticToEquatorial(sunEcliptic(jd), 0, jd);
}

const MOON_LON = [
  [6288774, 0, 0, 1, 0], [1274027, 2, 0, -1, 0], [658314, 2, 0, 0, 0],
  [213618, 0, 0, 2, 0], [-185116, 0, 1, 0, 0], [-114332, 0, 0, 0, 2],
  [58793, 2, 0, -2, 0], [57066, 2, -1, -1, 0], [53322, 2, 0, 1, 0],
  [45758, 2, -1, 0, 0], [-40923, 0, 1, -1, 0], [-34720, 1, 0, 0, 0],
  [-30383, 0, 1, 1, 0], [15327, 2, 0, 0, -2], [-12528, 0, 0, 1, 2],
  [10980, 0, 0, 1, -2], [10675, 4, 0, -1, 0], [10034, 0, 0, 3, 0],
  [8548, 4, 0, -2, 0], [-7888, 2, 1, -1, 0], [-6766, 2, 1, 0, 0],
  [-5163, 1, 0, -1, 0], [4987, 1, 1, 0, 0], [4036, 2, -1, 1, 0],
  [3994, 2, 0, 2, 0], [3861, 4, 0, 0, 0], [3665, 2, 0, -3, 0],
];

const MOON_LAT = [
  [5128122, 0, 0, 0, 1], [280602, 0, 0, 1, 1], [277693, 0, 0, 1, -1],
  [173237, 2, 0, 0, -1], [55413, 2, 0, -1, 1], [46271, 2, 0, -1, -1],
  [32573, 2, 0, 0, 1], [17198, 0, 0, 2, 1], [9266, 2, 0, 1, -1],
  [8822, 0, 0, 2, -1],
];

function moonSeries(table, D, M, Mp, F) {
  let sum = 0;
  for (let i = 0; i < table.length; i++) {
    const t = table[i];
    sum += t[0] * Math.sin((t[1] * D + t[2] * M + t[3] * Mp + t[4] * F) * DEG);
  }
  return sum / 1000000;
}

export function moonEcliptic(jd) {
  const T = (jd - 2451545.0) / 36525;
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T + T * T * T / 538841;
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T * T + T * T * T / 545868;
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T * T;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T * T + T * T * T / 69699;
  const F = 93.2720950 + 483202.0175233 * T - 0.0036539 * T * T;
  return [normDeg(Lp + moonSeries(MOON_LON, D, M, Mp, F)), moonSeries(MOON_LAT, D, M, Mp, F)];
}

export function moonRaDec(jd) {
  const [lon, lat] = moonEcliptic(jd);
  const eq = eclipticToEquatorial(lon, lat, jd);
  const elong = normDeg(lon - sunEcliptic(jd));
  const illum = (1 - Math.cos(elong * DEG)) / 2;
  return { ra: eq[0], dec: eq[1], illum, elong };
}

const PLANETS = {
  venus: [76.6799, 2.46590e-5, 3.3946, 2.75e-8, 54.8910, 1.38374e-5, 0.723330, 0, 0.006773, -1.302e-9, 48.0052, 1.6021302244],
  mars: [49.5574, 2.11081e-5, 1.8497, -1.78e-8, 286.5016, 2.92961e-5, 1.523688, 0, 0.093405, 2.516e-9, 18.6021, 0.5240207766],
  jupiter: [100.4542, 2.76854e-5, 1.3030, -1.557e-7, 273.8777, 1.64505e-5, 5.20256, 0, 0.048498, 4.469e-9, 19.8950, 0.0830853001],
  saturn: [113.6634, 2.38980e-5, 2.4886, -1.081e-7, 339.3939, 2.97661e-5, 9.55475, 0, 0.055546, -9.499e-9, 316.9670, 0.0334442282],
};

function keplerHelio(el, d) {
  const N = (el[0] + el[1] * d) * DEG;
  const i = (el[2] + el[3] * d) * DEG;
  const w = (el[4] + el[5] * d) * DEG;
  const a = el[6] + el[7] * d;
  const e = el[8] + el[9] * d;
  let M = normDeg(el[10] + el[11] * d) * DEG;
  let E = M;
  for (let k = 0; k < 8; k++) E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xv = a * (Math.cos(E) - e);
  const yv = a * (Math.sqrt(1 - e * e) * Math.sin(E));
  const v = Math.atan2(yv, xv);
  const r = Math.hypot(xv, yv);
  const vw = v + w;
  return [
    r * (Math.cos(N) * Math.cos(vw) - Math.sin(N) * Math.sin(vw) * Math.cos(i)),
    r * (Math.sin(N) * Math.cos(vw) + Math.cos(N) * Math.sin(vw) * Math.cos(i)),
    r * (Math.sin(vw) * Math.sin(i)),
  ];
}

function earthHelio(d) {
  const w = (282.9404 + 4.70935e-5 * d) * DEG;
  const e = 0.016709 - 1.151e-9 * d;
  const a = 1;
  let M = normDeg(356.0470 + 0.9856002585 * d) * DEG;
  let E = M;
  for (let k = 0; k < 8; k++) E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xv = a * (Math.cos(E) - e);
  const yv = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const v = Math.atan2(yv, xv);
  const r = Math.hypot(xv, yv);
  // v+w は太陽の地心黄経。太陽から見た地球はその正反対。
  return [-r * Math.cos(v + w), -r * Math.sin(v + w), 0];
}

export function planetRaDec(name, jd) {
  const d = jd - 2451543.5;
  const p = keplerHelio(PLANETS[name], d);
  const e = earthHelio(d);
  const x = p[0] - e[0];
  const y = p[1] - e[1];
  const z = p[2] - e[2];
  const lon = normDeg(Math.atan2(y, x) * RAD);
  const lat = Math.atan2(z, Math.hypot(x, y)) * RAD;
  const eq = eclipticToEquatorial(lon, lat, jd);
  return { ra: eq[0], dec: eq[1] };
}

export function greatCircle(lat1, lon1, bearingDeg, deltaDeg) {
  const φ1 = lat1 * DEG;
  const λ1 = lon1 * DEG;
  const θ = bearingDeg * DEG;
  const δ = deltaDeg * DEG;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(
    Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
    Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
  );
  return { lat: φ2 * RAD, lon: wrapLon(λ2 * RAD) };
}

/** tilt 0 keeps latitude. Positive tilt leans south.
 *  West follows that same circle in the opposite direction. */
export function routePoint(lat, lon, tiltDeg, west, fraction) {
  const sign = west ? -1 : 1;
  const f = fraction - Math.floor(fraction);
  if (Math.abs(tiltDeg) < 0.8) {
    return { lat, lon: wrapLon(lon + sign * f * 360) };
  }
  const bearing = 90 + tiltDeg + (west ? 180 : 0);
  return greatCircle(lat, lon, bearing, f * 360);
}

export function jstInputToDate(value) {
  const [day, time] = value.split('T');
  const [Y, M, D] = day.split('-').map(Number);
  const [h, m] = time.split(':').map(Number);
  return new Date(Date.UTC(Y, M - 1, D, h - 9, m || 0, 0));
}

export function formatJst(date) {
  const t = new Date(date.getTime() + 9 * 3600000);
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}/${t.getUTCMonth() + 1}/${t.getUTCDate()} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

export function formatSolar(utcDate, lon) {
  const t = new Date(utcDate.getTime() + (lon / 15) * 3600000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

export function formatLatLon(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(1)}°${ns} ${Math.abs(lon).toFixed(1)}°${ew}`;
}

export function bvColor(bv) {
  const t = Math.max(-0.4, Math.min(2.0, bv));
  if (t < 0.0) return [170, 198, 255];
  if (t < 0.4) return [214, 228, 255];
  if (t < 0.8) return [255, 248, 236];
  if (t < 1.3) return [255, 214, 170];
  return [255, 176, 120];
}
