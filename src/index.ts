// uimodulay — semantic UI structure analyzer.
//
//   import { analyze, renderTree, sketchSvg } from "uimodulay";
//   const { tree, snapshot } = await analyze("https://example.com");
//   console.log(renderTree(tree));

import { relabelWithAI, type AiOptions, type AiResult } from "./ai.ts";
import { toAst, type LayoutAst } from "./ast.ts";
import { capture, captureMany, type CaptureOptions } from "./capture.ts";
import { makeSet, type ResponsiveSet, type Variant } from "./responsive.ts";
import { toLayoutTree } from "./role.ts";
import { buildTree } from "./tree.ts";
import type { LayoutNode, Snapshot } from "./types.ts";

export type { LayoutNode, Snapshot, RawBox } from "./types.ts";
export type { AiOptions, AiResult } from "./ai.ts";
export type { AstNode, AstLayout, Bounds, LayoutAst, NodeKind, Padding } from "./ast.ts";
export type { CaptureOptions } from "./capture.ts";
export type { Change, ResponsiveSet, Variant } from "./responsive.ts";
export type { SketchOptions } from "./sketch.ts";
export { AST_FORMAT, AST_VERSION, CONTENT_OF, ROLE_OF, toAst } from "./ast.ts";
export { capture, captureMany, PRESET_WIDTHS } from "./capture.ts";
export { crawl, normalizeUrl, parseRobots, renderSiteTree } from "./crawl.ts";
export type { CrawlOptions, CrawledPage, SiteNode, SiteTree } from "./crawl.ts";
export { detectLayout, groupRows } from "./layout.ts";
export { fromAst, renderAst, renderTree } from "./render.ts";
export { compare, renderChanges } from "./responsive.ts";
export { sketchSvg } from "./sketch.ts";
export { emitTailwind } from "./emit.ts";
export type { CopyDeck, EmitOptions } from "./emit.ts";
export { VERSION } from "./version.ts";

export interface AnalyzeOptions extends CaptureOptions {
  /** let Claude refine the module names (runs your own `claude` login through the Agent SDK) */
  ai?: boolean | AiOptions;
}

export interface Analysis {
  tree: LayoutNode;
  snapshot: Snapshot;
  ai?: AiResult;
}

/** Pure: snapshot in, layout tree out. No browser, no network. */
export function analyzeSnapshot(snap: Snapshot): LayoutNode {
  return toLayoutTree(buildTree(snap), snap);
}

/** Name the tree and, when asked, let the AI pass rename its modules. */
export async function finish(snapshot: Snapshot, opts: AnalyzeOptions = {}): Promise<Analysis> {
  const tree = analyzeSnapshot(snapshot);
  const out: Analysis = { tree, snapshot };
  if (opts.ai) out.ai = await relabelWithAI(tree, typeof opts.ai === "object" ? opts.ai : {});
  return out;
}

/** Render one URL and analyze it. */
export async function analyze(url: string, opts: AnalyzeOptions = {}): Promise<Analysis> {
  return finish(await capture(url, opts), opts);
}

/** The same page at several widths: a set of Layout ASTs plus the arrangement changes between them. */
export async function analyzeResponsive(url: string, widths: number[], opts: AnalyzeOptions = {}, generator = "uimodulay"): Promise<ResponsiveSet> {
  const snapshots = await captureMany(url, widths, opts);
  const variants: Variant[] = [];
  for (const [i, snapshot] of snapshots.entries()) {
    const result = await finish(snapshot, opts);
    const ast = toAst(result.tree, snapshot, generator + (result.ai ? "+ai" : "")) as LayoutAst & { ai?: AiResult };
    if (result.ai) ast.ai = result.ai;
    variants.push({ width: widths[i], ast });
  }
  return makeSet(snapshots[0]?.url ?? url, variants);
}
