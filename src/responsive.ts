// Responsive comparison: the same page analyzed at several widths, and a summary of
// which modules change arrangement between them (Gallery: grid 3 → grid 2 → stack).

import type { AstNode, LayoutAst } from "./ast.ts";

export interface Variant { width: number; ast: LayoutAst }

export interface Change {
  /** path of module names from the root, with the module's first words: "Main / Gallery “View Theme”" */
  path: string;
  type: string;
  /** one entry per variant, in the same order as the variants: "grid 3", "stack", "—" when absent */
  arrangement: string[];
  /** true when the node exists in some widths only */
  presence: boolean;
}

export interface ResponsiveSet {
  format: "uimodulay/layout-ast-set";
  version: 1;
  url: string;
  widths: number[];
  variants: Variant[];
  changes: Change[];
}

const ABSENT = "—";

function arrangement(n: AstNode | undefined): string {
  if (!n) return ABSENT;
  if (n.kind === "leaf") return n.content ?? "leaf";
  const l = n.layout;
  if (!l) return "stack";
  return l.columns && l.mode !== "stack" ? `${l.mode} ${l.columns}` : l.mode;
}

/**
 * A module's fingerprint is the text it contains — the same words survive every width,
 * while type names, wrapper collapsing and sibling order do not.
 */
function fingerprint(n: AstNode): string {
  const texts: string[] = [];
  const visit = (x: AstNode): void => {
    if (texts.length >= 4) return;
    if (x.children.length > 0) {
      x.children.forEach(visit);
    } else if (x.text) {
      texts.push(x.text.slice(0, 24));
    }
  };
  visit(n);
  return texts.join("|");
}

interface Entry { node: AstNode; path: string; key: string; fp: string }

/** Every container of a tree, with its type-path key ("/Main#0/Section#2") and its fingerprint. */
function entries(root: AstNode, maxDepth: number): Entry[] {
  const out: Entry[] = [];
  const visit = (n: AstNode, key: string, path: string, depth: number): void => {
    if (n.kind !== "leaf") out.push({ node: n, path, key, fp: fingerprint(n) });
    if (depth >= maxDepth) return;
    const seen = new Map<string, number>();
    for (const c of n.children) {
      const i = seen.get(c.type) ?? 0;
      seen.set(c.type, i + 1);
      visit(c, `${key}/${c.type}#${i}`, path ? `${path} / ${c.type}` : c.type, depth + 1);
    }
  };
  visit(root, "", "", 0);
  return out;
}

interface Index { byFp: Map<string, Entry | null>; byKey: Map<string, Entry> }

function indexOf(es: Entry[]): Index {
  const byFp = new Map<string, Entry | null>();
  const byKey = new Map<string, Entry>();
  for (const e of es) {
    byKey.set(e.key, e);
    if (e.fp) byFp.set(e.fp, byFp.has(e.fp) ? null : e); // null marks an ambiguous fingerprint
  }
  return { byFp, byKey };
}

/** Words identify a module; only wordless modules fall back to their type-path. */
function lookup(idx: Index, e: Entry): Entry | undefined {
  if (e.fp) return idx.byFp.get(e.fp) ?? undefined;
  return idx.byKey.get(e.key);
}

function firstWords(n: AstNode): string | undefined {
  if (n.children.length === 0) return n.text;
  return n.children.map(firstWords).find(Boolean);
}

function short(n: AstNode): string {
  const t = firstWords(n);
  if (!t) return "";
  return ` “${t.length > 22 ? t.slice(0, 21) + "…" : t}”`;
}

function changeFor(e: Entry, idx: Index[]): Change | undefined {
  const arr = idx.map((m) => arrangement(lookup(m, e)?.node));
  const present = arr.filter((a) => a !== ABSENT);
  const distinct = new Set(present);
  const presence = present.length < arr.length;
  // Presence-only rows are reported only when the module has words (a matchable identity).
  const worth = distinct.size > 1 || (presence && e.fp !== "" && present.length > 0);
  if (!worth) return undefined;
  return { path: e.path + short(e.node), type: e.node.type, arrangement: arr, presence };
}

export function compare(variants: Variant[], maxDepth = 3): Change[] {
  if (variants.length < 2) return [];
  const all = variants.map((v) => entries(v.ast.root, maxDepth));
  const idx = all.map(indexOf);
  // The widest variant is the reference: desktop structure is what designers name.
  const widest = variants.map((v) => v.width).indexOf(Math.max(...variants.map((v) => v.width)));
  return all[widest].filter((e) => e.key !== "").map((e) => changeFor(e, idx)).filter((c): c is Change => c !== undefined);
}

export function makeSet(url: string, variants: Variant[]): ResponsiveSet {
  return {
    format: "uimodulay/layout-ast-set",
    version: 1,
    url,
    widths: variants.map((v) => v.width),
    variants,
    changes: compare(variants),
  };
}

export function renderChanges(set: ResponsiveSet): string {
  if (set.changes.length === 0) return "no arrangement changes across " + set.widths.join(" / ");
  const head = ["module", ...set.widths.map((w) => w + "px")];
  const rows = set.changes.map((c) => [c.path, ...c.arrangement]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r: string[]): string => r.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd();
  return [line(head), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}
