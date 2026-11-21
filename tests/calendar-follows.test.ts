import test from "node:test";
import assert from "node:assert/strict";
import {
  calendarEventIsFollowed, calendarFollowIdentity, calendarFollowKey, followFromEvent,
  parseCalendarFollows, withCalendarFollow, type CalendarFollow,
} from "../src/lib/calendar-follows";
import type { CalendarEvent } from "../src/lib/calendar-model";

function release(values: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "anilist:901", title: "Example Anime", kind: "episode",
    airingAt: "2026-11-24T12:00:00Z", episode: 8, totalEpisodes: 12,
    posterUrl: "https://example.com/image.jpg", url: "https://anilist.co/anime/321",
    source: "anilist", notes: null, anilistId: 321, ...values,
  };
}
const saved: CalendarFollow = { source: "anilist", externalId: 321, title: "Example Anime", posterUrl: null, addedAt: 1 };
test("calendar follow matches the stable anime ID across episodes and months", () => {
  assert.equal(calendarFollowIdentity(release()), "anilist:321");
  assert.equal(calendarFollowIdentity(release({ id: "anilist:another", episode: 9 })), "anilist:321");
  assert.equal(calendarFollowKey(saved), "anilist:321");
  assert.equal(calendarEventIsFollowed(release({ episode: 9 }), [saved], []), true);
  assert.equal(calendarEventIsFollowed(release({ anilistId: 322 }), [saved], []), false);
  assert.equal(calendarFollowIdentity(release({ id: "jikan:1234:2026-11-24", source: "jikan", anilistId: null })), "jikan:1234");
  assert.equal(calendarFollowIdentity(release({ id: "jikan:wrong", source: "jikan", anilistId: null })), null);
});
test("follows are deduplicated, saved and removed without a server session", () => {
  const first = withCalendarFollow([], saved, true);
  assert.equal(first.length, 1);
  assert.deepEqual(withCalendarFollow(first, saved, true), first);
  assert.deepEqual(withCalendarFollow(first, saved, false), []);
  assert.equal(calendarEventIsFollowed(release({ source: "jikan", id: "jikan:321:2026-11-25", anilistId: null }), first, []), false);
  const parsed = parseCalendarFollows(JSON.stringify(first));
  assert.equal(parsed[0].externalId, 321);
  assert.deepEqual(parseCalendarFollows("bad"), []);
  assert.deepEqual(parseCalendarFollows(JSON.stringify([{ ...saved, source: "unknown" }, { ...saved, externalId: 0 }])), []);
  assert.equal(followFromEvent(release())?.externalId, 321);
  assert.equal(followFromEvent(release({ source: "manual", anilistId: null })), null);
});
test("Vault follows match by exact media ID, source ID or canonical title path", () => {
  const follows = [{ id: 7, type: "anime", slug: "example-anime", externalSource: "anilist", externalId: "321" }];
  assert.equal(calendarEventIsFollowed(release(), [], follows), true);
  assert.equal(calendarEventIsFollowed(release({ anilistId: 999, vaultMediaId: 7 }), [], follows), true);
  assert.equal(calendarEventIsFollowed(release({ anilistId: null, source: "vault", id: "vault:4", url: "/anime/example-anime#episode-4" }), [], follows), true);
  assert.equal(calendarEventIsFollowed(release({ anilistId: null, source: "vault", id: "vault:4", url: "/anime/example-anime-extra" }), [], follows), false);
  assert.equal(calendarEventIsFollowed(release({ anilistId: null, source: "manual", url: "/anime/example-anime/other" }), [], follows), false);
});
test("unsafe saved records and poster URLs are not reused", () => {
  const list = parseCalendarFollows(JSON.stringify([
    { ...saved, posterUrl: "javascript:alert(1)" },
    { ...saved, title: "duplicate" },
    { source: "jikan", externalId: 777, title: "Other", posterUrl: "https://mal.example/p.jpg", addedAt: 10 },
  ]));
  assert.equal(list.length, 2);
  assert.equal(list[0].posterUrl, null);
  assert.equal(list[1].source, "jikan");
});
