// Shared types: what the browser probe emits, and what the analyzer produces.

/** One rendered element, as captured inside the page. Flat; `parent` is an index. */
export interface RawBox {
  id: number;
  parent: number; // -1 for the root
  tag: string;
  role: string; // explicit ARIA role, or ""
  x: number;
  y: number;
  w: number;
  h: number;
  display: string; // computed display
  position: string; // computed position
  bg: boolean; // has a visible background (color or image)
  text: string; // own text (direct text nodes only), trimmed, truncated
  textLen: number; // total text length under this element
  img: boolean; // renders an image (img/svg/video/canvas/picture or css background-image)
  link: boolean; // a[href] or button or input/select/textarea
  heading: number; // 1..6 for h1..h6, else 0
  id_attr: string;
  cls: string; // first few class names
}

export interface Snapshot {
  url: string;
  width: number;
  height: number; // viewport height
  docHeight: number;
  boxes: RawBox[];
}

/** Node of the semantic layout tree. */
export interface LayoutNode {
  type: string; // Page | Header | Hero | Gallery | Card | Heading | Text | Image | Link | Button | Nav | Footer | Section | Group | ...
  tag: string;
  bounds: [number, number, number, number]; // x, y, w, h
  layout?: "stack" | "row" | "split" | "grid" | "flow";
  columns?: number;
  rows?: number;
  text?: string;
  hint?: string; // semantic tag / role collected while collapsing wrappers
  children: LayoutNode[];
}
