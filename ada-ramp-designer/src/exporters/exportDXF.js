/**
 * Export callout elements as a DXF file
 * MicroStation can read DXF as a reference file or import it directly
 */

const DXF_HEADER = `  0\nSECTION\n  2\nHEADER\n  9\n$ACADVER\n  1\nAC1015\n  9\n$INSUNITS\n 70\n      2\n  0\nENDSEC\n`;

const DXF_TABLES = `  0\nSECTION\n  2\nTABLES\n  0\nTABLE\n  2\nLAYER\n 70\n      4\n  0\nLAYER\n  2\nCALLOUT_PANELS\n 70\n      0\n 62\n      3\n  6\nCONTINUOUS\n  0\nLAYER\n  2\nCALLOUT_SLOPES\n 70\n      0\n 62\n      1\n  6\nCONTINUOUS\n  0\nLAYER\n  2\nCALLOUT_ELEVATIONS\n 70\n      0\n 62\n      5\n  6\nCONTINUOUS\n  0\nLAYER\n  2\nCALLOUT_LEADERS\n 70\n      0\n 62\n      8\n  6\nCONTINUOUS\n  0\nENDTAB\n  0\nENDSEC\n`;

function dxfMText(x, y, text, layer, height = 0.5) {
  return `  0\nMTEXT\n  8\n${layer}\n 10\n${x.toFixed(4)}\n 20\n${y.toFixed(4)}\n 30\n0.0\n 40\n${height}\n  1\n${text}\n 71\n      1\n 72\n      5\n`;
}

function dxfLine(x1, y1, x2, y2, layer) {
  return `  0\nLINE\n  8\n${layer}\n 10\n${x1.toFixed(4)}\n 20\n${y1.toFixed(4)}\n 30\n0.0\n 11\n${x2.toFixed(4)}\n 21\n${y2.toFixed(4)}\n 31\n0.0\n`;
}

function dxfCircle(x, y, r, layer) {
  return `  0\nCIRCLE\n  8\n${layer}\n 10\n${x.toFixed(4)}\n 20\n${y.toFixed(4)}\n 30\n0.0\n 40\n${r.toFixed(4)}\n`;
}

export function exportCalloutsDXF(callouts, points, segments, options = {}) {
  const { textHeight = 0.5, leaderLength = 3 } = options;

  let entities = '';

  for (const co of callouts) {
    if (!co.visible) continue;

    const cx = co.x;
    const cy = co.y;

    if (co.type === 'panel') {
      // Segment label: panel length + slope
      const seg = segments.find(s => s.fromId === co.fromId && s.toId === co.toId);
      if (!seg) continue;

      // Leader from callout to midpoint of segment
      const mp = seg.mid;
      entities += dxfLine(cx, cy, mp.x, mp.y, 'CALLOUT_LEADERS');
      entities += dxfMText(cx, cy, co.content, 'CALLOUT_PANELS', textHeight);
      // Small tick at midpoint
      entities += dxfCircle(mp.x, mp.y, 0.1, 'CALLOUT_LEADERS');

    } else if (co.type === 'slope') {
      const seg = segments.find(s => s.fromId === co.fromId && s.toId === co.toId);
      if (!seg) continue;
      const mp = seg.mid;
      entities += dxfLine(cx, cy, mp.x, mp.y, 'CALLOUT_LEADERS');
      entities += dxfMText(cx, cy, co.content, 'CALLOUT_SLOPES', textHeight);

    } else if (co.type === 'elevation') {
      const pt = points.find(p => p.id === co.ptId);
      if (!pt) continue;
      entities += dxfLine(cx, cy, pt.x, pt.y, 'CALLOUT_LEADERS');
      entities += dxfMText(cx, cy, co.content, 'CALLOUT_ELEVATIONS', textHeight);
    }
  }

  // Also write ramp centerline as reference
  if (points.length >= 2) {
    for (let i = 0; i < points.length - 1; i++) {
      entities += dxfLine(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y, 'CALLOUT_LEADERS');
    }
    // Write elevation dots
    for (const pt of points) {
      entities += dxfCircle(pt.x, pt.y, 0.15, 'CALLOUT_ELEVATIONS');
    }
  }

  const dxf = `${DXF_HEADER}${DXF_TABLES}  0\nSECTION\n  2\nENTITIES\n${entities}  0\nENDSEC\n  0\nEOF\n`;
  return dxf;
}
