/**
 * DGN V7 binary parser - extracts line/polyline/shape geometry
 * Note: DGN V8 format is not supported - use File > Save As > DGN V7 or DXF in MicroStation
 */
export function parseDGNV7(buffer) {
  const view = new DataView(buffer);
  const elements = [];

  // Check magic bytes - DGN V7 files start with element type 9 (Cell Library) or TCB
  // We'll attempt to scan from the beginning
  let offset = 0;

  try {
    while (offset < buffer.byteLength - 8) {
      // DGN V7 element header (4 bytes):
      // Word 0 (uint16 LE): bits 0-6 = element type, bit 7 = complex flag
      // Word 1 (uint16 LE): bits 0-5 = level, bits 6-15 = length in words
      const word0 = view.getUint16(offset, true);
      const word1 = view.getUint16(offset + 2, true);

      const elemType = word0 & 0x7F;
      const lengthWords = (word1 >> 6) & 0x3FF;
      const level = word1 & 0x3F;

      // Sanity check
      if (lengthWords < 2 || lengthWords > 4000) {
        offset += 2;
        continue;
      }

      const elemBytes = lengthWords * 2;

      if (offset + elemBytes > buffer.byteLength) break;

      // Type 3: Line element (2 endpoints)
      if (elemType === 3 && elemBytes >= 36) {
        try {
          // After 4-byte header: 4 bytes properties, 16 bytes range, then 2 points × 8 bytes
          const x1 = view.getInt32(offset + 24, true);
          const y1 = view.getInt32(offset + 28, true);
          const x2 = view.getInt32(offset + 32, true);
          const y2 = view.getInt32(offset + 36, true);
          if (isFinite(x1) && Math.abs(x1) < 2147483647) {
            elements.push({ type: 'line', x1, y1, x2, y2, level });
          }
        } catch (_) {}
      }

      // Type 4: Line String (multiple vertices)
      // Type 6: Shape (closed)
      if ((elemType === 4 || elemType === 6) && elemBytes >= 28) {
        try {
          const numVerts = view.getUint16(offset + 24, true);
          if (numVerts >= 2 && numVerts <= 101) {
            const points = [];
            let ok = true;
            for (let v = 0; v < numVerts; v++) {
              const byteOff = offset + 26 + v * 8;
              if (byteOff + 8 > buffer.byteLength) { ok = false; break; }
              const px = view.getInt32(byteOff, true);
              const py = view.getInt32(byteOff + 4, true);
              if (!isFinite(px) || Math.abs(px) >= 2147483647) { ok = false; break; }
              points.push({ x: px, y: py });
            }
            if (ok && points.length >= 2) {
              elements.push({
                type: elemType === 6 ? 'shape' : 'linestring',
                points,
                level,
              });
            }
          }
        } catch (_) {}
      }

      // Type 17: Arc - skip for now, too complex
      // Type 15: Cell header - skip

      offset += elemBytes;
    }
  } catch (err) {
    console.warn('DGN parse stopped early:', err);
  }

  // Normalize coordinates to floating-point world units
  // UOR (units of resolution) in V7 typically 1000 UOR per master unit
  // We'll compute bounds and normalize
  if (elements.length > 0) {
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

    // Scale so the geometry is in reasonable floating-point range
    // Guess UOR factor from range (typical DGN V7 is 1000 UOR/ft or 1000 UOR/m)
    const range = Math.max(maxX - minX, maxY - minY);
    const scale = range > 100000 ? 1 / 1000 : 1; // normalize if UOR scale detected

    for (const el of elements) {
      if (el.type === 'line') {
        el.x1 *= scale; el.y1 *= scale; el.x2 *= scale; el.y2 *= scale;
      } else if (el.points) {
        el.points = el.points.map(p => ({ x: p.x * scale, y: p.y * scale }));
      }
    }
  }

  return elements;
}

export function isDGNV8(buffer) {
  // DGN V8 files start with a specific signature
  // First 8 bytes of V8: {00 01 00 00 FE FF FF FF} in big-endian or similar
  if (buffer.byteLength < 8) return false;
  const view = new DataView(buffer);
  // V8 OLE compound document magic: D0 CF 11 E0 A1 B1 1A E1
  return (
    view.getUint8(0) === 0xD0 &&
    view.getUint8(1) === 0xCF &&
    view.getUint8(2) === 0x11 &&
    view.getUint8(3) === 0xE0
  );
}
