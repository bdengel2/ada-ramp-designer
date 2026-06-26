// ===== ADA / PROWAG / IDOT Standards =====

export const STANDARDS = {
  PROWAG: {
    name: 'PROWAG 2011',
    maxRunningSlope: 8.33,
    preferredRunningSlope: 5.0,
    maxCrossSlope: 2.0,
    minWidthIn: 60,      // inches
    minLandingIn: 60,    // inches
    detWarningDepthIn: 24,
    detWarningContrastRatio: 70, // %
    notes: 'Public Rights-of-Way Accessibility Guidelines (PROWAG), USDOT/FHWA',
  },
  IDOT: {
    name: 'IDOT BDE 2023',
    maxRunningSlope: 8.33,
    preferredRunningSlope: 5.0,
    maxCrossSlope: 2.0,
    minWidthIn: 60,
    minLandingIn: 60,
    detWarningDepthIn: 24,
    notes: 'Illinois DOT Bureau of Design & Environment Manual, Ch. 17',
  },
  Custom: {
    name: 'Custom',
    maxRunningSlope: 8.33,
    preferredRunningSlope: 5.0,
    maxCrossSlope: 2.0,
    minWidthIn: 60,
    minLandingIn: 60,
    detWarningDepthIn: 24,
    notes: 'User-defined standard',
  },
};

// ===== Geometry Utilities =====

export function dist2D(p1, p2) {
  return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
}

/** slope in percent: positive = rising, negative = falling */
export function calcSlope(elev1, elev2, horizDist) {
  if (horizDist === 0) return 0;
  return ((elev2 - elev1) / horizDist) * 100;
}

export function snapTo(value, precision = 0.01) {
  return Math.round(value / precision) * precision;
}

export function formatElev(elev) {
  return elev.toFixed(2);
}

export function formatSlope(pct) {
  const abs = Math.abs(pct);
  const sign = pct >= 0 ? '+' : '-';
  return `${sign}${abs.toFixed(2)}%`;
}

export function formatDist(d) {
  return `${d.toFixed(2)}'`;
}

/** Returns 'pass' | 'warn' | 'fail' */
export function slopeStatus(slopePct, std = 'PROWAG') {
  const s = STANDARDS[std] || STANDARDS.PROWAG;
  const abs = Math.abs(slopePct);
  if (abs > s.maxRunningSlope) return 'fail';
  if (abs > s.preferredRunningSlope) return 'warn';
  return 'pass';
}

export function crossSlopeStatus(slopePct, std = 'PROWAG') {
  const s = STANDARDS[std] || STANDARDS.PROWAG;
  const abs = Math.abs(slopePct);
  if (abs > s.maxCrossSlope) return 'fail';
  return 'pass';
}

/** Compute all segment data from ordered ramp points */
export function computeSegments(points) {
  const segs = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const horiz = dist2D(a, b);
    const slope = calcSlope(a.elevation, b.elevation, horiz);
    const rise = b.elevation - a.elevation;
    segs.push({
      fromId: a.id,
      toId: b.id,
      from: a,
      to: b,
      horiz,
      rise,
      slope, // percent
      ratio: horiz !== 0 ? Math.abs(horiz / rise) : Infinity, // 1:X
      mid: {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
      },
    });
  }
  return segs;
}

/** Running slope 1:X label string */
export function slopeLabel(slope) {
  const abs = Math.abs(slope);
  if (abs < 0.01) return '0.00% (LEVEL)';
  const ratio = 100 / abs;
  return `${Math.abs(slope).toFixed(2)}% (1:${ratio.toFixed(1)})`;
}

export const STATUS_COLOR = {
  pass: '#00e5a0',
  warn: '#f5a623',
  fail: '#ff4444',
};

export const STATUS_LABEL = {
  pass: '✓',
  warn: '⚠',
  fail: '✗',
};
