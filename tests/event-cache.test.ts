import { describe, it, expect, beforeEach } from "vitest";
import {
  hashEvent,
  loadEventCache,
  saveEventCache,
  detectEventChanges,
  updateEventCache,
  clearEventCache,
  type EventCacheEntry,
} from "../src/event-cache";
import type { ICalEvent } from "../src/ical";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(global, "localStorage", { value: localStorageMock });

// Helper to create mock events
function createMockEvent(overrides: Partial<ICalEvent> = {}): ICalEvent {
  return {
    uid: "test-event-123",
    summary: "Test Meeting",
    description: "A test event",
    dtstart: new Date("2025-01-15T10:00:00Z"),
    dtend: new Date("2025-01-15T11:00:00Z"),
    location: "Room A",
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

describe("event-cache", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  describe("hashEvent", () => {
    it("should generate consistent hash for same event", () => {
      const event = createMockEvent();
      const hash1 = hashEvent(event);
      const hash2 = hashEvent(event);

      expect(hash1).toBe(hash2);
      expect(typeof hash1).toBe("string");
      expect(hash1.length).toBeGreaterThan(0);
    });

    it("should generate different hashes for different events", () => {
      const event1 = createMockEvent({ uid: "event-1" });
      const event2 = createMockEvent({ uid: "event-2" });

      const hash1 = hashEvent(event1);
      const hash2 = hashEvent(event2);

      expect(hash1).not.toBe(hash2);
    });

    it("should detect changes in event properties", () => {
      const event1 = createMockEvent({ summary: "Original Title" });
      const event2 = createMockEvent({ summary: "Updated Title" });

      const hash1 = hashEvent(event1);
      const hash2 = hashEvent(event2);

      expect(hash1).not.toBe(hash2);
    });

    it("should detect changes in event dates", () => {
      const event1 = createMockEvent({ dtstart: new Date("2025-01-15T10:00:00Z") });
      const event2 = createMockEvent({ dtstart: new Date("2025-01-15T11:00:00Z") });

      const hash1 = hashEvent(event1);
      const hash2 = hashEvent(event2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("loadEventCache / saveEventCache", () => {
    it("should return empty map when no cache exists", () => {
      const cache = loadEventCache();
      expect(cache.size).toBe(0);
    });

    it("should save and load cache correctly", () => {
      const cache = new Map<string, EventCacheEntry>();
      cache.set("event-1", { hash: "abc123", lastModified: Date.now() });
      cache.set("event-2", { hash: "def456", lastModified: Date.now() });

      saveEventCache(cache);
      const loadedCache = loadEventCache();

      expect(loadedCache.size).toBe(2);
      expect(loadedCache.get("event-1")?.hash).toBe("abc123");
      expect(loadedCache.get("event-2")?.hash).toBe("def456");
    });

    it("should handle corrupted cache gracefully", () => {
      localStorage.setItem("roam-ical-event-cache", "invalid json");

      const cache = loadEventCache();
      expect(cache.size).toBe(0);
    });

    it("should filter out expired entries", () => {
      const oldTimestamp = Date.now() - 8 * 24 * 60 * 60 * 1000; // 8 days ago
      const recentTimestamp = Date.now() - 1 * 24 * 60 * 60 * 1000; // 1 day ago

      const cache = new Map<string, EventCacheEntry>();
      cache.set("old-event", { hash: "old", lastModified: oldTimestamp });
      cache.set("recent-event", { hash: "recent", lastModified: recentTimestamp });

      saveEventCache(cache);
      const loadedCache = loadEventCache();

      expect(loadedCache.size).toBe(1);
      expect(loadedCache.has("recent-event")).toBe(true);
      expect(loadedCache.has("old-event")).toBe(false);
    });
  });

  describe("detectEventChanges", () => {
    it("should mark all events as created when cache is empty", () => {
      const events = [
        createMockEvent({ uid: "event-1" }),
        createMockEvent({ uid: "event-2" }),
      ];
      const cache = new Map<string, EventCacheEntry>();

      const result = detectEventChanges(events, cache);

      expect(result.stats.totalEvents).toBe(2);
      expect(result.stats.created).toBe(2);
      expect(result.stats.updated).toBe(0);
      expect(result.stats.unchanged).toBe(0);
      expect(result.eventsToWrite.length).toBe(2);
    });

    it("should detect unchanged events", () => {
      const event = createMockEvent({ uid: "event-1" });
      const hash = hashEvent(event);
      // Key format is uid_date
      const eventKey = `event-1_${event.dtstart?.toISOString().split("T")[0]}`;

      const cache = new Map<string, EventCacheEntry>();
      cache.set(eventKey, { hash, lastModified: Date.now() });

      const result = detectEventChanges([event], cache);

      expect(result.stats.unchanged).toBe(1);
      expect(result.stats.created).toBe(0);
      expect(result.stats.updated).toBe(0);
      expect(result.eventsToWrite.length).toBe(0);
    });

    it("should detect updated events", () => {
      const event = createMockEvent({ uid: "event-1", summary: "Updated" });
      // Key format is uid_date
      const eventKey = `event-1_${event.dtstart?.toISOString().split("T")[0]}`;

      const cache = new Map<string, EventCacheEntry>();
      cache.set(eventKey, { hash: "old-hash", lastModified: Date.now() });

      const result = detectEventChanges([event], cache);

      expect(result.stats.updated).toBe(1);
      expect(result.stats.created).toBe(0);
      expect(result.stats.unchanged).toBe(0);
      expect(result.eventsToWrite.length).toBe(1);
    });

    it("should handle mixed scenarios", () => {
      const baseDate = new Date("2025-01-15T10:00:00Z");
      const unchangedEvent = createMockEvent({ uid: "unchanged", dtstart: baseDate });
      const updatedEvent = createMockEvent({ uid: "updated", summary: "New Title", dtstart: baseDate });
      const newEvent = createMockEvent({ uid: "new", dtstart: baseDate });

      const dateStr = baseDate.toISOString().split("T")[0];

      const cache = new Map<string, EventCacheEntry>();
      cache.set(`unchanged_${dateStr}`, { hash: hashEvent(unchangedEvent), lastModified: Date.now() });
      cache.set(`updated_${dateStr}`, { hash: "old-hash", lastModified: Date.now() });

      const result = detectEventChanges([unchangedEvent, updatedEvent, newEvent], cache);

      expect(result.stats.totalEvents).toBe(3);
      expect(result.stats.unchanged).toBe(1);
      expect(result.stats.updated).toBe(1);
      expect(result.stats.created).toBe(1);
      expect(result.eventsToWrite.length).toBe(2);
    });
  });

  describe("updateEventCache", () => {
    it("should add new events to cache", () => {
      const event = createMockEvent({ uid: "event-1" });
      const cache = new Map<string, EventCacheEntry>();
      const eventKey = `event-1_${event.dtstart?.toISOString().split("T")[0]}`;

      updateEventCache([event], cache);

      expect(cache.has(eventKey)).toBe(true);
      expect(cache.get(eventKey)?.hash).toBe(hashEvent(event));
    });

    it("should update existing events in cache", () => {
      const event = createMockEvent({ uid: "event-1", summary: "Updated" });
      const cache = new Map<string, EventCacheEntry>();
      const eventKey = `event-1_${event.dtstart?.toISOString().split("T")[0]}`;
      cache.set(eventKey, { hash: "old-hash", lastModified: Date.now() - 10000 });

      updateEventCache([event], cache);

      expect(cache.get(eventKey)?.hash).toBe(hashEvent(event));
    });
  });

  describe("clearEventCache", () => {
    it("should clear all cached data", () => {
      const cache = new Map<string, EventCacheEntry>();
      cache.set("event-1", { hash: "abc", lastModified: Date.now() });
      saveEventCache(cache);

      clearEventCache();

      const loadedCache = loadEventCache();
      expect(loadedCache.size).toBe(0);
    });
  });
});
