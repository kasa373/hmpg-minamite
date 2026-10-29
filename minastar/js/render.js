import {
  DEG, apply3, bvColor, equatorialOfHorizontal, horizontalMatrix, precessionMatrix, raDecToVec,
} from './astro.js';

const MIN_RADIUS = 8;

// スライダー −30..+30 は、以前の −20..+30 の濃さ。−30 は旧−20、+30 は黒のまま。
function shadeHex(hex, shade) {
  const s = Math.max(-30, Math.min(30, Number(shade) || 0));
  const k = (-20 + (s + 30) * (50 / 60)) / 30;
  const n = Number.parseInt(hex.slice(1), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const out = rgb.map((c) => {
    if (k >= 0) return Math.round(c * (1 - k));
    return Math.round(c + (168 - c) * -k * 0.55);
  });
  return `rgb(${out[0]},${out[1]},${out[2]})`;
}

// 地上の低い稜線。周波数は整数にして、北（0°と360°）で高さがつながる。
function ridgeAltDeg(azDeg) {
  const a = ((azDeg % 360) + 360) % 360 * Math.PI / 180;
  const n = 0.50 * Math.sin(a * 2 + 0.4)
    + 0.34 * Math.sin(a * 5 + 1.8)
    + 0.20 * Math.sin(a * 9 + 0.6)
    + 0.12 * Math.sin(a * 17 + 2.4)
    + 0.07 * Math.sin(a * 23 + 1.1);
  const h = Math.max(0, Math.min(1, (n + 1.08) / 2.05));
  return h * h * 2.6;
}

const MARK_AZ = 175;
const LANDMARK_DRAW = {
  tower: {
    height: 5.2,
    halfW: 1.15,
    stroke: 'rgba(224, 112, 72, 0.92)',
    outline: [
      [-1.00, 0.00], [-0.62, 0.20], [-0.36, 0.38], [-0.58, 0.40], [-0.58, 0.48],
      [-0.30, 0.50], [-0.20, 0.66], [-0.36, 0.68], [-0.36, 0.76], [-0.12, 0.78],
      [-0.045, 0.90], [0.00, 1.00], [0.045, 0.90], [0.12, 0.78], [0.36, 0.76],
      [0.36, 0.68], [0.20, 0.66], [0.30, 0.50], [0.58, 0.48], [0.58, 0.40],
      [0.36, 0.38], [0.62, 0.20], [1.00, 0.00],
    ],
    holes: [[
      [-0.52, 0.00], [-0.14, 0.28], [0.14, 0.28], [0.52, 0.00],
    ]],
  },
  taipei: {
    height: 5.6,
    halfW: 0.78,
    stroke: 'rgba(120, 210, 170, 0.92)',
    outline: [
      [-1.00, 0.00], [-1.00, 0.16], [-0.78, 0.16], [-0.88, 0.28], [-0.68, 0.28],
      [-0.68, 0.40], [-0.80, 0.52], [-0.50, 0.52], [-0.50, 0.62], [-0.62, 0.74],
      [-0.32, 0.74], [-0.32, 0.82], [-0.18, 0.82], [-0.08, 0.94], [0.00, 1.00],
      [0.08, 0.94], [0.18, 0.82], [0.32, 0.82], [0.32, 0.74], [0.62, 0.74],
      [0.50, 0.62], [0.50, 0.52], [0.80, 0.52], [0.68, 0.40], [0.68, 0.28],
      [0.88, 0.28], [0.78, 0.16], [1.00, 0.16], [1.00, 0.00],
    ],
  },
};

export function decodeStars(buffer) {
  const view = new DataView(buffer);
  const n = Math.floor(buffer.byteLength / 6);
  const ra = new Float32Array(n);
  const dec = new Float32Array(n);
  const mag = new Float32Array(n);
  const bv = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    ra[i] = view.getUint16(o, true) / 65536 * 360;
    dec[i] = view.getInt16(o + 2, true) / 32767 * 90;
    mag[i] = view.getInt8(o + 4) / 10;
    bv[i] = view.getInt8(o + 5) / 20;
  }
  return { n, ra, dec, mag, bv };
}

export function indexFaint(stars) {
  const bins = 36 * 18;
  const counts = new Uint32Array(bins);
  const binOf = (i) => {
    let raBin = Math.floor(stars.ra[i] / 10);
    let decBin = Math.floor((stars.dec[i] + 90) / 10);
    if (raBin < 0) raBin = 0;
    if (raBin > 35) raBin = 35;
    if (decBin < 0) decBin = 0;
    if (decBin > 17) decBin = 17;
    return decBin * 36 + raBin;
  };
  for (let i = 0; i < stars.n; i++) counts[binOf(i)]++;
  const starts = new Uint32Array(bins);
  let sum = 0;
  for (let b = 0; b < bins; b++) {
    starts[b] = sum;
    sum += counts[b];
  }
  const indices = new Uint32Array(stars.n);
  const cursor = starts.slice();
  for (let i = 0; i < stars.n; i++) indices[cursor[binOf(i)]++] = i;
  return { counts, starts, indices };
}

function starSize(mag, viewRadius, scale) {
  const zoom = 90 / viewRadius;
  const s = (7.2 - mag) * 0.55 * Math.pow(zoom, 0.35) * scale;
  const floor = (mag > 5.5 ? 0.8 : 1.1) * scale;
  return Math.max(floor, Math.min(8 * scale, s));
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  let starCanvas = document.createElement('canvas');
  let starCtx = starCanvas.getContext('2d', { alpha: true });
  let pixels = null;
  let buf32 = null;
  let dpr = 1;
  let w = 1;
  let h = 1;
  let lastPick = null;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(1, Math.floor(window.innerWidth * dpr));
    h = Math.max(1, Math.floor(window.innerHeight * dpr));
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    starCanvas.width = w;
    starCanvas.height = h;
    starCtx = starCanvas.getContext('2d', { alpha: true });
    pixels = starCtx.createImageData(w, h);
    buf32 = new Uint32Array(pixels.data.buffer);
  }

  function plotPoint(x, y, rgb, alpha) {
    const ix = x | 0;
    const iy = y | 0;
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) return;
    const a = Math.max(0, Math.min(255, alpha * 255)) | 0;
    buf32[iy * w + ix] = (a << 24) | (rgb[2] << 16) | (rgb[1] << 8) | rgb[0];
  }

  function plot(x, y, radius, rgb, alpha) {
    const data = pixels.data;
    const a = Math.max(0, Math.min(255, alpha * 255)) | 0;
    const R = Math.max(0, Math.ceil(radius));
    const ix = x | 0;
    const iy = y | 0;
    for (let dy = -R; dy <= R; dy++) {
      const yy = iy + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -R; dx <= R; dx++) {
        const xx = ix + dx;
        if (xx < 0 || xx >= w) continue;
        const dist = Math.hypot(dx, dy);
        if (dist > radius) continue;
        const fall = radius <= 1 ? 1 : 1 - dist / (radius + 0.4);
        const pa = (a * fall) | 0;
        if (pa <= 0) continue;
        const p = (yy * w + xx) * 4;
        const keep = 255 - pa;
        data[p] = (data[p] * keep + rgb[0] * pa) / 255;
        data[p + 1] = (data[p + 1] * keep + rgb[1] * pa) / 255;
        data[p + 2] = (data[p + 2] * keep + rgb[2] * pa) / 255;
        data[p + 3] = Math.min(255, data[p + 3] + pa);
      }
    }
  }

  function draw(state) {
    const {
      jd, precess, lat, lst, magLimit, viewRadius, centerAlt, centerAz,
      stars, faint, faintIndex, showFaint, faintLimit, sky, onLand,
    } = state;
    const shade = state.shade;
    const landAlpha = Math.max(0, Math.min(1, state.landAlpha == null ? (onLand ? 1 : 0) : Number(state.landAlpha)));
    const starScale = Math.max(1, Math.min(5, Number(state.starScale) || 1));
    const ground = shadeHex(onLand ? '#16120e' : '#071018', shade);
    const cx = w / 2;
    const cy = h / 2;
    const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
    skyGrad.addColorStop(0, shadeHex('#060912', shade));
    skyGrad.addColorStop(0.58, shadeHex('#0b1222', shade));
    skyGrad.addColorStop(1, shadeHex('#162033', shade));
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, h);

    const horiz = horizontalMatrix(lat, lst);
    const northRot = (state.northRot || 0) * DEG;
    const cosN = Math.cos(northRot);
    const sinN = Math.sin(northRot);
    const altR = centerAlt * DEG;
    const azR = centerAz * DEG;
    const view = [
      Math.cos(altR) * Math.sin(azR),
      Math.cos(altR) * Math.cos(azR),
      Math.sin(altR),
    ];
    let ref = [0, 0, 1];
    if (Math.abs(view[2]) > 0.92) ref = [0, 1, 0];
    const refDot = view[0] * ref[0] + view[1] * ref[1] + view[2] * ref[2];
    let up = [
      ref[0] - view[0] * refDot,
      ref[1] - view[1] * refDot,
      ref[2] - view[2] * refDot,
    ];
    const ul = Math.hypot(up[0], up[1], up[2]) || 1;
    up = [up[0] / ul, up[1] / ul, up[2] / ul];
    const right = [
      view[1] * up[2] - view[2] * up[1],
      view[2] * up[0] - view[0] * up[2],
      view[0] * up[1] - view[1] * up[0],
    ];
    const ang = Math.max(0.15, viewRadius) * DEG;
    const focal = Math.max(w, h) / 2 / Math.tan(ang);
    const maxAng = Math.atan(Math.hypot(w, h) / 2 / focal) * 1.05;

    function projectBody(vecEq, aboveOnly) {
      const v = apply3(horiz, vecEq);
      const alt = Math.asin(Math.max(-1, Math.min(1, v[2])));
      if (aboveOnly && alt < -0.012) return null;
      const dot = v[0] * view[0] + v[1] * view[1] + v[2] * view[2];
      if (dot < 0.12) return null;
      const sx = (v[0] * right[0] + v[1] * right[1] + v[2] * right[2]) / dot;
      const sy = (v[0] * up[0] + v[1] * up[1] + v[2] * up[2]) / dot;
      const dx = sx * focal;
      const dy = sy * focal;
      const rx = dx * cosN - dy * sinN;
      const ry = dx * sinN + dy * cosN;
      const delta = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (delta > maxAng) return null;
      return {
        x: cx + rx,
        y: cy - ry,
        alt,
        delta,
        vec: v,
      };
    }

    function projectRaDec(ra, dec, ofDate) {
      const base = raDecToVec(ra, dec);
      const eq = ofDate ? base : apply3(precess, base);
      return projectBody(eq, true);
    }

    function horizontalToEq(azDeg, altDeg) {
      const altR = altDeg * DEG;
      const azR = azDeg * DEG;
      const e = Math.cos(altR) * Math.sin(azR);
      const n = Math.cos(altR) * Math.cos(azR);
      const u = Math.sin(altR);
      return [
        e * horiz[0] + n * horiz[3] + u * horiz[6],
        e * horiz[1] + n * horiz[4] + u * horiz[7],
        e * horiz[2] + n * horiz[5] + u * horiz[8],
      ];
    }

    function screenAlt(x, y) {
      const sxScr = x - cx;
      const syScr = cy - y;
      const dx = sxScr * cosN + syScr * sinN;
      const dy = -sxScr * sinN + syScr * cosN;
      const sx = dx / focal;
      const sy = dy / focal;
      const dir = [
        view[0] + right[0] * sx + up[0] * sy,
        view[1] + right[1] * sx + up[1] * sy,
        view[2] + right[2] * sx + up[2] * sy,
      ];
      const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      return Math.asin(Math.max(-1, Math.min(1, dir[2] / len)));
    }

    function toBorder(p) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      let t = 1e6;
      if (dx > 1) t = Math.min(t, (w - 1 - cx) / dx);
      else if (dx < -1) t = Math.min(t, (1 - cx) / dx);
      if (dy > 1) t = Math.min(t, (h - 1 - cy) / dy);
      else if (dy < -1) t = Math.min(t, (1 - cy) / dy);
      if (!Number.isFinite(t) || t <= 0) t = 1;
      return [cx + dx * t, cy + dy * t];
    }

    const perim = 2 * (w + h);
    function borderPos(x, y) {
      const m = 2 * dpr;
      if (y <= m) return Math.max(0, Math.min(w, x));
      if (x >= w - m) return w + Math.max(0, Math.min(h, y));
      if (y >= h - m) return w + h + (w - Math.max(0, Math.min(w, x)));
      return w + h + w + (h - Math.max(0, Math.min(h, y)));
    }
    function borderPoint(s) {
      s = ((s % perim) + perim) % perim;
      if (s <= w) return [s, 0];
      s -= w;
      if (s <= h) return [w, s];
      s -= h;
      if (s <= w) return [w - s, h];
      s -= w;
      return [0, h - s];
    }
    function borderWalk(sFrom, sTo) {
      const dist = (sTo - sFrom + perim) % perim;
      const n = Math.max(2, Math.ceil(dist / (28 * dpr)));
      const pts = [];
      for (let i = 0; i <= n; i++) pts.push(borderPoint(sFrom + (dist * i) / n));
      return pts;
    }

    const horizonSamples = [];
    for (let i = 0; i <= 180; i++) horizonSamples.push(projectBody(horizontalToEq(i * 2, 0), false));
    const horizonRuns = [];
    let horizonRun = null;
    for (let i = 0; i < horizonSamples.length - 1; i++) {
      const p = horizonSamples[i];
      if (!p) {
        if (horizonRun) {
          horizonRuns.push(horizonRun);
          horizonRun = null;
        }
        continue;
      }
      if (!horizonRun) horizonRun = [];
      horizonRun.push(p);
    }
    if (horizonRun) horizonRuns.push(horizonRun);
    if (horizonRuns.length >= 2 && horizonSamples[0] && horizonSamples[horizonSamples.length - 2]) {
      const merged = horizonRuns[horizonRuns.length - 1].concat(horizonRuns[0]);
      horizonRuns.shift();
      horizonRuns.pop();
      horizonRuns.unshift(merged);
    }
    const horizonClosed = horizonSamples.slice(0, -1).every(Boolean);

    function strokeHorizon() {
      if (!horizonRuns.length) return;
      ctx.beginPath();
      for (const seg of horizonRuns) {
        ctx.moveTo(seg[0].x, seg[0].y);
        for (let i = 1; i < seg.length; i++) ctx.lineTo(seg[i].x, seg[i].y);
        if (horizonClosed) ctx.closePath();
      }
      ctx.strokeStyle = 'rgba(214, 198, 160, 0.5)';
      ctx.lineWidth = Math.max(1, 1.25 * dpr);
      ctx.stroke();
    }

    ctx.fillStyle = ground;
    if (horizonClosed && horizonRuns[0]) {
      ctx.beginPath();
      if (screenAlt(cx, cy) < 0) {
        ctx.moveTo(horizonRuns[0][0].x, horizonRuns[0][0].y);
        for (const p of horizonRuns[0]) ctx.lineTo(p.x, p.y);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.rect(0, 0, w, h);
        ctx.moveTo(horizonRuns[0][0].x, horizonRuns[0][0].y);
        for (const p of horizonRuns[0]) ctx.lineTo(p.x, p.y);
        ctx.closePath();
        ctx.fill('evenodd');
      }
    } else if (!horizonRuns.length) {
      if (screenAlt(cx, cy) < 0) ctx.fillRect(0, 0, w, h);
    } else {
      for (const seg of horizonRuns) {
        if (seg.length < 2) continue;
        const endB = toBorder(seg[seg.length - 1]);
        const startB = toBorder(seg[0]);
        const s1 = borderPos(endB[0], endB[1]);
        const s0 = borderPos(startB[0], startB[1]);
        const cw = borderWalk(s1, s0);
        const ccwDist = (s1 - s0 + perim) % perim;
        const ccw = [];
        const steps = Math.max(2, Math.ceil(ccwDist / (28 * dpr)));
        for (let i = 0; i <= steps; i++) ccw.push(borderPoint(s1 - (ccwDist * i) / steps));
        const mid = seg[seg.length >> 1];
        const vx = mid.x - cx;
        const vy = mid.y - cy;
        const vl = Math.hypot(vx, vy) || 1;
        const ax = Math.max(1, Math.min(w - 2, mid.x + (vx / vl) * 18 * dpr));
        const ay = Math.max(1, Math.min(h - 2, mid.y + (vy / vl) * 18 * dpr));
        const tx = Math.max(1, Math.min(w - 2, mid.x - (vx / vl) * 18 * dpr));
        const ty = Math.max(1, Math.min(h - 2, mid.y - (vy / vl) * 18 * dpr));
        const groundPt = screenAlt(ax, ay) < screenAlt(tx, ty) ? [ax, ay] : [tx, ty];
        const build = (walk) => {
          ctx.beginPath();
          ctx.moveTo(seg[0].x, seg[0].y);
          for (const p of seg) ctx.lineTo(p.x, p.y);
          ctx.lineTo(endB[0], endB[1]);
          for (const q of walk) ctx.lineTo(q[0], q[1]);
          ctx.closePath();
        };
        build(cw);
        if (!ctx.isPointInPath(groundPt[0], groundPt[1])) {
          build(ccw);
          if (!ctx.isPointInPath(groundPt[0], groundPt[1])) build(cw);
        }
        ctx.fill();
      }
    }

    buf32.fill(0);

    const drawStar = (ra, dec, mag, bv, faintPixel) => {
      if (mag > magLimit && !faintPixel) return;
      const p = projectRaDec(ra, dec, false);
      if (!p || p.delta > maxAng) return;
      const fade = p.alt < 12 * DEG ? Math.max(0.15, p.alt / (12 * DEG)) : 1;
      if (faintPixel || mag >= 3.2) {
        const a = faintPixel ? (0.4 + (11 - mag) * 0.1) * fade : (0.45 + fade * 0.55);
        const rgb = faintPixel ? [206, 214, 228] : bvColor(bv);
        if (starScale <= 1.001) {
          plotPoint(p.x, p.y, rgb, a);
          if (!faintPixel && mag < 5.2) plotPoint(p.x + 1, p.y, rgb, a * 0.7);
          return;
        }
        const radius = (faintPixel ? 0.55 : (mag < 5.2 ? 1.15 : 0.7)) * starScale;
        plot(p.x, p.y, radius, rgb, a);
        return;
      }
      plot(p.x, p.y, starSize(mag, viewRadius, starScale), bvColor(bv), 0.55 + fade * 0.45);
    };

    let faintBox = null;
    if (showFaint && faint && faintIndex) {
      const centerEq = equatorialOfHorizontal(centerAlt, centerAz, lat, lst);
      const spanDeg = maxAng * 180 / Math.PI;
      const dec0 = centerEq[1] - spanDeg - 4;
      const dec1 = centerEq[1] + spanDeg + 4;
      const cosDec = Math.max(0.15, Math.cos(centerEq[1] * DEG));
      const raSpan = spanDeg / cosDec + 4;
      const ra0 = centerEq[0] - raSpan;
      const ra1 = centerEq[0] + raSpan;
      const seenBin = new Uint8Array(648);
      const decBin0 = Math.max(0, Math.floor((dec0 + 90) / 10));
      const decBin1 = Math.min(17, Math.floor((dec1 + 90) / 10));
      const visit = (b) => {
        if (seenBin[b]) return;
        seenBin[b] = 1;
        const start = faintIndex.starts[b];
        const end = start + faintIndex.counts[b];
        for (let k = start; k < end; k++) {
          const i = faintIndex.indices[k];
          if (faint.mag[i] > faintLimit) continue;
          drawStar(faint.ra[i], faint.dec[i], faint.mag[i], 0.3, true);
        }
      };
      for (let db = decBin0; db <= decBin1; db++) {
        if (raSpan >= 180 || dec0 < -70 || dec1 > 70) {
          for (let rb = 0; rb < 36; rb++) visit(db * 36 + rb);
        } else {
          for (let ra = ra0; ra <= ra1; ra += 10) {
            let rb = Math.floor(normRa(ra) / 10);
            if (rb < 0) rb = 0;
            if (rb > 35) rb = 35;
            visit(db * 36 + rb);
          }
        }
      }
      faintBox = { dec0, dec1, ra0, ra1, raSpan, decBin0, decBin1 };
    }

    for (let i = 0; i < stars.n; i++) {
      if (stars.mag[i] > magLimit) continue;
      drawStar(stars.ra[i], stars.dec[i], stars.mag[i], stars.bv[i], false);
    }

    starCtx.putImageData(pixels, 0, 0);
    ctx.drawImage(starCanvas, 0, 0);
    strokeHorizon();

    const bodies = [];
    const bodyHits = [];
    const sunVec = raDecToVec(state.sun.ra, state.sun.dec);
    const sunP = projectBody(sunVec, false);
    if (sunP && sunP.alt > -0.02 && sunP.delta < maxAng) {
      const g = ctx.createRadialGradient(sunP.x, sunP.y, 0, sunP.x, sunP.y, 46 * dpr);
      g.addColorStop(0, 'rgba(255, 220, 140, 0.55)');
      g.addColorStop(0.35, 'rgba(255, 170, 70, 0.18)');
      g.addColorStop(1, 'rgba(255, 140, 40, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sunP.x, sunP.y, 46 * dpr, 0, Math.PI * 2);
      ctx.fill();
      bodies.push({ ...sunP, kind: 'sun' });
      bodyHits.push({
        x: sunP.x, y: sunP.y, hit: 36, kind: 'sun', title: '太陽',
        ra: state.sun.ra, dec: state.sun.dec, ofDate: true,
      });
    }

    if (state.showLines !== false) {
      ctx.lineWidth = Math.max(1, dpr);
      ctx.strokeStyle = 'rgba(150, 176, 214, 0.42)';
      ctx.lineCap = 'round';
      for (const c of sky.constellations) {
        for (const seg of c.lines) {
          ctx.beginPath();
          let started = false;
          let last = null;
          for (const pt of seg) {
            const p = projectRaDec(pt[0], pt[1], false);
            if (!p) {
              started = false;
              last = null;
              continue;
            }
            if (!started || (last && Math.hypot(p.x - last.x, p.y - last.y) > Math.min(w, h) * 0.45)) {
              ctx.moveTo(p.x, p.y);
            } else ctx.lineTo(p.x, p.y);
            last = p;
            started = true;
          }
          ctx.stroke();
        }
      }
    }

    const moon = state.moon;
    const moonP = projectBody(raDecToVec(moon.ra, moon.dec), true);
    if (moonP && moonP.delta < maxAng) {
      const mr = Math.max(6 * dpr, focal * Math.tan(0.26 * DEG));
      let pa = 0;
      if (sunP) pa = Math.atan2(sunP.x - moonP.x, -(sunP.y - moonP.y));
      drawMoon(ctx, moonP.x, moonP.y, mr, pa, moon.illum);
      bodies.push({ ...moonP, kind: 'moon', label: '月' });
      bodyHits.push({
        x: moonP.x, y: moonP.y, hit: 22, kind: 'moon', title: '月',
        ra: moon.ra, dec: moon.dec, ofDate: true, illum: moon.illum,
      });
    }

    const planetStyle = {
      venus: ['金星', '#ffe7bf'],
      mars: ['火星', '#ff6d45'],
      jupiter: ['木星', '#ffd0a6'],
      saturn: ['土星', '#f2e2bc'],
    };
    for (const key of Object.keys(planetStyle)) {
      const body = state.planets[key];
      const p = projectBody(raDecToVec(body.ra, body.dec), true);
      if (!p || p.delta > maxAng) continue;
      const pr = Math.max(3.2 * dpr, (7.4 - (key === 'venus' ? -2 : 0)) * 0.4 * dpr);
      ctx.beginPath();
      ctx.fillStyle = planetStyle[key][1];
      ctx.arc(p.x, p.y, key === 'venus' ? pr * 1.35 : pr, 0, Math.PI * 2);
      ctx.fill();
      bodies.push({ ...p, kind: key, label: planetStyle[key][0] });
      bodyHits.push({
        x: p.x, y: p.y, hit: 20, kind: 'planet', title: planetStyle[key][0],
        ra: body.ra, dec: body.dec, ofDate: true,
      });
    }

    if (sunP && sunP.alt > -0.02 && sunP.delta < maxAng) {
      const sr = Math.max(7 * dpr, focal * Math.tan(0.85 * DEG));
      const core = ctx.createRadialGradient(sunP.x, sunP.y, 0, sunP.x, sunP.y, sr);
      core.addColorStop(0, '#fffaf0');
      core.addColorStop(0.45, '#ffd56a');
      core.addColorStop(1, 'rgba(255, 170, 50, 0.15)');
      ctx.beginPath();
      ctx.fillStyle = core;
      ctx.arc(sunP.x, sunP.y, sr, 0, Math.PI * 2);
      ctx.fill();
      bodies.push({ ...sunP, kind: 'sun-label', label: '太陽' });
    }

    ctx.font = `${Math.round(13 * dpr)}px "Yu Gothic UI", "Hiragino Sans", sans-serif`;
    ctx.fillStyle = 'rgba(214, 224, 240, 0.88)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const nameRank = viewRadius > 72 ? 1 : viewRadius > 34 ? 2 : 3;
    if (state.showNames !== false) {
      for (const c of sky.constellations) {
        if (c.rank > nameRank) continue;
        const p = projectRaDec(c.label[0], c.label[1], false);
        if (!p || p.delta > maxAng * 0.92) continue;
        ctx.fillText(c.name, p.x, p.y);
      }
    }
    ctx.font = `${Math.round(12 * dpr)}px "Yu Gothic UI", "Hiragino Sans", sans-serif`;
    ctx.fillStyle = 'rgba(255, 236, 200, 0.92)';
    ctx.textAlign = 'left';
    for (const s of sky.stars) {
      if (s.mag > 1.7 && viewRadius > 40) continue;
      const p = projectRaDec(s.ra, s.dec, false);
      if (!p || p.delta > maxAng) continue;
      ctx.fillText(s.name, p.x + 8 * dpr, p.y - 8 * dpr);
    }
    ctx.font = `${Math.round(13 * dpr)}px "Yu Gothic UI", "Hiragino Sans", sans-serif`;
    ctx.fillStyle = 'rgba(255, 228, 180, 0.95)';
    for (const b of bodies) {
      if (!b.label) continue;
      ctx.fillText(b.label, b.x + 10 * dpr, b.y + 4 * dpr);
    }

    if (state.selected) {
      const p = projectRaDec(state.selected.ra, state.selected.dec, !!state.selected.ofDate);
      if (p && p.delta < maxAng) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 12 * dpr, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(230, 201, 138, 0.95)';
        ctx.lineWidth = Math.max(1, 1.4 * dpr);
        ctx.stroke();
      }
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    if (state.showAltitude !== false) {
      ctx.save();
      ctx.lineWidth = Math.max(1, dpr * 0.9);
      ctx.strokeStyle = state.playing ? 'rgba(176, 198, 224, 0.12)' : 'rgba(176, 198, 224, 0.42)';
      ctx.fillStyle = state.playing ? 'rgba(214, 226, 242, 0.26)' : 'rgba(214, 226, 242, 0.92)';
      ctx.font = `${Math.round(12 * dpr)}px "Yu Gothic UI", "Hiragino Sans", sans-serif`;
      ctx.textBaseline = 'middle';
      const placeLabel = (text, pt) => {
        if (!pt || pt.y > h - 14 * dpr) return;
        const gap = 6 * dpr;
        const width = ctx.measureText(text).width;
        const y = pt.y < 16 * dpr ? pt.y + 4 * dpr : pt.y;
        ctx.textBaseline = pt.y < 16 * dpr ? 'top' : 'middle';
        if (pt.x + gap + width <= w - 4 * dpr) {
          ctx.textAlign = 'left';
          ctx.fillText(text, pt.x + gap, y);
        } else {
          ctx.textAlign = 'right';
          ctx.fillText(text, Math.max(width + 4 * dpr, pt.x - gap), y);
        }
      };
      const placeTopLabel = (text, pt) => {
        if (!pt || pt.x < w / 2 || pt.x > w - 28 * dpr) return;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(text, pt.x, pt.y + 4 * dpr);
      };
      for (let alt = 15; alt <= 75; alt += 15) {
        const pts = [];
        const flush = () => {
          if (pts.length >= 2) {
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.stroke();
          }
          pts.length = 0;
        };
        for (let az = 0; az <= 360; az += 3) {
          const p = projectBody(horizontalToEq(az % 360, alt), true);
          if (!p) {
            flush();
            continue;
          }
          pts.push(p);
        }
        flush();
      }
      const edgeX = w - 2;
      let prevAlt = null;
      let prevY = 0;
      const stepY = Math.max(1, Math.round(dpr));
      for (let y = 0; y <= h; y += stepY) {
        const altDeg = screenAlt(edgeX, y) * 180 / Math.PI;
        if (prevAlt != null && Number.isFinite(prevAlt) && Number.isFinite(altDeg)) {
          const lo = Math.min(prevAlt, altDeg);
          const hi = Math.max(prevAlt, altDeg);
          if (hi - lo < 30) {
            for (let mark = 0; mark <= 90; mark += 15) {
              if (lo < mark && hi >= mark) {
                const t = (mark - prevAlt) / (altDeg - prevAlt);
                placeLabel(`${mark}°`, { x: edgeX, y: prevY + (y - prevY) * t });
              }
            }
          }
        }
        prevAlt = altDeg;
        prevY = y;
      }
      const edgeY = 2;
      let prevTopAlt = null;
      let prevX = w / 2;
      const stepX = Math.max(1, Math.round(dpr));
      for (let x = w / 2; x <= w; x += stepX) {
        const altDeg = screenAlt(x, edgeY) * 180 / Math.PI;
        if (prevTopAlt != null && Number.isFinite(prevTopAlt) && Number.isFinite(altDeg)) {
          const lo = Math.min(prevTopAlt, altDeg);
          const hi = Math.max(prevTopAlt, altDeg);
          if (hi - lo < 30) {
            for (let mark = 0; mark <= 90; mark += 15) {
              if (lo < mark && hi >= mark) {
                const t = (mark - prevTopAlt) / (altDeg - prevTopAlt);
                placeTopLabel(`${mark}°`, { x: prevX + (x - prevX) * t, y: edgeY });
              }
            }
          }
        }
        prevTopAlt = altDeg;
        prevX = x;
      }
      ctx.restore();
    }
    if (landAlpha > 0.02) {
      const nSeg = 360;
      const parts = [];
      let part = null;
      for (let i = 0; i <= nSeg; i++) {
        const az = (i / nSeg) * 360;
        const base = projectBody(horizontalToEq(az % 360, 0), false);
        const top = projectBody(horizontalToEq(az % 360, ridgeAltDeg(az)), false);
        if (!base || !top) {
          if (part && part.length > 1) parts.push(part);
          part = null;
          continue;
        }
        if (!part) part = [];
        part.push({ base, top });
      }
      if (part && part.length > 1) parts.push(part);
      if (parts.length >= 2) {
        const head = parts[0][0];
        const tail = parts[parts.length - 1];
        const end = tail[tail.length - 1];
        if (Math.hypot(head.top.x - end.top.x, head.top.y - end.top.y) < 2 * dpr) {
          parts.unshift(parts.pop().concat(parts.shift()));
        }
      }
      ctx.save();
      ctx.globalAlpha = landAlpha;
      ctx.fillStyle = shadeHex('#16120e', shade);
      ctx.strokeStyle = 'rgba(214, 198, 160, 0.55)';
      ctx.lineWidth = Math.max(1, 1.25 * dpr);
      ctx.lineJoin = 'round';
      for (const seg of parts) {
        ctx.beginPath();
        ctx.moveTo(seg[0].base.x, seg[0].base.y);
        for (let i = 1; i < seg.length; i++) ctx.lineTo(seg[i].base.x, seg[i].base.y);
        for (let i = seg.length - 1; i >= 0; i--) ctx.lineTo(seg[i].top.x, seg[i].top.y);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(seg[0].top.x, seg[0].top.y);
        for (let i = 1; i < seg.length; i++) ctx.lineTo(seg[i].top.x, seg[i].top.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    const mark = LANDMARK_DRAW[state.landmark];
    if (mark) {
      const foot = landAlpha > 0.02 ? ridgeAltDeg(MARK_AZ) : 0;
      const at = (nx, ny) => projectBody(
        horizontalToEq(MARK_AZ + nx * mark.halfW, foot + ny * mark.height),
        false,
      );
      const trace = (pts) => {
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
      };
      const paint = (shape) => {
        const outline = shape.outline.map(([nx, ny]) => at(nx, ny));
        const holes = (shape.holes || []).map((hole) => hole.map(([nx, ny]) => at(nx, ny)));
        if (!outline.every(Boolean) || !holes.every((hole) => hole.every(Boolean))) return;
        if (!shape.stroke) return;
        ctx.beginPath();
        trace(outline);
        for (const hole of holes) trace(hole);
        ctx.strokeStyle = shape.stroke;
        ctx.lineWidth = Math.max(1, 1.15 * dpr);
        ctx.lineJoin = 'round';
        ctx.stroke();
      };
      for (const shape of mark.layers || [mark]) paint(shape);
      if (mark.clock) {
          const [cxn, cyn, rn] = mark.clock;
          const c = at(cxn, cyn);
          const e = at(cxn + rn, cyn);
          if (c && e) {
            ctx.beginPath();
            ctx.arc(c.x, c.y, Math.hypot(e.x - c.x, e.y - c.y), 0, Math.PI * 2);
            ctx.stroke();
          }
      }
    }

    const compass = [
      ['北', 0], ['北東', 45], ['東', 90], ['南東', 135],
      ['南', 180], ['南西', 225], ['西', 270], ['北西', 315],
    ];
    for (const [label, maz] of compass) {
      const skyline = landAlpha > 0.02 ? ridgeAltDeg(maz) : 0;
      const base = projectBody(horizontalToEq(maz, skyline), false);
      const raised = projectBody(horizontalToEq(maz, skyline + 2.2), true);
      if (!base || !raised) continue;
      if (base.x < 18 * dpr || base.x > w - 18 * dpr || base.y < 0 || base.y > h - 4 * dpr) continue;
      ctx.strokeStyle = 'rgba(232, 220, 190, 0.55)';
      ctx.lineWidth = Math.max(1, dpr);
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(raised.x, raised.y);
      ctx.stroke();
      ctx.fillStyle = state.playing ? 'rgba(154, 163, 179, 0.9)' : 'rgba(236, 224, 196, 0.9)';
      ctx.font = `${Math.round(14 * dpr)}px "Yu Gothic UI", "Hiragino Sans", sans-serif`;
      ctx.fillText(label, raised.x, raised.y - 2 * dpr);
    }

    if (state.meteors && state.meteors.length) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const m of state.meteors) {
        const u = Math.min(1, m.age / m.life);
        const fade = Math.sin(u * Math.PI);
        if (fade < 0.05) continue;
        const t0 = Math.max(0, u - m.tailFrac);
        const pts = [];
        for (let i = 0; i <= 7; i++) {
          const t = t0 + (u - t0) * (i / 7);
          const p = projectBody(horizontalToEq(m.az0 + m.dAz * t, m.alt0 + m.dAlt * t), true);
          if (!p) {
            if (pts.length) break;
            continue;
          }
          pts.push(p);
        }
        if (pts.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.strokeStyle = `rgba(186, 208, 255, ${0.35 * fade})`;
        ctx.lineWidth = Math.max(2.4, 3 * dpr);
        ctx.stroke();
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.92 * fade})`;
        ctx.lineWidth = Math.max(1, 1.25 * dpr);
        ctx.stroke();
      }
      ctx.restore();
    }

    lastPick = {
      project: projectRaDec,
      cx, cy, radius: focal, dpr,
      bodies: bodyHits,
      magLimit: state.magLimit,
      showFaint: !!(state.showFaint && state.faint && state.faintIndex),
      faintLimit: state.faintLimit || 0,
      faintBox,
    };
    return { cx, cy, radius: focal, dpr };
  }

  function pick(clientX, clientY, catalogs) {
    if (!lastPick || !catalogs) return null;
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / Math.max(1, rect.width);
    const x = (clientX - rect.left) * scale;
    const y = (clientY - rect.top) * scale;
    if (x < 0 || y < 0 || x > canvas.width || y > canvas.height) return null;

    let best = null;
    let bestDist = Infinity;
    const take = (item, dist, limit) => {
      if (dist <= limit && dist < bestDist) {
        bestDist = dist;
        best = item;
      }
    };
    for (const b of lastPick.bodies) {
      take(b, Math.hypot(b.x - x, b.y - y), b.hit * scale);
    }
    const consider = (ra, dec, mag, bv) => {
      const p = lastPick.project(ra, dec, false);
      if (!p) return;
      const css = mag < 0.5 ? 30 : mag < 2 ? 22 : mag < 4 ? 16 : 12;
      take({
        kind: 'star', title: '', ra, dec, mag, bv, ofDate: false,
      }, Math.hypot(p.x - x, p.y - y), css * scale);
    };
    const stars = catalogs.stars;
    if (stars) {
      for (let i = 0; i < stars.n; i++) {
        if (stars.mag[i] > lastPick.magLimit) continue;
        consider(stars.ra[i], stars.dec[i], stars.mag[i], stars.bv[i]);
      }
    }
    const box = lastPick.faintBox;
    const faint = catalogs.faint;
    const faintIndex = catalogs.faintIndex;
    if (lastPick.showFaint && box && faint && faintIndex) {
      const seenBin = new Uint8Array(648);
      const visit = (b) => {
        if (b < 0 || b >= 648 || seenBin[b]) return;
        seenBin[b] = 1;
        const start = faintIndex.starts[b];
        const end = start + faintIndex.counts[b];
        for (let k = start; k < end; k++) {
          const i = faintIndex.indices[k];
          if (faint.mag[i] > lastPick.faintLimit) continue;
          consider(faint.ra[i], faint.dec[i], faint.mag[i], faint.bv[i]);
        }
      };
      for (let db = box.decBin0; db <= box.decBin1; db++) {
        if (box.raSpan >= 180 || box.dec0 < -70 || box.dec1 > 70) {
          for (let rb = 0; rb < 36; rb++) visit(db * 36 + rb);
        } else {
          for (let ra = box.ra0; ra <= box.ra1; ra += 10) {
            let rb = Math.floor(normRa(ra) / 10);
            if (rb < 0) rb = 0;
            if (rb > 35) rb = 35;
            visit(db * 36 + rb);
          }
        }
      }
    }
    if (!best) return null;
    if (best.kind === 'star') decorateStar(best, catalogs.sky);
    return best;
  }

  resize();
  return { draw, resize, pick, minRadius: MIN_RADIUS };
}

function angSep(ra1, dec1, ra2, dec2) {
  const a = raDecToVec(ra1, dec1);
  const b = raDecToVec(ra2, dec2);
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

function colorName(bv) {
  if (bv < 0) return '青白い星';
  if (bv < 0.3) return '白い星';
  if (bv < 0.6) return '黄白い星';
  if (bv < 1.0) return '黄色い星';
  if (bv < 1.4) return '橙色の星';
  return '赤い星';
}

function decorateStar(star, sky) {
  let name = '';
  let nameSep = 0.25 * DEG;
  let cons = '';
  let consSep = 10 * DEG;
  if (sky) {
    for (const s of sky.stars) {
      const sep = angSep(s.ra, s.dec, star.ra, star.dec);
      if (sep < nameSep) {
        nameSep = sep;
        name = s.name;
      }
    }
    for (const c of sky.constellations) {
      for (const seg of c.lines) {
        for (const pt of seg) {
          const sep = angSep(pt[0], pt[1], star.ra, star.dec);
          if (sep < consSep) {
            consSep = sep;
            cons = c.name;
          }
        }
      }
    }
  }
  star.title = name || `${star.mag.toFixed(1)}等星`;
  star.constellation = cons;
  star.color = colorName(star.bv);
}

function normRa(ra) {
  const x = ra % 360;
  return x < 0 ? x + 360 : x;
}

function horizontalCardinal(azDeg, lat, lst) {
  const alt = 0.2 * DEG;
  const az = azDeg * DEG;
  const enu = [
    Math.cos(alt) * Math.sin(az),
    Math.cos(alt) * Math.cos(az),
    Math.sin(alt),
  ];
  const m = horizontalMatrix(lat, lst);
  return [
    enu[0] * m[0] + enu[1] * m[3] + enu[2] * m[6],
    enu[0] * m[1] + enu[1] * m[4] + enu[2] * m[7],
    enu[0] * m[2] + enu[1] * m[5] + enu[2] * m[8],
  ];
}

function drawMoon(ctx, x, y, r, pa, illum) {
  const limb = Math.max(-1, Math.min(1, illum * 2 - 1));
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(pa);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = '#1a1c24';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
  ctx.ellipse(0, 0, Math.max(0.4, Math.abs(limb) * r), r, 0, Math.PI / 2, -Math.PI / 2, limb < 0);
  ctx.fillStyle = '#f3f0e6';
  ctx.fill();
  ctx.restore();
}
