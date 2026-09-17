// Naming: turn a collapsed geometry tree into a semantic layout tree.
// Evidence, strongest first: ARIA landmarks and semantic tags, then position and shape
// on the page, then what the children are made of. Every rule is a small predicate;
// the order of the rule lists is the priority.

import { detectLayout, type Rect } from "./layout.ts";
import { tidy } from "./tidy.ts";
import type { Node } from "./tree.ts";
import type { LayoutNode, RawBox, Snapshot } from "./types.ts";

export interface Ctx {
  vw: number;
  vh: number;
  docH: number;
  depth: number;
  parentType: string;
  index: number;
}

const LANDMARK: Record<string, string> = {
  header: "Header", "role:banner": "Header",
  nav: "Nav", "role:navigation": "Nav",
  main: "Main", "role:main": "Main",
  footer: "Footer", "role:contentinfo": "Footer",
  aside: "Sidebar", "role:complementary": "Sidebar",
  form: "Form", "role:form": "Form", "role:search": "Search",
  article: "Article", section: "Section", figure: "Figure", table: "Table",
  dialog: "Dialog", "role:dialog": "Dialog",
  ul: "List", ol: "List", li: "Item", "role:list": "List", "role:listitem": "Item",
};

const LINKISH = new Set(["Link", "Button", "ImageLink"]);
const IMAGEISH = new Set(["Image", "ImageLink"]);

function landmark(n: Node): string | undefined {
  const b = n.box;
  const keys = [b.role ? "role:" + b.role : "", b.tag, ...n.hints];
  return keys.map((k) => LANDMARK[k]).find(Boolean);
}

function rect(n: Node): Rect {
  return { x: n.box.x, y: n.box.y, w: n.box.w, h: n.box.h };
}

function has(children: LayoutNode[], types: string[]): boolean {
  return children.some((c) => types.includes(c.type) || has(c.children, types));
}

function count(children: LayoutNode[], pred: (c: LayoutNode) => boolean): number {
  return children.filter(pred).length;
}

// ── leaves ────────────────────────────────────────────────────────────────

/** Scenery, not a module: page-wide and screen-tall, spilling past the viewport, or simply enormous. */
function isBackdrop(b: RawBox, ctx: Ctx): boolean {
  const spills = b.x < -20 || b.x + b.w > ctx.vw + 20;
  return (b.w >= ctx.vw * 0.9 && b.h >= ctx.vh * 1.2) || (spills && b.w >= ctx.vw * 0.6) || b.w * b.h >= ctx.vw * ctx.vh * 1.5;
}

function imageType(b: RawBox, ctx: Ctx): string {
  if (b.w <= 48 && b.h <= 48) return "Icon";
  if (isBackdrop(b, ctx)) return "Backdrop";
  if (b.link && ctx.parentType === "Header" && b.x < ctx.vw * 0.35) return "Logo";
  return b.link ? "ImageLink" : "Image";
}

const INPUT_TAGS = new Set(["input", "select", "textarea"]);

/** A padded, coloured link with a few words is a button in disguise. */
function isCta(b: RawBox): boolean {
  return b.bg && b.textLen > 0 && b.textLen < 40 && b.h >= 32;
}

function controlType(b: RawBox): string | undefined {
  if (b.tag === "button" || b.role === "button") return "Button";
  if (INPUT_TAGS.has(b.tag)) return "Input";
  if (!b.link) return undefined;
  return isCta(b) ? "Button" : "Link";
}

function textType(b: RawBox, ctx: Ctx): string {
  if (b.textLen >= 140) return "Paragraph";
  if (b.textLen > 0) return "Text";
  if (b.bg && b.w >= ctx.vw * 0.3) return "Panel";
  if (b.h <= 4 && b.w >= 60) return "Divider";
  return "Block";
}

export function leafType(n: Node, ctx: Ctx): string {
  const b = n.box;
  if (b.heading) return "Heading";
  if (b.img) return imageType(b, ctx);
  return controlType(b) ?? textType(b, ctx);
}

// ── containers ────────────────────────────────────────────────────────────

interface Container {
  n: Node;
  b: RawBox;
  children: LayoutNode[];
  layout: string | undefined;
  lm: string | undefined;
  wide: boolean;
  links: number;
  ctx: Ctx;
}

function describe(n: Node, children: LayoutNode[], layout: string | undefined, ctx: Ctx): Container {
  const b = n.box;
  let lm = landmark(n);
  // A <header> that is not at the top, or as tall as a screen, is a section header — usually the hero.
  if (lm === "Header" && (b.y > 150 || b.h >= ctx.vh * 0.35)) lm = undefined;
  // A <footer> that is narrow or sits in the upper half is a card's footer, not the page's.
  if (lm === "Footer" && (b.w < ctx.vw * 0.6 || b.y + b.h < ctx.docH * 0.5)) lm = undefined;
  return { n, b, children, layout, lm, wide: b.w >= ctx.vw * 0.8, links: count(children, (c) => LINKISH.has(c.type)), ctx };
}

/** A wrapper that holds the page's regions is scaffolding; `tidy` splices it away. */
function frameRule(c: Container): string | undefined {
  const wide = (k: LayoutNode): boolean => k.bounds[2] >= c.ctx.vw * 0.8;
  const holds = c.children.some((k) => k.type === "Frame" || (k.type === "Main" && wide(k)) || (k.type === "Footer" && wide(k)) || (k.type === "Header" && k.bounds[1] <= 16));
  return holds ? "Frame" : undefined;
}

/** An <li> that is one link, or one line of text. */
function isLinkItem(k: LayoutNode): boolean {
  return k.type === "Item" && k.children.length <= 1 && (k.children[0]?.type === "Link" || k.text !== undefined);
}

/** Two or more children that are all links, or all link items: the shape of a menu. */
function menuShape(c: Container): "links" | "items" | undefined {
  if (c.children.length < 2) return undefined;
  if (c.links === c.children.length) return "links";
  return c.children.every(isLinkItem) ? "items" : undefined;
}

/** A full-width <nav> at the very top is the site's header bar (role banner). */
function isTopBar(c: Container): boolean {
  return c.lm === "Nav" && c.wide && c.b.y <= 16 && c.b.h <= 180 && c.ctx.depth <= 2;
}

function navRule(c: Container): string | undefined {
  const shape = menuShape(c);
  if (c.lm === "List" && shape) return "Nav";
  if (isTopBar(c)) return "Header";
  if (shape === "links" && c.layout === "row") return "Nav";
  const stacked = c.layout === "row" || c.layout === "stack";
  if (shape === "items" && stacked && c.ctx.parentType === "Header") return "Nav";
  return undefined;
}

function gridRule(c: Container): string | undefined {
  if (c.layout !== "grid" || c.children.length < 3) return undefined;
  if (c.lm && c.lm !== "List" && c.lm !== "Section") return undefined;
  const pictures = count(c.children, (k) => IMAGEISH.has(k.type) || has(k.children, [...IMAGEISH]));
  return pictures >= c.children.length * 0.7 ? "Gallery" : "CardGrid";
}

function landmarkRule(c: Container): string | undefined {
  return c.lm && c.lm !== "Section" && c.lm !== "Item" ? c.lm : undefined;
}

function isHeaderBar(c: Container): boolean {
  const { b, children } = c;
  return b.y <= 16 && b.h <= 180 && (has(children, ["Nav", "Logo", "Link"]) || c.links >= 2);
}

function isFooterBand(c: Container): boolean {
  const { b, ctx, children } = c;
  // touches the bottom of the document, and lives in its lower half: not just any tall block
  const bottom = b.y + b.h >= ctx.docH - 48 && b.y >= ctx.docH * 0.5;
  return bottom && b.h <= 800 && (c.links >= 1 || has(children, ["Nav", "Link", "Text"]));
}

/** Header / Footer / Hero by where a wide block sits on the page. */
function positionRule(c: Container): string | undefined {
  if (!c.wide || c.ctx.depth > 3) return undefined;
  if (isHeaderBar(c)) return "Header";
  if (isFooterBand(c)) return "Footer";
  return heroRule(c);
}

function heroRule(c: Container): string | undefined {
  const { b, ctx, children } = c;
  const tall = b.h >= ctx.vh * 0.35 && b.h <= ctx.vh * 1.6;
  if (!tall || ctx.index > 2 || b.y >= ctx.vh) return undefined;
  if (has(children, ["Header", "Main", "Footer", "Hero"])) return undefined;
  const calls = has(children, ["Button", "Link", "Image"]) || c.layout === "split";
  return has(children, ["Heading"]) && calls ? "Hero" : undefined;
}

const ICONISH = new Set(["Icon", "ImageLink", "Link"]);
const TEXTISH = new Set(["Text", "Paragraph", "Heading"]);

function allOf(children: LayoutNode[], set: Set<string>): boolean {
  return children.every((k) => set.has(k.type));
}

function headedType(c: Container): string | undefined {
  if (!has(c.children, ["Heading"])) return undefined;
  if (c.layout === "split") return "Feature";
  return c.wide ? "Section" : "Group";
}

/** Ordered composition rules; the first that answers names the container. */
const COMPOSITION: ((c: Container) => string | undefined)[] = [
  (c) => (c.layout === "row" && c.children.length >= 3 && allOf(c.children, ICONISH) ? "IconRow" : undefined),
  (c) => (c.ctx.parentType === "Gallery" || c.ctx.parentType === "CardGrid" ? "Card" : undefined),
  headedType,
  (c) => (c.lm === "Item" ? "Item" : undefined),
  (c) => (c.children.length >= 2 && allOf(c.children, TEXTISH) ? "TextBlock" : undefined),
  (c) => (c.layout === "row" && c.children.length === 2 && c.children.some((k) => k.type === "Icon") ? "IconText" : undefined),
];

function compositionRule(c: Container): string {
  for (const rule of COMPOSITION) {
    const t = rule(c);
    if (t) return t;
  }
  return c.wide ? "Section" : "Group";
}

const RULES = [frameRule, navRule, gridRule, landmarkRule, positionRule];

export function containerType(n: Node, children: LayoutNode[], layout: string | undefined, ctx: Ctx): string {
  const c = describe(n, children, layout, ctx);
  for (const rule of RULES) {
    const t = rule(c);
    if (t) return t;
  }
  return compositionRule(c);
}

// ── tree ──────────────────────────────────────────────────────────────────

/** Under a gallery, every container child is a card. */
function relabelCards(children: LayoutNode[]): void {
  for (const c of children) {
    if (c.children.length > 0 && c.type !== "Nav" && c.type !== "Form") c.type = "Card";
  }
}

/** In a header, the picture on the left is the logo and the first short link is the brand. */
function relabelBrand(children: LayoutNode[], ctx: Ctx): void {
  for (const c of children) {
    if (IMAGEISH.has(c.type) && c.bounds[0] < ctx.vw * 0.35) c.type = "Logo";
    else if (c.type === "Link" && c.bounds[0] < ctx.vw * 0.2 && c.text) c.type = "Brand";
  }
}

/** Once a parent's type is final, some children read differently. */
function relabelChildren(type: string, children: LayoutNode[], ctx: Ctx): void {
  if (type === "Gallery" || type === "CardGrid") relabelCards(children);
  if (type === "Header") relabelBrand(children, ctx);
}

function leafNode(n: Node, ctx: Ctx): LayoutNode {
  const b = n.box;
  const node: LayoutNode = { type: leafType(n, ctx), tag: b.tag, bounds: [b.x, b.y, b.w, b.h], children: [] };
  if (b.textLen > 0 && b.text) node.text = b.text;
  if (n.hints.length) node.hint = n.hints.join(",");
  return node;
}

export function classify(n: Node, ctx: Ctx): LayoutNode {
  if (n.children.length === 0) return leafNode(n, ctx);
  const b = n.box;
  const info = detectLayout(n.children.map(rect), rect(n));
  // Children see a provisional parent type so Logo / Nav rules can fire before the parent is named.
  const topBar = b.y <= 16 && b.w >= ctx.vw * 0.8 && b.h <= 180;
  const provisional = landmark(n) ?? (topBar ? "Header" : "");
  const children = n.children.map((c, i) => classify(c, { ...ctx, depth: ctx.depth + 1, parentType: provisional, index: i }));
  const type = containerType(n, children, info?.layout, ctx);
  relabelChildren(type, children, ctx);
  const node: LayoutNode = { type, tag: b.tag, bounds: [b.x, b.y, b.w, b.h], children };
  if (info) {
    node.layout = info.layout;
    node.columns = info.columns;
    node.rows = info.rows;
  }
  if (b.text) node.text = b.text;
  if (n.hints.length) node.hint = n.hints.join(",");
  return node;
}

export function toLayoutTree(root: Node, snap: Snapshot): LayoutNode {
  const page = classify(root, { vw: snap.width, vh: snap.height, docH: snap.docHeight, depth: 0, parentType: "", index: 0 });
  page.type = "Page";
  page.bounds = [0, 0, snap.width, snap.docHeight];
  tidy(page);
  return page;
}
