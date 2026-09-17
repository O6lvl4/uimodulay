// Build a tree from the flat probe output, drop noise, and compress wrapper chains.
// This is the "DOM structure != layout structure" step.

import type { RawBox, Snapshot } from "./types.ts";

export interface Node {
  box: RawBox;
  children: Node[];
  /** semantic tags / roles of wrappers that were collapsed into this node */
  hints: string[];
}

const SEMANTIC = new Set([
  "header", "nav", "main", "footer", "aside", "section", "article", "form", "ul", "ol", "li",
  "figure", "table", "dialog",
]);
const INLINE_TEXT = new Set(["span", "strong", "em", "b", "i", "u", "small", "sub", "sup", "code", "abbr", "mark", "time", "label"]);

/** A wrapper adds nothing when its child fills it; 0.55 lets centered content columns merge into their section. */
const FILL_RATIO = 0.55;

export function buildTree(snap: Snapshot): Node {
  const nodes: Node[] = snap.boxes.map((box) => ({ box, children: [], hints: [] }));
  const roots: Node[] = [];
  for (const n of nodes) {
    if (n.box.parent < 0) roots.push(n);
    else nodes[n.box.parent].children.push(n);
  }
  const root = roots.length === 1 ? roots[0] : { box: { ...blank(), tag: "body", w: snap.width, h: snap.docHeight }, children: roots, hints: [] };
  prune(root, snap);
  root.children = root.children.map((c) => collapse(c));
  flattenInline(root);
  return root;
}

function blank(): RawBox {
  return {
    id: -1, parent: -1, tag: "div", role: "", x: 0, y: 0, w: 0, h: 0, display: "block", position: "static",
    bg: false, text: "", textLen: 0, img: false, link: false, heading: 0, id_attr: "", cls: "",
  };
}

// ── pruning ───────────────────────────────────────────────────────────────

/** Parked off-screen (skip links), or a fixed overlay far down the screen (cookie banners, modals). */
function offLayout(b: RawBox, snap: Snapshot): boolean {
  if (b.x >= snap.width || b.y >= snap.docHeight + 200) return true;
  return b.position === "fixed" && b.y > snap.height * 0.5 && b.textLen > 0;
}

/** Does this box carry anything: pixels of its own, text, or an interaction? */
function carries(c: Node, snap: Snapshot): boolean {
  const b = c.box;
  if (offLayout(b, snap)) return false;
  if (b.img) return true;
  if (b.w < 4 || b.h < 4) return false;
  const empty = c.children.length === 0 && b.textLen === 0 && !b.link && !b.bg;
  return !empty;
}

function prune(n: Node, snap: Snapshot): void {
  for (const c of n.children) prune(c, snap);
  n.children = n.children.filter((c) => carries(c, snap));
}

// ── wrapper compression ───────────────────────────────────────────────────

function coverage(outer: RawBox, inner: RawBox): number {
  return (inner.w * inner.h) / Math.max(1, outer.w * outer.h);
}

function isSemantic(b: RawBox): boolean {
  return SEMANTIC.has(b.tag) || b.role !== "";
}

function hintOf(b: RawBox): string[] {
  const out: string[] = [];
  if (SEMANTIC.has(b.tag)) out.push(b.tag);
  if (b.role) out.push("role:" + b.role);
  return out;
}

function isLeafText(c: Node): boolean {
  return c.children.length === 0 && !c.box.img && !c.box.link && !c.box.heading;
}

/** Can this wrapper and its only child become one node? */
function mergeable(n: Node, child: Node): boolean {
  const b = n.box;
  if (b.text !== "" || b.img || b.heading) return false;
  // A box holding a single leaf IS that leaf's module, however much padding it has.
  if (child.children.length > 0 && coverage(b, child.box) < FILL_RATIO) return false;
  // Keep a link wrapper around plain text: the interaction is the meaning.
  return !(b.link && !child.box.link && !child.box.img);
}

/** The wrapper's rect is the module's footprint; the child's semantics are its content. */
function merge(n: Node, child: Node): Node {
  const b = n.box;
  const box: RawBox = { ...child.box, x: b.x, y: b.y, w: b.w, h: b.h };
  // The outer semantic tag is the more meaningful one for a wrapper chain (header > div > nav keeps both).
  if (isSemantic(b) && !isSemantic(child.box)) {
    box.tag = b.tag;
    box.role = b.role;
  }
  box.link = b.link || child.box.link;
  box.bg = b.bg || child.box.bg;
  box.img = b.img || child.box.img;
  return { box, children: child.children, hints: [...hintOf(b), ...n.hints, ...child.hints] };
}

/** A coloured box holding one text is the module (a badge): keep the box, absorb the text. */
function absorbText(n: Node, child: Node): Node {
  const b = n.box;
  return { box: { ...b, text: child.box.text || b.text, textLen: Math.max(b.textLen, child.box.textLen) }, children: [], hints: n.hints };
}

/**
 * Compress `div > div > div > X` into `X` when each wrapper adds nothing.
 * Semantic wrappers (header/nav/...) survive as hints on the child.
 */
export function collapse(start: Node): Node {
  let n = start;
  n.children = n.children.map((c) => collapse(c));
  while (n.children.length === 1) {
    const child = n.children[0];
    if (!mergeable(n, child)) break;
    if (isLeafText(child) && n.box.bg && !child.box.bg) return absorbText(n, child);
    n = merge(n, child);
  }
  return n;
}

// ── inline runs ───────────────────────────────────────────────────────────

function isInlineText(c: Node): boolean {
  const b = c.box;
  if (c.children.length > 0 || b.img || b.heading) return false;
  if (b.link && b.tag !== "a") return false;
  const inline = b.display.startsWith("inline") || INLINE_TEXT.has(b.tag);
  // a link inside a sentence is inline text; a standalone link (block, or the only text) is not.
  if (b.link && (!inline || b.textLen === 0)) return false;
  return inline;
}

/** A paragraph made of spans is one Text leaf; it inherits the run's words and link-ness. */
function flattenInline(n: Node): void {
  for (const c of n.children) flattenInline(c);
  if (n.children.length === 0 || n.box.textLen === 0 || !n.children.every(isInlineText)) return;
  if (n.box.text === "") {
    n.box.text = n.children.map((c) => c.box.text).filter(Boolean).join(" ").slice(0, 80);
    if (n.children.every((c) => c.box.link)) n.box.link = true;
  }
  n.children = [];
}
