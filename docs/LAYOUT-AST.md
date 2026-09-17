# uimodulay Layout AST — specification v1

*Japanese: [LAYOUT-AST.ja.md](LAYOUT-AST.ja.md) · Schema: [layout-ast.schema.json](layout-ast.schema.json)*

A **Layout AST** is the analysis result of one rendered web page: a tree of *modules*, each with a
measured rectangle, a name, and, for containers, how its children are arranged. It is what a
designer would draw of the page, not what the DOM says. `div > div > div > h1` is one `Heading`.

Two document kinds exist:

| `format` | What it holds |
|---|---|
| `uimodulay/layout-ast` | one page at one viewport width |
| `uimodulay/layout-ast-set` | the same page at several widths, plus the arrangement changes between them |

## 1. Vocabulary

The AST composes three existing vocabularies instead of inventing one:

| Axis | Field | Source | Values |
|---|---|---|---|
| Page region | `role` | ARIA landmark and structural roles | `document banner navigation main contentinfo complementary form search dialog article region list listitem table figure` |
| Arrangement | `layout.mode` | Auto Layout / Column–Row–Grid | `stack row split grid flow` |
| Leaf content | `content` | DocLayNet-style kinds | `heading text paragraph image icon logo link button input divider panel block backdrop` |

`type` is the human module name in PascalCase (`Header`, `Hero`, `Gallery`, `Card`, `Heading`, …).
It is a *label*; `role`, `content` and `layout` are the *stable machine vocabularies*. Tools that
consume the AST should branch on those three and treat `type` as display text.

### 1.1 Types the heuristics produce

| Kind | Types |
|---|---|
| regions | `Page Header Nav Main Footer Sidebar Hero Section Feature Gallery CardGrid Form Search Dialog Article List Item Table Figure` |
| containers | `Card Group TextBlock IconText IconRow` |
| leaves | `Heading Text Paragraph Image ImageLink Icon Logo Brand Link Button Input Divider Panel Block Backdrop` |

`Frame` never appears in output: it marks page scaffolding during analysis and is spliced away.

### 1.2 Types the AI pass may add

`Testimonial Pricing FAQ CTA Profile Stats Timeline Steps LogoRow Breadcrumb Pagination Badge Label`
and compound names such as `ProductCard` or `ArtistProfile`. The AI pass only renames; it never
adds, moves or resizes nodes.

## 2. Document

```json
{
  "format": "uimodulay/layout-ast",
  "version": 1,
  "source": {
    "url": "https://playwright.dev/",
    "viewport": { "width": 1440, "height": 900 },
    "document": { "height": 2848 },
    "capturedAt": "2026-09-17T09:00:00.000Z",
    "generator": "uimodulay 0.1.0"
  },
  "root": { "id": 0, "type": "Page", "kind": "region", "role": "document", "…": "…" }
}
```

| Field | Meaning |
|---|---|
| `format` | `"uimodulay/layout-ast"` |
| `version` | integer; bumps on a breaking change (§6) |
| `source.url` | the URL after redirects |
| `source.viewport` | CSS pixels of the viewport the page was rendered in |
| `source.document.height` | full scroll height at that width |
| `source.capturedAt` | ISO 8601 |
| `source.generator` | producer and version; `+ai` is appended when the AI pass ran |
| `root` | the `Page` node |

An optional `ai` object (`{ relabeled, costUsd, durationMs, notes }`) is attached when the AI pass ran.

## 3. Node

```json
{
  "id": 7,
  "type": "Gallery",
  "kind": "region",
  "role": "region",
  "bounds": { "x": 60, "y": 1287, "width": 1320, "height": 383 },
  "layout": {
    "mode": "grid", "columns": 3, "rows": 2,
    "gap": 24, "rowGap": 32,
    "padding": { "top": 0, "right": 0, "bottom": 0, "left": 0 }
  },
  "source": { "tag": "section", "hints": ["ul"] },
  "children": [ { "id": 8, "type": "Card", "kind": "container", "…": "…" } ]
}
```

| Field | On | Meaning |
|---|---|---|
| `id` | all | pre-order index from 0 at the root; stable within one document; the AI pass addresses nodes by it |
| `type` | all | module name, PascalCase, `/^[A-Z][A-Za-z]{1,30}$/` |
| `kind` | all | `leaf` when `children` is empty; else `region` when `type` maps to a role; else `container` |
| `role` | region | ARIA landmark or structural role (table in §1) |
| `content` | leaf | what the leaf is |
| `bounds` | all | CSS pixels in **document** coordinates (scroll offset included) at the captured width; integers |
| `layout` | non-leaf | §4 |
| `text` | some | preview of the node's own words, ≤ 80 characters, whitespace-collapsed |
| `source.tag` | all | the element that survived wrapper collapsing (lowercase) |
| `source.hints` | some | semantic tags or `role:*` of wrappers collapsed into this node, outermost first |
| `children` | all | top-to-bottom, left-to-right document order; empty for leaves |

`Page` is always the root, has `role: "document"`, and its `bounds` are `{0, 0, viewport.width, document.height}`.

### 3.1 Content kinds

| `content` | Produced for | Drawn as |
|---|---|---|
| `heading` | `h1`–`h6` | thick lines |
| `text` | own text under 140 characters | thin lines |
| `paragraph` | own text of 140 characters or more | thin lines |
| `image` | `img svg video canvas picture iframe`, or a box with a CSS background image | box with an X |
| `icon` | an image at most 48 × 48 px | circle |
| `logo` | a linked image in the left third of the header | box with an X |
| `link` | `a[href]`, plain | underlined stroke |
| `button` | `button`, `role=button`, or a padded coloured link with a few words | box with a bar |
| `input` | `input select textarea` | thin box |
| `divider` | a box at most 4 px tall and at least 60 px wide | line |
| `panel` | a wide coloured box with no text | thin box |
| `backdrop` | an image wider than 90 % of the viewport and taller than 1.2 screens, one spilling past the viewport edges, or one larger than 1.5 screens in area | dotted frame |
| `block` | anything else | thin box |

## 4. `layout`

| `mode` | Meaning | `columns` | `rows` | `gap` | `rowGap` |
|---|---|---|---|---|---|
| `stack` | every child on its own visual row | – | n | vertical spacing | – |
| `row` | one visual row | n | 1 | horizontal spacing | – |
| `split` | two children side by side, each at least 25 % of the parent width, or two children with no horizontal overlap | 2 | 1 | horizontal spacing | – |
| `grid` | two or more rows, every full row holds the same count k ≥ 2, cell widths within ±25 % of their mean | k | n | horizontal spacing | vertical spacing |
| `flow` | none of the above | – | n | – | – |

- A **visual row** groups children whose vertical overlap exceeds half of the shorter one's height.
- `gap` is the **median** distance between neighbouring children along the main axis, never negative.
- `padding` is the distance from the node's `bounds` to the bounding box of its children, never negative.
- A container with fewer than two children has `mode: "stack"` and no counts.

## 5. Responsive set

```json
{
  "format": "uimodulay/layout-ast-set",
  "version": 1,
  "url": "https://astro.build/",
  "widths": [390, 820, 1440],
  "variants": [ { "width": 390, "ast": { "format": "uimodulay/layout-ast", "…": "…" } }, "…" ],
  "changes": [
    { "path": "Main / Section / Gallery “View Theme”", "type": "Gallery", "arrangement": ["stack", "grid 2", "grid 3"], "presence": false }
  ]
}
```

- `variants` are in the order of `widths`. Each `ast` is a complete `layout-ast` document.
- `changes` lists containers of the **widest** variant (down to depth 3) whose arrangement differs
  somewhere. `arrangement[i]` corresponds to `widths[i]`: `"<mode>"`, `"<mode> <columns>"`, a leaf's
  `content`, or `"—"` when the module was not found at that width. `presence` is true when some
  entry is `"—"`.
- Modules are matched across widths by **fingerprint**: the first four leaf texts under the node,
  each cut to 24 characters, joined with `|`. Names, wrapper collapsing and sibling order change
  between widths; the words do not. A module with no words falls back to its type path with
  sibling index (`/Main#0/Section#2`). Ambiguous fingerprints (shared by two modules) never match.
- `path` is the type path in the widest variant followed by the module's first words in quotes.

## 6. Guarantees and versioning

- `id`s are dense from 0 in pre-order. They are not stable between two captures of the same page.
- `bounds` of a child are not guaranteed to lie inside its parent (overflowing content, negative margins).
- `children` order is document order, which for `row`/`grid` is also left-to-right, top-to-bottom.
- `version` bumps on any change to field names, required fields, or the meaning of `mode`,
  `role` or `content` values. New optional fields and new `type` names are not breaking.
- Producers other than uimodulay should set `source.generator` to their own name.

## 7. Mapping to other systems

- **Figma**: `row`/`stack` → Auto Layout direction; `gap` → item spacing; `padding` → padding;
  `grid` → a wrapping Auto Layout or a Grid frame; `bounds` → absolute frame.
- **Accessibility tree**: every `role` is a valid ARIA role, so region nodes can be diffed against
  Chrome's `Accessibility.getFullAXTree`.
- **MJML / email**: `Section` → `mj-section`; a `row`/`split` child → `mj-column`; leaves → `mj-text`,
  `mj-image`, `mj-button`.
- **VIPS / DocLayNet**: `content` kinds are a superset of the DocLayNet label set restricted to what
  a web page has; `bounds` plus `kind` give the block tree VIPS produces.

## 8. Examples

- `examples/playwright.dev.ast.json` — a documentation landing page at 1440 px.
- `examples/mozilla.org.ast.json` — a marketing page at 1440 px.
- `examples/astro.build.set.json` — a responsive set at 390 / 820 / 1440 px with a changes table.

`test/schema.test.ts` checks every example against `docs/layout-ast.schema.json`.
