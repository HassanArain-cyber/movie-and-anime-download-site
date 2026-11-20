# Vault experience upgrades

This pull request refines the existing public experience **without altering production data or database migrations**.

## Implemented in this branch

- **Download chooser:** responsive deep-violet download/copy buttons, quality shortcuts, distinct real source rows, stored file sizes (when known), safe unavailable-link state, and conditional Video/Audio tabs for explicitly identified audio-only links. The original per-link open/copy choice, R2 handling, 5-second copy confirmation and existing links remain intact.
- **Right-hand navigation:** compact 3-line menu on desktop and mobile; category links, Following and Calendar are moved out of the crowded header. Escape, outside click and route changes dismiss the menu.
- **Continue Watching shortcuts:** automatically remembers the last opened episode per series/anime in this browser, now showing the real media poster when available and a Remove control. This tracks opened episodes, **not actual watched minutes**; no fake percentage or playback data.
- **Skeleton loading:** app-router loading placeholders keep the library layout stable.
- **Advanced library browse:** existing title/episode search, type, category/tag, release-year and sort filters retained.
- **Release Calendar:** published-episode history displayed by actual publication date (UTC); it does not invent upcoming broadcast schedules.
- **Recommendations & Watchlist:** existing related titles by content type/category and Following/Watching/Completed workflows retained, without duplicating the watchlist.

## Requires additional data or product support

- Video/Audio tabs appear only when actual audio-only files can be identified from their filename or label. To recognize every source reliably (including anonymous cloud-storage URLs), the admin needs an explicit audio/video field.
- Genre/language filters need admin-managed, queryable genre/language fields; current categories can already act as tags.
- Actual playback progress bars require a player/progress event source. Download-only links do not report watch duration.
- Future episode countdown/calendar dates need admin-provided scheduled release timestamps, not publication dates.
- Personalized recommendations require an explicit history/preference signal; current related-title recommendations use available catalog metadata.

## Verification

- Existing end-to-end tests cover distinct download qualities, R2 links, bulk download handling and phone widths.
- This branch adds E2E checks for the navigation drawer and last-opened episode shortcuts.
- CI, Preview and browser validation are required before merge. **Do not merge without owner approval**.
