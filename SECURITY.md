# Security

The launcher opens Chromium DevTools Protocol on `127.0.0.1:9322`. While the desktop app remains open, another local process running as the same user may be able to control that app through this port. Fully exit the app, including its tray process, to close the port.

The launcher refuses non-loopback CDP endpoints, disables HTTP proxy use and redirects, verifies the listener and owning process, and only targets `app://-/index.html`. The injected adapter contains no HTTP/WebSocket/fetch calls and does not modify installed application files.

Bookmarks are stored in the app's localStorage as conversation IDs and message IDs. Chat text is held only in page memory for previews and is not written by this project.

Please avoid attaching chat exports, DOM inspection reports, account identifiers, or tokens to public bug reports. Report a suspected vulnerability privately to the repository maintainer before opening a public issue.
