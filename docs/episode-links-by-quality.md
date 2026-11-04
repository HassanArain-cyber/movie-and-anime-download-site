# Episode placeholders and bulk links by quality

## Recommended workflow (including Android)

1. Open **Admin**, enter the existing admin password, then tap **Bulk Add Links**. The admin tabs scroll sideways on small screens and stay on one compact row.
2. Select the anime/series and its season. If the season is missing, create it using the existing **Media** editor first.
3. Under **Create Episodes**, enter **Start episode** and **End episode**, then tap **Create Episodes**. Both ends are included: `1` to `12` creates Episodes 1–12; `1` to `100` creates Episodes 1–100. The existing API allows up to 500 placeholders per batch, with episode numbers up to 100000. Overlapping existing numbers are rejected without partial insertion or replacement.
4. Under **Bulk Add Links by Quality**, select **720p** once. Each already-created episode has a single link input. Paste links into the desired rows and tap **Save quality links**. Blank rows are skipped; quality, episode title, and other metadata do not need to be repeated on each row.
5. Select **1080p**, paste that quality's links into the same episode rows, and save again. Episode IDs and previously saved 720p links remain unchanged. Repeat for other supported qualities.

The episode list scrolls internally when there are many rows. Status/error messages are shown beside the operation that produced them. The form retains separate drafts/results by episode and quality while the Admin page remains open, including when switching admin tabs. Drafts are in memory, not durable across a refresh; keep the page open while saving.

## Existing qualities and retries

- Existing links for the selected quality are displayed read-only. This workflow does **not** PATCH, overwrite, or delete any existing link or quality.
- To intentionally replace a link, use **Media → title → season → episode → individual link editor**, which remains unchanged. Existing alternate/mirror links are retained.
- Invalid non-empty links are reported before new writes. Empty inputs are skipped.
- A submission lock disables competing actions and prevents double submission from this UI. Each link is saved independently, so a failed row does not undo successful rows.
- Retrying fetches fresh season data. If a previous response was lost but the exact episode/quality/link was saved, it is treated as saved rather than posted again. If another link already exists for that quality, it is protected and skipped.
- This client-side protection does not add cross-client transactional uniqueness or change existing API semantics. Avoid simultaneous bulk operations for the same season/quality from multiple browsers.

## Tools retained

The original individual episode form, range/count creator, per-episode link editor, R2 file uploader, existing batch file uploader, and **Bulk Add Episodes** advanced row/file workflow remain available. The new **Bulk Add Links** tab is the simpler placeholder-first/common-quality workflow; it never creates episodes while saving links.

## Compact moderation

In **Comment moderation**, the visible checkbox/tick action controls comment visibility: checked means visible; clicking hides it, and clicking an unchecked action restores it. The action has Hide/Restore accessible labels and descriptive tooltips.

The arrow expands/collapses the full comment body, title/episode context, timestamps, reply depth/report count/spoiler information, report reason/details/status controls (for reported comments), and the confirmed Delete action. These secondary controls are hidden by default; no moderation functionality was removed.

## Implementation and verification

- `BulkEpisodeLinks.tsx`: new compact range and common-quality UI, exposed by `AdminDashboard.tsx`.
- `episode-quality-batch.ts`: inclusive-range adaptation, quality-aware protection/reconciliation, and link validation using existing helpers.
- `CommentModerationManager.tsx`: compact visibility tick and per-row accessible disclosures.
- `episode-quality-batch.test.ts` and extended browser/API tests.

No changes to the database schema, migrations, API routes, authentication, R2/storage implementation, upload flow, or production environment variables. The new UI reuses `POST /api/episodes/batch` with `{start, count}` and `POST /api/download-links` with existing episode IDs and the common quality. Existing media-detail APIs supply episode/link data.

Validation: TypeScript, ESLint, 48 unit tests, production build, and browser/API regression tests. Browser scenarios cover inclusive ranges including 1–100, overlap rejection, 720p then 1080p without episode recreation or link replacement, blank/invalid rows, partial failure/retry, concurrent-existing-quality protection, moderation expand/collapse, visibility actions, report status, confirmed deletion, and mobile/tablet/desktop overflow. Production-rendered workflow and collapsed/expanded moderation screenshots were inspected at 360/390/768/1280px against disposable local data. Physical Android review remains recommended.
