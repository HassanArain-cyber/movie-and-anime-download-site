# Vault experience upgrades

This branch introduces an initial set of UI upgrades without changing the database or existing Follow/Watching/Completed workflows.

- Download options show actual available quality groups, file size (when stored), source labels and open/copy behavior. No file sizes or servers are invented.
- App-router loading skeleton shows poster placeholders while a route loads.

## Still to implement and verify

- Continue Watching requires a reliable episode progress signal. Follow/Watching/Completed status alone is not playback progress.
- Advanced search already has type, category, year and sort filters. Genre/language filtering requires suitable stored metadata.
- Release Calendar requires trustworthy episode release dates and timezone handling; existing episode rows do not expose a scheduled release field.
- Smart recommendations currently have related-title cards. Personalization requires explicit user preference/history data and privacy considerations.
- Watchlist is already covered by Following and watch statuses; do not duplicate it.

## Verification

CI and preview/browser checks must pass before merge. No production deployment is implied by opening this PR.
