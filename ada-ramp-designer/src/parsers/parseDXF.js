/**
 * DXF ASCII parser - extracts geometry from ENTITIES section
 * Supports: LINE, LWPOLYLINE, POLYLINE/VERTEX, ARC (as line segments)
 */
export function parseDXF(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim());
  const elements = [];

  let i = 0;
  const total = lines.length;

  const readCode = () => {
    if (i >= total - 1) return null;
    const code = parseInt(lines[i], 10);
    const value = lines[i + 1];
    i += 2;
    return { code, value };
  };

  // Scan to ENTITIES section
  while (i < total) {
    if (lines[i] === '0' && lines[i + 1] === 'ENTITIES') { i += 2; break; }
    i++;
  }

  while (i < total) {
    // Each entity starts with group code 0
    while (i < total && lines[i] !== '0') i++;
    if (i >= total) break;
    i++; // move past '0'
    if (i >= total) break;

    const entityType = lines[i++];

    if (entityType === 'ENDSEC' || entityType === 'EOF') break;

    if (entityType === 'LINE') {
      let x1 = 0, y1 = 0, x2 = 0, y2 = 0, layer = '0';
      while (i < total && lines[i] !== '0') {
        const code = parseInt(lines[i]);
        const val = lines[i + 1];
        i += 2;
        if (code === 8)  layer = val;
        if (code === 10) x1 = parseFloat(val);
        if (code === 20) y1 = parseFloat(val);
        if (code === 11) x2 = parseFloat(val);
        if (code === 21) y2 = parseFloat(val);
      }
      if (isFinite(x1) && isFinite(y1)) {
        elements.push({ type: 'line', x1, y1, x2, y2, layer });
      }

    } else if (entityType === 'LWPOLYLINE') {
      const points = [];
      let closed = false;
      let layer = '0';
      let cx = null, cy = null;
      while (i < total && lines[i] !== '0') {
        const code = parseInt(lines[i]);
        const val = lines[i + 1];
        i += 2;
        if (code === 8)  layer = val;
        if (code === 70) closed = (parseInt(val) & 1) === 1;
        if (code === 10) {
          if (cx !== null && cy !== null) points.push({ x: cx, y: cy });
          cx = parseFloat(val); cy = null;
        }
        if (code === 20) cy = parseFloat(val);
      }
      if (cx !== null && cy !== null) points.push({ x: cx, y: cy });
      if (points.length >= 2) {
        elements.push({ type: closed ? 'shape' : 'linestring', points, layer });
      }

    } else if (entityType === 'POLYLINE') {
      let closed = false, layer = '0';
      while (i < total && lines[i] !== '0') {
        const code = parseInt(lines[i]);
        const val = lines[i + 1];
        i += 2;
        if (code === 8)  layer = val;
        if (code === 70) closed = (parseInt(val) & 1) === 1;
      }
      // Read VERTEX entities
      const points = [];
      while (i < total) {
        while (i < total && lines[i] !== '0') i++;
        if (i >= total) break;
        i++;
        const sub = lines[i++];
        if (sub === 'VERTEX') {
          let vx = 0, vy = 0;
          while (i < total && lines[i] !== '0') {
            const code = parseInt(lines[i]);
            const val = lines[i + 1];
            i += 2;
            if (code === 10) vx = parseFloat(val);
            if (code === 20) vy = parseFloat(val);
          }
          points.push({ x: vx, y: vy });
        } else if (sub === 'SEQEND') {
          break;
        } else {
          // Unexpected entity, put i back
          i -= 2; break;
        }
      }
      if (points.length >= 2) {
        elements.push({ type: closed ? 'shape' : 'linestring', points, layer });
      }

    } else if (entityType === 'ARC') {
      // Approximate arc as line segments
      let cx = 0, cy = 0, r = 1, startA = 0, endA = 360, layer = '0';
      while (i < total && lines[i] !== '0') {
        const code = parseInt(lines[i]);
        const val = lines[i + 1];
        i += 2;
        if (code === 8)  layer = val;
        if (code === 10) cx = parseFloat(val);
        if (code === 20) cy = parseFloat(val);
        if (code === 40) r = parseFloat(val);
        if (code === 50) startA = parseFloat(val);
        if (code === 51) endA = parseFloat(val);
      }
      const pts = [];
      let a = startA;
      if (endA < startA) endA += 360;
      const step = Math.min(10, (endA - startA) / 10);
      while (a <= endA + 0.001) {
        const rad = (a * Math.PI) / 180;
        pts.push({ x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) });
        a += step;
      }
      if (pts.length >= 2) elements.push({ type: 'linestring', points: pts, layer });

    } else if (entityType === 'SPLINE') {
      // Skip splines — too complex, just consume
      while (i < total && lines[i] !== '0') i += 2;

    } else if (entityType === 'INSERT') {
      // Cell/block insert - skip
      while (i < total && lines[i] !== '0') i += 2;
    }
    // All other entity types: consume and skip
  }

  return elements;
}

export function getGeomBounds(elements) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements) {
    if (el.type === 'line') {
      minX = Math.min(minX, el.x1, el.x2); maxX = Math.max(maxX, el.x1, el.x2);
      minY = Math.min(minY, el.y1, el.y2); maxY = Math.max(maxY, el.y1, el.y2);
    } else if (el.points) {
      for (const p of el.points) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
    }
  }
  if (!isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}
