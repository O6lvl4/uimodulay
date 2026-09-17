// The public Layout AST: a versioned, self-describing document that combines
//   - ARIA landmark roles for page regions,
//   - Auto Layout vocabulary (stack / row / grid + gap + padding) for arrangement,
//   - DocLayNet-style content kinds for leaves.
// See docs/LAYOUT-AST.md. Internally we work on LayoutNode; this is the export form.

import { groupRows, type LayoutMode, type Rect } from "./layout.ts";
import type { LayoutNode, Snapshot } from "./types.ts";

export const AST_FORMAT = "uimodulay/layout-ast";
export const AST_VERSION = 1;

export type NodeKind = "region" | "container" | "leaf";

export interface Bounds { x: number; y: number; width: number; height: number }
export interface Padding { top: number; right: number; bottom: number; left: number }

export interface AstLayout {
  mode: LayoutMode;
  columns?: number;
  rows?: number;
  /** spacing along the main axis (between columns for row/split/grid, between rows for stack) */
  gap?: number;
  /** grid only: spacing between rows */
  rowGap?: number;
  padding?: Padding;
}

export interface AstNode {
  id: number;
  type: string;
  kind: NodeKind;
  role?: string;
  content?: string;
  bounds: Bounds;
  layout?: AstLayout;
  text?: string;
  source: { tag: string; hints?: string[] };
  children: AstNode[];
}

export interface LayoutAst {
  format: typeof AST_FORMAT;
  version: typeof AST_VERSION;
  source: {
    url: string;
    viewport: { width: number; height: number };
    document: { height: number };
    capturedAt: string;
    generator: string;
  };
  root: AstNode;
}

/** Module type -> ARIA landmark / structural role. */
export const ROLE_OF: Record<string, string> = {
  Page: "document",
  Header: "banner",
  Nav: "navigation",
  Main: "main",
  Footer: "contentinfo",
  Sidebar: "complementary",
  Form: "form",
  Search: "search",
  Dialog: "dialog",
  Article: "article",
  Section: "region",
  Hero: "region",
  Feature: "region",
  Gallery: "region",
  CardGrid: "region",
  List: "list",
  Item: "listitem",
  Table: "table",
  Figure: "figure",
};

/** Leaf type -> content kind (DocLayNet-flavoured). */
export const CONTENT_OF: Record<string, string> = {
  Heading: "heading",
  Text: "text",
  Paragraph: "paragraph",
  Brand: "text",
  Image: "image",
  ImageLink: "image",
  Backdrop: "backdrop",
  Icon: "icon",
  Logo: "logo",
  Link: "link",
  Button: "button",
  Input: "input",
  Label: "text",
  Badge: "text",
  Divider: "divider",
  Panel: "panel",
  Block: "block",
};

function median(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function rectOf(c: LayoutNode): Rect {
  return { x: c.bounds[0], y: c.bounds[1], w: c.bounds[2], h: c.bounds[3] };
}

function horizontalGaps(rects: Rect[], rows: number[][]): number[] {
  const out: number[] = [];
  for (const row of rows) {
    for (let i = 1; i < row.length; i++) {
      const a = rects[row[i - 1]];
      out.push(Math.max(0, rects[row[i]].x - (a.x + a.w)));
    }
  }
  return out;
}

function verticalGaps(rects: Rect[], rows: number[][]): number[] {
  const out: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const bottom = Math.max(...rows[i - 1].map((k) => rects[k].y + rects[k].h));
    const top = Math.min(...rows[i].map((k) => rects[k].y));
    out.push(Math.max(0, top - bottom));
  }
  return out;
}

function gaps(n: LayoutNode): { gap?: number; rowGap?: number } {
  const rects = n.children.map(rectOf);
  if (rects.length < 2 || !n.layout || n.layout === "flow") return {};
  const rows = groupRows(rects);
  const across = median(horizontalGaps(rects, rows));
  const down = median(verticalGaps(rects, rows));
  if (n.layout === "stack") return { gap: down };
  if (n.layout === "grid") return { gap: across, rowGap: down };
  return { gap: across };
}

function padding(n: LayoutNode): Padding {
  const [x, y, w, h] = n.bounds;
  const left = Math.min(...n.children.map((c) => c.bounds[0]));
  const top = Math.min(...n.children.map((c) => c.bounds[1]));
  const right = Math.max(...n.children.map((c) => c.bounds[0] + c.bounds[2]));
  const bottom = Math.max(...n.children.map((c) => c.bounds[1] + c.bounds[3]));
  return { top: Math.max(0, top - y), right: Math.max(0, x + w - right), bottom: Math.max(0, y + h - bottom), left: Math.max(0, left - x) };
}

function layoutOf(n: LayoutNode): AstLayout {
  const out: AstLayout = { mode: n.layout ?? "stack", ...gaps(n), padding: padding(n) };
  if (n.columns) out.columns = n.columns;
  if (n.rows) out.rows = n.rows;
  return out;
}

function kindOf(n: LayoutNode): NodeKind {
  if (n.children.length === 0) return "leaf";
  return n.type in ROLE_OF ? "region" : "container";
}

function nodeOf(n: LayoutNode, id: number): AstNode {
  const kind = kindOf(n);
  const out: AstNode = {
    id,
    type: n.type,
    kind,
    bounds: { x: n.bounds[0], y: n.bounds[1], width: n.bounds[2], height: n.bounds[3] },
    source: { tag: n.tag },
    children: [],
  };
  if (ROLE_OF[n.type]) out.role = ROLE_OF[n.type];
  if (kind === "leaf") out.content = CONTENT_OF[n.type] ?? "block";
  else out.layout = layoutOf(n);
  if (n.text) out.text = n.text;
  if (n.hint) out.source.hints = n.hint.split(",");
  return out;
}

export function toAst(tree: LayoutNode, snap: Snapshot, generator = "uimodulay"): LayoutAst {
  let next = 0;
  const conv = (n: LayoutNode): AstNode => {
    const out = nodeOf(n, next);
    next += 1;
    out.children = n.children.map(conv);
    return out;
  };
  return {
    format: AST_FORMAT,
    version: AST_VERSION,
    source: {
      url: snap.url,
      viewport: { width: snap.width, height: snap.height },
      document: { height: snap.docHeight },
      capturedAt: new Date().toISOString(),
      generator,
    },
    root: conv(tree),
  };
}
