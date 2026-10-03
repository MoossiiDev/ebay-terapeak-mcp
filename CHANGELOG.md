# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0/). For **how** we version, tag, and publish, see [docs/RELEASES.md](./docs/RELEASES.md).

## [Unreleased] — MoossiiDev fork

### Added
- `get_item` tool: reads any item page (live or ended/sold) in the logged-in browser and returns title, status, price, condition, and seller description text (from the itm.ebaydesc.com iframe). eBay drops ended-listing descriptions after roughly 90 days, and only the summary is returned then. `EBAY_MCP_DEBUG_DIR` dumps raw item HTML for selector fixes.
- HTTP daemon mode (`EBAY_MCP_PORT`): stateless Streamable HTTP on 127.0.0.1, one long-lived browser shared by every MCP client (a Chromium profile can only be opened by one process). `GET /health` returns `{ok, loggedIn}`.
- `EBAY_MCP_ENGINE` switch: `playwright` (default, stock Chromium) or `cloak` (upstream CloakBrowser, now an optional dependency loaded lazily).
- Dead-browser recovery: a closed context/page is dropped and relaunched on the next call.
- `login.sh`: stops the service, opens a headed login on DISPLAY=:0, restarts the service. `EBAY_LOGIN_TIMEOUT_MIN` sets the wait.

### Fixed
- A session eBay revoked server-side no longer reads as an empty market. It returned JSON with no aggregates and no rows (identical to a genuine zero-result query) while `/health` still said `loggedIn:true` from the cookie. An empty first page now triggers one live Seller Hub check: logged out throws `NotLoggedInError` and flips `/health` `lastKnown` to false; signed in returns the zero with a "live check confirmed" note. `session_status` also records its result in `lastKnown`. Login hints point at `./login.sh`.
- `npm test` (node:test over the built `dist/`) with fake-session tests for the empty/logged-out cases; CI runs it. Prettier-formatted `browser.ts`, `item.ts`, `server.ts` so `format:check` passes.

### Changed
- `GET /health` is local-only: `ebaysid` cookie + last real request outcome; it no longer loads Seller Hub (a probe that navigates generates bot-like traffic on the account every 10 min). `session_status` stays the explicit live check.
- Stock engine sends no spoofed User-Agent (a Windows/Chrome-124 string on Linux Chrome 149 mismatches client hints). Runs headed under Xvfb instead of headless.

## [Unreleased]

## [0.2.1] - 2026-07-21

### Added

- Standardized project scaffolding: `LICENSE` (MIT), `.editorconfig`, `.env.example`, ESLint + Prettier, Conventional Commits (commitlint), Husky pre-commit hooks, CI + release workflows, issue/PR templates, and a `docs/` guide set.

### Changed

- **Browser engine: switched from vanilla Playwright to [CloakBrowser](https://github.com/CloakHQ/cloakbrowser)** (a fingerprint-patched Chromium), aligning the anti-detection stack with the other browser-based MCP servers. CloakBrowser ships its own binary, so the separate `npx playwright install chromium` step is gone; `playwright` is retained only for its types. No tool or API changes.
- Updated runtime and development dependencies, and standardized the npm trusted-publishing release workflow.

## [0.2.0] - 2026-07-06

### Added

- MCP server **and CLI** for eBay **Terapeak Product Research** (sold & active listings) via a persistent Playwright session.
- **3 tools:** `search_sold_listings`, `search_active_listings`, `session_status`, with server-side and client-side filters (exact phrase, condition, price range, format, exclude, sort).
- Structured response shape with aggregates + per-listing rows; compact-by-default rows (`detail: true` for heavy fields).

[Unreleased]: https://github.com/bintangtimurlangit/ebay-terapeak-mcp/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/bintangtimurlangit/ebay-terapeak-mcp/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/bintangtimurlangit/ebay-terapeak-mcp/releases/tag/v0.2.0
