// runSearch must not report a logged-out session as an empty market.
// A session eBay revoked server-side returns JSON with no aggregates and no rows,
// the same shape as a genuine zero-result query. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSearch } from '../dist/core.js';
import { NotLoggedInError } from '../dist/browser.js';

const span = (text) => ({ textSpans: [{ text }] });

const EMPTY = JSON.stringify({ meta: { name: 'resultsHeader' } });
const FULL = [
  {
    meta: { name: 'aggregates' },
    sections: [{ dataItems: [{ header: span('Total sold'), value: span('3') }] }],
  },
  {
    meta: { name: 'searchResults' },
    results: [
      {
        listing: { title: span('Widget'), itemId: { value: '123456789' } },
        avgsalesprice: { avgsalesprice: span('$10.00') },
      },
    ],
    pagination: {},
  },
]
  .map((m) => JSON.stringify(m))
  .join('\n');

function fakeSession(body, loggedIn) {
  const s = {
    liveChecks: 0,
    fetchSearch: async () => body,
    isLoggedIn: async () => {
      s.liveChecks++;
      return loggedIn;
    },
  };
  return s;
}

const opts = {
  keywords: 'widget',
  tab: 'SOLD',
  days: 30,
  categoryId: 0,
  maxResults: 10,
  marketplace: 'EBAY-US',
};

test('empty search on a logged-out session throws NotLoggedInError', async () => {
  await assert.rejects(runSearch(opts, fakeSession(EMPTY, false)), (e) => {
    assert.ok(e instanceof NotLoggedInError);
    assert.match(e.message, /logged out/);
    assert.match(e.message, /login\.sh/);
    return true;
  });
});

test('empty search on a live session is a verified zero', async () => {
  const s = fakeSession(EMPTY, true);
  const r = await runSearch(opts, s);
  assert.equal(r.resultCount, 0);
  assert.equal(r.aggregates, null);
  assert.equal(s.liveChecks, 1);
  assert.ok(r.notes.some((n) => /confirmed the session is signed in/.test(n)));
});

test('a search with results never pays for a live check', async () => {
  const s = fakeSession(FULL, false);
  const r = await runSearch(opts, s);
  assert.equal(r.resultCount, 1);
  assert.equal(r.aggregates.totalSold, 3);
  assert.equal(s.liveChecks, 0);
});
