// Build the sketchbook page: transpile src/sketch.ts to viewer/sketch.js and inline the
// example ASTs into viewer/index.html. Usage: node viewer/build.mjs
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

const here = (p) => new URL(p, import.meta.url);
const root = (p) => new URL("../" + p, import.meta.url);

const sketch = ts.transpileModule(readFileSync(root("src/sketch.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, removeComments: false },
}).outputText;
writeFileSync(here("./sketch.js"), "// Generated from src/sketch.ts by viewer/build.mjs — do not edit.\n" + sketch);

const safe = (p) => readFileSync(root(p), "utf8").replace(/<\//g, "<\\/");
const tpl = readFileSync(here("./index.template.html"), "utf8");
const html = tpl.replace("__PLAYWRIGHT__", safe("examples/playwright.dev.ast.json")).replace("__MOZILLA__", safe("examples/mozilla.org.ast.json"));
writeFileSync(here("./index.html"), html);
process.stdout.write(`viewer/sketch.js ${sketch.length} bytes, viewer/index.html ${html.length} bytes\n`);
