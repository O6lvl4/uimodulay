#!/usr/bin/env node
// uimodulay CLI — see USAGE below.

import { readFile, writeFile } from "node:fs/promises";
import { toAst, type LayoutAst } from "./ast.ts";
import { emitTailwind, type CopyDeck } from "./emit.ts";
import { capture } from "./capture.ts";
import { analyzeResponsive, analyzeSnapshot, crawl, finish, PRESET_WIDTHS, renderChanges, renderSiteTree } from "./index.ts";
import { renderAst, renderTree, type RenderOptions } from "./render.ts";
import type { ResponsiveSet } from "./responsive.ts";
import { sketchSvg } from "./sketch.ts";
import { note, print } from "./term.ts";
import type { Snapshot } from "./types.ts";
import { VERSION } from "./version.ts";

const USAGE = `uimodulay ${VERSION} — semantic UI structure analyzer

  uimodulay <url>                 print the layout tree
  uimodulay <url> --json          print the Layout AST document
  uimodulay <url> --ai            let Claude (your own login, via the Agent SDK) refine the names
  uimodulay <url> --widths phone,tablet,desktop
                                  responsive run: one tree per width + a table of what rearranges
  uimodulay <url> --crawl 20      follow same-origin links (--crawl-depth 2) and print the site tree
  uimodulay --from snap.json      re-analyze a saved snapshot offline

Options
  --width N       viewport width (default 1440)
  --widths LIST   phone,tablet,laptop,desktop (390/820/1024/1440) or plain numbers
  --height N      viewport height (default 900)
  --bounds        show W×H@x,y on every node
  --depth N       limit tree depth in the text output
  --model NAME    model for --ai (default: your claude default)
  --save FILE     save the raw snapshot (boxes) for offline re-analysis
  --sketch FILE   write a hand-drawn monochrome wireframe as SVG (--sketch-width N; one file per width)
  --tailwind FILE write the structure back as a Tailwind HTML page (--copy deck.json for the words)
  --raw           print the raw snapshot JSON instead of the tree
  --no-scroll     do not scroll through the page before capturing
`;

const VALUE_FLAGS = ["width", "widths", "height", "depth", "model", "save", "from", "sketch", "sketch-width", "crawl", "crawl-depth", "tailwind", "copy"];

interface Args {
  url?: string;
  flags: Set<string>;
  values: Map<string, string>;
}

function parseArgs(argv: string[]): Args {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  let url: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      url ??= a;
    } else if (VALUE_FLAGS.includes(a.slice(2))) {
      values.set(a.slice(2), argv[i + 1] ?? "");
      i += 1;
    } else {
      flags.add(a.slice(2));
    }
  }
  return { url, flags, values };
}

function normalizeUrl(url: string | undefined): string {
  if (!url) throw new Error("a URL is required; try `uimodulay --help`");
  return /^[a-z]+:\/\//.test(url) ? url : "https://" + url;
}

function parseWidths(list: string): number[] {
  const widths = list.split(",").map((w) => PRESET_WIDTHS[w.trim()] ?? Number(w));
  if (widths.some((w) => !Number.isFinite(w) || w <= 0)) throw new Error("--widths takes numbers or phone/tablet/laptop/desktop");
  return widths;
}

function renderOpts(a: Args): RenderOptions {
  const depth = a.values.get("depth");
  return { bounds: a.flags.has("bounds"), maxDepth: depth === undefined ? undefined : Number(depth) };
}

function aiOpts(a: Args): { model?: string } | false {
  return a.flags.has("ai") ? { model: a.values.get("model") } : false;
}

async function writeSketch(a: Args, ast: LayoutAst, file: string): Promise<void> {
  const width = Number(a.values.get("sketch-width") ?? Math.min(720, ast.source.viewport.width));
  await writeFile(file, sketchSvg(ast, { width }));
  note(`sketch: wrote ${file}`);
}

/** Tailwind skeleton of the page, with words from a copy deck when one is given. */
async function writeTailwind(a: Args, ast: LayoutAst, file: string): Promise<void> {
  const deckFile = a.values.get("copy");
  const copy = deckFile ? (JSON.parse(await readFile(deckFile, "utf8")) as CopyDeck) : undefined;
  await writeFile(file, emitTailwind(ast, { copy }));
  note(`tailwind: wrote ${file}`);
}

/** Responsive run: one tree per width, then the table of arrangement changes. */
async function runResponsive(a: Args, widths: number[]): Promise<void> {
  const set: ResponsiveSet = await analyzeResponsive(normalizeUrl(a.url), widths, { ai: aiOpts(a), scroll: !a.flags.has("no-scroll") }, `uimodulay ${VERSION}`);
  if (a.flags.has("json")) {
    print(JSON.stringify(set, null, 2));
    return;
  }
  const sketch = a.values.get("sketch");
  for (const v of set.variants) {
    print(`━━ ${v.width}px`);
    print(renderAst(v.ast.root, renderOpts(a)));
    if (sketch) await writeSketch(a, v.ast, sketch.replace(/\.svg$/, "") + `-${v.width}.svg`);
  }
  print("━━ changes");
  print(renderChanges(set));
}

async function loadSnapshot(a: Args): Promise<Snapshot> {
  const from = a.values.get("from");
  if (from) return JSON.parse(await readFile(from, "utf8")) as Snapshot;
  return capture(normalizeUrl(a.url), {
    width: Number(a.values.get("width") ?? 1440),
    height: Number(a.values.get("height") ?? 900),
    scroll: !a.flags.has("no-scroll"),
  });
}

async function runSingle(a: Args): Promise<void> {
  const snapshot = await loadSnapshot(a);
  const save = a.values.get("save");
  if (save) await writeFile(save, JSON.stringify(snapshot));
  if (a.flags.has("raw")) {
    print(JSON.stringify(snapshot, null, 2));
    return;
  }
  const result = await finish(snapshot, { ai: aiOpts(a) });
  if (result.ai) {
    const tail = result.ai.notes ? " — " + result.ai.notes : "";
    note(`ai: relabeled ${result.ai.relabeled} nodes in ${result.ai.durationMs}ms ($${result.ai.costUsd.toFixed(4)})${tail}`);
  }
  const ast = toAst(result.tree, snapshot, `uimodulay ${VERSION}${result.ai ? "+ai" : ""}`);
  const sketch = a.values.get("sketch");
  if (sketch) await writeSketch(a, ast, sketch);
  const html = a.values.get("tailwind");
  if (html) await writeTailwind(a, ast, html);
  if (a.flags.has("json")) print(JSON.stringify(ast, null, 2));
  else print(renderTree(result.tree, renderOpts(a)));
}

/** Crawl run: the site's URL tree, each page summarized by its top-level modules. */
async function runCrawl(a: Args, maxPages: number): Promise<void> {
  const widthsArg = a.values.get("widths");
  const summaries = new Map<string, string>();
  const tree = await crawl(normalizeUrl(a.url), {
    maxPages,
    maxDepth: Number(a.values.get("crawl-depth") ?? 2),
    widths: widthsArg ? parseWidths(widthsArg) : undefined,
    scroll: !a.flags.has("no-scroll"),
  }, (page) => {
    const top = analyzeSnapshot(page.snapshots[0]).children.map((c) => c.type).join(" · ");
    summaries.set(page.url, top);
    note(`crawl: ${page.url}`);
  });
  if (a.flags.has("json")) {
    print(JSON.stringify(tree, null, 2));
    return;
  }
  print(renderSiteTree(tree, (n) => summaries.get(n.url) ?? ""));
  if (tree.skipped.length > 0) print(`(${tree.skipped.length} links not visited: budget, depth or robots.txt)`);
}

async function main(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    print(USAGE);
    process.exit(argv.length === 0 ? 1 : 0);
  }
  const a = parseArgs(argv);
  const widths = a.values.get("widths");
  const crawlPages = a.values.get("crawl");
  if (crawlPages !== undefined) await runCrawl(a, Number(crawlPages));
  else if (widths && !a.values.has("from")) await runResponsive(a, parseWidths(widths));
  else await runSingle(a);
}

main(process.argv.slice(2)).catch((e: unknown) => {
  note("uimodulay: " + (e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
