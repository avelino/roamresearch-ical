import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  shouldNotify,
  loadNotificationState,
  saveNotificationState,
  clearNotificationState,
  getUpcomingEvents,
  REMINDER_OPTIONS,
  DEFAULT_REMINDER_CONFIG,
  type NotificationState,
} from "../src/reminders";
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
    description: "",
    dtstart: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes from now
    dtend: new Date(Date.now() + 70 * 60 * 1000),
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

describe("reminders", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("REMINDER_OPTIONS", () => {
    it("should have expected options", () => {
      expect(REMINDER_OPTIONS.length).toBeGreaterThan(0);
      expect(REMINDER_OPTIONS.map((o) => o.value)).toContain(5);
      expect(REMINDER_OPTIONS.map((o) => o.value)).toContain(15);
      expect(REMINDER_OPTIONS.map((o) => o.value)).toContain(30);
    });

    it("should have labels for all options", () => {
      REMINDER_OPTIONS.forEach((option) => {
        expect(option.label).toBeTruthy();
        expect(typeof option.label).toBe("string");
      });
    });
  });

  describe("DEFAULT_REMINDER_CONFIG", () => {
    it("should have expected defaults", () => {
      expect(DEFAULT_REMINDER_CONFIG.enabled).toBe(false);
      expect(DEFAULT_REMINDER_CONFIG.reminderMinutes).toBe(15);
    });
  });

  describe("shouldNotify", () => {
    it("should return false for events without start date", () => {
      const event = createMockEvent({ dtstart: null });
      const state = new Map<string, NotificationState>();

      expect(shouldNotify(event, 15, state)).toBe(false);
    });

    it("should return false for all-day events", () => {
      const event = createMockEvent({ isAllDay: true });
      const state = new Map<string, NotificationState>();

      expect(shouldNotify(event, 15, state)).toBe(false);
    });

    it("should return false for events too far in future", () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const event = createMockEvent({
        dtstart: new Date(now + 60 * 60 * 1000), // 60 min from now
      });
      const state = new Map<string, NotificationState>();

      // With 15 min reminder, event starting in 60 min is too far
      expect(shouldNotify(event, 15, state)).toBe(false);
    });

    it("should return false for events that already started", () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const event = createMockEvent({
        dtstart: new Date(now - 5 * 60 * 1000), // 5 min ago
      });
      const state = new Map<string, NotificationState>();

      expect(shouldNotify(event, 15, state)).toBe(false);
    });

    it("should return true for events in notification window", () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const event = createMockEvent({
        uid: "upcoming-event",
        dtstart: new Date(now + 10 * 60 * 1000), // 10 min from now
      });
      const state = new Map<string, NotificationState>();

      // With 15 min reminder, event starting in 10 min should notify
      expect(shouldNotify(event, 15, state)).toBe(true);
    });

    it("should return false if already notified", () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const eventDate = new Date(now + 10 * 60 * 1000);
      const event = createMockEvent({
        uid: "already-notified",
        dtstart: eventDate,
      });

      const state = new Map<string, NotificationState>();
      const key = `already-notified_${eventDate.toISOString().split("T")[0]}`;
      state.set(key, {
        eventUid: "already-notified",
        eventDate: eventDate.toISOString().split("T")[0],
        notifiedAt: now,
      });

      expect(shouldNotify(event, 15, state)).toBe(false);
    });
  });

  describe("loadNotificationState / saveNotificationState", () => {
    it("should return empty map when no state exists", () => {
      const state = loadNotificationState();
      expect(state.size).toBe(0);
    });

    it("should save and load state correctly", () => {
      const state = new Map<string, NotificationState>();
      state.set("event-1_2025-01-15", {
        eventUid: "event-1",
        eventDate: "2025-01-15",
        notifiedAt: Date.now(),
      });

      saveNotificationState(state);
      const loadedState = loadNotificationState();

      expect(loadedState.size).toBe(1);
      expect(loadedState.get("event-1_2025-01-15")?.eventUid).toBe("event-1");
    });

    it("should filter out expired entries (older than 24h)", () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const state = new Map<string, NotificationState>();
      state.set("old-event", {
        eventUid: "old",
        eventDate: "2025-01-01",
        notifiedAt: now - 25 * 60 * 60 * 1000, // 25 hours ago
      });
      state.set("recent-event", {
        eventUid: "recent",
        eventDate: "2025-01-15",
        notifiedAt: now - 12 * 60 * 60 * 1000, // 12 hours ago
      });

      saveNotificationState(state);
      const loadedState = loadNotificationState();

      expect(loadedState.size).toBe(1);
      expect(loadedState.has("recent-event")).toBe(true);
      expect(loadedState.has("old-event")).toBe(false);
    });

    it("should handle corrupted state gracefully", () => {
      localStorage.setItem("roam-ical-notification-state", "invalid json");

      const state = loadNotificationState();
      expect(state.size).toBe(0);
    });
  });

  describe("clearNotificationState", () => {
    it("should clear all state", () => {
      const state = new Map<string, NotificationState>();
      state.set("event-1", {
        eventUid: "event-1",
        eventDate: "2025-01-15",
        notifiedAt: Date.now(),
      });
      saveNotificationState(state);

      clearNotificationState();

      const loadedState = loadNotificationState();
      expect(loadedState.size).toBe(0);
    });
  });

  describe("getUpcomingEvents", () => {
    it("should return events starting within the time window", () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const events = [
        createMockEvent({
          uid: "soon",
          dtstart: new Date(now + 20 * 60 * 1000), // 20 min
        }),
        createMockEvent({
          uid: "later",
          dtstart: new Date(now + 90 * 60 * 1000), // 90 min
        }),
      ];

      const upcoming = getUpcomingEvents(events, 60);

      expect(upcoming.length).toBe(1);
      expect(upcoming[0].uid).toBe("soon");
    });

    it("should exclude past events", () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const events = [
        createMockEvent({
          uid: "past",
          dtstart: new Date(now - 30 * 60 * 1000), // 30 min ago
        }),
      ];

      const upcoming = getUpcomingEvents(events, 60);
      expect(upcoming.length).toBe(0);
    });

    it("should exclude all-day events", () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const events = [
        createMockEvent({
          uid: "all-day",
          isAllDay: true,
          dtstart: new Date(now + 30 * 60 * 1000),
        }),
      ];

      const upcoming = getUpcomingEvents(events, 60);
      expect(upcoming.length).toBe(0);
    });

    it("should exclude events without start date", () => {
      const events = [
        createMockEvent({
          uid: "no-date",
          dtstart: null,
        }),
      ];

      const upcoming = getUpcomingEvents(events, 60);
      expect(upcoming.length).toBe(0);
    });
  });
});
