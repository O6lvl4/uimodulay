// Structural cleanup after naming: splice scaffolding Frames into their parent, and merge
// a container with its only container child (Footer > Footer, Nav > Header) into one node.

import type { LayoutNode } from "./types.ts";

/** Which name survives when two regions merge: the earlier in this list. */
const REGION_RANK = ["Header", "Footer", "Main", "Hero", "Nav", "Sidebar", "Form", "Gallery", "CardGrid", "Section", "Group"];

function rank(t: string): number {
  const i = REGION_RANK.indexOf(t);
  return i < 0 ? REGION_RANK.length : i;
}

function expand(c: LayoutNode): LayoutNode[] {
  return c.type === "Frame" ? c.children.flatMap(expand) : [c];
}

/** A container whose only child is a container becomes one node: outer footprint, inner content, stronger name. */
function absorbOnlyChild(n: LayoutNode): boolean {
  if (n.children.length !== 1 || n.type === "Page") return false;
  const c = n.children[0];
  if (c.children.length === 0 || n.text || c.text) return false;
  const outer = n.bounds[2] * n.bounds[3];
  if (c.bounds[2] * c.bounds[3] < outer * 0.3) return false;
  if (rank(n.type) > rank(c.type)) n.type = c.type;
  n.children = c.children;
  n.layout = c.layout;
  n.columns = c.columns;
  n.rows = c.rows;
  n.hint = [n.hint, c.hint].filter(Boolean).join(",") || undefined;
  return true;
}

export function tidy(n: LayoutNode): void {
  n.children = n.children.flatMap(expand);
  for (const c of n.children) tidy(c);
  let again = true;
  while (again) again = absorbOnlyChild(n);
}
