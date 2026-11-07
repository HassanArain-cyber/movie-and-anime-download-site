# Admin Delete All: comments and requests

Both sections expose a compact Delete All button with a native Cancel/OK confirmation. Comments deletion is global, including hidden/unreported comments and nested replies—not scoped to a media title, report status, visible row limit or API page. Requests deletion is likewise collection-wide. This is permanent, not a Recycle Bin operation.

The existing collection routes now accept authenticated, same-origin `DELETE` with JSON `{ "confirm": true }`. Missing/false confirmation is rejected before any database mutation. Each action runs a single fixed PostgreSQL `DELETE … RETURNING` CTE and returns the deleted-record count. Existing foreign keys remove comment replies/likes/reports; no media, episode, link, Wallpaper, storage object or independent upload-history record is targeted. No migration is required.

The UI prevents overlapping actions, shows indeterminate progress while awaiting the operation and refresh, and retains navigation/before-unload safeguards. Cancel sends no request. Failed requests trigger a reconciliation read, not an automatic destructive retry. A committed delete followed by a failed refresh is reported explicitly so the operator can refresh the list. Records submitted concurrently after the DELETE statement's snapshot may appear on refresh; they are new records, not a pagination omission.

Verification uses unit fixtures, the built Admin UI against fixture APIs, and a loopback-only PostgreSQL/browser suite. The global-delete integration suite runs last against disposable data, covers more than 523 comments/deep replies and 1005 requests, and verifies digests of unrelated tables remain unchanged. Never point that global-delete test at Preview or Production.
