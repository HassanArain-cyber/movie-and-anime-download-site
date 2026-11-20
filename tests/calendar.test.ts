import test from "node:test";
import assert from "node:assert/strict";
import { calendarDay, combineCalendarEvents, parseCalendarMonth, readManualCalendarEntries, type CalendarEvent, type ManualCalendarEntry } from "../src/lib/calendar-model";

test("calendar converts UTC release times to Pakistan days", () => {
  assert.equal(calendarDay("2026-11-20T20:00:00.000Z"), "2026-11-21");
  assert.equal(calendarDay("2026-11-21T00:00:00.000Z"), "2026-11-21");
  assert.deepEqual(parseCalendarMonth("2027", "2"), { year: 2027, month: 2 });
  assert.throws(() => parseCalendarMonth("2027", "13"));
  assert.throws(() => parseCalendarMonth("hello", "2"));
});

test("admin event replaces corresponding AniList airing but not unrelated releases", () => {
  const automated: CalendarEvent[] = [
    { id: "anilist:1", title: "First", kind: "episode", airingAt: "2027-02-14T14:00:00.000Z",
      episode: 4, totalEpisodes: 12, posterUrl: null, url: null, notes: null, source: "anilist", anilistId: 123 },
    { id: "anilist:2", title: "Second", kind: "episode", airingAt: "2027-02-17T14:00:00.000Z",
      episode: 5, totalEpisodes: 12, posterUrl: null, url: null, notes: null, source: "anilist", anilistId: 456 },
  ];
  const manual: ManualCalendarEntry[] = [{
    id: "12345678-1234-4234-8234-123456789abc", title: "Updated first", kind: "episode",
    airingAt: "2027-02-15T14:00:00.000Z", episode: 4, posterUrl: null, url: null, notes: null, anilistId: 123,
  }];
  const combined = combineCalendarEvents(automated, manual, 2027, 2);
  assert.deepEqual(combined.map((entry) => entry.title), ["Updated first", "Second"]);
  assert.deepEqual(combined.map((entry) => entry.source), ["manual", "anilist"]);
  assert.equal(combineCalendarEvents(automated, manual, 2027, 3).length, 0);
});

test("corrupted stored calendar JSON degrades safely to empty list", () => {
  assert.deepEqual(readManualCalendarEntries(null), []);
  assert.deepEqual(readManualCalendarEntries("{"), []);
  assert.deepEqual(readManualCalendarEntries('[{"id":"bad"}]'), []);
});
