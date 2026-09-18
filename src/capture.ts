// Browser layer: render a URL with the locally installed Chrome and run the probe.
// `openContext` and `preparePage` are shared with the crawler, so both load pages the same way.

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
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
/** Below this width the page is loaded as a phone: touch, mobile user agent, device pixel ratio 1. */
const PHONE_MAX_WIDTH = 600;
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

/** A page that never goes network-idle is still worth capturing. */
function ignore(): undefined {
  return undefined;
}

/**
 * The user agent a desktop Chrome of this version sends. Headless Chrome announces itself as
 * "HeadlessChrome", and some sites answer that with a different page (a machine-readable
 * summary, an access-denied screen) instead of the one people see.
 */
function desktopUa(browser: Browser): string {
  const version = browser.version().split(".")[0];
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`;
}

/** One fresh context per page load, sized and dressed as the device the width stands for. */
export async function openContext(browser: Browser, width: number, height = 900): Promise<BrowserContext> {
  const phone = width < PHONE_MAX_WIDTH;
  return browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    isMobile: phone,
    hasTouch: phone,
    userAgent: phone ? PHONE_UA : desktopUa(browser),
  });
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

/**
 * Close what stands between a first-time visitor and the page: press Escape once (newsletter and
 * region popups), and accept a cookie banner if one is showing. One attempt each; nothing else.
 */
async function dismissOverlays(page: Page): Promise<void> {
  await page.keyboard.press("Escape").catch(ignore);
  await page.evaluate(() => {
    const ACCEPT = /^(accept( all)?( cookies)?|allow( all)?( cookies)?|agree|i agree|got it|ok|okay|同意する|すべて許可|すべて同意|許可する|OK)$/i;
    const hosts = document.querySelectorAll('[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[id*="onetrust" i],[id*="didomi" i],[role="dialog"],[aria-modal="true"]');
    for (const host of hosts) {
      const button = [...host.querySelectorAll("button, a, [role=button]")].find((b) => ACCEPT.test((b.textContent ?? "").trim()));
      if (button) {
        (button as HTMLElement).click();
        return;
      }
    }
  }).catch(ignore);
  await page.waitForTimeout(400);
}

/** Load a URL the way every capture does: wait for the network to settle, clear overlays, scroll. */
export async function preparePage(page: Page, url: string, opts: CaptureOptions): Promise<void> {
  await page.goto(url, { waitUntil: "load", timeout: opts.timeoutMs ?? 30000 });
  await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_MS }).catch(ignore);
  await dismissOverlays(page);
  if (opts.scroll !== false) await scrollThrough(page);
}

/**
 * Run the probe; if the page navigated underneath it (accepting cookies can reload the page),
 * wait for the new page to settle and probe once more.
 */
export async function probePage(page: Page): Promise<Snapshot> {
  try {
    return await page.evaluate(probe);
  } catch {
    await page.waitForLoadState("load").catch(ignore);
    await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_MS }).catch(ignore);
    return page.evaluate(probe);
  }
}

async function captureAt(browser: Browser, url: string, width: number, opts: CaptureOptions): Promise<Snapshot> {
  const context = await openContext(browser, width, opts.height);
  try {
    const page = await context.newPage();
    await preparePage(page, url, opts);
    return await probePage(page);
  } finally {
    await context.close();
  }
}

export async function capture(url: string, opts: CaptureOptions = {}): Promise<Snapshot> {
  const [snap] = await captureMany(url, [opts.width ?? 1440], opts);
  return snap;
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
