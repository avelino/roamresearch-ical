import { describe, it, expect } from "vitest";
import {
  matchesQuery,
  type EventSearchResult,
} from "../src/search";

// Helper to create mock search results
function createMockResult(overrides: Partial<EventSearchResult> = {}): EventSearchResult {
  return {
    pageTitle: "ical/work/meeting-123",
    pageUid: "abc123",
    blockUid: "def456",
    eventId: "meeting-123@google.com",
    title: "Team Meeting",
    date: "January 15th, 2025",
    calendar: "work",
    location: undefined,
    attendees: undefined,
    ...overrides,
  };
}

describe("search", () => {
  describe("matchesQuery", () => {
    describe("title search", () => {
      it("should match title case-insensitively", () => {
        const result = createMockResult({ title: "Team Meeting" });

        expect(matchesQuery(result, { title: "team" })).toBe(true);
        expect(matchesQuery(result, { title: "MEETING" })).toBe(true);
        expect(matchesQuery(result, { title: "Team Meeting" })).toBe(true);
      });

      it("should not match non-matching title", () => {
        const result = createMockResult({ title: "Team Meeting" });

        expect(matchesQuery(result, { title: "standup" })).toBe(false);
      });

      it("should match partial title", () => {
        const result = createMockResult({ title: "Weekly Team Standup" });

        expect(matchesQuery(result, { title: "standup" })).toBe(true);
        expect(matchesQuery(result, { title: "weekly" })).toBe(true);
      });
    });

    describe("calendar filter", () => {
      it("should match calendar case-insensitively", () => {
        const result = createMockResult({ calendar: "work-calendar" });

        expect(matchesQuery(result, { calendar: "work" })).toBe(true);
        expect(matchesQuery(result, { calendar: "WORK" })).toBe(true);
      });

      it("should not match different calendar", () => {
        const result = createMockResult({ calendar: "work" });

        expect(matchesQuery(result, { calendar: "personal" })).toBe(false);
      });
    });

    describe("location search", () => {
      it("should match location case-insensitively", () => {
        const result = createMockResult({ location: "Conference Room A" });

        expect(matchesQuery(result, { location: "conference" })).toBe(true);
        expect(matchesQuery(result, { location: "room a" })).toBe(true);
      });

      it("should pass through when location is undefined", () => {
        const result = createMockResult({ location: undefined });

        // When result has no location, location query is skipped (matches)
        expect(matchesQuery(result, { location: "anywhere" })).toBe(true);
      });
    });

    describe("attendee search", () => {
      it("should match attendee case-insensitively", () => {
        const result = createMockResult({
          attendees: ["Alice Smith", "Bob Jones"],
        });

        expect(matchesQuery(result, { attendee: "alice" })).toBe(true);
        expect(matchesQuery(result, { attendee: "JONES" })).toBe(true);
      });

      it("should not match non-existing attendee", () => {
        const result = createMockResult({
          attendees: ["Alice Smith"],
        });

        expect(matchesQuery(result, { attendee: "charlie" })).toBe(false);
      });

      it("should pass through when attendees is undefined", () => {
        const result = createMockResult({ attendees: undefined });

        // When result has no attendees, attendee query is skipped (matches)
        expect(matchesQuery(result, { attendee: "anyone" })).toBe(true);
      });
    });

    describe("date range filter", () => {
      it("should match events within date range", () => {
        const result = createMockResult({ date: "January 15th, 2025" });

        expect(
          matchesQuery(result, {
            dateStart: new Date("2025-01-01"),
            dateEnd: new Date("2025-01-31"),
          })
        ).toBe(true);
      });

      it("should not match events before dateStart", () => {
        const result = createMockResult({ date: "January 15th, 2025" });

        expect(
          matchesQuery(result, {
            dateStart: new Date("2025-02-01"),
          })
        ).toBe(false);
      });

      it("should not match events after dateEnd", () => {
        const result = createMockResult({ date: "January 15th, 2025" });

        expect(
          matchesQuery(result, {
            dateEnd: new Date("2025-01-10"),
          })
        ).toBe(false);
      });

      it("should handle events with invalid/empty dates", () => {
        const result = createMockResult({ date: "" });

        // Should not crash with empty date
        expect(
          matchesQuery(result, {
            dateStart: new Date("2025-01-01"),
          })
        ).toBe(true); // Can't filter by date if date is invalid
      });
    });

    describe("combined filters", () => {
      it("should require all filters to match", () => {
        const result = createMockResult({
          title: "Team Meeting",
          calendar: "work",
          location: "Room A",
        });

        // All match
        expect(
          matchesQuery(result, {
            title: "team",
            calendar: "work",
            location: "room",
          })
        ).toBe(true);

        // One doesn't match
        expect(
          matchesQuery(result, {
            title: "team",
            calendar: "personal",
          })
        ).toBe(false);
      });

      it("should match with empty query (all results)", () => {
        const result = createMockResult();

        expect(matchesQuery(result, {})).toBe(true);
      });
    });
  });

  // Note: searchEvents depends on Roam API functions which would need to be mocked
  // These tests cover the core matching logic
});
