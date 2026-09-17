# Changelog

## 0.1.0 — 2026-09-18

First public release.

- `analyze(url)` / `uimodulay <url>`: render a page in the installed Chrome (Playwright) and
  turn it into a semantic layout tree — wrapper chains collapsed, stack / row / split / grid
  detected from geometry, modules named from ARIA landmarks, tags, position and composition.
- Layout AST v1 (`docs/LAYOUT-AST.md`): ARIA roles + Auto Layout vocabulary with gap and
  padding + DocLayNet-style content kinds, as a versioned JSON document.
- `--ai`: Claude renames generic modules through the Claude Agent SDK using your own `claude`
  login (no API key). Geometry is never touched.
- `--widths phone,tablet,desktop`: one browser, resized in place; a changes table matches
  modules across widths by the words they contain.
- `sketchSvg(ast)` / `--sketch`: hand-drawn monochrome wireframe, no dependencies.
- `uimodulay-app`: local server with a URL bar, width chips, compare view and hover-linked outline.
