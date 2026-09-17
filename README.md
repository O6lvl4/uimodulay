<p align="center">
  <img src="docs/hero.svg" alt="playwright.dev drawn by uimodulay as a hand-drawn wireframe" width="720">
</p>

<h1 align="center">uimodulay</h1>

<p align="center">
  <strong>Semantic UI structure analyzer.</strong><br>
  Give it a URL. Get the page back as the modules a designer would draw — not the DOM.
</p>

<p align="center">
  <a href="https://github.com/O6lvl4/uimodulay/actions/workflows/ci.yml"><img alt="ci" src="https://github.com/O6lvl4/uimodulay/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="codopsy A" src="https://img.shields.io/badge/codopsy-A%20100%2F100-2ea043">
  <img alt="node 22.18+" src="https://img.shields.io/badge/node-%E2%89%A522.18-333">
  <img alt="MIT" src="https://img.shields.io/badge/license-MIT-333">
</p>

```
$ uimodulay https://playwright.dev --ai --depth 2

Page
├── Header [row 2]
│   ├── Nav [row 6]
│   └── Toolbar [row 4]
├── Hero
│   ├── Heading "enables reliable web automation…"
│   ├── Paragraph "One API to drive Chromium, Fire…"
│   └── CTA [row 2]
├── Main
│   ├── CardGrid [row 3]
│   ├── Feature
│   ├── Feature
│   ├── Feature
│   ├── BrowserSupport
│   └── Showcase
└── Footer
    ├── LinkColumns [row 3]
    └── Copyright "Copyright © 2026 Microsoft"
```

Every node carries a measured rectangle and, for containers, how its children are arranged
(`stack` / `row` / `split` / `grid` with `gap` and `padding`). The result is a versioned
**Layout AST** ([spec](docs/LAYOUT-AST.md) · [日本語](docs/LAYOUT-AST.ja.md) · [JSON Schema](docs/layout-ast.schema.json))
whose vocabulary is borrowed, not invented: ARIA landmark roles for regions, Auto Layout words for
arrangement, DocLayNet-style kinds for leaves.

## Install

Node ≥ 22.18 and Google Chrome (Playwright drives the Chrome you already have; nothing is downloaded).

```
npm install uimodulay
```

Or from a clone: `npm install`, then `node src/cli.ts …` — Node runs the TypeScript directly.

## CLI

```
uimodulay <url>                              layout tree
uimodulay <url> --json                       Layout AST document
uimodulay <url> --bounds --depth 3           rectangles, three levels deep
uimodulay <url> --sketch page.svg            hand-drawn wireframe
uimodulay <url> --ai                         Claude renames generic modules (your own claude login)
uimodulay <url> --widths phone,tablet,desktop
                                             390 / 820 / 1440: one tree per width + what rearranges
uimodulay <url> --crawl 20 --crawl-depth 2   follow same-origin links; site tree with each page's modules
uimodulay <url> --save snap.json             keep the raw snapshot …
uimodulay --from snap.json                   … and re-analyze it offline, instantly
```

A responsive run ends with a table of the modules whose arrangement changes. Modules are matched
across widths by the words they contain, so a desktop `Gallery` that the phone heuristics call a
`Section` is still the same row:

```
module                                   390px   820px    1440px
Main / Section / Gallery “View Theme”    stack   grid 2   grid 3
Main / Section / Section “Server-First”  stack   grid 2   row 3
Footer / Nav / Group “Resources”         grid 2  row 4    row 4
```

## Sketchbook app

```
npx uimodulay-app          # http://127.0.0.1:4310/
```

Type a URL, pick widths, press **Analyze**. The page is drawn as a monochrome pencil wireframe
beside its outline (hover links the two), with width tabs, a side-by-side **compare** view at one
true scale, and the changes table. Drop any Layout AST `.json` onto it to draw that instead.
A [static sketchbook](https://claude.ai/artifact/D4X4UTTQVbDi48mdKygChX) (import only, no browser
needed) is published from the same page.

## Library

```ts
import { analyze, analyzeResponsive, renderTree, sketchSvg, toAst } from "uimodulay";

const { tree, snapshot } = await analyze("https://example.com", { width: 1440 });
console.log(renderTree(tree));                  // the text tree above
const ast = toAst(tree, snapshot);              // Layout AST document
const svg = sketchSvg(ast, { width: 720 });     // hand-drawn wireframe

const set = await analyzeResponsive("https://example.com", [390, 820, 1440]);
set.changes;                                    // [{ path, arrangement: ["stack", "grid 2", "grid 3"] }, …]
```

| Export | What it does |
|---|---|
| `analyze(url, opts)` | render + analyze one width; `opts.ai` enables the naming pass |
| `analyzeResponsive(url, widths, opts)` | several widths, one browser; returns a `layout-ast-set` |
| `analyzeSnapshot(snapshot)` | **pure**: raw boxes in, tree out — no browser, testable with fixtures |
| `capture(url, opts)` / `captureMany` | just the raw snapshot |
| `toAst(tree, snapshot)` | tree → Layout AST document |
| `renderTree(tree)` / `renderAst(node)` | text tree |
| `sketchSvg(ast, opts)` | wireframe SVG (also `import { sketchSvg } from "uimodulay/sketch"`) |
| `compare(variants)` / `renderChanges(set)` | the responsive changes table |
| `crawl(url, opts, onPage)` | breadth-first same-origin crawl; `onPage` receives each page's snapshots as they arrive |

## How it works

```
URL ─▶ Chrome (Playwright) ─▶ probe.ts runs in the page
        every visible element: rect, computed display/position/overflow, text, image/link flags;
        hidden, aria-hidden and overflow-clipped elements never make it out
            │  Snapshot (flat JSON)
            ▼
   tree.ts     prune noise · collapse wrapper chains (div>div>div>h1 → Heading) · merge inline runs
   layout.ts   stack / row / split / grid / flow from the children's rectangles
   role.ts     landmarks > tags > position & shape > composition → Header, Hero, Gallery, Card …
   tidy.ts     splice scaffolding, merge same-family chains
   ast.ts      Layout AST v1 with gap and padding
            │  optional
            ▼
   ai.ts      Claude renames generic nodes (Section → ProductCard) via the Claude Agent SDK,
              running *your* `claude` binary — your login, no API key. It never touches geometry.
```

The heuristics are deterministic and carry the skeleton; the AI pass only renames. `analyzeSnapshot`
is pure, so the analyzer is unit-tested with synthetic snapshots and iterated offline against saved
real ones (`--save` / `--from`).

## Quality

```
npm run check      # typecheck + tests + codopsy (rank A, zero warnings)
npm run build      # dist/ + viewer/
```

CI runs the same gate with [codopsy](https://github.com/O6lvl4/codopsy).

## Status and limits

- Verified on documentation, marketing and game-franchise pages at 390–1440 px.
- One page load per width, phone widths with a mobile user agent. Pages that mount content on
  scroll are scrolled through first; content behind clicks is not seen.
- iframes are opaque. Cross-fading carousels can leave stacked slides in the tree.
- Grid detection gives up to `flow` on ragged layouts, on purpose.

## License

MIT

## Structure back out: Tailwind

```
uimodulay <url> --tailwind page.html --copy deck.json
```

Turns the AST back into an HTML page with Tailwind classes: regions become `header` / `main` /
`section` / `footer`, `layout.mode` becomes flex or grid with the measured `gap` and `padding`, and
leaves become headings, paragraphs, buttons and image placeholders. A **copy deck** (see
`examples/petshop.copy.json`) supplies the words, cycled per role, so one page's structure can carry
another business's content. `examples/petshop.html` is playwright.dev's skeleton as a pet shop.
