const DEG = Math.PI / 180;
const STEP = 2;

export function createGlobe(canvas) {
  const ctx = canvas.getContext('2d');
  let mask = null;
  let polygons = [];

  function setLand(next) {
    polygons = next;
    const w = 720;
    const h = 360;
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const g = off.getContext('2d');
    g.beginPath();
    for (const poly of next) {
      for (const ring of poly.rings) {
        let prevLon = null;
        for (let i = 0; i < ring.length; i++) {
          const lon = ring[i][0];
          const lat = ring[i][1];
          const x = (lon + 180) / 360 * w;
          const y = (90 - lat) / 180 * h;
          if (i === 0 || Math.abs(lon - prevLon) > 180) g.moveTo(x, y);
          else g.lineTo(x, y);
          prevLon = lon;
        }
        g.closePath();
      }
    }
    g.fillStyle = '#fff';
    g.fill('evenodd');
    const img = g.getImageData(0, 0, w, h);
    const land = new Uint8Array(w * h);
    for (let i = 0; i < land.length; i++) land[i] = img.data[i * 4 + 3] > 20 ? 1 : 0;
    mask = { w, h, land };
  }

  function landAt(lat, lon) {
    if (!mask) return false;
    const { w, h, land } = mask;
    let x = Math.floor((lon + 180) / 360 * w);
    x = ((x % w) + w) % w;
    let y = Math.floor((90 - lat) / 180 * h);
    if (y < 0) y = 0;
    if (y >= h) y = h - 1;
    return land[y * w + x] === 1;
  }

  function projector(lat0, lon0) {
    const φ0 = lat0 * DEG;
    const λ0 = lon0 * DEG;
    const c0 = Math.cos(λ0);
    const s0 = Math.sin(λ0);
    const β = φ0 - Math.PI / 2;
    const cb = Math.cos(β);
    const sb = Math.sin(β);
    return (lat, lon) => {
      const φ = lat * DEG;
      const λ = lon * DEG;
      const cp = Math.cos(φ);
      const vx = cp * Math.cos(λ);
      const vy = cp * Math.sin(λ);
      const vz = Math.sin(φ);
      const x1 = c0 * vx + s0 * vy;
      const y1 = -s0 * vx + c0 * vy;
      const z1 = vz;
      return {
        x: y1,
        y: -(x1 * cb + z1 * sb),
        z: -x1 * sb + z1 * cb,
      };
    };
  }

  function strokeFront(project, pts, style, width, cx, cy, radius) {
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < pts.length - 1; i++) {
      let a = project(pts[i].lat, pts[i].lon);
      let b = project(pts[i + 1].lat, pts[i + 1].lon);
      if (a.z <= 0 && b.z <= 0) {
        pen = false;
        continue;
      }
      if (a.z < 0 || b.z < 0) {
        const t = a.z / (a.z - b.z);
        const hit = {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          z: 0,
        };
        if (a.z < 0) a = hit;
        else b = hit;
      }
      const ax = cx + a.x * radius;
      const ay = cy - a.y * radius;
      const bx = cx + b.x * radius;
      const by = cy - b.y * radius;
      if (!pen) ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      pen = b.z > 0.001;
    }
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  function draw(state) {
    const css = canvas.clientWidth;
    if (!css) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.max(2, Math.round(css * dpr));
    if (canvas.width !== px || canvas.height !== px) {
      canvas.width = px;
      canvas.height = px;
    }
    const cx = px / 2;
    const cy = px / 2;
    const radius = px * 0.46;
    const project = projector(state.lat, state.lon);
    ctx.clearRect(0, 0, px, px);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();

    const ocean = ctx.createRadialGradient(cx - radius * 0.32, cy - radius * 0.36, radius * 0.1, cx, cy, radius);
    ocean.addColorStop(0, '#1d6d8c');
    ocean.addColorStop(0.62, '#0e3d58');
    ocean.addColorStop(1, '#071722');
    ctx.fillStyle = ocean;
    ctx.fillRect(0, 0, px, px);

    if (mask) {
      for (let lat = -88; lat < 88; lat += STEP) {
        for (let lon = -180; lon < 180; lon += STEP) {
          const latC = lat + STEP / 2;
          const lonC = lon + STEP / 2;
          if (!landAt(latC, lonC)) continue;
          const c = project(latC, lonC);
          if (c.z <= 0.05) continue;
          const corners = [
            project(lat, lon),
            project(lat, Math.min(180, lon + STEP)),
            project(lat + STEP, Math.min(180, lon + STEP)),
            project(lat + STEP, lon),
          ];
          if (corners.some((p) => p.z <= 0)) continue;
          const shade = 0.62 + 0.38 * c.z;
          ctx.fillStyle = `rgb(${Math.round(132 * shade)},${Math.round(168 * shade)},${Math.round(104 * shade)})`;
          ctx.beginPath();
          corners.forEach((p, i) => {
            const x = cx + p.x * radius;
            const y = cy - p.y * radius;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.fill();
        }
      }
    }

    if (polygons.length) {
      ctx.beginPath();
      for (const poly of polygons) {
        for (const ring of poly.rings) {
          let pen = false;
          for (let i = 0; i < ring.length - 1; i++) {
            const lonA = ring[i][0];
            const lonB = ring[i + 1][0];
            if (Math.abs(lonA - lonB) > 180) {
              pen = false;
              continue;
            }
            let a = project(ring[i][1], lonA);
            let b = project(ring[i + 1][1], lonB);
            if (a.z <= 0 && b.z <= 0) {
              pen = false;
              continue;
            }
            if (a.z < 0 || b.z < 0) {
              const t = a.z / (a.z - b.z);
              const hit = {
                x: a.x + (b.x - a.x) * t,
                y: a.y + (b.y - a.y) * t,
                z: 0,
              };
              if (a.z < 0) a = hit;
              else b = hit;
            }
            const ax = cx + a.x * radius;
            const ay = cy - a.y * radius;
            const bx = cx + b.x * radius;
            const by = cy - b.y * radius;
            if (!pen) ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            pen = b.z > 0.001;
          }
        }
      }
      ctx.strokeStyle = 'rgba(232, 236, 214, 0.28)';
      ctx.lineWidth = Math.max(1, px / 180);
      ctx.stroke();
    }

    ctx.lineWidth = Math.max(1, px / 220);
    ctx.strokeStyle = 'rgba(214, 232, 236, 0.2)';
    for (let lon = -180; lon < 180; lon += 30) {
      const line = [];
      for (let lat = -80; lat <= 80; lat += 4) line.push({ lat, lon });
      strokeFront(project, line, ctx.strokeStyle, ctx.lineWidth, cx, cy, radius);
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const line = [];
      for (let lon = -180; lon <= 180; lon += 4) line.push({ lat, lon });
      strokeFront(project, line, ctx.strokeStyle, ctx.lineWidth, cx, cy, radius);
    }

    if (state.route && state.route.length > 2) {
      const wide = Math.max(2, px / 70);
      strokeFront(project, state.route, 'rgba(230, 201, 138, 0.5)', wide, cx, cy, radius);
      const progress = ((state.progress % 1) + 1) % 1;
      const span = 0.06;
      const n = state.route.length - 1;
      let run = [];
      const flush = () => {
        if (run.length > 1) strokeFront(project, run, '#ffe7a3', wide * 1.45, cx, cy, radius);
        run = [];
      };
      for (let i = 0; i <= n; i++) {
        const ahead = ((i / n) - progress + 1) % 1;
        if (ahead <= span) run.push(state.route[i]);
        else flush();
      }
      flush();
    }

    const gloss = ctx.createRadialGradient(cx - radius * 0.34, cy - radius * 0.4, radius * 0.02, cx, cy, radius);
    gloss.addColorStop(0, 'rgba(255,255,255,0.2)');
    gloss.addColorStop(0.42, 'rgba(255,255,255,0)');
    ctx.fillStyle = gloss;
    ctx.fillRect(0, 0, px, px);
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(230, 201, 138, 0.55)';
    ctx.lineWidth = Math.max(1.5, px / 90);
    ctx.stroke();

    const dot = Math.max(3.5, px / 42);
    ctx.beginPath();
    ctx.arc(cx, cy, dot * 2.1, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 244, 214, 0.8)';
    ctx.lineWidth = Math.max(1, px / 140);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, dot, 0, Math.PI * 2);
    ctx.fillStyle = '#fff6df';
    ctx.fill();
    ctx.lineWidth = Math.max(1.25, px / 110);
    ctx.strokeStyle = '#e6c98a';
    ctx.stroke();
  }

  return { setLand, draw };
}
