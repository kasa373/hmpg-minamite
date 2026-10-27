export function prepareLand(geojson) {
  const polygons = [];
  const pushPolygon = (rings) => {
    if (!rings || !rings.length) return;
    let minLon = 180;
    let maxLon = -180;
    let minLat = 90;
    let maxLat = -90;
    for (const ring of rings) {
      for (const p of ring) {
        const lon = p[0];
        const lat = p[1];
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
    polygons.push({ rings, minLon, maxLon, minLat, maxLat });
  };
  for (const feature of geojson.features) {
    const g = feature.geometry;
    if (!g) continue;
    if (g.type === 'Polygon') pushPolygon(g.coordinates);
    else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates) pushPolygon(poly);
    }
  }
  return polygons;
}

function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][1];
    const yj = ring[j][1];
    if ((yi > lat) === (yj > lat)) continue;
    const xi = ring[i][0];
    const xj = ring[j][0];
    const x = ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (lon < x) inside = !inside;
  }
  return inside;
}

export function isLand(polygons, lat, lon) {
  let x = lon;
  if (x > 180) x -= 360;
  if (x < -180) x += 360;
  for (let i = 0; i < polygons.length; i++) {
    const p = polygons[i];
    if (x < p.minLon || x > p.maxLon || lat < p.minLat || lat > p.maxLat) continue;
    let inside = false;
    for (let r = 0; r < p.rings.length; r++) {
      if (inRing(x, lat, p.rings[r])) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}
