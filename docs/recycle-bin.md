# Recycle Bin and standalone anime movies

## Deployment boundary

`drizzle/0008_recycle_bin.sql` adds only the independent `content_state` marker table and its index. It does not change existing media, relationships, Wallpaper settings, R2 uploads, or migration 0007. Creation of this migration does **not** apply it to any live database. Builds and deployments never run migrations.

An authorized operator must install **only the new 0008 migration**, once, on the independently confirmed Preview database, recording it consistently with the existing migration process. Do not paste/re-run installed 0007, use `db:push`, or target Production. This change does not provide authorization to execute live SQL. Before 0008 is installed, existing browsing, creation and editing remain compatible; deletion and new anime-movie classification return an explicit 503 instead of deleting anything. The bin explains that the migration is missing.

## Recovery semantics

- Normal content Delete means **move to bin**. Original IDs, metadata, descendants, quality links, comments/replies/likes/reports, follows, publication and notification records remain intact.
- A deleted parent hides its complete subtree from library, details, search, comments, following, notifications and download authorization. Children need no additional markers.
- Restore the title, then an independently deleted season, then independently deleted episodes. Child restore under a deleted parent returns 409 without mutation. Restoring a parent does not revive independently deleted children.
- Existing episode/season numbers remain reserved while in the bin. Restore those entries or deliberately permanently delete them before reusing their numbers.
- The Episodes tool supports each-row Delete, checkboxes, range selection (e.g. 13–22), selected deletion (up to 500 at a time), and confirmed Delete All for the selected season. Moving all is atomic, including seasons larger than 500.
- Permanent deletion is a separate authenticated action, only for an already deleted record, with typed confirmation identifying its kind and ID. Purging a parent deliberately removes its database subtree and dependent relationships. Empty Bin requires `EMPTY RECYCLE BIN` and permanently removes all marked subtrees. These actions cannot be undone.

## R2 safety

No bin action—including permanent record deletion or Empty Bin—calls physical object deletion or removes independent `r2_uploads` history. Objects remain private; active downloads still require short-lived signed URLs. Already-issued signed URLs retain their existing expiry. Moving content to the bin prevents issuance of new download URLs. Physical object cleanup is intentionally outside this feature and requires a separate explicitly confirmed storage process.

## Classification

Existing movie rows are **not** guessed or automatically reclassified. Create/edit a standalone movie and select **Anime movie** to list it under **Anime & Movies → Movie** instead of regular Movies. Anime series still use the Anime tab with normal seasons and episodes. The five manual follow statuses, anonymous follow identity, in-site-only episode bell, community features and public PWA remain unchanged. Standalone movies do not generate episode notifications.

## Verification

`tests/content-state.test.ts` checks migration snapshots and pre-migration fail-closed behavior without opening a database. `tests/recycle-bin-e2e.mjs`, run by the existing disposable CI runner, refuses remote database/app/storage endpoints and exercises real PostgreSQL relationships and a real multipart object on the local provider mock. Existing batching/failure/retry and UI/PWA suites remain in the same CI workflow. No tests are to be pointed at Preview or Production.
