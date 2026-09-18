// The probe runs INSIDE the page (serialized by Playwright's page.evaluate).
// It must be self-contained: no imports at runtime, no closures over module scope.
// It walks the rendered DOM and emits a flat list of visible boxes.

import type { RawBox, Snapshot } from "./types.ts";

export function probe(): Snapshot {
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "META", "LINK", "HEAD", "TITLE", "BR", "WBR"]);
  const IMG = new Set(["IMG", "SVG", "VIDEO", "CANVAS", "PICTURE", "IFRAME", "OBJECT", "EMBED"]);
  const CTRL = new Set(["BUTTON", "INPUT", "SELECT", "TEXTAREA"]);
  const SVG_NS = "http://www.w3.org/2000/svg";
  const boxes: RawBox[] = [];
  const vw = window.innerWidth;

  function ownText(el: Element): string {
    let s = "";
    for (const n of el.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) s += n.textContent ?? "";
    }
    return s.replace(/\s+/g, " ").trim();
  }

  function opaque(color: string): boolean {
    if (!color || color === "transparent") return false;
    const m = color.match(/rgba?\(([^)]+)\)/);
    if (!m) return true;
    const parts = m[1].split(",").map((v) => parseFloat(v));
    return parts.length < 4 || parts[3] > 0.05;
  }

  function hasBg(cs: CSSStyleDeclaration): boolean {
    return (cs.backgroundImage !== "" && cs.backgroundImage !== "none") || opaque(cs.backgroundColor);
  }

  function rendered(cs: CSSStyleDeclaration): boolean {
    return cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.opacity) > 0.02;
  }

  function rectOf(el: Element): { x: number; y: number; w: number; h: number } {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) };
  }

  function onPage(r: { x: number; y: number; w: number; h: number }): boolean {
    return r.w > 0 && r.h > 0 && r.x + r.w > 0 && r.x < vw && r.y + r.h > 0;
  }

  function classes(el: Element): string {
    const cls = typeof el.className === "string" ? el.className : "";
    return cls.split(/\s+/).filter(Boolean).slice(0, 4).join(" ");
  }

  function isLink(el: Element, tag: string): boolean {
    if (tag === "A") return el.hasAttribute("href");
    return CTRL.has(tag);
  }

  function boxFor(el: Element, cs: CSSStyleDeclaration, r: { x: number; y: number; w: number; h: number }, parent: number): RawBox {
    const tag = el.tagName;
    const t = tag.toLowerCase();
    return {
      id: boxes.length,
      parent,
      tag: t,
      role: el.getAttribute("role") ?? "",
      x: r.x, y: r.y, w: r.w, h: r.h,
      display: cs.display,
      position: cs.position,
      bg: hasBg(cs),
      text: ownText(el).slice(0, 80),
      textLen: (el.textContent ?? "").replace(/\s+/g, " ").trim().length,
      img: IMG.has(tag) || (cs.backgroundImage !== "none" && r.w > 24 && r.h > 24),
      link: isLink(el, tag),
      heading: /^h[1-6]$/.test(t) ? Number(t[1]) : 0,
      id_attr: el.id ?? "",
      cls: classes(el),
    };
  }

  type R = { x: number; y: number; w: number; h: number };
  /** Where the children may still show: the intersection of every overflow-clipping ancestor. */
  type Scope = { parent: number; clip: R | null };

  function intersect(a: R, b: R): R | null {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const w = Math.min(a.x + a.w, b.x + b.w) - x;
    const h = Math.min(a.y + a.h, b.y + b.h) - y;
    return w > 0 && h > 0 ? { x, y, w, h } : null;
  }

  const vh = window.innerHeight;

  /**
   * Does this box cut off what overflows it? Not body or html (their overflow moves to the
   * viewport), and not a page-level scroller (a smooth-scroll wrapper or an overflow:auto page):
   * everything inside one of those is reachable by scrolling, so it is part of the page.
   */
  function clips(el: Element, cs: CSSStyleDeclaration): boolean {
    if (cs.overflowX === "visible" && cs.overflowY === "visible") return false;
    if (el === document.body || el === document.documentElement) return false;
    const pageScroller = el.clientHeight >= vh * 0.8 && el.scrollHeight > el.clientHeight * 1.2;
    return !pageScroller;
  }

  /**
   * Marked as not there: the hidden attribute, a screen-reader-only clip, or aria-hidden / inert
   * on something smaller than half the screen. A larger aria-hidden region is the page behind an
   * open popup, which is still the page.
   */
  function hiddenByAuthor(el: Element, cs: CSSStyleDeclaration, r: { w: number; h: number }): boolean {
    if (el.hasAttribute("hidden")) return true;
    if (cs.clip.startsWith("rect(0px, 0px, 0px, 0px)") || cs.clipPath.includes("inset(100%)")) return true;
    const muted = el.getAttribute("aria-hidden") === "true" || el.hasAttribute("inert");
    return muted && r.w * r.h < vw * vh * 0.5;
  }

  /** Emit this element if it is visible inside its scope; return the scope for its children (or null to stop). */
  function emit(el: Element, scope: Scope): Scope | null {
    const cs = getComputedStyle(el);
    if (!rendered(cs)) return null;
    const r = rectOf(el);
    if (hiddenByAuthor(el, cs, r)) return null;
    const cuts = clips(el, cs);
    const shown = scope.clip ? intersect(r, scope.clip) : r;
    if (!shown || !onPage(shown)) return cuts ? null : scope; // clipped away: children of a clipping box are gone too
    boxes.push(boxFor(el, cs, r, scope.parent));
    return { parent: boxes.length - 1, clip: cuts ? shown : scope.clip };
  }

  // parent index is the nearest *emitted* ancestor, so hidden/skipped wrappers vanish.
  function walk(el: Element, scope: Scope): void {
    const tag = el.tagName;
    if (SKIP.has(tag)) return;
    if (el.namespaceURI === SVG_NS && tag !== "svg") return; // svg internals
    const inner = emit(el, scope);
    if (!inner) return;
    const shadow = (el as HTMLElement).shadowRoot; // open shadow roots are walked as children
    if (shadow) for (const c of shadow.children) walk(c, inner);
    for (const c of el.children) walk(c, inner);
  }

  walk(document.body, { parent: -1, clip: null });
  // Pages that scroll inside an inner container report a short scrollHeight; the boxes know better.
  const lowest = boxes.reduce((m, b) => Math.max(m, b.y + b.h), 0);
  return {
    url: location.href,
    width: vw,
    height: window.innerHeight,
    docHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, lowest),
    boxes,
  };
}
