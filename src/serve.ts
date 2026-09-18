// uimodulay app server: serves the sketchbook viewer and analyzes URLs on demand.
//
//   uimodulay-app [--port 4310] [--open]
//
//   GET  /               the viewer (viewer/index.html, built by viewer/build.mjs)
//   GET  /sketch.js      the renderer shared with the CLI
//   GET  /api/ping       lets the viewer know it is running inside the app
//   POST /api/analyze    {url, width?|widths?, ai?, model?} -> Layout AST document, or a set with changes
//   GET  /api/recent     the last analyses of this process (in memory)

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { LayoutAst } from "./ast.ts";
import { analyzeResponsive } from "./index.ts";
import type { ResponsiveSet } from "./responsive.ts";
import { print } from "./term.ts";
import { VERSION } from "./version.ts";

const DEFAULT_PORT = 4310;
const MIN_WIDTH = 240;
const MAX_WIDTH = 3840;

interface AnalyzeBody { url?: string; width?: number; widths?: number[]; ai?: boolean; model?: string }
interface Recent { url: string; at: string; widths: number[]; nodes: number; ms: number; ai: boolean }
type Result = LayoutAst | ResponsiveSet;

const viewerDir = new URL("../viewer/", import.meta.url);
const recent: Recent[] = [];
const cache = new Map<string, Result>();

function countNodes(n: { children: unknown[] }): number {
  return 1 + (n.children as { children: unknown[] }[]).reduce((a, c) => a + countNodes(c), 0);
}

function widthsOf(body: AnalyzeBody): number[] {
  const raw = body.widths?.length ? body.widths : [body.width ?? 1440];
  const widths = raw.map(Number).filter((w) => w >= MIN_WIDTH && w <= MAX_WIDTH);
  if (widths.length === 0) throw new Error("no valid widths");
  return widths;
}

async function analyzeUrl(body: AnalyzeBody): Promise<Result> {
  if (!body.url) throw new Error("url is required");
  const url = /^[a-z]+:\/\//.test(body.url) ? body.url : "https://" + body.url;
  const widths = widthsOf(body);
  const key = JSON.stringify([url, widths, !!body.ai, body.model ?? ""]);
  const hit = cache.get(key);
  if (hit) return hit;
  const started = Date.now();
  const set = await analyzeResponsive(url, widths, { ai: body.ai ? { model: body.model } : false }, `uimodulay ${VERSION}`);
  // One width: answer with the plain AST document. Several: the set with its changes table.
  const out: Result = widths.length === 1 ? set.variants[0].ast : set;
  recent.unshift({ url, at: new Date().toISOString(), widths, nodes: countNodes(set.variants[0].ast.root), ms: Date.now() - started, ai: !!body.ai });
  recent.splice(20);
  cache.set(key, out);
  return out;
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

async function sendFile(res: ServerResponse, name: string, type: string): Promise<void> {
  res.writeHead(200, { "content-type": `${type}; charset=utf-8` });
  res.end(await readFile(new URL(name, viewerDir)));
}

async function readBody(req: IncomingMessage): Promise<AnalyzeBody> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as AnalyzeBody;
}

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

const ROUTES: Record<string, Handler> = {
  "GET /": (_req, res) => sendFile(res, "index.html", "text/html"),
  "GET /sketch.js": (_req, res) => sendFile(res, "sketch.js", "text/javascript"),
  "GET /api/ping": async (_req, res) => sendJson(res, 200, { app: "uimodulay", version: VERSION }),
  "GET /api/recent": async (_req, res) => sendJson(res, 200, recent),
  "POST /api/analyze": async (req, res) => sendJson(res, 200, await analyzeUrl(await readBody(req))),
};

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const pathname = new URL(req.url ?? "/", "http://x").pathname;
  const route = ROUTES[`${req.method ?? "GET"} ${pathname}`];
  if (!route) {
    sendJson(res, 404, { error: "not found" });
    return;
  }
  try {
    await route(req, res);
  } catch (e) {
    const status = e instanceof Error && e.message.includes("required") ? 400 : 500;
    sendJson(res, status, { error: e instanceof Error ? e.message : String(e) });
  }
}

function openBrowser(addr: string): void {
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(cmd, [addr], { stdio: "ignore", detached: true }).unref();
}

export function serve(argv: string[] = process.argv.slice(2)): void {
  const portArg = argv[argv.indexOf("--port") + 1];
  const port = argv.includes("--port") ? Number(portArg) : DEFAULT_PORT;
  createServer((req, res) => void handle(req, res)).listen(port, "127.0.0.1", () => {
    const addr = `http://127.0.0.1:${port}/`;
    print(`uimodulay app: ${addr}`);
    if (argv.includes("--open")) openBrowser(addr);
  });
}

// Run when started directly (`uimodulay-app`); the CLI's `app` command imports and calls serve() itself.
if (/serve\.(ts|js)$/.test(process.argv[1] ?? "")) serve();
