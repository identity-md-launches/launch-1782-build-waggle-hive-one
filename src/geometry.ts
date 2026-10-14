import { SEAT_COUNT } from './data';
export interface Geometry { width: number; height: number; cols: number; pitch: number; radius: number; spacing: number }
export function geometry(width: number): Geometry {
  const inner = width - 8;
  const cols = Math.min(40, Math.max(16, Math.floor(inner / 14 - 0.5)));
  const pitch = inner / (cols + 0.5);
  const radius = pitch / Math.sqrt(3);
  const spacing = 1.5 * radius;
  return { width, height: 8 + radius * 2 + (Math.ceil(SEAT_COUNT / cols) - 1) * spacing, cols, pitch, radius, spacing };
}
export function center(id: number, g: Geometry) {
  const row = Math.floor(id / g.cols);
  return { x: 4 + g.pitch / 2 + (id % g.cols + (row % 2) / 2) * g.pitch, y: 4 + g.radius + row * g.spacing };
}
export function hitTest(x: number, y: number, g: Geometry): number | null {
  if (x < 0 || y < 0 || x > g.width || y > g.height) return null;
  const row = Math.round((y - 4 - g.radius) / g.spacing);
  let nearest: number | null = null;
  let distance = Infinity;
  for (let r = row - 1; r <= row + 1; r++) {
    if (r < 0) continue;
    const col = Math.round((x - 4 - g.pitch / 2) / g.pitch - (r % 2) / 2);
    for (let c = col - 1; c <= col + 1; c++) {
      const id = r * g.cols + c;
      if (c < 0 || c >= g.cols || id >= SEAT_COUNT) continue;
      const p = center(id, g);
      const d = (x - p.x) ** 2 + (y - p.y) ** 2;
      if (d < distance) { nearest = id; distance = d; }
    }
  }
  if (nearest === null) return null;
  const p = center(nearest, g);
  const dx = Math.abs(x - p.x);
  const dy = Math.abs(y - p.y);
  // Pointy hex containment; gaps and the outside of the partial final row are not seats.
  const r = g.radius * 0.9;
  return dx <= Math.sqrt(3) * r / 2 && dy <= r && dx + Math.sqrt(3) * dy <= Math.sqrt(3) * r ? nearest : null;
}
export function keyboardSeat(id: number, key: string, cols: number): number {
  const rowStart = Math.floor(id / cols) * cols;
  const candidates: Record<string, number> = {
    ArrowLeft: id - 1, ArrowRight: id + 1, ArrowUp: id - cols, ArrowDown: id + cols,
    Home: rowStart, End: Math.min(rowStart + cols - 1, SEAT_COUNT - 1),
    PageUp: id - cols * 10, PageDown: id + cols * 10,
  };
  return Math.min(SEAT_COUNT - 1, Math.max(0, candidates[key] ?? id));
}
