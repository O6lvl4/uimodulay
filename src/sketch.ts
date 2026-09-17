// Render a Layout AST as a hand-drawn, monochrome wireframe (an SVG string).
// Pure and dependency-free: the CLI's --sketch and the browser sketchbook share it
// (viewer/build.mjs transpiles this file to viewer/sketch.js).

import type { AstNode, LayoutAst } from "./ast.ts";

export interface SketchOptions {
  /** rendered width in px (default 720); height follows the document's aspect */
  width?: number;
  /** deepest level to draw; deeper containers are hatched (default: all) */
  depth?: number;
  /** print module names on containers (default true) */
  labels?: boolean;
  /** seed for the pencil wobble (default 7) */
  seed?: number;
}

interface Box { X: number; Y: number; W: number; H: number }
type Rng = () => number;

const LEAF_GLYPH: Record<string, string> = {
  heading: "heading", text: "text", paragraph: "text", image: "image", logo: "image", icon: "icon",
  link: "link", button: "button", input: "input", divider: "divider", panel: "box", block: "box", backdrop: "backdrop",
};

const STYLE = `
  .uimodulay-sketch { --sk-paper: #fafaf7; --sk-ink: #1c1c1a; --sk-pencil: #7a7a75; font-family: "Architects Daughter", "Comic Sans MS", cursive, sans-serif; }
  .uimodulay-sketch .paper { fill: var(--sk-paper); }
  .uimodulay-sketch path { fill: none; stroke-linecap: round; stroke-linejoin: round; }
  .uimodulay-sketch .ink { stroke: var(--sk-ink); stroke-width: 1.3; }
  .uimodulay-sketch .ink.thick { stroke-width: 2.4; }
  .uimodulay-sketch .pencil { stroke: var(--sk-pencil); stroke-width: 0.9; }
  .uimodulay-sketch .p2 { opacity: 0.45; }
  .uimodulay-sketch circle.ink { fill: none; }
  .uimodulay-sketch .hatch { stroke: var(--sk-pencil); stroke-width: 0.5; opacity: 0.5; }
  .uimodulay-sketch .backdrop { fill: none; stroke: var(--sk-pencil); stroke-width: 0.6; stroke-dasharray: 2 4; opacity: 0.5; }
  .uimodulay-sketch .label { fill: var(--sk-ink); opacity: 0.85; }
  .uimodulay-sketch g.node:hover > path.ink, .uimodulay-sketch g.node:hover > path.pencil { stroke-width: 2.2; }
`;

/** Small deterministic PRNG (mulberry32) so the same tree always draws the same way. */
function rng(seed: number): Rng {
  let a = (seed * 2654435761 + 1013904223) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n: number): string => String(Math.round(n * 10) / 10);

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

type Pt = [number, number];

/** A wobbly line from a to b: a quadratic curve whose control point drifts. */
function wobble(r: Rng, a: Pt, b: Pt, amp: number): string {
  const j = (v: number): string => f(v + (r() - 0.5) * amp);
  const mx = (a[0] + b[0]) / 2 + (r() - 0.5) * amp * 2;
  const my = (a[1] + b[1]) / 2 + (r() - 0.5) * amp * 2;
  return `M${j(a[0])} ${j(a[1])} Q${f(mx)} ${f(my)} ${j(b[0])} ${j(b[1])}`;
}

type Seg = [Pt, Pt];

function line(r: Rng, cls: string, seg: Seg, amp: number): string {
  return `<path class="${cls}" d="${wobble(r, seg[0], seg[1], amp)}"/>`;
}

/** A rectangle drawn twice, as a pencil would: two slightly different passes, overshooting corners. */
function sketchRect(r: Rng, b: Box, amp: number, cls: string): string {
  const o = amp * 1.5; // corner overshoot
  const R = b.X + b.W;
  const B = b.Y + b.H;
  const pass = (): string => [
    wobble(r, [b.X - o, b.Y], [R + o * 0.5, b.Y], amp),
    wobble(r, [R, b.Y - o], [R, B + o * 0.5], amp),
    wobble(r, [R + o, B], [b.X - o * 0.5, B], amp),
    wobble(r, [b.X, B + o], [b.X, b.Y - o * 0.5], amp),
  ].join(" ");
  return `<path class="${cls}" d="${pass()}"/><path class="${cls} p2" d="${pass()}"/>`;
}

/** Lines of text: full-width strokes with a shorter last line. */
function textLines(r: Rng, b: Box, lineH: number, thick: boolean): string {
  const out: string[] = [];
  const n = Math.max(1, Math.min(Math.floor(b.H / lineH), 40));
  const pad = lineH * 0.5;
  for (let i = 0; i < n; i++) {
    const ly = b.Y + pad + i * lineH;
    if (ly > b.Y + b.H) break;
    const last = i === n - 1 && n > 1;
    const len = b.W * (last ? 0.45 + r() * 0.3 : 0.9 + r() * 0.1);
    out.push(line(r, thick ? "ink thick" : "pencil", [[b.X, ly], [b.X + len, ly]], thick ? 1 : 0.6));
  }
  return out.join("");
}

function hatch(b: Box): string {
  const out: string[] = [];
  const step = 9;
  for (let d = step; d < b.W + b.H; d += step) {
    const x1 = Math.max(b.X, b.X + d - b.H);
    const y1 = Math.min(b.Y + b.H, b.Y + d);
    const x2 = Math.min(b.X + b.W, b.X + d);
    const y2 = Math.max(b.Y, b.Y + d - b.W);
    out.push(`<path class="hatch" d="M${f(x1)} ${f(y1)} L${f(x2)} ${f(y2)}"/>`);
  }
  return out.join("");
}

type Glyph = (r: Rng, b: Box, node: AstNode, k: number) => string;

const GLYPHS: Record<string, Glyph> = {
  heading: (r, b) => {
    const lh = Math.min(b.H, Math.max(10, b.H / Math.max(1, Math.round(b.H / 26))));
    return textLines(r, { ...b, X: b.X + 2, W: b.W - 4 }, lh, true);
  },
  text: (r, b, _n, k) => textLines(r, { ...b, X: b.X + 2, W: b.W - 4 }, Math.min(b.H, Math.max(6, 8 * k)), false),
  image: (r, b) => {
    const amp = Math.min(1.4, Math.max(0.5, b.W / 400));
    return sketchRect(r, b, amp, "ink") + line(r, "pencil", [[b.X, b.Y], [b.X + b.W, b.Y + b.H]], amp) + line(r, "pencil", [[b.X + b.W, b.Y], [b.X, b.Y + b.H]], amp);
  },
  icon: (r, b) => {
    const rad = Math.min(b.W, b.H) / 2.4;
    return `<circle class="ink" cx="${f(b.X + b.W / 2 + (r() - 0.5))}" cy="${f(b.Y + b.H / 2 + (r() - 0.5))}" r="${f(rad)}"/>`;
  },
  link: (r, b, node, k) => {
    const ly = b.Y + b.H * 0.55;
    const len = Math.min(b.W, Math.max(8, (node.text?.length ?? 6) * 4.2 * k));
    return line(r, "ink", [[b.X, ly], [b.X + len, ly]], 0.6) + line(r, "pencil", [[b.X, ly + 3], [b.X + len, ly + 3]], 0.5);
  },
  button: (r, b) => {
    const ly = b.Y + b.H / 2;
    return sketchRect(r, b, Math.min(1.4, Math.max(0.5, b.W / 400)), "ink") + line(r, "ink thick", [[b.X + b.W * 0.25, ly], [b.X + b.W * 0.75, ly]], 0.8);
  },
  input: (r, b) => {
    const ly = b.Y + b.H / 2;
    return sketchRect(r, b, 0.7, "pencil") + line(r, "pencil", [[b.X + 6, ly], [b.X + Math.min(b.W - 6, 40), ly]], 0.5);
  },
  divider: (r, b) => line(r, "pencil", [[b.X, b.Y + b.H / 2], [b.X + b.W, b.Y + b.H / 2]], 0.6),
  backdrop: (_r, b) => `<rect class="backdrop" x="${f(b.X + 1)}" y="${f(b.Y + 1)}" width="${f(Math.max(0, b.W - 2))}" height="${f(Math.max(0, b.H - 2))}"/>`,
  box: (r, b) => sketchRect(r, b, Math.min(1.4, Math.max(0.5, b.W / 400)), "pencil"),
};

function labelText(node: AstNode): string {
  const l = node.layout;
  if (!l || l.mode === "stack" || l.mode === "flow") return node.type;
  return `${node.type} [${l.mode}${l.columns ? " " + l.columns : ""}]`;
}

function titleOf(node: AstNode): string {
  const b = node.bounds;
  const extra = [node.role, node.content].filter(Boolean).map((s) => " · " + s).join("");
  return `#${node.id} ${labelText(node)}${extra} — ${b.width}×${b.height} @ ${b.x},${b.y}${node.text ? "\n" + node.text : ""}`;
}

interface Draw { parts: string[]; r: Rng; s: number; k: number; maxDepth: number; labels: boolean }

function boxOf(node: AstNode, s: number): Box {
  return { X: node.bounds.x * s, Y: node.bounds.y * s, W: node.bounds.width * s, H: node.bounds.height * s };
}

/** A container's label sits top-left, unless a child container hugs that corner: then top-right. */
function label(d: Draw, node: AstNode, b: Box, depth: number): string {
  const fs = Math.max(8, Math.min(13, 11 * d.k));
  const crowded = depth < d.maxDepth && node.children.some((c) => c.children.length > 0 && (c.bounds.x - node.bounds.x) * d.s < 18 && (c.bounds.y - node.bounds.y) * d.s < fs + 6);
  const lx = crowded ? b.X + b.W - 5 : b.X + 5;
  const anchor = crowded ? ' text-anchor="end"' : "";
  return `<text class="label" x="${f(lx)}" y="${f(b.Y + fs + 2)}" font-size="${f(fs)}"${anchor}>${esc(labelText(node))}</text>`;
}

function body(d: Draw, node: AstNode, b: Box, depth: number): string {
  const leaf = node.kind === "leaf" || node.children.length === 0;
  if (leaf) return GLYPHS[LEAF_GLYPH[node.content ?? ""] ?? "box"](d.r, b, node, d.k);
  if (depth === d.maxDepth) return sketchRect(d.r, b, 1, "pencil") + hatch(b);
  if (depth === 0) return "";
  const region = node.kind === "region";
  return sketchRect(d.r, b, region ? 1.6 : 1.0, region ? "ink" : "pencil");
}

function open(node: AstNode, depth: number, leaf: boolean): string {
  const cls = leaf ? "leaf" : node.kind;
  return `<g class="node d${Math.min(depth, 6)} ${cls}" data-id="${node.id}" data-type="${esc(node.type)}"><title>${esc(titleOf(node))}</title>`;
}

function labelled(d: Draw, b: Box, depth: number): boolean {
  return d.labels && depth > 0 && b.W > 40 && b.H > 14;
}

function draw(d: Draw, node: AstNode, depth: number): void {
  if (depth > d.maxDepth) return;
  const b = boxOf(node, d.s);
  if (b.W < 1.5 || b.H < 1.5) return;
  const leaf = node.kind === "leaf" || node.children.length === 0;
  d.parts.push(open(node, depth, leaf), body(d, node, b, depth));
  if (leaf) {
    d.parts.push("</g>");
    return;
  }
  if (labelled(d, b, depth)) d.parts.push(label(d, node, b, depth));
  if (depth < d.maxDepth) node.children.forEach((c) => draw(d, c, depth + 1));
  d.parts.push("</g>");
}

/** Render a Layout AST document (or a bare root node) as a hand-drawn SVG. */
export function sketchSvg(ast: LayoutAst | AstNode, opt: SketchOptions = {}): string {
  const root = "root" in ast ? ast.root : ast;
  const docW = root.bounds.width || 1440;
  const docH = root.bounds.height || 900;
  const width = opt.width ?? 720;
  const s = width / docW;
  const height = docH * s;
  const d: Draw = {
    parts: [],
    r: rng(opt.seed ?? 7),
    s,
    k: Math.max(0.6, Math.min(1.4, s * 2)), // typographic scale factor for glyph density
    maxDepth: opt.depth ?? Infinity,
    labels: opt.labels ?? true,
  };
  draw(d, root, 0);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(width)} ${f(height)}" width="${f(width)}" height="${f(height)}" class="uimodulay-sketch" data-doc-width="${docW}" data-doc-height="${docH}">
<style>${STYLE}</style>
<rect class="paper" x="0" y="0" width="${f(width)}" height="${f(height)}"/>
${d.parts.join("\n")}
</svg>`;
}
