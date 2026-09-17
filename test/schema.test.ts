// Every example document must satisfy docs/layout-ast.schema.json. The validator below covers
// the subset of JSON Schema the file uses (type, const, enum, pattern, minimum, required,
// properties, items, $ref into $defs, oneOf) so the check needs no dependency.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

type Schema = Record<string, unknown> & { $defs?: Record<string, Schema> };

const root = new URL("../", import.meta.url);
const schema = JSON.parse(readFileSync(new URL("docs/layout-ast.schema.json", root), "utf8")) as Schema;

function resolve(ref: string): Schema {
  const name = ref.replace("#/$defs/", "");
  const def = schema.$defs?.[name];
  if (!def) throw new Error("unknown $ref " + ref);
  return def;
}

function typeOf(v: unknown): string {
  if (Array.isArray(v)) return "array";
  if (v === null) return "null";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function typeOk(expected: string, v: unknown): boolean {
  const t = typeOf(v);
  return t === expected || (expected === "number" && t === "integer");
}

function check(s: Schema, v: unknown, path: string, errors: string[]): void {
  if (typeof s.$ref === "string") return check(resolve(s.$ref), v, path, errors);
  if (Array.isArray(s.oneOf)) {
    const passes = (s.oneOf as Schema[]).filter((alt) => { const e: string[] = []; check(alt, v, path, e); return e.length === 0; });
    if (passes.length !== 1) errors.push(`${path}: matched ${passes.length} of oneOf`);
    return;
  }
  if ("const" in s && v !== s.const) errors.push(`${path}: expected ${JSON.stringify(s.const)}`);
  if (Array.isArray(s.enum) && !s.enum.includes(v)) errors.push(`${path}: ${JSON.stringify(v)} not in enum`);
  if (typeof s.type === "string" && !typeOk(s.type, v)) { errors.push(`${path}: expected ${s.type}, got ${typeOf(v)}`); return; }
  if (typeof s.pattern === "string" && typeof v === "string" && !new RegExp(s.pattern).test(v)) errors.push(`${path}: ${v} fails ${s.pattern}`);
  if (typeof s.minimum === "number" && typeof v === "number" && v < s.minimum) errors.push(`${path}: ${v} < ${s.minimum}`);
  checkObject(s, v, path, errors);
  if (Array.isArray(v) && s.items) v.forEach((item, i) => check(s.items as Schema, item, `${path}[${i}]`, errors));
}

function checkObject(s: Schema, v: unknown, path: string, errors: string[]): void {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return;
  const obj = v as Record<string, unknown>;
  for (const key of (s.required as string[] | undefined) ?? []) {
    if (!(key in obj)) errors.push(`${path}: missing ${key}`);
  }
  const props = (s.properties as Record<string, Schema> | undefined) ?? {};
  for (const [key, sub] of Object.entries(props)) {
    if (key in obj) check(sub, obj[key], `${path}.${key}`, errors);
  }
}

for (const file of readdirSync(new URL("examples/", root)).filter((f) => f.endsWith(".ast.json") || f.endsWith(".set.json"))) {
  test(`examples/${file} matches the Layout AST schema`, () => {
    const doc = JSON.parse(readFileSync(new URL("examples/" + file, root), "utf8")) as unknown;
    const errors: string[] = [];
    check(schema, doc, "$", errors);
    assert.deepEqual(errors.slice(0, 5), [], errors.length + " schema errors");
  });
}

test("the validator rejects a broken document", () => {
  const errors: string[] = [];
  check(schema, { format: "uimodulay/layout-ast", version: 1, source: {}, root: { id: -1, type: "bad name", kind: "leaf", bounds: {}, source: {}, children: [] } }, "$", errors);
  assert.ok(errors.length > 0);
});
