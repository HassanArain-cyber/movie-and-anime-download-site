# Bulk Add Episodes

> For the recommended placeholder-first workflow with one quality per link batch, use **Bulk Add Links**. See [Episode placeholders and bulk links by quality](episode-links-by-quality.md). This advanced row/file creation tool remains available unchanged.

## Android workflow

1. Tap **Admin** and enter your existing admin password.
2. In the horizontally scrollable admin tab bar, tap **Bulk Add Episodes** (next to Media).
3. Select the anime/series and an existing season. If the season is missing, create it under Media first.
4. Tap **Add Another Episode** for each new episode. Fill its number, title, and download link. Quality defaults to 1080p but can be changed; duration is optional. Remove unwanted rows before submission.
5. Alternatively, when R2 is configured, tap **Select multiple video files** and use Android's file picker to select several videos. Each file creates a row. Names like `S01E03.mp4`, `EP 004.mkv`, and `05.mp4` suggest episode numbers; file basenames suggest titles. Check every number/title/quality before submitting. A row supports either a file OR an external link. Individual file selection is also available per row.
6. Tap **Save all episodes** once. Each row shows creating/uploading/attaching/saved or an error, and file transfers show percentage progress. The summary counts saved and failed rows.
7. Correct failed rows, then tap **Retry failed episodes**. Successful rows are skipped; known episode IDs and completed uploads are reused. Existing download links are reconciled before attachment to avoid duplicate links after a lost response.
8. Use **Start a new batch** to clear the form and select another title/season. This does not delete saved episodes or uploaded files.

Keep the page open and the phone connected while processing. Do not refresh or close the browser: draft files and retry checkpoints are held in browser memory, not durable storage. Switching admin tabs after processing retains the form while the admin page stays mounted. Tabs and logout are disabled during processing, and normal page unload displays a browser warning where supported.

## Validation and failure behavior

- A batch is preflight-validated before new API writes: valid integer numbers (1–100000), titles, supported links or non-empty video files, field lengths, duplicate numbers within the batch, and conflicts with freshly fetched season episodes.
- Existing episodes are never overwritten. To add another quality to an already existing episode, use the existing Media → season → episode link editor or batch file uploader.
- Rows are processed independently and sequentially. One row failing does not roll back or remove successful rows. If an episode was created but uploading/link attachment failed, its status explicitly says the episode is saved and its link is pending.
- If an episode-creation request loses its response, the UI does not blindly retry an ambiguous insertion. Review that episode number in Media. If it exists, finish its link using the existing editor; if it does not, start a new batch after checking. This conservative behavior avoids claiming idempotency that the existing POST endpoint does not provide.
- R2 uses the existing secure browser-to-R2 multipart client, signed uploads, target IDs, quality metadata, resume sessions, and verified completion. No video bytes are sent through a new API or stored as arbitrary local links.
- If an old multipart session expires or is aborted, use the existing episode/link editor to finish the already-created episode rather than creating it again.
- A synchronous submission lock and disabled controls prevent double submission in this interface. Existing server-side authorization, validation, and duplicate checks remain in force. This change does not introduce cross-client database uniqueness or new server idempotency semantics.

## Implementation and verification

New files: `BulkAddEpisodes.tsx`, `bulk-episodes.ts`, and `bulk-episodes.test.ts`. The only existing admin component changed is `AdminDashboard.tsx`, which exposes the new tab and retains its form state across tab switches. Individual creation, range creation, and the existing batch quality uploader are preserved.

No schema, migrations, API route, authentication, storage implementation, wallpaper management, or environment changes are needed. Existing endpoints `/api/media`, `/api/media/[id]`, `/api/episodes`, `/api/download-links`, and secure upload endpoints are reused.

Tests cover required fields, duplicate/new season numbers, safe URLs/files, filename matching, partial failures, checkpointed R2 retries, lost attachment responses, uncertain creation responses, and skipping saved rows. Browser tests exercise the new tab with real local API writes, validation/duplicate rejection before insertion, a simulated link failure and retry without duplicates, multiple real mock-R2 file uploads, row removal, and 360/390/768/1280px overflow checks.
