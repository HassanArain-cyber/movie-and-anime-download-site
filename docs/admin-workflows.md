# Admin media workflows

Only media-management screens change. Wallpaper/Appearance and the existing shared
ImageUploader are unchanged; a hash-based regression test guards both source files.
No database, storage, public-site or API-contract changes are required.

## Create a title

Media → All media / Movies / Anime / Series → Add media.

1. Basic details (type, title, year, category; description is expandable).
2. Poster (private R2 upload, existing URL, or skip).
3. Movies: optional download rows with separate qualities → **Save movie**.
   Anime/series: first season number/name → **Create & Continue** into Episodes.

Poster files are uploaded immediately, as before; the title is created only on
final Save. R2 video uploads, custom download labels/file sizes, and individual
link editing remain in the title editor. Optional link metadata is expandable.
Partial setup failures retain the saved title ID. Retry re-reads saved links and
seasons rather than blindly recreating them. An uncertain title-creation response
requires checking the library, not an unsafe automatic retry. Cancelling after a
partial save never deletes existing records or private R2 objects.

## Episodes — range first

Use **Episodes** in navigation, or open an anime/series in Media (preselected).
Select or create a season inline. Enter an inclusive range, e.g. 1–24, and choose
**Create Episodes**. This creates saved placeholders immediately; overlapping
ranges are rejected without replacing existing episodes. The existing 500-per-
range limit and server uniqueness protections are unchanged.

Paste per-episode URLs in the compact table, select quality, then **Save All**.
Blank rows are skipped. Saved links are protected. Switch quality to add another
version; existing qualities are never overwritten. Pending/saved/error status is
shown per row and in the save bar. Retry checks current server state and submits
only missing links. Refresh season re-reads changes made in other editors.

**File batches** retains multiple-file upload, matching, multipart resume and
retry checkpoints. **Individual editing & files** in a title retains season and
episode editing/deletion, archives, batch uploads, and per-episode moderation.
Title comment settings are under **Advanced title settings**. Categories, requests
and moderation remain available. No capability has been removed.

## Verification

`npm run test:admin-ui` uses the built Admin UI with in-memory API fixtures and
blocks external requests. It is not database or real-provider evidence. CI also
runs the existing disposable PostgreSQL/browser/API suites with local mock R2
and Resend, including movie poster/video uploads, editing, episode batches,
quality protection and retries. Never point tests at Preview or Production data.
