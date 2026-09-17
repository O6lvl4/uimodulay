// AI pass: hand the heuristic tree to Claude (via the Agent SDK, running the user's
// own `claude` binary so their login is used — no API key) and let it fix the names.
// The model only relabels; geometry stays as measured.

import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { homedir } from "node:os";
import { join } from "node:path";
import { index, renderForAI } from "./render.ts";
import { note } from "./term.ts";
import type { LayoutNode } from "./types.ts";

export interface AiOptions {
  model?: string;
  claudeBin?: string;
}

export interface AiResult {
  relabeled: number;
  costUsd: number;
  durationMs: number;
  notes?: string;
}

interface Reply { labels?: Record<string, string>; notes?: string }

const SYSTEM = `You are uimodulay's naming pass. You receive an outline of a web page's layout tree
produced by geometric heuristics: one node per line, "#id Type <tag> WxH@x,y [layout] "text" {hints}".
Your job: correct node TYPES where the heuristic is wrong or too generic, using the page's meaning.
Prefer these vocabularies:
  regions: Header Nav Hero Main Footer Sidebar Section Feature Gallery CardGrid Card Testimonial Pricing FAQ CTA
           Form Search Article Profile Stats Timeline Steps LogoRow Breadcrumb Pagination TextBlock
  leaves:  Heading Text Paragraph Image Icon Logo Brand Link Button Input Label Badge Divider
Rules:
- Only rename nodes whose current type is generic (Section, Group, Block, Panel, Card, Item, Text, Link, Image, Feature, IconText, TextBlock)
  or clearly wrong. Keep correct ones.
- Never invent nodes, never move nodes, never change geometry.
- Use PascalCase single words, or two joined words at most (e.g. ProductCard, ArtistProfile).
Answer with ONLY a JSON object: {"labels": {"<id>": "<Type>", ...}, "notes": "<one sentence about the page>"}.`;

const TYPE_NAME = /^[A-Z][A-Za-z]{1,30}$/;

function sdkOptions(opts: AiOptions): Options {
  return {
    pathToClaudeCodeExecutable: opts.claudeBin ?? join(homedir(), ".local/bin/claude"),
    model: opts.model,
    systemPrompt: SYSTEM,
    allowedTools: [],
    disallowedTools: ["Bash", "Read", "Write", "Edit", "WebFetch", "WebSearch", "Agent", "Glob", "Grep"],
    permissionMode: "plan",
    maxTurns: 1,
    settingSources: [],
    stderr: () => undefined,
  };
}

/** One turn, no tools: the outline in, the model's text and its cost out. */
async function ask(prompt: string, opts: AiOptions): Promise<{ text: string; costUsd: number }> {
  let text = "";
  let costUsd = 0;
  for await (const m of query({ prompt, options: sdkOptions(opts) })) {
    if (m.type !== "result") continue;
    costUsd = (m as { total_cost_usd?: number }).total_cost_usd ?? 0;
    if (m.subtype !== "success") throw new Error(`claude returned ${m.subtype}`);
    text = m.result;
  }
  if (process.env.UIMODULAY_DEBUG) note("[ai reply]\n" + text);
  return { text, costUsd };
}

function extractJson(text: string): Reply {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("no JSON in model reply: " + text.slice(0, 200));
  return JSON.parse(body.slice(start, end + 1)) as Reply;
}

/** Apply "#id" -> Type labels to the tree; returns how many nodes changed. */
function applyLabels(nodes: LayoutNode[], labels: Record<string, string>): number {
  let changed = 0;
  for (const [rawId, type] of Object.entries(labels)) {
    const n = nodes[Number(rawId.replace(/^#/, ""))];
    if (!n || n.type === "Page" || !TYPE_NAME.test(type) || n.type === type) continue;
    n.type = type;
    changed += 1;
  }
  return changed;
}

export async function relabelWithAI(root: LayoutNode, opts: AiOptions = {}): Promise<AiResult> {
  const nodes = index(root);
  const started = Date.now();
  const prompt = `Page layout outline (${nodes.length} nodes):\n\n${renderForAI(root)}\n\nReturn the JSON now.`;
  const { text, costUsd } = await ask(prompt, opts);
  const reply = extractJson(text);
  const relabeled = applyLabels(nodes, reply.labels ?? {});
  return { relabeled, costUsd, durationMs: Date.now() - started, notes: reply.notes };
}
