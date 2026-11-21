# Vault experience upgrades — Preview / PR #25

This branch is **not merged**. Production data and the production database remain unchanged.

## Implemented

- **Admin auto import:** Search and select a matching anime (AniList), TV series (TVmaze) or movie (TMDB), then review/edit title, synopsis, poster, year, genres, and total episode count (when the provider supplies it). This works when creating and when editing existing titles. Manual entry and R2 uploads are still supported.
- **Simpler admin workflow:** A Find & Auto-fill card leads the two-step wizard; imports never auto-create title, season, episode or download links. After review, the normal Save creates the title.
- **Smart Following:** Anime with saved AniList ID shows the next airing episode and local Pakistan-time countdown. Unlinked or unsupported titles show no invented countdown. Calendar has a **Only Following** filter (exact AniList IDs and Vault title URLs); release rows are incrementally displayed using Show More.
- **Optional notifications:** Bell includes a user-initiated permission toggle. The site can notify about newly received Vault episode inbox alerts while it is open, including PWA foreground service-worker notifications. Alerts are never requested automatically. A future **server-side Web Push subscription, VAPID credentials and recurring delivery worker** would be required to deliver when the app is closed; this is not claimed complete.
- **Continue Watching:** Recently opened episodes are shown on this browser. A *Mark Watched* toggle records manually completed episodes and can show episode-count completion progress. Actual streaming watch position, playback duration and minutes watched cannot be measured from external file download links.
- **Downloads:** Full-width responsive grouped quality/source cards, real saved file sizes and source type, top-listed quality badge, correct direct/copy actions. External host uptime is not verified automatically.
- **Performance:** Poster lazy loading and memoization, bounded feed requests with server caching, calendar Show More to limit initially rendered release cards, unchanged private data/cache protections.

## External metadata provider requirements

- AniList anime search: no personal token, but dependent on rate limits and API availability.
- TVmaze series search: no personal token. The free search API may not report total episode count; leave this blank instead of guessing.
- TMDB movie search: set **TMDB_READ_TOKEN** (v3 read access Bearer token) or **TMDB_API_KEY** (v3 key) in **Vercel Preview** environment. The admin UI explains when no movie-search key is configured. No key is checked into the repository.
- External service content is displayed as metadata for administrator review; it does not provide licensed video downloads.

## Database and deploy

- Migration `drizzle/0011_media_metadata.sql` adds nullable `media.genres`, `episode_count`, `external_source`, `external_id` and an index. Historical media rows, links, seasons and episodes retain their IDs and content.
- **Preview Neon branch only** (`preview`, `br-lively-scene-b5dhtkvc`) had 0011 safely applied and registered in the migration history on November 21, 2026. **Production** was not migrated; release would require an approved, separately validated production migration and subsequent merge/deploy.
- Use branch Preview builds and the disposable CI database for validation. No changes to main or Production until explicit authorization.

## Validation

CI includes TypeScript, ESLint, unit tests, PostgreSQL migration idempotency, API/browser E2E, Admin UI and Following mobile fixtures. New tests cover imported metadata validation, title auto-fill and exact followed-anime countdown matching. Do not merge without all CI checks passing and the owner's approval.
