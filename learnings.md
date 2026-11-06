# Learnings

Lessons from running this server. Lessons only, not run status.

## A tab held open on a heavy web app burns CPU while idle

- **What happened:** the daemon opened Seller Hub Research on the first search and kept that one tab on it for the life of the service. After about 9 days the tab's renderer was using 2-4 CPU cores (the page's own scripts are the likely cause, not yet proven), with no tool calls in the last 2.3 days (4.5 CPU-days in total). Playwright launches Chromium with background throttling off, and the tab is "visible" on Xvfb, so the page's timers and polling run at full rate.
- **Rule:** never leave a long-lived automation tab parked on a heavy single-page app. Blank it (`about:blank`) after an idle period, under the same lock as the calls that use it, and keep the browser and profile running so logins survive. `EBAY_IDLE_BLANK_MIN` (default 10) does this here.
- **Also:** log one line per call (tool, ms, result, page origin+path), because with no per-call log the journal could not show when the page was loaded or how idle it was. Cap the service with systemd `CPUQuota=` so a future runaway is bounded.
