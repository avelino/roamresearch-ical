import { describe, it, expect } from "vitest";
import {
  eventsOverlap,
  detectConflicts,
  isEventInConflict,
  mergeTransitiveConflicts,
  formatConflictDescription,
  DEFAULT_CONFLICT_CONFIG,
  type ConflictDetectionConfig,
} from "../src/conflicts";
import type { ICalEvent } from "../src/ical";

// Helper to create mock events
function createMockEvent(overrides: Partial<ICalEvent> = {}): ICalEvent {
  return {
    uid: "test-event-123",
    summary: "Test Meeting",
    description: "",
    dtstart: new Date("2025-01-15T10:00:00Z"),
    dtend: new Date("2025-01-15T11:00:00Z"),
    location: "",
    url: "",
    meetingUrl: undefined,
    attendees: [],
    isAllDay: false,
    isRecurring: false,
    dtstartTzid: undefined,
    dtendTzid: undefined,
    ...overrides,
  };
}

describe("conflicts", () => {
  describe("eventsOverlap", () => {
    const minOverlap15Min = 15 * 60 * 1000;

    it("should detect overlapping events", () => {
      const eventA = createMockEvent({
        uid: "event-a",
        dtstart: new Date("2025-01-15T10:00:00Z"),
        dtend: new Date("2025-01-15T11:00:00Z"),
      });
      const eventB = createMockEvent({
        uid: "event-b",
        dtstart: new Date("2025-01-15T10:30:00Z"),
        dtend: new Date("2025-01-15T11:30:00Z"),
      });

      expect(eventsOverlap(eventA, eventB, minOverlap15Min)).toBe(true);
    });

    it("should not detect non-overlapping events", () => {
      const eventA = createMockEvent({
        uid: "event-a",
        dtstart: new Date("2025-01-15T10:00:00Z"),
        dtend: new Date("2025-01-15T11:00:00Z"),
      });
      const eventB = createMockEvent({
        uid: "event-b",
        dtstart: new Date("2025-01-15T11:00:00Z"),
        dtend: new Date("2025-01-15T12:00:00Z"),
      });

      expect(eventsOverlap(eventA, eventB, minOverlap15Min)).toBe(false);
    });

    it("should respect minimum overlap time", () => {
      const eventA = createMockEvent({
        uid: "event-a",
        dtstart: new Date("2025-01-15T10:00:00Z"),
        dtend: new Date("2025-01-15T11:00:00Z"),
      });
      const eventB = createMockEvent({
        uid: "event-b",
        dtstart: new Date("2025-01-15T10:50:00Z"), // 10 min overlap
        dtend: new Date("2025-01-15T11:30:00Z"),
      });

      expect(eventsOverlap(eventA, eventB, minOverlap15Min)).toBe(false);
      expect(eventsOverlap(eventA, eventB, 10 * 60 * 1000)).toBe(true);
    });

    it("should handle events without dates", () => {
      const eventA = createMockEvent({ dtstart: null, dtend: null });
      const eventB = createMockEvent();

      expect(eventsOverlap(eventA, eventB, minOverlap15Min)).toBe(false);
    });

    it("should detect fully contained events", () => {
      const eventA = createMockEvent({
        uid: "event-a",
        dtstart: new Date("2025-01-15T09:00:00Z"),
        dtend: new Date("2025-01-15T12:00:00Z"),
      });
      const eventB = createMockEvent({
        uid: "event-b",
        dtstart: new Date("2025-01-15T10:00:00Z"),
        dtend: new Date("2025-01-15T11:00:00Z"),
      });

      expect(eventsOverlap(eventA, eventB, minOverlap15Min)).toBe(true);
    });
  });

  describe("detectConflicts", () => {
    const config: ConflictDetectionConfig = {
      enabled: true,
      excludeAllDay: true,
      minimumOverlapMinutes: 15,
    };

    it("should return empty result when disabled", () => {
      const events = [createMockEvent()];
      const result = detectConflicts(events, { ...config, enabled: false });

      expect(result.conflicts.length).toBe(0);
      expect(result.totalConflicts).toBe(0);
    });

    it("should return empty result for single event", () => {
      const events = [createMockEvent()];
      const result = detectConflicts(events, config);

      expect(result.conflicts.length).toBe(0);
    });

    it("should detect conflicting events", () => {
      const events = [
        createMockEvent({
          uid: "event-1",
          summary: "Meeting A",
          dtstart: new Date("2025-01-15T10:00:00Z"),
          dtend: new Date("2025-01-15T11:00:00Z"),
        }),
        createMockEvent({
          uid: "event-2",
          summary: "Meeting B",
          dtstart: new Date("2025-01-15T10:30:00Z"),
          dtend: new Date("2025-01-15T11:30:00Z"),
        }),
      ];

      const result = detectConflicts(events, config);

      expect(result.conflicts.length).toBe(1);
      expect(result.totalConflicts).toBe(1);
      expect(result.conflictingEventUids.has("event-1")).toBe(true);
      expect(result.conflictingEventUids.has("event-2")).toBe(true);
    });

    it("should exclude all-day events when configured", () => {
      const events = [
        createMockEvent({
          uid: "all-day",
          isAllDay: true,
          dtstart: new Date("2025-01-15T00:00:00Z"),
          dtend: new Date("2025-01-16T00:00:00Z"),
        }),
        createMockEvent({
          uid: "timed",
          dtstart: new Date("2025-01-15T10:00:00Z"),
          dtend: new Date("2025-01-15T11:00:00Z"),
        }),
      ];

      const result = detectConflicts(events, config);

      expect(result.conflicts.length).toBe(0);
    });

    it("should include all-day events when not excluded", () => {
      const events = [
        createMockEvent({
          uid: "all-day",
          summary: "Holiday",
          isAllDay: true,
          dtstart: new Date("2025-01-15T00:00:00Z"),
          dtend: new Date("2025-01-16T00:00:00Z"),
        }),
        createMockEvent({
          uid: "timed",
          summary: "Meeting",
          dtstart: new Date("2025-01-15T10:00:00Z"),
          dtend: new Date("2025-01-15T11:00:00Z"),
        }),
      ];

      const result = detectConflicts(events, { ...config, excludeAllDay: false });

      expect(result.conflicts.length).toBe(1);
    });

    it("should detect multiple conflicts", () => {
      const events = [
        createMockEvent({
          uid: "event-1",
          dtstart: new Date("2025-01-15T10:00:00Z"),
          dtend: new Date("2025-01-15T11:00:00Z"),
        }),
        createMockEvent({
          uid: "event-2",
          dtstart: new Date("2025-01-15T10:30:00Z"),
          dtend: new Date("2025-01-15T11:30:00Z"),
        }),
        createMockEvent({
          uid: "event-3",
          dtstart: new Date("2025-01-15T14:00:00Z"),
          dtend: new Date("2025-01-15T15:00:00Z"),
        }),
        createMockEvent({
          uid: "event-4",
          dtstart: new Date("2025-01-15T14:30:00Z"),
          dtend: new Date("2025-01-15T15:30:00Z"),
        }),
      ];

      const result = detectConflicts(events, config);

      expect(result.conflicts.length).toBe(2);
      expect(result.totalConflicts).toBe(2);
    });

    it("should not report same pair twice", () => {
      const events = [
        createMockEvent({
          uid: "event-1",
          dtstart: new Date("2025-01-15T10:00:00Z"),
          dtend: new Date("2025-01-15T11:00:00Z"),
        }),
        createMockEvent({
          uid: "event-1", // Same UID - duplicate
          dtstart: new Date("2025-01-15T10:00:00Z"),
          dtend: new Date("2025-01-15T11:00:00Z"),
        }),
      ];

      const result = detectConflicts(events, config);

      // Same UID should be treated as same event
      expect(result.conflicts.length).toBeLessThanOrEqual(1);
    });
  });

  describe("isEventInConflict", () => {
    it("should return true for conflicting event", () => {
      const event = createMockEvent({ uid: "event-1" });
      const conflictingUids = new Set(["event-1", "event-2"]);

      expect(isEventInConflict(event, conflictingUids)).toBe(true);
    });

    it("should return false for non-conflicting event", () => {
      const event = createMockEvent({ uid: "event-3" });
      const conflictingUids = new Set(["event-1", "event-2"]);

      expect(isEventInConflict(event, conflictingUids)).toBe(false);
    });
  });

  describe("mergeTransitiveConflicts", () => {
    it("should return empty array for no conflicts", () => {
      const result = mergeTransitiveConflicts([]);
      expect(result).toEqual([]);
    });

    it("should merge transitive conflicts", () => {
      const eventA = createMockEvent({ uid: "a", summary: "Event A" });
      const eventB = createMockEvent({ uid: "b", summary: "Event B" });
      const eventC = createMockEvent({ uid: "c", summary: "Event C" });

      // A conflicts with B, B conflicts with C
      const conflicts = [
        {
          events: [eventA, eventB],
          timeSlot: { start: new Date(), end: new Date() },
        },
        {
          events: [eventB, eventC],
          timeSlot: { start: new Date(), end: new Date() },
        },
      ];

      const merged = mergeTransitiveConflicts(conflicts);

      // A, B, C should all be in one group
      expect(merged.length).toBe(1);
      expect(merged[0].events.length).toBe(3);
    });

    it("should keep separate groups for non-transitive conflicts", () => {
      const eventA = createMockEvent({ uid: "a" });
      const eventB = createMockEvent({ uid: "b" });
      const eventC = createMockEvent({ uid: "c" });
      const eventD = createMockEvent({ uid: "d" });

      // A conflicts with B, C conflicts with D (separate groups)
      const conflicts = [
        {
          events: [eventA, eventB],
          timeSlot: { start: new Date(), end: new Date() },
        },
        {
          events: [eventC, eventD],
          timeSlot: { start: new Date(), end: new Date() },
        },
      ];

      const merged = mergeTransitiveConflicts(conflicts);

      expect(merged.length).toBe(2);
    });
  });

  describe("formatConflictDescription", () => {
    it("should format conflict with event names and time", () => {
      const conflict = {
        events: [
          createMockEvent({ summary: "Meeting A" }),
          createMockEvent({ summary: "Meeting B" }),
        ],
        timeSlot: {
          start: new Date("2025-01-15T10:30:00"),
          end: new Date("2025-01-15T11:00:00"),
        },
      };

      const description = formatConflictDescription(conflict);

      expect(description).toContain("Meeting A");
      expect(description).toContain("Meeting B");
      expect(description).toContain("&");
    });

    it("should handle untitled events", () => {
      const conflict = {
        events: [
          createMockEvent({ summary: "" }),
          createMockEvent({ summary: "Meeting" }),
        ],
        timeSlot: {
          start: new Date("2025-01-15T10:30:00"),
          end: new Date("2025-01-15T11:00:00"),
        },
      };

      const description = formatConflictDescription(conflict);

      expect(description).toContain("Untitled");
    });
  });

  describe("DEFAULT_CONFLICT_CONFIG", () => {
    it("should have expected default values", () => {
      expect(DEFAULT_CONFLICT_CONFIG.enabled).toBe(false);
      expect(DEFAULT_CONFLICT_CONFIG.excludeAllDay).toBe(true);
      expect(DEFAULT_CONFLICT_CONFIG.minimumOverlapMinutes).toBe(15);
    });
  });
});
