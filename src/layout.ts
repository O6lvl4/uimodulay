// Geometric layout detection: given the rectangles of a container's children,
// decide whether they form a stack, a row, a split, a grid, or free flow.

export interface Rect { x: number; y: number; w: number; h: number }

export type LayoutMode = "stack" | "row" | "split" | "grid" | "flow";

export interface LayoutInfo {
  layout: LayoutMode;
  columns?: number;
  rows?: number;
  /** children indices grouped into visual rows, top to bottom */
  rowGroups: number[][];
}

interface Band { top: number; bottom: number; idx: number[] }

function joins(band: Band, r: Rect): boolean {
  const overlap = Math.min(band.bottom, r.y + r.h) - Math.max(band.top, r.y);
  const minH = Math.max(1, Math.min(r.h, band.bottom - band.top));
  return overlap > 0.5 * minH;
}

/** Group rectangles into visual rows by vertical overlap. */
export function groupRows(rects: Rect[]): number[][] {
  const order = rects.map((_, i) => i).sort((a, b) => rects[a].y - rects[b].y || rects[a].x - rects[b].x);
  const bands: Band[] = [];
  for (const i of order) {
    const r = rects[i];
    const last = bands[bands.length - 1];
    if (last && joins(last, r)) {
      last.idx.push(i);
      last.top = Math.min(last.top, r.y);
      last.bottom = Math.max(last.bottom, r.y + r.h);
    } else {
      bands.push({ top: r.y, bottom: r.y + r.h, idx: [i] });
    }
  }
  return bands.map((b) => b.idx.sort((a, c) => rects[a].x - rects[c].x));
}

function similar(values: number[], tolerance = 0.25): boolean {
  if (values.length < 2) return true;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return mean === 0 || values.every((v) => Math.abs(v - mean) / mean <= tolerance);
}

function singleRow(rects: Rect[], parent: Rect, rowGroups: number[][]): LayoutInfo {
  const n = rects.length;
  if (n !== 2) return { layout: "row", columns: n, rows: 1, rowGroups };
  const wide = rects.every((r) => r.w >= parent.w * 0.25);
  return { layout: wide ? "split" : "row", columns: 2, rows: 1, rowGroups };
}

/** Every full row has the same count k >= 2 and the cells are alike in width. */
function isGrid(rects: Rect[], rowGroups: number[][]): boolean {
  const counts = rowGroups.map((g) => g.length);
  const k = counts[0];
  const fullRowsMatch = counts.slice(0, -1).every((c) => c === k);
  const lastFits = counts[counts.length - 1] <= k;
  return k >= 2 && fullRowsMatch && lastFits && similar(rects.map((r) => r.w));
}

/** Two children beside each other, one taller than the other (text + image), still read as a split. */
function sideBySide(rects: Rect[]): boolean {
  if (rects.length !== 2) return false;
  const [a, b] = rects;
  return a.x + a.w <= b.x + 4 || b.x + b.w <= a.x + 4;
}

export function detectLayout(rects: Rect[], parent: Rect): LayoutInfo | undefined {
  if (rects.length < 2) return undefined;
  const rowGroups = groupRows(rects);
  const rows = rowGroups.length;
  if (rows === 1) return singleRow(rects, parent, rowGroups);
  if (rows === rects.length) return { layout: "stack", rows, rowGroups };
  if (isGrid(rects, rowGroups)) return { layout: "grid", columns: rowGroups[0].length, rows, rowGroups };
  if (sideBySide(rects)) return { layout: "split", columns: 2, rows: 1, rowGroups: [[0, 1]] };
  return { layout: "flow", rows, rowGroups };
}
