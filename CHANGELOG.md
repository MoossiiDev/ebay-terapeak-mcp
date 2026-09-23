# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0/). For **how** we version, tag, and publish, see [docs/RELEASES.md](./docs/RELEASES.md).

## [Unreleased] — MoossiiDev fork

### Added
- HTTP daemon mode (`EBAY_MCP_PORT`): stateless Streamable HTTP on 127.0.0.1, one long-lived browser shared by every MCP client (a Chromium profile can only be opened by one process). `GET /health` returns `{ok, loggedIn}`.
- `EBAY_MCP_ENGINE` switch: `playwright` (default, stock Chromium) or `cloak` (upstream CloakBrowser, now an optional dependency loaded lazily).
- Dead-browser recovery: a closed context/page is dropped and relaunched on the next call.
- `login.sh`: stops the service, opens a headed login on DISPLAY=:0, restarts the service. `EBAY_LOGIN_TIMEOUT_MIN` sets the wait.

### Changed
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
