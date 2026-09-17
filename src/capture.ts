// Browser layer: render a URL with the locally installed Chrome and run the probe.

import { chromium, type Browser, type Page } from "playwright";
import { probe } from "./probe.ts";
import type { Snapshot } from "./types.ts";

export interface CaptureOptions {
  width?: number;
  height?: number;
  timeoutMs?: number;
  /** scroll through the page first so lazy content mounts */
  scroll?: boolean;
}

/** Typical viewports: phone / tablet / laptop / desktop. Structure changes cluster around 768 and 1024. */
export const PRESET_WIDTHS: Record<string, number> = { phone: 390, tablet: 820, laptop: 1024, desktop: 1440 };

const NETWORK_IDLE_MS = 8000;

/** A page that never goes network-idle is still worth capturing. */
function ignore(): undefined {
  return undefined;
}

/** Walk down the page in viewport steps so IntersectionObserver-driven content appears. */
async function scrollThrough(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const step = window.innerHeight;
    const max = (): number => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    for (let y = 0; y < max() && y < 20000; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 250));
  });
}

export async function capture(url: string, opts: CaptureOptions = {}): Promise<Snapshot> {
  const [snap] = await captureMany(url, [opts.width ?? 1440], opts);
  return snap;
}

/** Below this width the page is loaded as a phone: touch, mobile user agent, device pixel ratio 1. */
const PHONE_MAX_WIDTH = 600;
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

/** One fresh browser context per width: sites that pick a layout by user agent or at load time get the real one. */
async function captureAt(browser: Browser, url: string, width: number, opts: CaptureOptions): Promise<Snapshot> {
  const phone = width < PHONE_MAX_WIDTH;
  const context = await browser.newContext({
    viewport: { width, height: opts.height ?? 900 },
    deviceScaleFactor: 1,
    isMobile: phone,
    hasTouch: phone,
    userAgent: phone ? PHONE_UA : undefined,
  });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load", timeout: opts.timeoutMs ?? 30000 });
    await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_MS }).catch(ignore);
    if (opts.scroll !== false) await scrollThrough(page);
    return await page.evaluate(probe);
  } finally {
    await context.close();
  }
}

/** Capture the same page at several viewport widths with one browser, each width loaded afresh. */
export async function captureMany(url: string, widths: number[], opts: CaptureOptions = {}): Promise<Snapshot[]> {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const out: Snapshot[] = [];
    for (const width of widths) out.push(await captureAt(browser, url, width, opts));
    return out;
  } finally {
    await browser.close();
  }
}
