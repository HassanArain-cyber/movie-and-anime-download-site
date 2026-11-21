// Live provider reachability/contract smoke; no DB writes or credentials.
// Run in CI separately from deterministic tests because provider availability is external.
const now = Math.floor(Date.now() / 1000);
const query = `query VaultCalendar($start: Int, $end: Int, $page: Int) {
  Page(page: $page, perPage: 2) {
    pageInfo { hasNextPage }
    airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME) {
      id episode airingAt
      media { id isAdult episodes status nextAiringEpisode { episode airingAt } siteUrl title { english romaji } coverImage { large } }
    }
  }
}`;
async function checkAniList() {
  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables: { start: now - 86_400, end: now + 14 * 86_400, page: 1 } }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error("HTTP " + response.status + " / retry-after: " + (response.headers.get("retry-after") ?? "none"));
  const result = await response.json();
  if (result.errors?.length) throw new Error("GraphQL errors: " + result.errors.map((x) => x.message).slice(0, 2).join("; "));
  const p = result?.data?.Page;
  if (!Array.isArray(p?.airingSchedules) || !p.pageInfo) throw new Error("Invalid Page / airingSchedules schema");
  console.log("AniList LIVE VERIFIED: HTTP " + response.status + "; " + p.airingSchedules.length + " airing schedule records; pageInfo present");
  return true;
}
async function checkJikan() {
  const response = await fetch("https://api.jikan.moe/v4/schedules?page=1&limit=2", {
    headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
  const result = await response.json();
  if (!Array.isArray(result.data) || !result.pagination) throw new Error("Invalid MAL schedule schema");
  console.log("Jikan LIVE VERIFIED: HTTP " + response.status + "; " + result.data.length + " weekly entries; pagination present");
  return true;
}
let successes = 0;
for (const [name, test] of [["AniList", checkAniList], ["Jikan", checkJikan]]) {
  try { if (await test()) successes++; }
  catch (e) { console.warn(name + " LIVE UNAVAILABLE: " + (e instanceof Error ? e.message : String(e))); }
}
if (successes === 0) {
  console.error("LIVE CHECK INCONCLUSIVE: both remote providers unreachable; deterministic tests may still pass.");
  process.exitCode = 1;
}
