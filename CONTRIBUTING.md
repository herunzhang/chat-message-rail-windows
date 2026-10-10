# Contributing

Contributions are welcome, especially compatibility updates for newer Windows desktop builds.

Before opening a pull request:

1. Keep all network access restricted to loopback CDP endpoints.
2. Do not add chat exports, DOM reports, screenshots containing conversations, application bundles, or extracted proprietary assets.
3. Preserve fail-closed version checks when internal module names or exports change.
4. Run the JavaScript and PowerShell syntax checks documented in `README.md`.
5. Manually verify the four-message threshold, smooth reveal, active-item highlighting, MutationObserver updates, viewport stability, preview caching, and cleanup.

Compatibility pull requests should state the exact desktop application version tested and explain which internal resource names or exports changed. Avoid analytics, telemetry, external CDNs, or automatic downloads.
