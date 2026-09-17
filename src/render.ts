// Text rendering of a layout tree, and a compact numbered form for the AI pass.

import type { LayoutNode } from "./types.ts";
import type { AstNode } from "./ast.ts";

export interface RenderOptions { bounds?: boolean; maxDepth?: number }

interface Walk { lines: string[]; opts: RenderOptions }
/** Where a node sits in the drawing: the prefix inherited from its ancestors, and whether it closes its parent's list. */
interface Spot { prefix: string; isLast: boolean; depth: number }

const ROOT: Spot = { prefix: "", isLast: true, depth: 0 };

/** The connector drawn before this node, and the prefix its children inherit. */
function connectors(at: Spot): { branch: string; prefix: string } {
  if (at === ROOT) return { branch: "", prefix: "" };
  if (at.isLast) return { branch: at.prefix + "└── ", prefix: at.prefix + "    " };
  return { branch: at.prefix + "├── ", prefix: at.prefix + "│   " };
}

function walk(w: Walk, n: LayoutNode, at: Spot): void {
  const { branch, prefix } = connectors(at);
  w.lines.push(branch + label(n, w.opts.bounds ?? false));
  if (w.opts.maxDepth !== undefined && at.depth >= w.opts.maxDepth) return;
  n.children.forEach((c, i) => walk(w, c, { prefix, isLast: i === n.children.length - 1, depth: at.depth + 1 }));
}

export function renderTree(node: LayoutNode, opts: RenderOptions = {}): string {
  const w: Walk = { lines: [], opts };
  walk(w, node, ROOT);
  return w.lines.join("\n");
}

function layoutTag(n: LayoutNode): string | undefined {
  if (!n.layout || n.layout === "stack") return undefined;
  if (n.layout === "flow") return "[flow]";
  return `[${n.layout}${n.columns ? " " + n.columns : ""}]`;
}

export function label(n: LayoutNode, bounds: boolean): string {
  const parts: string[] = [n.type];
  const tag = layoutTag(n);
  if (tag) parts.push(tag);
  if (bounds) parts.push(`${n.bounds[2]}×${n.bounds[3]}@${n.bounds[0]},${n.bounds[1]}`);
  if (n.text && n.children.length === 0) parts.push(JSON.stringify(trunc(n.text, 32)));
  return parts.join(" ");
}

function trunc(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Same drawing for an exported AST node (bounds/layout as objects). */
export function renderAst(node: AstNode, opts: RenderOptions = {}): string {
  return renderTree(fromAst(node), opts);
}

export function fromAst(n: AstNode): LayoutNode {
  return {
    type: n.type,
    tag: n.source.tag,
    bounds: [n.bounds.x, n.bounds.y, n.bounds.width, n.bounds.height],
    layout: n.layout?.mode,
    columns: n.layout?.columns,
    rows: n.layout?.rows,
    text: n.text,
    hint: n.source.hints?.join(","),
    children: n.children.map(fromAst),
  };
}

/** Every node in pre-order; the index is the id the AI pass addresses. */
export function index(root: LayoutNode): LayoutNode[] {
  const out: LayoutNode[] = [];
  const visit = (n: LayoutNode): void => {
    out.push(n);
    n.children.forEach(visit);
  };
  visit(root);
  return out;
}

function outlineLine(n: LayoutNode, id: number, depth: number): string {
  const b = n.bounds;
  const bits = [`#${id}`, n.type, `<${n.tag}>`, `${b[2]}x${b[3]}@${b[0]},${b[1]}`];
  if (n.layout) bits.push(n.layout + (n.columns ? ":" + n.columns : ""));
  if (n.text) bits.push(JSON.stringify(trunc(n.text, 60)));
  if (n.hint) bits.push("{" + n.hint + "}");
  return "  ".repeat(depth) + bits.join(" ");
}

/** Compact, id-prefixed outline used as the prompt for the AI relabel pass. */
export function renderForAI(root: LayoutNode): string {
  const ids = new Map<LayoutNode, number>(index(root).map((n, i) => [n, i]));
  const lines: string[] = [];
  const visit = (n: LayoutNode, depth: number): void => {
    lines.push(outlineLine(n, ids.get(n) ?? 0, depth));
    n.children.forEach((c) => visit(c, depth + 1));
  };
  visit(root, 0);
  return lines.join("\n");
}
