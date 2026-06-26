import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { parseDGNV7, isDGNV8 } from './parsers/parseDGN';
import { parseDXF, getGeomBounds } from './parsers/parseDXF';
import { exportCalloutsDXF } from './exporters/exportDXF';
import {
  STANDARDS, dist2D, calcSlope, snapTo, formatElev, formatSlope,
  formatDist, slopeStatus, computeSegments, slopeLabel,
  STATUS_COLOR, STATUS_LABEL,
} from './utils/adaCalc';
import './App.css';

let _uid = 100;
const uid = () => String(_uid++);

const CALLOUT_OFFSET = { panel: { dx: 0, dy: 3 }, slope: { dx: 2, dy: 5 }, elevation: { dx: 3, dy: 0 } };

function generateCallouts(points, segments, existing = []) {
  const cos = [];
  for (const seg of segments) {
    const { fromId, toId, horiz, slope, mid } = seg;
    const existP = existing.find(e => e.type === 'panel' && e.fromId === fromId && e.toId === toId);
    const existS = existing.find(e => e.type === 'slope' && e.fromId === fromId && e.toId === toId);
    cos.push({
      id: existP?.id || uid(), type: 'panel', fromId, toId, visible: existP?.visible ?? true,
      x: existP?.x ?? (mid.x + CALLOUT_OFFSET.panel.dx),
      y: existP?.y ?? (mid.y + CALLOUT_OFFSET.panel.dy),
      content: `L = ${formatDist(horiz)}`,
    });
    cos.push({
      id: existS?.id || uid(), type: 'slope', fromId, toId, visible: existS?.visible ?? true,
      x: existS?.x ?? (mid.x + CALLOUT_OFFSET.slope.dx),
      y: existS?.y ?? (mid.y + CALLOUT_OFFSET.slope.dy),
      content: slopeLabel(slope),
    });
  }
  for (const pt of points) {
    const existE = existing.find(e => e.type === 'elevation' && e.ptId === pt.id);
    cos.push({
      id: existE?.id || uid(), type: 'elevation', ptId: pt.id, visible: existE?.visible ?? true,
      x: existE?.x ?? (pt.x + CALLOUT_OFFSET.elevation.dx),
      y: existE?.y ?? (pt.y + CALLOUT_OFFSET.elevation.dy),
      content: `EL=${formatElev(pt.elevation)}'`,
    });
  }
  return cos;
}

function renderCanvas(canvas, state) {
  if (!canvas) return;
  const { alignGeom, drawGeom, points, callouts, view, selectedPointId,
    showPanels, showSlopes, showElevations, segments, hoveredCalloutId } = state;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#060b12';
  ctx.fillRect(0, 0, W, H);

  // Grid
  const gs = view.scale < 5 ? 10 : view.scale < 20 ? 5 : 1;
  ctx.strokeStyle = 'rgba(20,50,80,0.6)';
  ctx.lineWidth = 0.5;
  const wx0 = (0 - view.tx) / view.scale, wx1 = (W - view.tx) / view.scale;
  const wy0 = (view.ty - H) / view.scale, wy1 = view.ty / view.scale;
  for (let gx = Math.floor(wx0/gs)*gs; gx <= wx1; gx += gs) {
    const sx = gx * view.scale + view.tx;
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
  }
  for (let gy = Math.floor(wy0/gs)*gs; gy <= wy1; gy += gs) {
    const sy = -gy * view.scale + view.ty;
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
  }

  const wts = (wx, wy) => ({ x: wx * view.scale + view.tx, y: -wy * view.scale + view.ty });

  const drawLayer = (geom, color, lw) => {
    ctx.strokeStyle = color; ctx.lineWidth = lw;
    for (const el of geom) {
      ctx.beginPath();
      if (el.type === 'line') {
        const p1 = wts(el.x1, el.y1), p2 = wts(el.x2, el.y2);
        ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
      } else if (el.points) {
        const pts = el.points.map(p => wts(p.x, p.y));
        if (!pts.length) continue;
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        if (el.type === 'shape') ctx.closePath();
      }
      ctx.stroke();
    }
  };

  drawLayer(alignGeom, '#1a4080', 1.5);
  drawLayer(drawGeom, '#334455', 1);

  // Ramp line
  if (points.length > 1) {
    ctx.strokeStyle = '#008060'; ctx.lineWidth = 2; ctx.setLineDash([]);
    ctx.beginPath();
    const p0s = wts(points[0].x, points[0].y);
    ctx.moveTo(p0s.x, p0s.y);
    for (let i = 1; i < points.length; i++) { const ps = wts(points[i].x, points[i].y); ctx.lineTo(ps.x, ps.y); }
    ctx.stroke();
  }

  // Leaders
  ctx.setLineDash([4, 4]); ctx.lineWidth = 0.8;
  for (const co of callouts) {
    if (!co.visible) continue;
    if ((co.type==='panel'&&!showPanels)||(co.type==='slope'&&!showSlopes)||(co.type==='elevation'&&!showElevations)) continue;
    const coS = wts(co.x, co.y);
    let tgt = null;
    if (co.type === 'elevation') {
      const pt = points.find(p => p.id === co.ptId);
      if (pt) tgt = wts(pt.x, pt.y);
    } else {
      const seg = segments.find(s => s.fromId === co.fromId && s.toId === co.toId);
      if (seg) tgt = wts(seg.mid.x, seg.mid.y);
    }
    if (tgt) {
      const lineColor = co.type==='slope'?'#a07010':co.type==='elevation'?'#204060':'#006040';
      ctx.strokeStyle = lineColor;
      ctx.beginPath(); ctx.moveTo(coS.x, coS.y); ctx.lineTo(tgt.x, tgt.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(tgt.x, tgt.y, 3, 0, Math.PI*2);
      ctx.fillStyle = lineColor + 'bb'; ctx.fill();
      ctx.setLineDash([4, 4]);
    }
  }
  ctx.setLineDash([]);

  // Callout boxes
  ctx.font = '11px "JetBrains Mono","Courier New",monospace';
  for (const co of callouts) {
    if (!co.visible) continue;
    if ((co.type==='panel'&&!showPanels)||(co.type==='slope'&&!showSlopes)||(co.type==='elevation'&&!showElevations)) continue;
    const coS = wts(co.x, co.y);
    const isHov = co.id === hoveredCalloutId;
    const tc = co.type==='slope'?'#f5a623':co.type==='elevation'?'#4a9eff':'#00e5a0';
    const bg = co.type==='slope'?'rgba(35,20,0,0.9)':co.type==='elevation'?'rgba(0,10,35,0.9)':'rgba(0,25,15,0.9)';
    const tm = ctx.measureText(co.content);
    const bx = coS.x - 4, by = coS.y - 14, bw = tm.width + 8, bh = 18;
    ctx.fillStyle = bg;
    ctx.strokeStyle = isHov ? '#ffffff66' : tc + '55';
    ctx.lineWidth = isHov ? 1.5 : 0.5;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 2); else ctx.rect(bx, by, bw, bh);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = tc;
    ctx.fillText(co.content, coS.x, coS.y);
  }

  // Points
  for (const pt of points) {
    const s = wts(pt.x, pt.y);
    const isSel = pt.id === selectedPointId;
    if (isSel) { ctx.beginPath(); ctx.arc(s.x, s.y, 14, 0, Math.PI*2); ctx.fillStyle='rgba(0,229,160,0.1)'; ctx.fill(); }
    ctx.beginPath(); ctx.arc(s.x, s.y, isSel ? 8 : 6, 0, Math.PI*2);
    ctx.strokeStyle = pt.locked ? '#ff8c00' : isSel ? '#00e5a0' : '#009060';
    ctx.lineWidth = isSel ? 2 : 1.5; ctx.stroke();
    ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, Math.PI*2);
    ctx.fillStyle = pt.locked ? '#ff8c00' : '#00e5a0'; ctx.fill();
    ctx.font = 'bold 10px "JetBrains Mono",monospace'; ctx.fillStyle = '#c8d8e8';
    ctx.fillText('P' + pt.label, s.x + 11, s.y - 3);
    ctx.font = '9px "JetBrains Mono",monospace'; ctx.fillStyle = '#4a9eff';
    ctx.fillText(formatElev(pt.elevation) + "'", s.x + 11, s.y + 8);
    if (pt.locked) { ctx.font = '10px Arial'; ctx.fillText('🔒', s.x - 20, s.y - 4); }
  }

  // Segment status
  for (const seg of segments) {
    const st = slopeStatus(seg.slope);
    const ms = wts(seg.mid.x, seg.mid.y);
    ctx.beginPath(); ctx.arc(ms.x, ms.y, 6, 0, Math.PI*2);
    ctx.strokeStyle = STATUS_COLOR[st]; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.font = 'bold 7px Arial'; ctx.fillStyle = STATUS_COLOR[st];
    ctx.fillText(STATUS_LABEL[st], ms.x - 3, ms.y + 2.5);
  }
}

export default function App() {
  const [alignGeom, setAlignGeom] = useState([]);
  const [drawGeom, setDrawGeom] = useState([]);
  const [points, setPoints] = useState([]);
  const [callouts, setCallouts] = useState([]);
  const [view, setView] = useState({ scale: 10, tx: 400, ty: 400 });
  const [tool, setTool] = useState('select');
  const [standard, setStandard] = useState('PROWAG');
  const [calloutStyle, setCalloutStyle] = useState('civil');
  const [showPanels, setShowPanels] = useState(true);
  const [showSlopes, setShowSlopes] = useState(true);
  const [showElevations, setShowElevations] = useState(true);
  const [selectedPointId, setSelectedPointId] = useState(null);
  const [hoveredCalloutId, setHoveredCalloutId] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [statusMsg, setStatusMsg] = useState('');
  const [customStd, setCustomStd] = useState({ maxRunningSlope: 8.33, preferredRunningSlope: 5.0, maxCrossSlope: 2.0 });
  const [alignLoaded, setAlignLoaded] = useState(false);
  const [drawLoaded, setDrawLoaded] = useState(false);
  const [pCounter, setPCounter] = useState(1);

  const canvasRef = useRef(null);
  const fileAlignRef = useRef(null);
  const fileDrawRef = useRef(null);

  const segments = useMemo(() => computeSegments(points), [points]);

  const wts = useCallback((wx, wy) => ({
    x: wx * view.scale + view.tx, y: -wy * view.scale + view.ty,
  }), [view]);
  const stw = useCallback((sx, sy) => ({
    x: (sx - view.tx) / view.scale, y: -(sy - view.ty) / view.scale,
  }), [view]);

  // Render
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    renderCanvas(c, { alignGeom, drawGeom, points, callouts, view,
      selectedPointId, showPanels, showSlopes, showElevations, segments, hoveredCalloutId });
  });

  // Canvas size
  useEffect(() => {
    const resize = () => {
      const c = canvasRef.current; if (!c) return;
      c.width = c.offsetWidth; c.height = c.offsetHeight;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const fitToGeom = useCallback((geom) => {
    const bounds = getGeomBounds(geom); if (!bounds) return;
    const c = canvasRef.current; if (!c) return;
    const { minX, minY, maxX, maxY } = bounds;
    const gw = maxX - minX || 1, gh = maxY - minY || 1;
    const scale = Math.min(c.width / gw, c.height / gh) * 0.85;
    setView({ scale, tx: c.width/2 - (minX+gw/2)*scale, ty: c.height/2 + (minY+gh/2)*scale });
  }, []);

  const loadFile = async (file, isAlign) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    let geom = [], err = null;
    try {
      if (ext === 'dxf') {
        const text = await file.text(); geom = parseDXF(text);
        setStatusMsg(`Loaded ${file.name}: ${geom.length} elements`);
      } else if (ext === 'dgn') {
        const buf = await file.arrayBuffer();
        if (isDGNV8(buf)) { err = `DGN V8 format in "${file.name}" — resave as V7 or export DXF from MicroStation.`; }
        else { geom = parseDGNV7(buf); if (!geom.length) err = `Could not parse "${file.name}" — try exporting as DXF.`; else setStatusMsg(`Loaded ${file.name} (DGN V7): ${geom.length} elements`); }
      } else { err = `Unsupported format .${ext}`; }
    } catch (e) { err = `Error: ${e.message}`; }
    if (err) { setStatusMsg('⚠ ' + err); return; }
    if (isAlign) { setAlignGeom(geom); setAlignLoaded(true); if (geom.length) fitToGeom([...geom, ...drawGeom]); }
    else { setDrawGeom(geom); setDrawLoaded(true); if (geom.length) fitToGeom([...alignGeom, ...geom]); }
  };

  // Regenerate callouts
  useEffect(() => {
    const segs = computeSegments(points);
    setCallouts(prev => generateCallouts(points, segs, prev));
  }, [points]);

  const addPoint = useCallback((wx, wy) => {
    const id = uid(), label = pCounter;
    setPCounter(c => c + 1);
    setPoints(prev => [...prev, { id, label, x: wx, y: wy, elevation: 0.00, locked: false }]);
    setSelectedPointId(id);
    setStatusMsg(`Point P${label} added`);
  }, [pCounter]);

  const updateElevation = (id, raw) => {
    const v = snapTo(parseFloat(raw), 0.01); if (isNaN(v)) return;
    setPoints(prev => prev.map(p => p.id === id && !p.locked ? { ...p, elevation: v } : p));
  };

  const toggleLock = (id) => setPoints(prev => prev.map(p => p.id === id ? { ...p, locked: !p.locked } : p));
  const removePoint = (id) => { setPoints(prev => prev.filter(p => p.id !== id)); if (selectedPointId === id) setSelectedPointId(null); };

  const moveUp = (id) => setPoints(prev => {
    const i = prev.findIndex(p => p.id === id); if (i <= 0) return prev;
    const n = [...prev]; [n[i-1], n[i]] = [n[i], n[i-1]]; return n;
  });
  const moveDown = (id) => setPoints(prev => {
    const i = prev.findIndex(p => p.id === id); if (i < 0 || i >= prev.length-1) return prev;
    const n = [...prev]; [n[i], n[i+1]] = [n[i+1], n[i]]; return n;
  });

  const hitPt = useCallback((sx, sy) => {
    for (const pt of points) { const s = wts(pt.x, pt.y); if (Math.hypot(s.x-sx, s.y-sy) < 12) return pt; }
    return null;
  }, [points, wts]);

  const hitCo = useCallback((sx, sy) => {
    for (const co of callouts) { const s = wts(co.x, co.y); if (Math.hypot(s.x-sx, s.y-sy) < 45) return co; }
    return null;
  }, [callouts, wts]);

  const onMouseDown = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const world = stw(sx, sy);
    if (tool === 'addPoint') { addPoint(world.x, world.y); return; }
    const hp = hitPt(sx, sy);
    if (hp) { setSelectedPointId(hp.id); setDragging({ type:'point', id:hp.id, sx, sy, ox:hp.x, oy:hp.y }); return; }
    const hc = hitCo(sx, sy);
    if (hc) { setDragging({ type:'callout', id:hc.id, sx, sy, ox:hc.x, oy:hc.y }); return; }
    setDragging({ type:'pan', sx, sy, otx:view.tx, oty:view.ty }); setSelectedPointId(null);
  }, [tool, stw, hitPt, hitCo, addPoint, view]);

  const onMouseMove = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    setMousePos(stw(sx, sy));
    if (!dragging) { setHoveredCalloutId(hitCo(sx, sy)?.id || null); return; }
    const world = stw(sx, sy);
    if (dragging.type === 'pan') {
      setView(v => ({ ...v, tx: dragging.otx + sx - dragging.sx, ty: dragging.oty + sy - dragging.sy }));
    } else if (dragging.type === 'point') {
      const dxW = world.x - stw(dragging.sx, dragging.sy).x;
      const dyW = world.y - stw(dragging.sx, dragging.sy).y;
      setPoints(prev => prev.map(p => p.id === dragging.id ? { ...p, x: dragging.ox+dxW, y: dragging.oy+dyW } : p));
    } else if (dragging.type === 'callout') {
      const dxW = world.x - stw(dragging.sx, dragging.sy).x;
      const dyW = world.y - stw(dragging.sx, dragging.sy).y;
      setCallouts(prev => prev.map(c => c.id === dragging.id ? { ...c, x: dragging.ox+dxW, y: dragging.oy+dyW } : c));
    }
  }, [dragging, stw, hitCo]);

  const onMouseUp = useCallback(() => setDragging(null), []);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const f = e.deltaY < 0 ? 1.15 : 1/1.15;
    setView(v => {
      const ns = Math.max(0.01, Math.min(1000, v.scale * f));
      return { scale:ns, tx: sx-(sx-v.tx)*(ns/v.scale), ty: sy-(sy-v.ty)*(ns/v.scale) };
    });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 's' || e.key === 'S' || e.key === 'Escape') setTool('select');
      if (e.key === 'a' || e.key === 'A') setTool('addPoint');
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedPointId) removePoint(selectedPointId);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedPointId, removePoint]);

  const doExport = () => {
    const dxf = exportCalloutsDXF(callouts, points, segments);
    const blob = new Blob([dxf], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'ramp-callouts.dxf'; a.click();
    setStatusMsg('Exported ramp-callouts.dxf — attach in MicroStation as reference.');
  };

  const std = standard === 'Custom' ? { ...STANDARDS.Custom, ...customStd } : STANDARDS[standard];
  const allStatus = segments.map(s => slopeStatus(s.slope, standard));
  const hasFail = allStatus.includes('fail'), hasWarn = allStatus.includes('warn');
  const selPt = points.find(p => p.id === selectedPointId);

  return (
    <div className="layout">
      <header className="header">
        <div className="header-left">
          <span className="logo-mark">⬡</span>
          <span className="logo-text">ADA Ramp Designer</span>
          <span className="logo-sub">IDOT · PROWAG · Custom</span>
        </div>
        <div className="header-center">
          <div className="tool-group">
            <button className={`tool-btn ${tool==='select'?'active':''}`} onClick={() => setTool('select')} title="S">
              ↖ Select
            </button>
            <button className={`tool-btn add ${tool==='addPoint'?'active':''}`} onClick={() => setTool('addPoint')} title="A">
              ⊕ Add Point
            </button>
          </div>
          <div className="sep" />
          <label className="ctrl-label">Standard</label>
          <select value={standard} onChange={e => setStandard(e.target.value)}>
            <option value="PROWAG">PROWAG 2011</option>
            <option value="IDOT">IDOT BDE 2023</option>
            <option value="Custom">Custom</option>
          </select>
          <div className="sep" />
          <label className="ctrl-label">Style</label>
          <select value={calloutStyle} onChange={e => setCalloutStyle(e.target.value)}>
            <option value="civil">Civil</option>
            <option value="arch">Arch</option>
            <option value="simple">Simple</option>
          </select>
        </div>
        <div className="header-right">
          <div className={`badge ${hasFail?'fail':hasWarn?'warn':'pass'}`}>
            {hasFail ? '✗ NON-COMPLIANT' : hasWarn ? '⚠ REVIEW' : points.length < 2 ? '— NO DATA' : '✓ COMPLIANT'}
          </div>
          <button className="hdr-export" onClick={doExport} disabled={!callouts.length}>↓ Export DXF</button>
        </div>
      </header>

      <div className="main">
        <aside className="left-panel">
          <div className="psec">
            <div className="ptitle">FILES</div>
            <div className="file-row">
              <span className={`fledge ${alignLoaded?'on':''}`}>●</span>
              <span className="flabel">Alignment</span>
              <button className="fbtn" onClick={() => fileAlignRef.current.click()}>{alignLoaded?'Replace':'Load'}</button>
              <input ref={fileAlignRef} type="file" accept=".dxf,.dgn" style={{display:'none'}} onChange={e=>{loadFile(e.target.files[0],true);e.target.value='';}} />
            </div>
            <div className="file-row">
              <span className={`fledge ${drawLoaded?'on':''}`}>●</span>
              <span className="flabel">Drawing</span>
              <button className="fbtn" onClick={() => fileDrawRef.current.click()}>{drawLoaded?'Replace':'Load'}</button>
              <input ref={fileDrawRef} type="file" accept=".dxf,.dgn" style={{display:'none'}} onChange={e=>{loadFile(e.target.files[0],false);e.target.value='';}} />
            </div>
            <div className="fnote">Accepts .dxf or .dgn (V7) · Resave V8 as V7 in MicroStation</div>
          </div>

          <div className="psec flex-grow">
            <div className="ptitle">RAMP POINTS <span className="cnt">{points.length}</span></div>
            {points.length === 0 ? (
              <div className="hint">Select <strong>⊕ Add Point</strong> and click the canvas to place ramp vertices in order.</div>
            ) : (
              <div className="pt-list">
                {points.map((pt) => {
                  const segAfter = segments.find(s => s.fromId === pt.id);
                  const isSel = pt.id === selectedPointId;
                  const st = segAfter ? slopeStatus(segAfter.slope, standard) : null;
                  return (
                    <div key={pt.id} className={`ptcard ${isSel?'sel':''} ${pt.locked?'lkd':''}`} onClick={() => setSelectedPointId(pt.id)}>
                      <div className="ptch">
                        <span className="ptlbl">P{pt.label}</span>
                        <div className="ptact">
                          <button className="ib" title="Move earlier" onClick={e=>{e.stopPropagation();moveUp(pt.id);}}>↑</button>
                          <button className="ib" title="Move later" onClick={e=>{e.stopPropagation();moveDown(pt.id);}}>↓</button>
                          <button className={`ib lk ${pt.locked?'on':''}`} title={pt.locked?'Unlock':'Lock tie-in'} onClick={e=>{e.stopPropagation();toggleLock(pt.id);}}>
                            {pt.locked?'🔒':'🔓'}
                          </button>
                          <button className="ib del" title="Remove" onClick={e=>{e.stopPropagation();removePoint(pt.id);}}>✕</button>
                        </div>
                      </div>
                      <div className="ptbody">
                        <div className="elevrow">
                          <span className="elevlbl">ELEV</span>
                          <input type="number" step="0.01" value={pt.elevation} disabled={pt.locked}
                            className={`elevinp ${pt.locked?'lkd':''}`}
                            onChange={e=>updateElevation(pt.id,e.target.value)}
                            onClick={e=>e.stopPropagation()} />
                          <span className="elevunit">ft</span>
                        </div>
                        <div className="coordrow">({pt.x.toFixed(1)}, {pt.y.toFixed(1)})</div>
                        {segAfter && (
                          <div className={`sloperow ${st}`}>
                            <span>{STATUS_LABEL[st]}</span>
                            <span>{Math.abs(segAfter.slope).toFixed(2)}%</span>
                            <span>{formatDist(segAfter.horiz)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="psec">
            <div className="ptitle">ADA LIMITS — {std.name}</div>
            {[
              ['Max running slope', `${std.maxRunningSlope}% (1:${(100/std.maxRunningSlope).toFixed(1)})`],
              ['Preferred slope', `${std.preferredRunningSlope}% (1:${(100/std.preferredRunningSlope).toFixed(0)})`],
              ['Max cross slope', `${std.maxCrossSlope}%`],
              ['Min width', `${std.minWidthIn}" (${(std.minWidthIn/12).toFixed(1)}')`],
              ['Det. warning depth', `${std.detWarningDepthIn}"`],
            ].map(([l, v]) => (
              <div key={l} className="adarow"><span>{l}</span><span className="aval">{v}</span></div>
            ))}
            {standard === 'Custom' && (
              <div className="customstd">
                {[['Max running %','maxRunningSlope'],['Preferred %','preferredRunningSlope'],['Max cross %','maxCrossSlope']].map(([l,k])=>(
                  <div key={k} className="csrow">
                    <label>{l}</label>
                    <input type="number" step="0.01" value={customStd[k]}
                      onChange={e=>setCustomStd(c=>({...c,[k]:parseFloat(e.target.value)}))} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        <div className="canvas-wrap">
          <canvas ref={canvasRef} className={`canvas tool-${tool}`}
            onMouseDown={onMouseDown} onMouseMove={onMouseMove}
            onMouseUp={onMouseUp} onMouseLeave={onMouseUp} onWheel={onWheel} />
          <div className="coords">N {mousePos.y.toFixed(2)} &nbsp; E {mousePos.x.toFixed(2)} &nbsp;|&nbsp; ×{view.scale.toFixed(1)}</div>
          <div className={`mode-bar ${tool==='addPoint'?'add':''}`}>
            {tool==='addPoint' ? '⊕ PLACE POINTS — click canvas to add vertices in order along ramp' : '↖ SELECT — drag points/callouts · scroll zoom · drag canvas to pan · Del to remove selected'}
          </div>
          {!alignLoaded && !drawLoaded && !points.length && (
            <div className="overlay">
              <div className="ov-inner">
                <div className="ov-icon">⬡</div>
                <div className="ov-title">ADA Ramp Designer</div>
                <div className="ov-sub">Load a DGN/DXF background, then place ramp vertices — or start placing points directly.</div>
                <div className="ov-chips">
                  <div className="chip">PROWAG 2011</div>
                  <div className="chip">IDOT BDE 2023</div>
                  <div className="chip">Custom Standards</div>
                  <div className="chip">DXF / DGN Import</div>
                  <div className="chip">DXF Export</div>
                </div>
              </div>
            </div>
          )}
        </div>

        <aside className="right-panel">
          <div className="psec">
            <div className="ptitle">CALLOUT LAYERS</div>
            {[
              ['panel-dot', 'Panel Lengths', showPanels, setShowPanels],
              ['slope-dot', 'Slopes', showSlopes, setShowSlopes],
              ['elev-dot', 'Elevations', showElevations, setShowElevations],
            ].map(([cls, lbl, val, set]) => (
              <label key={cls} className="tog">
                <input type="checkbox" checked={val} onChange={e=>set(e.target.checked)} />
                <span className={`dot ${cls}`} />
                {lbl}
              </label>
            ))}
          </div>

          <div className="psec flex-grow">
            <div className="ptitle">CALLOUTS <span className="cnt">{callouts.filter(c=>c.visible).length}/{callouts.length}</span></div>
            <div className="co-list">
              {callouts.length === 0 ? <div className="hint">Add ramp points to generate callouts.</div> : (
                callouts.map(co => {
                  if ((co.type==='panel'&&!showPanels)||(co.type==='slope'&&!showSlopes)||(co.type==='elevation'&&!showElevations)) return null;
                  const tc = co.type==='slope'?'#f5a623':co.type==='elevation'?'#4a9eff':'#00e5a0';
                  return (
                    <div key={co.id} className={`coitem ${!co.visible?'hid':''} ${co.id===hoveredCalloutId?'hov':''}`}>
                      <span className="codot" style={{background:tc}} />
                      <span className="cocnt">{co.content}</span>
                      <button className="ib" title={co.visible?'Hide':'Show'}
                        onClick={()=>setCallouts(prev=>prev.map(c=>c.id===co.id?{...c,visible:!c.visible}:c))}>
                        {co.visible?'👁':'🙈'}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="psec">
            <div className="ptitle">COMPLIANCE</div>
            {segments.length === 0 ? <div className="hint">Place 2+ points.</div> : (
              <div className="comp-list">
                {segments.map(seg => {
                  const st = slopeStatus(seg.slope, standard);
                  const fp = points.find(p=>p.id===seg.fromId);
                  const tp = points.find(p=>p.id===seg.toId);
                  return (
                    <div key={seg.fromId+seg.toId} className={`compitem ${st}`}>
                      <span className="clbl">P{fp?.label}→P{tp?.label}</span>
                      <span className="cval">{Math.abs(seg.slope).toFixed(2)}%</span>
                      <span className="cdist">{formatDist(seg.horiz)}</span>
                      <span className="cst">{STATUS_LABEL[st]}</span>
                    </div>
                  );
                })}
                <div className="comp-leg">
                  <span className="pass">✓ ≤{std.preferredRunningSlope}%</span>
                  <span className="warn">⚠ ≤{std.maxRunningSlope}%</span>
                  <span className="fail">✗ &gt;{std.maxRunningSlope}%</span>
                </div>
              </div>
            )}
          </div>

          <div className="psec">
            <button className="exp-btn" onClick={doExport} disabled={!callouts.length}>
              ↓ Export Callouts as DXF
            </button>
            <div className="expnote">Attach in MicroStation as reference or File › Import</div>
          </div>
        </aside>
      </div>

      <div className="statusbar">
        <span>{statusMsg || 'Ready — use ⊕ Add Point to start placing ramp vertices'}</span>
        <span className="keys">S = Select &nbsp; A = Add Point &nbsp; Del = Remove &nbsp; Scroll = Zoom</span>
      </div>
    </div>
  );
}
