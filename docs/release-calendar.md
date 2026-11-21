# Release Calendar

## Public calendar

- The /calendar page uses the requested two-panel layout: month grid with colored event markers and poster-backed release cards.
- Use arrows to browse months, tap a day to filter events, or choose All month.
- Dates and times are explicitly displayed in Pakistan Standard Time (Asia/Karachi).
- Each entry shows its source: AniList, MAL weekly estimate, manual Admin update or actual Vault publication.

## Automatic schedules

1. The server reads announced anime episodes from AniList's public GraphQL airing schedule. It collects the episode number, airing time, title, poster, AniList page, and total number of episodes if available.
2. The estimated aired episode count uses AniList's next-airing episode number, or the known completed-series total. This is not a count of files uploaded to Vault.
3. AniList data is cached for thirty minutes with bounded pagination.
4. If AniList is unavailable, Jikan's public MyAnimeList weekly broadcast schedule is used when available. Jikan does not confirm episode numbers; its cards are labelled MAL weekly estimate and only projected through the next two weeks.
5. If both feeds are unavailable, manual Admin entries and real Vault episode publications still appear. A transparent source-status note explains the outage.

No third-party account, API key, paid subscription, protected-page scraping, or media upload is required. A listed broadcast does not imply the episode can already be downloaded on Vault.

## Admin

Use Admin → Release Calendar to create, edit, and delete releases. Edit the title, kind (episode, new series, movie, special), date/time, episode number, poster, destination link, optional AniList ID and notes.

To manually correct an AniList release, enter the same AniList media ID and episode number. The manual entry overrides the automatic entry, including when moving its date to a different month. Removing the manual entry restores the source date if AniList provides it.

Admin time inputs use the admin device's local time; the public calendar displays PKT.

## Storage and security

Manual entries are a bounded JSON list saved in the existing PostgreSQL site_settings table under release_calendar_manual_v1. Only authenticated Admin requests can mutate it. Same-origin validation, input validation and transaction row locks are used. This adds no database migrations and does not modify existing movie, anime, episode or download records.

## Verification

- Unit tests cover timezone conversion, manual override handling and stored entry parsing.
- Disposable browser/API E2E covers authenticated calendar creation, edits, deletion, cross-origin protection and responsive month navigation. The E2E runner explicitly disables external provider calls.
- A successful Preview build cannot guarantee the external APIs are accessible at runtime; AniList and Jikan control their own availability.
