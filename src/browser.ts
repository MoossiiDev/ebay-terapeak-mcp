/**
 * Persistent CloakBrowser session against eBay Seller Hub.
 *
 * The whole point: rather than scraping cookies and replaying them with a plain
 * HTTP client (which eBay's bot detection — Akamai + perfdrive — flags), we keep
 * a real logged-in Chromium profile alive and run the API `fetch` *inside* the
 * page. That request carries every session cookie, satisfies bot detection, and
 * lets the real browser rotate the short-lived anti-bot cookies itself. That is
 * what defeats the cookie-staleness problem.
 *
 * We drive CloakBrowser (a fingerprint-patched Chromium) rather than vanilla
 * Playwright so the same anti-detection profile is shared across these servers.
 * Playwright is kept only for its context/page TYPES — CloakBrowser's context is
 * API-compatible.
 */
import { chromium, type BrowserContext, type Page } from 'playwright';
import os from 'node:os';
import path from 'node:path';

const RESEARCH_URL = 'https://www.ebay.com/sh/research?marketplace=EBAY-US&tabName=SOLD';
const SEARCH_API = 'https://www.ebay.com/sh/research/api/search';

/** Where the logged-in browser profile lives (override with EBAY_MCP_PROFILE). */
export const PROFILE_DIR =
  process.env.EBAY_MCP_PROFILE || path.join(os.homedir(), '.ebay-research-mcp', 'profile');

/** How to recover, appended to every NotLoggedInError message. */
export const LOGIN_HINT =
  'Re-login: run ./login.sh (stops the service, opens a sign-in window, restarts it), ' +
  'or `npm run login` with the server stopped.';

/** Thrown when the session isn't authenticated (or got logged out). */
export class NotLoggedInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotLoggedInError';
  }
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Browser engine. Default `playwright` = stock Playwright Chromium (no third-party
 * binary). `cloak` = upstream's CloakBrowser (fingerprint-patched Chromium), loaded
 * lazily so it is only installed/downloaded if stock Chromium gets bot-blocked.
 */
const ENGINE = process.env.EBAY_MCP_ENGINE || 'playwright';

async function launch(headless: boolean): Promise<BrowserContext> {
  if (ENGINE === 'playwright') {
    // No UA override: a spoofed Windows/Chrome-124 UA on a Linux Chrome-149 build
    // mismatches the client hints, which is itself a bot signal. Run headed (under
    // Xvfb on the server) so the native UA carries no "HeadlessChrome" token.
    return chromium.launchPersistentContext(PROFILE_DIR, {
      headless,
      viewport: { width: 1280, height: 900 },
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    });
  }
  const cloak = 'cloakbrowser';
  const { launchPersistentContext } = await import(cloak);
  return (await launchPersistentContext({
    userDataDir: PROFILE_DIR,
    headless,
    userAgent: USER_AGENT,
    viewport: { width: 1280, height: 900 },
    humanize: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })) as unknown as BrowserContext;
}

export class EbaySession {
  private ctx: BrowserContext | null = null;
  private page: Page | null = null;
  private startPromise: Promise<void> | null = null;
  /** Serializes access to the single shared page so overlapping tool calls
   *  don't navigate/fetch on top of each other. */
  private chain: Promise<unknown> = Promise.resolve();
  /** Login state observed by the last REAL request (null = none yet). */
  private lastKnown: { loggedIn: boolean; at: number } | null = null;

  constructor(private headless = true) {}

  private async start(): Promise<void> {
    if (this.ctx) return;
    if (!this.startPromise) {
      this.startPromise = (async () => {
        this.ctx = await launch(this.headless);
        // If the browser dies (crash, OOM, killed for a re-login), drop the handle so
        // the next call relaunches instead of failing forever on a dead context.
        this.ctx.on('close', () => {
          this.ctx = null;
          this.page = null;
          this.startPromise = null;
        });
        // Fail fast instead of hanging if a bot-challenge page never settles.
        this.ctx.setDefaultNavigationTimeout(45_000);
        this.page = this.ctx.pages()[0] ?? (await this.ctx.newPage());
      })();
    }
    await this.startPromise;
  }

  /** Run `fn` exclusively (mutex over the shared page). */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next as Promise<T>;
  }

  private async ensureReady(): Promise<void> {
    await this.start();
    if (!this.page || this.page.isClosed()) this.page = await this.ctx!.newPage();
    const page = this.page;
    if (!page.url().startsWith('https://www.ebay.com/sh/research')) {
      await page.goto(RESEARCH_URL, { waitUntil: 'domcontentloaded' });
    }
    if (page.url().includes('signin.ebay.com')) {
      this.lastKnown = { loggedIn: false, at: Date.now() };
      throw new NotLoggedInError(`eBay session is not authenticated. ${LOGIN_HINT}`);
    }
  }

  /** LIVE check (loads Seller Hub once): true if the profile is logged in. Records
   *  the outcome in lastKnown so /health reflects it. */
  async isLoggedIn(): Promise<boolean> {
    return this.run(async () => {
      await this.start();
      await this.page!.goto(RESEARCH_URL, { waitUntil: 'domcontentloaded' });
      const loggedIn = !this.page!.url().includes('signin.ebay.com');
      this.lastKnown = { loggedIn, at: Date.now() };
      return loggedIn;
    });
  }

  /**
   * Call the research search endpoint with a prebuilt query string and return
   * the raw response body (concatenated JSON modules).
   */
  async fetchSearch(queryString: string): Promise<string> {
    return this.run(async () => {
      await this.ensureReady();
      const url = `${SEARCH_API}?${queryString}`;
      const res = await this.page!.evaluate(async (u: string) => {
        const r = await fetch(u, {
          headers: { 'x-requested-with': 'XMLHttpRequest', accept: '*/*' },
          credentials: 'include',
        });
        return {
          status: r.status,
          contentType: r.headers.get('content-type') ?? '',
          body: await r.text(),
        };
      }, url);

      if (!res.contentType.includes('application/json')) {
        this.lastKnown = { loggedIn: false, at: Date.now() };
        throw new NotLoggedInError(
          `eBay returned a non-JSON response (HTTP ${res.status}). The session ` +
            `is likely stale or bot detection triggered. ${LOGIN_HINT}`,
        );
      }
      // JSON alone does not prove the login: a session eBay revoked server-side still
      // gets JSON, just with no aggregates and no rows. runSearch live-checks that case.
      this.lastKnown = { loggedIn: true, at: Date.now() };
      return res.body;
    });
  }

  /**
   * Fetch an eBay item page (live or ended) plus its seller description. The item
   * page is fetched in-page (carries the browser fingerprint that plain HTTP lacks);
   * the description lives on a separate ebaydesc.com iframe URL, fetched through the
   * context's request client (shares cookies, not subject to page CORS).
   */
  async fetchItem(
    itemId: string,
  ): Promise<{ html: string; descHtml: string | null; status: number }> {
    // Digits only: the id is interpolated into a URL and a debug file path.
    if (!/^\d{6,20}$/.test(itemId)) throw new Error(`Invalid eBay item id: ${itemId}`);
    return this.run(async () => {
      await this.ensureReady();
      const res = await this.page!.evaluate(
        async (u: string) => {
          const r = await fetch(u, { credentials: 'include' });
          return { status: r.status, body: await r.text() };
        },
        `https://www.ebay.com/itm/${encodeURIComponent(itemId)}`,
      );
      const m = res.body.match(/https:\/\/[a-z.]*ebaydesc\.com\/(?:itmdesc|ws)\/[^\s"'>]+/);
      let descHtml: string | null = null;
      if (m) {
        const url = m[0].replace(/&amp;/g, '&');
        const d = await this.ctx!.request.get(url, { timeout: 30_000 }).catch(() => null);
        if (d && d.ok()) descHtml = await d.text();
      }
      if (process.env.EBAY_MCP_DEBUG_DIR) {
        const fs = await import('node:fs');
        fs.writeFileSync(`${process.env.EBAY_MCP_DEBUG_DIR}/item-${itemId}.html`, res.body);
      }
      return { html: res.body, descHtml, status: res.status };
    });
  }

  /**
   * LOCAL-ONLY login check for the watchdog/statusline: never sends a request to
   * eBay (feedback_no_synthetic_health_probes: automated probe traffic on a logged-in
   * seat is a bot signature). Combines the persistent `ebaysid` login cookie (present
   * and unexpired) with the outcome of the last REAL request. A session eBay revoked
   * server-side is caught on the next real use, which flips lastKnown to false.
   */
  async localStatus(): Promise<{
    loggedIn: boolean;
    cookie: boolean;
    lastKnown: { loggedIn: boolean; at: number } | null;
  }> {
    return this.run(async () => {
      await this.start();
      const now = Date.now() / 1000;
      const cs = await this.ctx!.cookies('https://www.ebay.com');
      const cookie = cs.some((c) => c.name === 'ebaysid' && (c.expires < 0 || c.expires > now));
      return {
        loggedIn: cookie && this.lastKnown?.loggedIn !== false,
        cookie,
        lastKnown: this.lastKnown,
      };
    });
  }

  async close(): Promise<void> {
    await this.ctx?.close();
    this.ctx = null;
    this.page = null;
    this.startPromise = null;
  }
}

/**
 * One-time interactive login. Opens a headed browser using the SAME persistent
 * profile the server uses, lets the user sign in by hand (incl. 2FA), and waits
 * until Seller Hub Research loads. Must be run while the server is NOT running
 * (a profile directory can only be opened by one browser at a time).
 */
export async function loginInteractive(): Promise<void> {
  const ctx = await launch(false);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(RESEARCH_URL, { waitUntil: 'domcontentloaded' });

  console.error(
    '\nA browser window has opened.\n' +
      '  1. Sign into your eBay account (complete any 2FA).\n' +
      "  2. Wait until the 'Research products' page loads.\n" +
      'Waiting for sign-in...\n',
  );

  const minutes = Number(process.env.EBAY_LOGIN_TIMEOUT_MIN || 5);
  const deadline = Date.now() + minutes * 60 * 1000;
  let ok = false;
  while (Date.now() < deadline) {
    const url = page.url();
    if (url.startsWith('https://www.ebay.com/sh/research') && !url.includes('signin.ebay.com')) {
      const hasResearch = await page
        .getByRole('heading', { name: 'Research products' })
        .count()
        .catch(() => 0);
      if (hasResearch) {
        ok = true;
        break;
      }
    }
    await page.waitForTimeout(1500);
  }

  if (ok) {
    console.error(
      '\n✅ Login detected and saved to the profile. You can close this window.\n' +
        '   The MCP server will now reuse this session.\n',
    );
  } else {
    console.error('\n⚠️  Timed out waiting for sign-in. Re-run `npm run login` and try again.\n');
  }
  await ctx.close();
}
