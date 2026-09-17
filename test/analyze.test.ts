import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeSnapshot } from "../src/index.ts";
import { toAst } from "../src/ast.ts";
import { detectLayout } from "../src/layout.ts";
import type { RawBox, Snapshot } from "../src/types.ts";

// ── synthetic snapshot builder ────────────────────────────────────────────
type Spec = Partial<RawBox> & { x: number; y: number; w: number; h: number; tag?: string; kids?: Spec[] };

function snap(spec: Spec, width = 1440, height = 900): Snapshot {
  const boxes: RawBox[] = [];
  const add = (s: Spec, parent: number) => {
    const id = boxes.length;
    const { kids, ...rest } = s;
    boxes.push({
      id, parent, tag: "div", role: "", display: "block", position: "static", bg: false, text: "", textLen: 0,
      img: false, link: false, heading: 0, id_attr: "", cls: "", ...rest,
    });
    for (const k of kids ?? []) add(k, id);
  };
  add(spec, -1);
  const docHeight = Math.max(...boxes.map((b) => b.y + b.h));
  return { url: "test://", width, height, docHeight, boxes };
}

const text = (x: number, y: number, w: number, h: number, t: string, extra: Partial<RawBox> = {}): Spec =>
  ({ x, y, w, h, tag: "p", text: t, textLen: t.length, ...extra });
const heading = (x: number, y: number, w: number, h: number, t: string): Spec =>
  ({ x, y, w, h, tag: "h1", heading: 1, text: t, textLen: t.length });
const link = (x: number, y: number, w: number, h: number, t: string): Spec =>
  ({ x, y, w, h, tag: "a", link: true, text: t, textLen: t.length, display: "inline-block" });
const img = (x: number, y: number, w: number, h: number): Spec => ({ x, y, w, h, tag: "img", img: true });

// ── tests ─────────────────────────────────────────────────────────────────
test("wrapper chain collapses to its content", () => {
  const s = snap({ x: 0, y: 0, w: 1440, h: 900, tag: "body", kids: [
    { x: 100, y: 100, w: 1240, h: 400, kids: [
      { x: 110, y: 110, w: 1220, h: 380, kids: [
        { x: 120, y: 120, w: 1200, h: 360, kids: [heading(120, 120, 1200, 60, "Artist Name")] },
      ] },
    ] },
  ] });
  const t = analyzeSnapshot(s);
  assert.equal(t.type, "Page");
  assert.equal(t.children.length, 1);
  assert.equal(t.children[0].type, "Heading");
  assert.equal(t.children[0].text, "Artist Name");
  // footprint of the outermost wrapper is kept
  assert.deepEqual(t.children[0].bounds, [100, 100, 1240, 400]);
});

test("grid detection: 3 columns x 2 rows", () => {
  const rects = [];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) rects.push({ x: 60 + c * 440, y: 100 + r * 300, w: 400, h: 260 });
  const info = detectLayout(rects, { x: 0, y: 0, w: 1440, h: 800 });
  assert.equal(info?.layout, "grid");
  assert.equal(info?.columns, 3);
  assert.equal(info?.rows, 2);
});

test("layout modes: stack, row, split", () => {
  const parent = { x: 0, y: 0, w: 1440, h: 800 };
  assert.equal(detectLayout([{ x: 0, y: 0, w: 1440, h: 100 }, { x: 0, y: 120, w: 1440, h: 100 }], parent)?.layout, "stack");
  assert.equal(detectLayout([{ x: 0, y: 0, w: 100, h: 40 }, { x: 120, y: 0, w: 100, h: 40 }, { x: 240, y: 0, w: 100, h: 40 }], parent)?.layout, "row");
  assert.equal(detectLayout([{ x: 0, y: 0, w: 700, h: 400 }, { x: 740, y: 0, w: 700, h: 400 }], parent)?.layout, "split");
  assert.equal(detectLayout([{ x: 0, y: 0, w: 100, h: 40 }, { x: 740, y: 0, w: 100, h: 40 }], parent)?.layout, "row");
});

test("page skeleton: header, hero, gallery, footer", () => {
  const cards: Spec[] = [];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
    const x = 60 + c * 440, y = 1000 + r * 320;
    cards.push({ x, y, w: 400, h: 300, tag: "li", kids: [img(x, y, 400, 220), text(x, y + 230, 400, 40, "Work " + (r * 3 + c))] });
  }
  const s = snap({ x: 0, y: 0, w: 1440, h: 900, tag: "body", kids: [
    { x: 0, y: 0, w: 1440, h: 72, tag: "header", kids: [
      { x: 40, y: 16, w: 120, h: 40, tag: "a", link: true, kids: [img(40, 16, 120, 40)] },
      { x: 900, y: 24, w: 500, h: 24, tag: "ul", kids: [
        { x: 900, y: 24, w: 100, h: 24, tag: "li", kids: [link(900, 24, 100, 24, "Work")] },
        { x: 1020, y: 24, w: 100, h: 24, tag: "li", kids: [link(1020, 24, 100, 24, "About")] },
        { x: 1140, y: 24, w: 100, h: 24, tag: "li", kids: [link(1140, 24, 100, 24, "Contact")] },
      ] },
    ] },
    { x: 0, y: 72, w: 1440, h: 800, tag: "main", kids: [
      { x: 0, y: 72, w: 1440, h: 800, tag: "section", kids: [
        heading(200, 300, 1040, 80, "Painter of quiet rooms"),
        text(200, 400, 1040, 60, "A short description of the artist and her practice."),
        { x: 200, y: 500, w: 160, h: 48, tag: "a", link: true, bg: true, text: "See works", textLen: 9 },
      ] },
    ] },
    { x: 0, y: 960, w: 1440, h: 700, tag: "section", kids: [
      { x: 60, y: 1000, w: 1320, h: 620, tag: "ul", kids: cards },
    ] },
    { x: 0, y: 1700, w: 1440, h: 200, tag: "footer", kids: [
      link(60, 1760, 100, 20, "Imprint"),
      text(1200, 1760, 180, 20, "© 2026"),
    ] },
  ] });
  const t = analyzeSnapshot(s);
  const types = t.children.map((c) => c.type);
  assert.deepEqual(types, ["Header", "Hero", "Gallery", "Footer"]);
  const header = t.children[0];
  assert.ok(header.children.some((c) => c.type === "Logo"), "logo in header: " + JSON.stringify(header.children.map((c) => c.type)));
  assert.ok(header.children.some((c) => c.type === "Nav"), "nav in header");
  const hero = t.children[1];
  assert.deepEqual(hero.children.map((c) => c.type), ["Heading", "Text", "Button"]);
  const gallery = t.children[2];
  assert.equal(gallery.layout, "grid");
  assert.equal(gallery.columns, 3);
  assert.equal(gallery.children.length, 6);
  assert.ok(gallery.children.every((c) => c.type === "Card"));

  const ast = toAst(t, s);
  assert.equal(ast.format, "uimodulay/layout-ast");
  assert.equal(ast.root.role, "document");
  const h = ast.root.children[0];
  assert.equal(h.role, "banner");
  assert.equal(h.kind, "region");
  const g = ast.root.children[2];
  assert.equal(g.layout?.mode, "grid");
  assert.equal(g.layout?.gap, 40);
  assert.equal(g.layout?.rowGap, 20);
  const logo = h.children.find((c) => c.type === "Logo");
  assert.equal(logo?.content, "logo");
});

test("inline runs become one text leaf and keep the words", () => {
  const s = snap({ x: 0, y: 0, w: 1440, h: 900, tag: "body", kids: [
    { x: 0, y: 0, w: 800, h: 40, tag: "p", textLen: 20, kids: [
      { x: 0, y: 0, w: 300, h: 40, tag: "span", display: "inline", text: "Hello", textLen: 5 },
      { x: 300, y: 0, w: 300, h: 40, tag: "a", display: "inline", link: true, text: "world", textLen: 5 },
    ] },
  ] });
  const t = analyzeSnapshot(s);
  assert.equal(t.children.length, 1);
  assert.equal(t.children[0].children.length, 0);
  assert.equal(t.children[0].text, "Hello world");
});

test("off-screen and empty boxes are pruned", () => {
  const s = snap({ x: 0, y: 0, w: 1440, h: 900, tag: "body", kids: [
    link(1440, 10, 100, 30, "Skip to content"),
    { x: 0, y: 0, w: 1440, h: 10 },
    heading(0, 100, 1440, 60, "Only me"),
  ] });
  const t = analyzeSnapshot(s);
  assert.deepEqual(t.children.map((c) => c.type), ["Heading"]);
});
