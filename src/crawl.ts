// Site crawl: from a start URL, follow same-origin links breadth-first, and capture every page
// reached. The result is a URL tree (who linked to whom first) plus one snapshot per width per page.

import { chromium, type Browser } from "playwright";
import { openContext, preparePage, probePage, PRESET_WIDTHS, type CaptureOptions } from "./capture.ts";
import type { Snapshot } from "./types.ts";

export interface CrawlOptions extends CaptureOptions {
  /** stop after this many pages (default 20) */
  maxPages?: number;
  /** how many links away from the start to go (default 2) */
  maxDepth?: number;
  /** viewport widths to capture per page (default [1440]) */
  widths?: number[];
  /** only follow URLs matching this pattern (tested against the full URL) */
  include?: RegExp;
  /** never follow URLs matching this pattern */
  exclude?: RegExp;
  /** pause between page loads, ms (default 500) */
  delayMs?: number;
  /** honour robots.txt Disallow rules for `*` (default true) */
  robots?: boolean;
}

export interface CrawledPage {
  url: string;
  title: string;
  depth: number;
  /** the page that first linked here; undefined for the start page */
  parent?: string;
  /** same-origin links found on the page, normalized, in document order */
  links: string[];
  /** one snapshot per requested width, in the order of `widths` */
  snapshots: Snapshot[];
}

export interface SiteNode {
  url: string;
  title: string;
  depth: number;
  parent?: string;
  children: string[];
}

export interface SiteTree {
  format: "uimodulay/site-tree";
  version: 1;
  root: string;
  crawledAt: string;
  pages: SiteNode[];
  /** links seen but not visited (budget, depth, filters, robots) */
  skipped: string[];
}

const ASSET = /\.(pdf|zip|gz|tar|dmg|exe|png|jpe?g|gif|svg|webp|avif|mp4|mp3|webm|css|js|json|xml|rss|ics)$/i;

/** Canonical form for de-duplication: no hash, no trailing slash except the root, no default ports. */
export function normalizeUrl(href: string, base?: string): string | undefined {
  let u: URL;
  try {
    u = new URL(href, base);
  } catch {
    return undefined;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
  u.hash = "";
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
  return u.toString();
}

function sameSite(a: URL, b: URL): boolean {
  return a.origin === b.origin;
}

/** Links on the page worth following: same origin, not an asset, not excluded. */
function followable(links: string[], origin: URL, opts: CrawlOptions): string[] {
  const out: string[] = [];
  for (const raw of links) {
    const url = normalizeUrl(raw);
    if (!url || out.includes(url)) continue;
    const u = new URL(url);
    if (!sameSite(u, origin) || ASSET.test(u.pathname)) continue;
    if (opts.include && !opts.include.test(url)) continue;
    if (opts.exclude?.test(url)) continue;
    out.push(url);
  }
  return out;
}

// ── robots.txt ────────────────────────────────────────────────────────────

/** Disallow prefixes that apply to everyone (`User-agent: *`). Minimal on purpose. */
export function parseRobots(text: string): string[] {
  const out: string[] = [];
  let applies = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [, key, value] = m;
    if (key.toLowerCase() === "user-agent") applies = value.trim() === "*";
    else if (applies && key.toLowerCase() === "disallow" && value.trim()) out.push(value.trim());
  }
  return out;
}

async function loadRobots(origin: URL): Promise<string[]> {
  try {
    const res = await fetch(new URL("/robots.txt", origin));
    return res.ok ? parseRobots(await res.text()) : [];
  } catch {
    return [];
  }
}

function disallowed(url: string, rules: string[]): boolean {
  const path = new URL(url).pathname;
  return rules.some((r) => path.startsWith(r));
}

// ── page loading ──────────────────────────────────────────────────────────

interface Loaded { snapshot: Snapshot; links: string[]; title: string; finalUrl: string }

async function loadAt(browser: Browser, url: string, width: number, opts: CrawlOptions): Promise<Loaded> {
  const context = await openContext(browser, width, opts.height);
  try {
    const page = await context.newPage();
    await preparePage(page, url, opts);
    const links = await page.evaluate(() => Array.from(document.querySelectorAll("a[href]"), (a) => (a as HTMLAnchorElement).href));
    const title = await page.title();
    return { snapshot: await probePage(page), links, title, finalUrl: page.url() };
  } finally {
    await context.close();
  }
}

// ── the crawl ─────────────────────────────────────────────────────────────

interface Queued { url: string; depth: number; parent?: string }

interface State {
  browser: Browser;
  origin: URL;
  opts: CrawlOptions;
  widths: number[];
  rules: string[];
  seen: Set<string>;
  queue: Queued[];
  nodes: Map<string, SiteNode>;
  skipped: Set<string>;
}

/** Load a page at every width; undefined when it redirected off the site. */
async function visit(s: State, q: Queued): Promise<CrawledPage | undefined> {
  const [first, ...rest] = s.widths;
  const main = await loadAt(s.browser, q.url, first, s.opts);
  if (!sameSite(new URL(main.finalUrl), s.origin)) return undefined;
  const snapshots = [main.snapshot];
  for (const w of rest) snapshots.push((await loadAt(s.browser, q.url, w, s.opts)).snapshot);
  const links = followable(main.links, s.origin, s.opts);
  return { url: q.url, title: main.title, depth: q.depth, parent: q.parent, links, snapshots };
}

function enqueue(s: State, page: CrawledPage, node: SiteNode): void {
  for (const link of page.links) {
    if (s.seen.has(link)) continue;
    const tooDeep = page.depth + 1 > (s.opts.maxDepth ?? 2);
    const blocked = s.rules.length > 0 && disallowed(link, s.rules);
    if (tooDeep || blocked) {
      s.skipped.add(link);
      continue;
    }
    s.seen.add(link);
    node.children.push(link);
    s.queue.push({ url: link, depth: page.depth + 1, parent: page.url });
  }
}

/**
 * Crawl breadth-first from `start`. `onPage` is called as each page is captured, so a caller can
 * store results as they arrive; the returned tree is the map of what was visited.
 */
type OnPage = (page: CrawledPage) => Promise<void> | void;

async function newState(root: string, browser: Browser, opts: CrawlOptions): Promise<State> {
  const origin = new URL(root);
  return {
    browser,
    origin,
    opts,
    widths: opts.widths?.length ? opts.widths : [PRESET_WIDTHS.desktop],
    rules: opts.robots === false ? [] : await loadRobots(origin),
    seen: new Set([root]),
    queue: [{ url: root, depth: 0 }],
    nodes: new Map(),
    skipped: new Set(),
  };
}

async function step(s: State, q: Queued, onPage?: OnPage): Promise<void> {
  const page = await visit(s, q);
  if (!page) {
    s.skipped.add(q.url);
    return;
  }
  const node: SiteNode = { url: page.url, title: page.title, depth: page.depth, parent: page.parent, children: [] };
  s.nodes.set(page.url, node);
  enqueue(s, page, node);
  if (onPage) await onPage(page);
}

async function run(s: State, onPage?: OnPage): Promise<void> {
  const budget = s.opts.maxPages ?? 20;
  while (s.queue.length > 0 && s.nodes.size < budget) {
    await step(s, s.queue.shift() as Queued, onPage);
    if (s.queue.length > 0) await new Promise((r) => setTimeout(r, s.opts.delayMs ?? 500));
  }
}

export async function crawl(start: string, opts: CrawlOptions = {}, onPage?: OnPage): Promise<SiteTree> {
  const root = normalizeUrl(/^[a-z]+:\/\//.test(start) ? start : "https://" + start);
  if (!root) throw new Error("not a crawlable URL: " + start);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const s = await newState(root, browser, opts);
  try {
    await run(s, onPage);
  } finally {
    await browser.close();
  }
  for (const q of s.queue) s.skipped.add(q.url);
  return { format: "uimodulay/site-tree", version: 1, root, crawledAt: new Date().toISOString(), pages: [...s.nodes.values()], skipped: [...s.skipped] };
}

/** Text drawing of a site tree: one line per page, indented by depth. */
interface Spot { prefix: string; last: boolean }

/** The connector drawn before a node and the prefix its children inherit; the root has neither. */
function connectors(at: Spot | undefined): { branch: string; prefix: string } {
  if (!at) return { branch: "", prefix: "" };
  if (at.last) return { branch: at.prefix + "└── ", prefix: at.prefix + "    " };
  return { branch: at.prefix + "├── ", prefix: at.prefix + "│   " };
}

function siteLine(n: SiteNode, detail?: (n: SiteNode) => string): string {
  const title = n.title ? "  “" + n.title.slice(0, 40) + "”" : "";
  const extra = detail ? "  " + detail(n) : "";
  return new URL(n.url).pathname + title + extra;
}

export function renderSiteTree(tree: SiteTree, detail?: (n: SiteNode) => string): string {
  const byUrl = new Map(tree.pages.map((p) => [p.url, p]));
  const lines: string[] = [];
  const walk = (url: string, at: Spot | undefined): void => {
    const n = byUrl.get(url);
    if (!n) return;
    const { branch, prefix } = connectors(at);
    lines.push(branch + siteLine(n, detail));
    n.children.forEach((c, i) => walk(c, { prefix, last: i === n.children.length - 1 }));
  };
  walk(tree.root, undefined);
  return lines.join("\n");
}
