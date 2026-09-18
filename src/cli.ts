#!/usr/bin/env node
// uimodulay CLI — subcommands over one input kind: a URL, a saved snapshot, or a Layout AST file.

import { readFile, writeFile } from "node:fs/promises";
import { relabelAst } from "./ai.ts";
import { toAst, type LayoutAst } from "./ast.ts";
import { capture } from "./capture.ts";
import { emitTailwind, type CopyDeck } from "./emit.ts";
import { analyzeResponsive, analyzeSnapshot, crawl, finish, PRESET_WIDTHS, renderChanges, renderSiteTree } from "./index.ts";
import { fromAst, renderAst, renderTree, type RenderOptions } from "./render.ts";
import { sketchSvg } from "./sketch.ts";
import { note, print } from "./term.ts";
import type { Snapshot } from "./types.ts";
import { VERSION } from "./version.ts";

const USAGE = `uimodulay ${VERSION} — semantic UI structure analyzer

  uimodulay tree   <input>              the layout tree as text          [--depth N] [--bounds] [--ai]
  uimodulay ast    <input>              the Layout AST document (JSON)   [--ai]
  uimodulay sketch <input> -o page.svg  hand-drawn monochrome wireframe  [--sketch-width 720]
  uimodulay emit   <input> -o page.html the structure as a Tailwind page [--copy deck.json]
  uimodulay name   <ast.json>           let Claude rename the modules of a saved AST (prints the AST)
  uimodulay diff   <url>                the page at several widths       [--widths phone,tablet,desktop] [--json]
  uimodulay crawl  <url>                same-origin site tree            [--max 20] [--depth 2] [--widths …] [--json]
  uimodulay app                         the sketchbook at http://127.0.0.1:4310/  [--port N] [--open]

<input> is a URL, a snapshot saved with --save, or a Layout AST .json (from \`ast\`).

Options
  --width N        viewport width for a URL (default 1440)
  --save FILE      keep the raw snapshot of a URL for offline re-analysis
  --ai             Claude renames generic modules through your own claude login (--model NAME)
  --no-scroll      do not scroll through the page before capturing
  -o FILE          output file for sketch / emit
`;

const VALUE_FLAGS = new Set(["width", "widths", "height", "depth", "model", "save", "sketch-width", "copy", "max", "port", "o"]);

interface Args {
  cmd: string;
  input?: string;
  flags: Set<string>;
  values: Map<string, string>;
}

function parseArgs(argv: string[]): Args {
  const [cmd = "", ...rest] = argv;
  const flags = new Set<string>();
  const values = new Map<string, string>();
  let input: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const name = a.startsWith("--") ? a.slice(2) : a === "-o" ? "o" : undefined;
    if (name === undefined) input ??= a;
    else if (VALUE_FLAGS.has(name)) {
      values.set(name, rest[i + 1] ?? "");
      i += 1;
    } else flags.add(name);
  }
  return { cmd, input, flags, values };
}

function toUrl(input: string | undefined): string {
  if (!input) throw new Error("a URL is required; try `uimodulay --help`");
  return /^[a-z]+:\/\//.test(input) ? input : "https://" + input;
}

function parseWidths(list: string): number[] {
  const widths = list.split(",").map((w) => PRESET_WIDTHS[w.trim()] ?? Number(w));
  if (widths.some((w) => !Number.isFinite(w) || w <= 0)) throw new Error("--widths takes numbers or phone/tablet/laptop/desktop");
  return widths;
}

function aiOpts(a: Args): { model?: string } | false {
  return a.flags.has("ai") ? { model: a.values.get("model") } : false;
}

function output(a: Args): string {
  const o = a.values.get("o");
  if (!o) throw new Error("-o FILE is required for this command");
  return o;
}

// ── input resolution ──────────────────────────────────────────────────────

interface Loaded { ast: LayoutAst; snapshot?: Snapshot }

function isFile(input: string): boolean {
  return input.endsWith(".json") && !/^[a-z]+:\/\//.test(input);
}

async function analyzeUrl(a: Args): Promise<Loaded> {
  const snapshot = await capture(toUrl(a.input), {
    width: Number(a.values.get("width") ?? 1440),
    height: Number(a.values.get("height") ?? 900),
    scroll: !a.flags.has("no-scroll"),
  });
  const save = a.values.get("save");
  if (save) await writeFile(save, JSON.stringify(snapshot));
  return fromSnapshot(snapshot, a);
}

async function fromSnapshot(snapshot: Snapshot, a: Args): Promise<Loaded> {
  const result = await finish(snapshot, { ai: aiOpts(a) });
  if (result.ai) {
    const tail = result.ai.notes ? " — " + result.ai.notes : "";
    note(`ai: relabeled ${result.ai.relabeled} nodes in ${result.ai.durationMs}ms${tail}`);
  }
  return { ast: toAst(result.tree, snapshot, `uimodulay ${VERSION}${result.ai ? "+ai" : ""}`), snapshot };
}

/** A URL is rendered; a snapshot file is analyzed; an AST file is taken as is (plus --ai when asked). */
async function load(a: Args): Promise<Loaded> {
  if (!a.input) throw new Error("an input is required; try `uimodulay --help`");
  if (!isFile(a.input)) return analyzeUrl(a);
  const doc = JSON.parse(await readFile(a.input, "utf8")) as { format?: string; boxes?: unknown };
  if (doc.boxes) return fromSnapshot(doc as unknown as Snapshot, a);
  if (doc.format !== "uimodulay/layout-ast") throw new Error(`${a.input} is neither a snapshot nor a Layout AST`);
  const ast = doc as unknown as LayoutAst;
  const ai = aiOpts(a);
  if (ai) {
    const r = await relabelAst(ast, ai);
    note(`ai: relabeled ${r.relabeled} nodes in ${r.durationMs}ms`);
  }
  return { ast };
}

// ── commands ──────────────────────────────────────────────────────────────

async function cmdTree(a: Args): Promise<void> {
  const { ast } = await load(a);
  const depth = a.values.get("depth");
  const opts: RenderOptions = { bounds: a.flags.has("bounds"), maxDepth: depth === undefined ? undefined : Number(depth) };
  print(renderAst(ast.root, opts));
}

async function cmdAst(a: Args): Promise<void> {
  const { ast } = await load(a);
  print(JSON.stringify(ast, null, 2));
}

async function cmdSketch(a: Args): Promise<void> {
  const file = output(a);
  const { ast } = await load(a);
  await writeFile(file, sketchSvg(ast, { width: Number(a.values.get("sketch-width") ?? 720) }));
  note(`sketch: wrote ${file}`);
}

async function cmdEmit(a: Args): Promise<void> {
  const file = output(a);
  const { ast } = await load(a);
  const deck = a.values.get("copy");
  const copy = deck ? (JSON.parse(await readFile(deck, "utf8")) as CopyDeck) : undefined;
  await writeFile(file, emitTailwind(ast, { copy }));
  note(`emit: wrote ${file}`);
}

async function cmdName(a: Args): Promise<void> {
  a.flags.add("ai");
  const { ast } = await load(a);
  print(JSON.stringify(ast, null, 2));
}

async function cmdDiff(a: Args): Promise<void> {
  const widths = parseWidths(a.values.get("widths") ?? "phone,tablet,desktop");
  const set = await analyzeResponsive(toUrl(a.input), widths, { ai: aiOpts(a), scroll: !a.flags.has("no-scroll") }, `uimodulay ${VERSION}`);
  if (a.flags.has("json")) {
    print(JSON.stringify(set, null, 2));
    return;
  }
  const depth = a.values.get("depth");
  for (const v of set.variants) {
    print(`━━ ${v.width}px`);
    print(renderTree(fromAst(v.ast.root), { bounds: a.flags.has("bounds"), maxDepth: depth === undefined ? undefined : Number(depth) }));
  }
  print("━━ changes");
  print(renderChanges(set));
}

async function cmdCrawl(a: Args): Promise<void> {
  const widthsArg = a.values.get("widths");
  const summaries = new Map<string, string>();
  const tree = await crawl(toUrl(a.input), {
    maxPages: Number(a.values.get("max") ?? 20),
    maxDepth: Number(a.values.get("depth") ?? 2),
    widths: widthsArg ? parseWidths(widthsArg) : undefined,
    scroll: !a.flags.has("no-scroll"),
  }, (page) => {
    summaries.set(page.url, analyzeSnapshot(page.snapshots[0]).children.map((c) => c.type).join(" · "));
    note(`crawl: ${page.url}`);
  });
  if (a.flags.has("json")) {
    print(JSON.stringify(tree, null, 2));
    return;
  }
  print(renderSiteTree(tree, (n) => summaries.get(n.url) ?? ""));
  if (tree.skipped.length > 0) print(`(${tree.skipped.length} links not visited: budget, depth or robots.txt)`);
}

async function cmdApp(a: Args): Promise<void> {
  const { serve } = await import("./serve.ts");
  const argv = [...(a.values.has("port") ? ["--port", a.values.get("port") ?? ""] : []), ...(a.flags.has("open") ? ["--open"] : [])];
  serve(argv);
}

const COMMANDS: Record<string, (a: Args) => Promise<void>> = {
  tree: cmdTree, ast: cmdAst, sketch: cmdSketch, emit: cmdEmit, name: cmdName, diff: cmdDiff, crawl: cmdCrawl, app: cmdApp,
};

async function main(argv: string[]): Promise<void> {
  const a = parseArgs(argv);
  const run: ((a: Args) => Promise<void>) | undefined = COMMANDS[a.cmd];
  const known = run !== undefined;
  if (!known || a.flags.has("help") || argv.includes("-h")) {
    print(USAGE);
    process.exit(known ? 0 : 1);
  }
  await run(a);
}

main(process.argv.slice(2)).catch((e: unknown) => {
  note("uimodulay: " + (e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
