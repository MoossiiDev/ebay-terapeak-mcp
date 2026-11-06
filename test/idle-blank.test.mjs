// The tab must be sent to about:blank after an idle period, so a Seller Hub page
// is never left running eBay's scripts for days. Uses a stub page and context
// (no browser, no eBay) and mocked setTimeout. Run: npm test
/* global console, process, setImmediate */
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EbaySession, safeLocation } from '../dist/browser.js';

const IDLE_MS = 600_000; // 10 minutes
const RESEARCH = 'https://www.ebay.com/sh/research?marketplace=EBAY-US&tabName=SOLD';
const JSON_BODY = { status: 200, contentType: 'application/json', body: '{}' };

/** A stub page that records every goto and lets a test hold evaluate() open. */
function stubPage() {
  const p = {
    current: 'about:blank',
    gotos: [],
    hold: null, // set to a promise to make evaluate() wait on it
    url: () => p.current,
    isClosed: () => false,
    goto: async (u) => {
      p.gotos.push(u);
      p.current = u;
    },
    evaluate: async () => {
      if (p.hold) await p.hold;
      return JSON_BODY;
    },
  };
  return p;
}

/** A session with the stub page injected, so start() never launches a browser. */
function stubSession(idleMs = IDLE_MS) {
  const s = new EbaySession(true, idleMs);
  const page = stubPage();
  const ctx = { cookieHold: null, cookies: async () => ctx.cookieHold ?? [] };
  // Private in TypeScript, plain fields at runtime.
  s.ctx = ctx;
  s.page = page;
  return { s, page, ctx };
}

const blanks = (page) => page.gotos.filter((u) => u === 'about:blank').length;

/** Let queued promise callbacks (the lock chain) run. setImmediate is not mocked. */
const flush = () => new Promise((r) => setImmediate(r));

function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout'] });
  mock.method(console, 'error', () => {}); // keep the [idle] log lines out of test output
});
afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

test('the tab is blanked once the idle period passes after a call', async () => {
  const { s, page } = stubSession();
  await s.fetchSearch('q=1');
  assert.equal(page.current, RESEARCH);

  mock.timers.tick(IDLE_MS - 1);
  await flush();
  assert.equal(blanks(page), 0, 'not before the idle period');

  mock.timers.tick(1);
  await flush();
  assert.equal(blanks(page), 1);
  assert.equal(page.current, 'about:blank');

  // The next call reloads Seller Hub through ensureReady, as a cold start does.
  await s.fetchSearch('q=2');
  assert.equal(page.current, RESEARCH);
});

test('a new call restarts the idle timer', async () => {
  const { s, page } = stubSession();
  await s.fetchSearch('q=1');
  mock.timers.tick(IDLE_MS - 1000);
  await s.fetchSearch('q=2'); // resets the clock
  mock.timers.tick(IDLE_MS - 1000);
  await flush();
  assert.equal(blanks(page), 0, 'second call pushed the blank back');

  mock.timers.tick(1000);
  await flush();
  assert.equal(blanks(page), 1);
});

test('the blank never runs while a call is running', async () => {
  const { s, page } = stubSession();
  await s.fetchSearch('q=1');

  const gate = deferred();
  page.hold = gate.promise;
  const running = s.fetchSearch('q=2'); // holds the lock until the gate opens
  await flush();
  mock.timers.tick(IDLE_MS * 3);
  await flush();
  assert.equal(blanks(page), 0, 'no blank while the call holds the page');

  page.hold = null;
  gate.resolve();
  await running;
  await flush();
  assert.equal(blanks(page), 0, 'the timer restarts when the call ends');

  mock.timers.tick(IDLE_MS);
  await flush();
  assert.equal(blanks(page), 1);
});

test('a timer that fires while the lock is held waits for it', async () => {
  const { s, page, ctx } = stubSession();
  await s.fetchSearch('q=1');

  // /health (localStatus) takes the same lock without counting as page use.
  const gate = deferred();
  ctx.cookieHold = gate.promise.then(() => []);
  const health = s.localStatus();
  await flush();
  mock.timers.tick(IDLE_MS);
  await flush();
  assert.equal(blanks(page), 0, 'blank queued behind the lock holder');

  gate.resolve();
  await health;
  await flush();
  assert.equal(blanks(page), 1, 'blank runs once the lock is free');
});

test('a queued blank is dropped if a call ran first', async () => {
  const { s, page, ctx } = stubSession();
  await s.fetchSearch('q=1');

  const gate = deferred();
  ctx.cookieHold = gate.promise.then(() => []);
  const health = s.localStatus(); // holds the lock
  const search = s.fetchSearch('q=2'); // queued before the blank
  await flush();
  mock.timers.tick(IDLE_MS); // blank queued behind the search
  await flush();

  gate.resolve();
  await health;
  await search;
  await flush();
  assert.equal(blanks(page), 0, 'stale blank skipped; the search restarted the timer');
  assert.equal(page.current, RESEARCH);
});

test('EBAY_IDLE_BLANK_MIN=0 turns the blank off', async () => {
  const { s, page } = stubSession(0);
  await s.fetchSearch('q=1');
  mock.timers.tick(IDLE_MS * 100);
  await flush();
  assert.equal(blanks(page), 0);
});

test('the env var sets the idle period, and 0 disables it', async () => {
  const saved = process.env.EBAY_IDLE_BLANK_MIN;
  try {
    process.env.EBAY_IDLE_BLANK_MIN = '0';
    assert.equal(new EbaySession().idleBlankMs, 0);
    process.env.EBAY_IDLE_BLANK_MIN = '10m'; // a typo falls back to 10, never off
    assert.equal(new EbaySession(true).idleBlankMs, 10 * 60_000);
    process.env.EBAY_IDLE_BLANK_MIN = '2';
    assert.equal(new EbaySession().idleBlankMs, 120_000);
    delete process.env.EBAY_IDLE_BLANK_MIN;
    assert.equal(new EbaySession().idleBlankMs, IDLE_MS);
  } finally {
    if (saved === undefined) delete process.env.EBAY_IDLE_BLANK_MIN;
    else process.env.EBAY_IDLE_BLANK_MIN = saved;
  }
});

test('a failed blank is logged, drops the tab, and the next call opens a fresh one', async () => {
  const { s, page, ctx } = stubSession();
  await s.fetchSearch('q=1');
  let closed = false;
  page.close = async () => {
    closed = true;
  };
  page.goto = async () => {
    throw new Error('target crashed');
  };
  mock.timers.tick(IDLE_MS);
  await flush();
  assert.ok(
    console.error.mock.calls.some((c) => /\[idle\] blank failed/.test(String(c.arguments[0]))),
  );
  assert.equal(closed, true);
  assert.equal(s.page, null);
  // The lock chain still works afterwards, on a new tab from the context.
  const fresh = stubPage();
  ctx.newPage = async () => fresh;
  await s.fetchSearch('q=2');
  assert.equal(fresh.current, RESEARCH);
});

test('close() clears the idle timer', async () => {
  const { s, page, ctx } = stubSession();
  await s.fetchSearch('q=1');
  ctx.close = async () => {};
  await s.close();
  s.page = page; // so a stray timer would have something to blank
  mock.timers.tick(IDLE_MS * 2);
  await flush();
  assert.equal(blanks(page), 0);
});

test('safeLocation keeps origin and path only', () => {
  assert.equal(
    safeLocation('https://www.ebay.com/sh/research?keywords=rolex&tabName=SOLD#x'),
    'https://www.ebay.com/sh/research',
  );
  assert.equal(safeLocation('about:blank'), 'about:blank');
  assert.equal(safeLocation('not a url'), '-');
});
