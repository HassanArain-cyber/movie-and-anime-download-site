# Recycle Bin and standalone anime movies

## Deployment boundary

`drizzle/0008_recycle_bin.sql` adds only the independent `content_state` marker table and its index. It does not change existing media, relationships, Wallpaper settings, R2 uploads, or migration 0007. Creation of this migration does **not** apply it to any live database. Builds and deployments never run migrations.

An authorized operator must install **only the new 0008 migration**, once, on the independently confirmed Preview database, recording it consistently with the existing migration process. Do not paste/re-run installed 0007, use `db:push`, or target Production. This change does not provide authorization to execute live SQL. Before 0008 is installed, existing browsing, creation and editing remain compatible; deletion and new anime-movie classification return an explicit 503 instead of deleting anything. The bin explains that the migration is missing.

### Readiness probe and `search_path`

The readiness guard (`lifecycleReady`) previously probed the hardcoded name `public.content_state` while every runtime query in this feature is unqualified (`FROM content_state`) and therefore resolves through the session `search_path`. The two could disagree in both directions:

- the table existed on the schema the application actually resolves, but not on `public`, so the guard reported "not installed" and the bin stayed blocked although its queries worked;
- the session could not resolve the table at all, so the guard reported "installed" and a bin request failed with a raw SQLSTATE 42P01 / generic HTTP 500 instead of the safe, explanatory 503.

The probe now uses the same unqualified lookup as the queries and additionally requires the four columns the feature depends on (`kind`, `content_id`, `deleted_at`, `is_anime_movie`, ignoring dropped attributes), so a partial or divergent table is still classified as "not installed". `src/lib/notifications/readiness.ts` applies the same rule to the 0007 relations it pre-checks. This remains capability detection only: it never creates, alters or repairs schema, it does not prove a matching migration ledger or ACLs, and the missing-schema guard is unchanged. `tests/recycle-bin-readiness.test.ts` exercises both guards against a real in-process PostgreSQL engine, including a non-`public` installation and a session that cannot resolve the table.

## Recovery semantics

- Normal content Delete means **move to bin**. Original IDs, metadata, descendants, quality links, comments/replies/likes/reports, follows, publication and notification records remain intact.
- A deleted parent hides its complete subtree from library, details, search, comments, following, notifications and download authorization. Children need no additional markers.
- Restore the title, then an independently deleted season, then independently deleted episodes. Child restore under a deleted parent returns 409 without mutation. Restoring a parent does not revive independently deleted children.
- Existing episode/season numbers remain reserved while in the bin. Restore those entries or deliberately permanently delete them before reusing their numbers.
- The Episodes tool supports each-row Delete, checkboxes, range selection (e.g. 13–22), selected deletion (up to 500 at a time), and confirmed Delete All for the selected season. Moving all is atomic, including seasons larger than 500.
- Permanent deletion is a separate authenticated action, only for an already deleted record, with a clear Cancel/OK confirmation in the Admin UI. The client supplies the existing kind/ID confirmation payload after OK; the backend validation is unchanged. Purging a parent deliberately removes its database subtree and dependent relationships. Empty Bin uses a separate Cancel/OK dialog and supplies the existing `EMPTY RECYCLE BIN` API confirmation after OK and permanently removes all marked subtrees. These actions cannot be undone.

## Compact Admin presentation

The bin has All, Titles (including seasons), and Episodes filters. Episodes are grouped by stable media/season IDs, never by parsing display titles. Both title and season folders start collapsed; episode action rows are mounted only while both folders are expanded. Counts include all paginated metadata, not just the first 100 items.

Season-level Restore All explicitly restores that season’s individually marked episodes through the existing restore endpoint. It is disabled if a parent is deleted. Requests run sequentially, show progress, stop on the first error, and refresh remaining items so a retry does not re-submit already restored episodes. This convenience operation is **not one atomic batch transaction**: completed restores remain completed if a later request fails. Parent rules are rechecked server-side for each episode. No other season or unselected child is restored.

Permanent delete and Empty Bin use concise Cancel/OK dialogs, without asking the user to type. Their existing server confirmation payloads and error handling remain unchanged. Failed bin refreshes keep the current display but disable mutations until a successful refresh. The density stylesheet is scoped to Admin and removed entirely on Appearance; Wallpaper keeps its original layout and uploader. No database or storage lifecycle redesign is involved.

## Admin navigation and search

Admin section tabs stay sticky below the existing public header. Their top offset follows the public header’s measured height at each responsive breakpoint; the tabs retain their normal layout footprint. Switching from a deeply scrolled section reveals the new section below the sticky tabs. Existing busy-operation navigation locks remain in place.

Media Library filtering starts as a search icon. Opening it immediately focuses the already-mounted input in the same interaction, including keyboard activation. Its shell expands/slides with a subtle fade and reverses on close, without moving Add Media or the table. Focus never waits for an animation timer. Closed controls are inert and hidden from accessibility navigation; reduced-motion disables transitions. The close button or Escape clears the filter, closes the input, and returns focus to the icon. Title/type filtering and the existing media-section filters are otherwise unchanged.

## R2 safety

No bin action—including permanent record deletion or Empty Bin—calls physical object deletion or removes independent `r2_uploads` history. Objects remain private; active downloads still require short-lived signed URLs. Already-issued signed URLs retain their existing expiry. Moving content to the bin prevents issuance of new download URLs. Physical object cleanup is intentionally outside this feature and requires a separate explicitly confirmed storage process.

## Classification

Existing movie rows are **not** guessed or automatically reclassified. Create/edit a standalone movie and select **Anime movie** to list it under **Anime & Movies → Movie** instead of regular Movies. Anime series still use the Anime tab with normal seasons and episodes. The five manual follow statuses, anonymous follow identity, in-site-only episode bell, community features and public PWA remain unchanged. Standalone movies do not generate episode notifications.

## Verification

`tests/content-state.test.ts` checks migration snapshots and pre-migration fail-closed behavior without opening a database. `tests/recycle-bin-e2e.mjs`, run by the existing disposable CI runner, refuses remote database/app/storage endpoints and exercises real PostgreSQL relationships and a real multipart object on the local provider mock. Existing batching/failure/retry and UI/PWA suites remain in the same CI workflow. No tests are to be pointed at Preview or Production.
