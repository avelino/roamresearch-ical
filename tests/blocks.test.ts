import { describe, it, expect } from "vitest";
import { resolveEventPageName, type BatchConfig } from "../src/blocks";
import type { ICalEvent } from "../src/ical";

// Helper to create a mock event
function createMockEvent(overrides: Partial<ICalEvent> = {}): ICalEvent {
  return {
    uid: "test-uid-123",
    summary: "Test Event",
    description: "",
    dtstart: new Date("2025-01-15T10:00:00Z"),
    dtend: new Date("2025-01-15T11:00:00Z"),
    location: "",
    url: "",
    attendees: [],
    ...overrides,
  };
}

describe("resolveEventPageName", () => {
  it("should create page name with prefix, calendar name, and sanitized event ID", () => {
    const event = createMockEvent({ uid: "event-123@calendar.google.com" });
    const result = resolveEventPageName(event, "Work", "ical");

    // Should be in format: prefix/calendarName/hashedId
    expect(result).toMatch(/^ical\/Work\/[a-z0-9]+$/);
  });

  it("should handle special characters in event UID", () => {
    const event = createMockEvent({ uid: "event/with\\special:chars@domain.com" });
    const result = resolveEventPageName(event, "Personal", "calendar");

    // Should still produce a valid page name
    expect(result).toMatch(/^calendar\/Personal\/[a-z0-9]+$/);
  });

  it("should handle empty calendar name", () => {
    const event = createMockEvent();
    const result = resolveEventPageName(event, "", "ical");

    expect(result).toMatch(/^ical\/\/[a-z0-9]+$/);
  });

  it("should handle custom page prefix", () => {
    const event = createMockEvent();
    const result = resolveEventPageName(event, "Work", "my-calendars");

    expect(result).toMatch(/^my-calendars\/Work\/[a-z0-9]+$/);
  });

  it("should produce consistent hashes for the same UID", () => {
    const event1 = createMockEvent({ uid: "consistent-uid" });
    const event2 = createMockEvent({ uid: "consistent-uid" });

    const result1 = resolveEventPageName(event1, "Work", "ical");
    const result2 = resolveEventPageName(event2, "Work", "ical");

    expect(result1).toBe(result2);
  });

  it("should produce different hashes for different UIDs", () => {
    const event1 = createMockEvent({ uid: "uid-1" });
    const event2 = createMockEvent({ uid: "uid-2" });

    const result1 = resolveEventPageName(event1, "Work", "ical");
    const result2 = resolveEventPageName(event2, "Work", "ical");

    expect(result1).not.toBe(result2);
  });
});

describe("BatchConfig", () => {
  it("should have correct default shape", () => {
    const config: BatchConfig = {
      batchSize: 50,
      batchDelayMs: 500,
      excludePatterns: [],
      titlePrefix: "#gcal",
      attendeeAliases: new Map(),
    };

    expect(config.batchSize).toBe(50);
    expect(config.batchDelayMs).toBe(500);
    expect(config.excludePatterns).toEqual([]);
    expect(config.titlePrefix).toBe("#gcal");
    expect(config.attendeeAliases.size).toBe(0);
  });

  it("should support custom exclude patterns", () => {
    const config: BatchConfig = {
      batchSize: 25,
      batchDelayMs: 200,
      excludePatterns: [/^Busy$/i, /^Private$/i],
      titlePrefix: "",
      attendeeAliases: new Map([["john@example.com", "@John"]]),
    };

    expect(config.excludePatterns.length).toBe(2);
    expect(config.excludePatterns[0].test("Busy")).toBe(true);
    expect(config.excludePatterns[1].test("Private")).toBe(true);
    expect(config.attendeeAliases.get("john@example.com")).toBe("@John");
  });
});
