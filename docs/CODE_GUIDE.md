# Vault code guide (simple English + Roman Urdu)

This guide explains **where the code is**, **what it does**, and **why it exists**. It is safe to read; no commands here modify Production automatically.

## Start here

| Folder / file | What it does |
| --- | --- |
| `src/app/page.tsx` | Home page: list of movies, anime and series |
| `src/app/[type]/[slug]/page.tsx` | One movie/anime/series detail page |
| `src/components/` | Reusable visual parts: Navbar, cards, Follow, Calendar and download buttons |
| `src/components/admin/` | Admin screens and editing forms |
| `src/app/api/` | Server endpoints that read/write information |
| `src/lib/` | Shared functions: searching, validation, link checks and backup rules |
| `src/db/schema.ts` | PostgreSQL table definitions |
| `drizzle/` | Versioned database migrations; **never run blindly on Production** |
| `tests/` | Automated checks to prevent bugs |
| `public/` | Static files, PWA icons and service worker |

**Roman Urdu:** `components` screen par dikhne wala UI hai. `api` browser ki request handle karta hai. `lib` reusable logic hai. `schema` database ka structure hai. `tests` check karte hain ke changes se purana kaam na tootay.

## Follow button example: how the flow works

1. User presses **Follow** in `src/components/FollowButton.tsx`.
2. `src/components/UpdatesProvider.tsx` sends the request.
3. `src/app/api/follows/route.ts` validates the media ID and updates `anime_follows`.
4. The provider refreshes the list, so Following and the bell show new data.

Why is the API separate from the button? The browser must not be allowed to change database rows directly.

## New reliability tools (PR #26)

- `src/lib/library-backup.ts` validates the portable JSON format and safely merges saved browser lists.
- `src/components/LibraryBackup.tsx` exports/imports your choices from **Following**.
- `src/app/api/library-backup/route.ts` restores Vault title follows to the current anonymous browser without copying cookies or passwords.
- `src/lib/link-health.ts` contains small link-check rules that can be unit tested.
- `src/lib/link-health-server.ts` safely checks external HTTPS servers with no redirects, pinned public DNS and short timeouts.
- `src/app/api/admin/link-health/route.ts` gives Admin the results. It does not update or delete links.
- `src/lib/episode-suggestions.ts` prepares editable episode numbers and TVmaze episode names.
- `src/app/api/admin/episode-suggestions/route.ts` reads provider data; `BulkAddEpisodes.tsx` creates drafts, **not automatic uploads or publications**.

## How to read a function

Example:

```ts
function isValidEpisode(number: number): boolean {
  // An episode ID must be a positive whole number.
  return Number.isSafeInteger(number) && number > 0;
}
```

- `function`: defines a reusable action.
- `number: number`: the input is a number.
- `: boolean`: the result is true or false.
- `return`: sends the answer back.
- `//`: a comment explaining **why** a rule exists.

**Roman Urdu:** Pehle function ka naam dekho, phir brackets mein inputs, phir `return` par result. Comments important decisions samjhane ke liye hain, har obvious line repeat karne ke liye nahi.

## Code style rules

1. Use descriptive names (`episodeNumber`, `followedTitles`) instead of unclear shortcuts (`x`, `tmp`).
2. Keep one meaningful task per function. Extract repeated logic only when it simplifies understanding.
3. Prefer an early return to several nested `if/else` blocks.
4. Write comments for **why**, security limits and tricky edge cases; do not write a comment for every line.
5. Shorten truly redundant lines, but **never compress code so much that it becomes difficult to read**.
6. Never print or commit admin passwords, R2 keys, subscriber cookies, or DB URLs.
7. Before merging, run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and disposable API/browser tests.

## Safe workflow

Create a feature branch → edit one area → run tests → open a Pull Request → review Vercel Preview → merge only after confirmation.

Avoid manual writes in Production to test UI changes. Use Preview/CI databases first.
