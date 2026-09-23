#!/usr/bin/env bash
# eBay login for the ebay-terapeak MCP (one-time; re-run when the session expires).
# Stops the ebay-mcp service (a Chromium profile can only be open in one browser),
# opens a HEADED Chromium on the server desktop (DISPLAY=:0, visible over RDP) on the
# same profile, waits for sign-in, then restarts the service. The window closes itself
# once the "Research products" page loads.
#   EBAY_LOGIN_TIMEOUT_MIN  how long to wait for sign-in (default 240)
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DISPLAY="${DISPLAY:-:0}"
export EBAY_LOGIN_TIMEOUT_MIN="${EBAY_LOGIN_TIMEOUT_MIN:-240}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
systemctl --user stop ebay-mcp.service
node "$DIR/dist/index.js" login
rc=$?
systemctl --user start ebay-mcp.service
exit $rc
