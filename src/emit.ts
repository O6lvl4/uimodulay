// Emit: a Layout AST back into HTML with Tailwind classes. The AST supplies structure —
// regions, arrangement, gaps, padding, proportions — and a "copy deck" supplies the words.
// The result is a starting point a designer edits, not a pixel copy of the source page.

import type { AstNode, LayoutAst } from "./ast.ts";

/** Words to pour into the skeleton. Every list is cycled; missing keys fall back to generic text. */
export interface CopyDeck {
  brand?: string;
  nav?: string[];
  hero?: { heading?: string; text?: string; button?: string; link?: string };
  sections?: { heading: string; text?: string }[];
  cards?: { heading: string; text?: string; link?: string }[];
  footer?: { links?: string[]; text?: string };
  buttons?: string[];
  links?: string[];
  texts?: string[];
}

export interface EmitOptions {
  copy?: CopyDeck;
  title?: string;
  /** Tailwind Play CDN script tag (default true); false when the consumer has a build */
  cdn?: boolean;
}

type Hero = Required<NonNullable<CopyDeck["hero"]>>;
type Card = { heading: string; text?: string; link?: string };

const TAG_OF: Record<string, string> = {
  Header: "header", Nav: "nav", Main: "main", Footer: "footer", Sidebar: "aside", Form: "form",
  Hero: "section", Section: "section", Feature: "section", Gallery: "section", CardGrid: "section",
  Article: "article", Card: "article", List: "ul", Item: "li", Figure: "figure", Dialog: "dialog",
};

/** Tailwind spacing steps (px → class suffix) we round to. */
const SPACING: [number, string][] = [[0, "0"], [4, "1"], [8, "2"], [12, "3"], [16, "4"], [24, "6"], [32, "8"], [40, "10"], [48, "12"], [64, "16"], [80, "20"], [96, "24"]];

function step(px: number | undefined): string {
  if (px === undefined) return "4";
  return SPACING.reduce((a, b) => (Math.abs(b[0] - px) < Math.abs(a[0] - px) ? b : a))[1];
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── copy ──────────────────────────────────────────────────────────────────

const GENERIC: Required<CopyDeck> = {
  brand: "Brand",
  nav: ["Products", "Solutions", "Pricing", "Docs", "Company"],
  hero: { heading: "A headline that states the promise", text: "One sentence that explains who this is for and what changes for them.", button: "Get started", link: "Learn more" },
  sections: [{ heading: "Why it matters", text: "A short paragraph with the substance behind the heading." }],
  cards: [{ heading: "Feature one", text: "What it does and why you would care.", link: "Read more" }],
  footer: { links: ["About", "Blog", "Careers", "Privacy", "Terms"], text: "© 2026 Brand. All rights reserved." },
  buttons: ["Get started", "Contact us", "See pricing"],
  links: ["Learn more", "See details", "Browse all"],
  texts: ["Short supporting copy that fits in one line.", "A second line of copy, a little longer, for variety."],
};

class Copy {
  private counters = new Map<string, number>();
  private deck: CopyDeck;
  constructor(deck: CopyDeck) {
    this.deck = deck;
  }

  private pick<T>(key: string, list: T[] | undefined, fallback: T[]): T {
    const pool = list && list.length > 0 ? list : fallback;
    const i = this.counters.get(key) ?? 0;
    this.counters.set(key, i + 1);
    return pool[i % pool.length];
  }

  brand(): string { return this.deck.brand ?? GENERIC.brand; }
  nav(): string { return this.pick("nav", this.deck.nav, GENERIC.nav); }
  section(): { heading: string; text?: string } { return this.pick("sections", this.deck.sections, GENERIC.sections); }
  card(): Card { return this.pick("cards", this.deck.cards, GENERIC.cards); }
  footerLink(): string { return this.pick("footerLinks", this.deck.footer?.links, GENERIC.footer.links ?? []); }
  footerText(): string { return this.deck.footer?.text ?? GENERIC.footer.text ?? ""; }
  button(): string { return this.pick("buttons", this.deck.buttons, GENERIC.buttons); }
  link(): string { return this.pick("links", this.deck.links, GENERIC.links); }
  text(): string { return this.pick("texts", this.deck.texts, GENERIC.texts); }
  hero(): Hero { return { ...GENERIC.hero, ...this.deck.hero } as Hero; }
}

// ── layout classes ────────────────────────────────────────────────────────

interface Ctx { copy: Copy; region: string; vw: number; depth: number; asCard: boolean }

const ARRANGE: Record<string, (cols: number) => string> = {
  row: () => "flex flex-wrap items-center",
  split: () => "grid grid-cols-1 md:grid-cols-2 items-center",
  grid: (cols) => `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-${Math.min(cols, 6)}`,
  flow: () => "flex flex-wrap",
  stack: () => "flex flex-col",
};

/** Three or more containers side by side read as cards, whatever the heuristics called them. */
function cardRow(n: AstNode): boolean {
  const mode = n.layout?.mode;
  const kids = n.children.filter((c) => c.children.length > 0).length;
  return (mode === "row" || mode === "grid") && kids >= 3;
}

function arrangement(n: AstNode): string {
  const l = n.layout;
  if (!l) return "";
  // Neighbours measured flush (links padded from the inside) still need air between them.
  const gap = `gap-${step(Math.max(8, l.gap ?? 16))}`;
  if (cardRow(n) && l.mode === "row") return `grid grid-cols-1 md:grid-cols-${Math.min(n.children.length, 4)} ${gap}`;
  return `${ARRANGE[l.mode](l.columns ?? 3)} ${gap}`;
}

/** Measured padding, with a floor of vertical rhythm for page-level sections. */
function padding(n: AstNode, ctx: Ctx): string {
  const p = n.layout?.padding;
  if (!p) return "";
  const pageLevel = n.bounds.width >= ctx.vw * 0.8 && ctx.depth <= 2 && n.type !== "Header";
  const y = pageLevel ? Math.max(48, Math.min(p.top, p.bottom)) : Math.min(p.top, p.bottom);
  return `px-${step(Math.min(p.left, p.right))} py-${step(y)}`;
}

/** A wide region whose content sits in a narrower column gets a centered max-width. */
function column(n: AstNode, vw: number): string {
  const p = n.layout?.padding;
  if (!p || n.bounds.width < vw * 0.8) return "";
  const inner = n.bounds.width - p.left - p.right;
  return inner < n.bounds.width * 0.85 ? `max-w-[${inner}px] mx-auto` : "";
}

const REGION_CLASS: Record<string, string> = {
  Header: "sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-neutral-200",
  Hero: "bg-amber-50",
  Footer: "bg-neutral-900 text-neutral-300",
  Card: "rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm",
  Nav: "text-sm font-medium",
};

// ── leaves ────────────────────────────────────────────────────────────────

function headingSize(h: number): string {
  if (h >= 56) return "text-5xl md:text-6xl";
  if (h >= 34) return "text-3xl";
  return "text-xl";
}

const HEADING_LEVEL: Record<string, string> = { Hero: "h1", Card: "h3" };

function headingWords(ctx: Ctx): string {
  if (ctx.region === "Hero") return ctx.copy.hero().heading;
  if (ctx.region === "Card") return ctx.copy.card().heading;
  return ctx.copy.section().heading;
}

function headingLeaf(n: AstNode, ctx: Ctx): string {
  const level = HEADING_LEVEL[ctx.region] ?? "h2";
  return `<${level} class="${headingSize(n.bounds.height)} font-bold tracking-tight text-balance">${esc(headingWords(ctx))}</${level}>`;
}

function textLeaf(n: AstNode, ctx: Ctx): string {
  if (ctx.region === "Footer" && n.text?.includes("©")) return `<p class="text-sm">${esc(ctx.copy.footerText())}</p>`;
  const words = ctx.region === "Hero" ? ctx.copy.hero().text : ctx.copy.text();
  const cls = n.content === "paragraph" ? "text-lg text-neutral-600 max-w-prose" : "text-neutral-600";
  return `<p class="${cls}">${esc(words)}</p>`;
}

function imageLeaf(n: AstNode, ctx: Ctx): string {
  if (n.content === "logo") return `<a href="#" class="text-xl font-black tracking-tight">${esc(ctx.copy.brand())}</a>`;
  if (n.content === "icon") return `<span class="inline-block size-6 rounded-full bg-amber-400" aria-hidden="true"></span>`;
  // A small picture that carries words is a button with an icon in it.
  if (n.text && n.bounds.height <= 64) return buttonLeaf(n, ctx);
  const w = Math.max(1, n.bounds.width);
  const h = Math.max(1, n.bounds.height);
  // The measured width is the ceiling: a 120px logo stays 120px, a 1200px banner fills its column.
  return `<div class="max-w-full rounded-xl bg-neutral-200" style="width:${w}px;aspect-ratio:${w}/${h}" role="img" aria-label="photo"></div>`;
}

function linkWords(ctx: Ctx): string {
  if (ctx.region === "Nav" || ctx.region === "Header") return ctx.copy.nav();
  if (ctx.region === "Footer") return ctx.copy.footerLink();
  if (ctx.region === "Card") return ctx.copy.card().link ?? ctx.copy.link();
  return ctx.copy.link();
}

function buttonLeaf(_n: AstNode, ctx: Ctx): string {
  const words = ctx.region === "Hero" ? ctx.copy.hero().button : ctx.copy.button();
  return `<a href="#" class="inline-flex items-center rounded-full bg-amber-500 px-5 py-2.5 font-semibold text-neutral-900 hover:bg-amber-400">${esc(words)}</a>`;
}

function linkLeaf(_n: AstNode, ctx: Ctx): string {
  return `<a href="#" class="hover:underline underline-offset-4">${esc(linkWords(ctx))}</a>`;
}

const LEAF: Record<string, (n: AstNode, ctx: Ctx) => string> = {
  heading: headingLeaf,
  text: textLeaf,
  paragraph: textLeaf,
  image: imageLeaf,
  logo: imageLeaf,
  icon: imageLeaf,
  link: linkLeaf,
  button: buttonLeaf,
  input: () => `<input class="rounded-lg border border-neutral-300 px-3 py-2" placeholder="Search">`,
  divider: () => `<hr class="border-neutral-200">`,
  backdrop: () => "",
};

function leaf(n: AstNode, ctx: Ctx): string {
  const draw = LEAF[n.content ?? ""];
  return draw ? draw(n, ctx) : `<div class="rounded-lg bg-neutral-100 min-h-4"></div>`;
}

// ── containers ────────────────────────────────────────────────────────────

const REGIONS = new Set(["Header", "Hero", "Footer", "Card", "Nav"]);
/** Regions where a row of groups is columns of links, not cards. */
const NO_CARDS = new Set(["Header", "Footer", "Nav"]);

function container(n: AstNode, ctx: Ctx): string {
  const type = ctx.asCard && n.children.length > 0 ? "Card" : n.type;
  const region = REGIONS.has(type) ? type : ctx.region;
  const inner: Ctx = { ...ctx, region, depth: ctx.depth + 1, asCard: cardRow(n) && !NO_CARDS.has(region) };
  const cls = [REGION_CLASS[type] ?? "", padding(n, ctx)].filter(Boolean).join(" ");
  const col = column(n, ctx.vw);
  const body = n.children.map((c) => emitNode(c, inner)).filter(Boolean).join("\n");
  const arranged = `<div class="${[col, arrangement(n)].filter(Boolean).join(" ")}">\n${body}\n</div>`;
  const tag = TAG_OF[type] ?? "div";
  return `<${tag} data-module="${esc(n.type)}" class="${cls}">\n${arranged}\n</${tag}>`;
}

function emitNode(n: AstNode, ctx: Ctx): string {
  if (n.children.length === 0) return leaf(n, ctx);
  if (n.type === "Page") return n.children.map((c) => emitNode(c, { ...ctx, depth: 1 })).join("\n");
  return container(n, ctx);
}

/** Render a Layout AST as a Tailwind HTML page. */
export function emitTailwind(ast: LayoutAst, opts: EmitOptions = {}): string {
  const copy = new Copy(opts.copy ?? {});
  const body = emitNode(ast.root, { copy, region: "", vw: ast.source.viewport.width, depth: 0, asCard: false });
  const title = opts.title ?? copy.brand();
  const cdn = opts.cdn === false ? "" : `<script src="https://cdn.tailwindcss.com"></script>\n`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${cdn}<!-- structure: ${esc(ast.source.url)} via ${esc(ast.source.generator)} -->
</head>
<body class="bg-white text-neutral-900 antialiased">
${body}
</body>
</html>
`;
}
