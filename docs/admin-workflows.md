# Admin media workflows

Only media-management screens change. Wallpaper/Appearance and the existing shared
ImageUploader are unchanged; a hash-based regression test guards both source files.
The title and episode workflows need no database, storage, public-site or
API-contract changes. Link Behavior (below) adds two small database migrations.

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

## Link Behavior and the Copy Link website

Every place that saves a download link has **Link Behavior**: movie downloads,
episode links (quick table, individual editor, **File batches** pasted links),
complete-season archives and the Add media setup. **Open Link (Default)** is a
normal new-tab link. **Copy Link** copies the original URL instead, then opens
a website, e.g. a TeraBox downloader, so the visitor can paste it there.

- **Default website:** Appearance → **Copy Link website** → **Save website**.
  It is stored in the database and used by every Copy Link button without its own
  website. It changes only with **Update website** and goes away only with
  **Remove**; a blank field is rejected, never treated as a delete.
- **Per-link website:** with Copy Link selected, **Website to Open After Copying**
  overrides the default for that link. Leave it blank to follow the default.
- **No website saved:** Copy Link only copies, as before.
- **Bulk saves** only add links: they never rewrite an existing link's behavior or
  website. The behavior picked in a bulk form applies to the links saved by that
  action. Uploaded R2 files and local files always download directly.
- **Visitors:** the link is copied first; only then does a new tab open. That tab
  shows a short confirmation — a green check, **Link Copied Successfully!**, and
  *Paste the copied link on the next website to download* — and redirects itself to
  the website after five seconds. A **Continue to download website** button is always
  there for browsers that refuse the automatic redirect. The confirmation page never
  puts the download link or the website in its address bar. It is an introduction, not
  a permanent step: a browser sees it for its first two successful copies and afterwards
  every Copy Link button goes straight to the website. The count is kept in the browser's
  local storage, so it is shared by every tab and survives refreshes and restarts; a
  blocked tab or a failed copy never counts towards it. The original page also
  shows a brief toast ("Link copied…"), announced politely to screen readers,
  dismissible, gone after a few seconds. If the browser blocks the new tab that
  toast carries an **Open …** link instead. If copying is refused no tab opens, no
  confirmation or toast is shown, and the link appears under the button to copy by
  hand. Telegram and magnet links can be copied like any other link.
- **Selected downloads** (episode checkboxes) are unchanged and ignore this setting.

Needs migrations `0009_link_behavior` and `0010_link_copy_website` (both additive:
one new column each). Apply them with `npm run db:migrate` before deploying code
that reads the columns.

## Verification

`npm run test:admin-ui` uses the built Admin UI with in-memory API fixtures and
blocks external requests. It is not database or real-provider evidence. CI also
runs the existing disposable PostgreSQL/browser/API suites with local mock R2
and Resend, including movie poster/video uploads, editing, episode batches,
quality protection and retries. Never point tests at Preview or Production data.
