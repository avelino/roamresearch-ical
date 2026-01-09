/**
 * Event reminders using browser notifications.
 * Sends notifications before events start based on user configuration.
 */

import type { ICalEvent } from "./ical";
import { logDebug, logInfo, logWarn } from "./logger";

/**
 * Minutes before event to send reminder.
 */
export type ReminderMinutes = 5 | 10 | 15 | 30 | 60;

/**
 * Available reminder time options.
 */
export const REMINDER_OPTIONS: { value: ReminderMinutes; label: string }[] = [
  { value: 5, label: "5 minutes before" },
  { value: 10, label: "10 minutes before" },
  { value: 15, label: "15 minutes before" },
  { value: 30, label: "30 minutes before" },
  { value: 60, label: "1 hour before" },
];

/**
 * Configuration for event reminders.
 */
export interface ReminderConfig {
  /** Whether reminders are enabled */
  enabled: boolean;
  /** Minutes before event to send reminder */
  reminderMinutes: number;
}

/**
 * Default reminder configuration.
 */
export const DEFAULT_REMINDER_CONFIG: ReminderConfig = {
  enabled: false,
  reminderMinutes: 15,
};

/**
 * State tracking for sent notifications.
 */
export interface NotificationState {
  /** Event UID */
  eventUid: string;
  /** Event date (to handle recurring events) */
  eventDate: string;
  /** Timestamp when notification was sent */
  notifiedAt: number;
}

/**
 * Storage key for notification state.
 */
const NOTIFICATION_STATE_KEY = "roam-ical-notification-state";

/**
 * Maximum age for notification state entries (24 hours).
 */
const STATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Requests notification permission from the browser.
 *
 * @returns Promise resolving to the permission state.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!("Notification" in window)) {
    logWarn("Notifications not supported in this browser");
    return "denied";
  }

  if (Notification.permission === "granted") {
    return "granted";
  }

  if (Notification.permission === "denied") {
    return "denied";
  }

  // Request permission
  const permission = await Notification.requestPermission();
  logDebug("notification_permission_requested", { permission });
  return permission;
}

/**
 * Checks if notifications can be shown.
 *
 * @returns True if notifications are available and permitted.
 */
export function canShowNotifications(): boolean {
  return "Notification" in window && Notification.permission === "granted";
}

/**
 * Loads notification state from localStorage.
 *
 * @returns Map of notification states by event key.
 */
export function loadNotificationState(): Map<string, NotificationState> {
  try {
    const stored = localStorage.getItem(NOTIFICATION_STATE_KEY);
    if (!stored) {
      return new Map();
    }

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return new Map();
    }

    const now = Date.now();
    const state = new Map<string, NotificationState>();

    // Filter out expired entries
    for (const [key, entry] of parsed) {
      if (typeof key === "string" && entry && typeof entry.notifiedAt === "number") {
        const age = now - entry.notifiedAt;
        if (age < STATE_MAX_AGE_MS) {
          state.set(key, entry);
        }
      }
    }

    return state;
  } catch {
    return new Map();
  }
}

/**
 * Saves notification state to localStorage.
 *
 * @param state Map of notification states.
 */
export function saveNotificationState(state: Map<string, NotificationState>): void {
  try {
    const entries = Array.from(state.entries());
    localStorage.setItem(NOTIFICATION_STATE_KEY, JSON.stringify(entries));
  } catch {
    // Silently fail if localStorage is unavailable
  }
}

/**
 * Creates a unique key for an event notification.
 *
 * @param event Event to create key for.
 * @returns Unique notification key.
 */
function createNotificationKey(event: ICalEvent): string {
  const dateStr = event.dtstart?.toISOString().split("T")[0] ?? "no-date";
  return `${event.uid}_${dateStr}`;
}

/**
 * Checks if a notification should be sent for an event.
 *
 * @param event Event to check.
 * @param reminderMinutes Minutes before event to notify.
 * @param state Current notification state.
 * @returns True if notification should be sent.
 */
export function shouldNotify(
  event: ICalEvent,
  reminderMinutes: number,
  state: Map<string, NotificationState>
): boolean {
  // Need a start time to calculate notification time
  if (!event.dtstart) {
    return false;
  }

  // Skip all-day events
  if (event.isAllDay) {
    return false;
  }

  const now = Date.now();
  const eventStart = event.dtstart.getTime();
  const notifyAt = eventStart - reminderMinutes * 60 * 1000;

  // Check if we're in the notification window
  // Window is from (notifyAt) to (eventStart)
  if (now < notifyAt || now >= eventStart) {
    return false;
  }

  // Check if already notified
  const key = createNotificationKey(event);
  if (state.has(key)) {
    return false;
  }

  return true;
}

/**
 * Shows a browser notification for an event.
 *
 * @param event Event to notify about.
 * @param reminderMinutes Minutes until event starts.
 * @returns The Notification object, or null if failed.
 */
export function showEventNotification(
  event: ICalEvent,
  reminderMinutes: number
): Notification | null {
  if (!canShowNotifications()) {
    return null;
  }

  const title = event.summary || "Upcoming Event";
  const startTime = event.dtstart?.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  }) ?? "";

  let body = `Starts in ${reminderMinutes} minutes`;
  if (startTime) {
    body += ` at ${startTime}`;
  }
  if (event.location) {
    body += `\nLocation: ${event.location}`;
  }

  try {
    const notification = new Notification(title, {
      body,
      icon: "📅",
      tag: `ical-reminder-${event.uid}`,
      requireInteraction: false,
    });

    // Auto-close after 30 seconds
    setTimeout(() => notification.close(), 30000);

    logDebug("notification_shown", {
      eventUid: event.uid,
      summary: event.summary,
      reminderMinutes,
    });

    return notification;
  } catch (error) {
    logWarn("Failed to show notification", { error: String(error) });
    return null;
  }
}

/**
 * Checks all events and sends reminders where appropriate.
 *
 * @param events Events to check for reminders.
 * @param config Reminder configuration.
 * @returns Number of notifications sent.
 */
export async function checkAndSendReminders(
  events: ICalEvent[],
  config: ReminderConfig
): Promise<number> {
  if (!config.enabled) {
    return 0;
  }

  if (!canShowNotifications()) {
    const permission = await requestNotificationPermission();
    if (permission !== "granted") {
      logInfo("Notification permission not granted, reminders disabled");
      return 0;
    }
  }

  const state = loadNotificationState();
  let sentCount = 0;

  for (const event of events) {
    if (shouldNotify(event, config.reminderMinutes, state)) {
      const notification = showEventNotification(event, config.reminderMinutes);

      if (notification) {
        // Mark as notified
        const key = createNotificationKey(event);
        state.set(key, {
          eventUid: event.uid,
          eventDate: event.dtstart?.toISOString().split("T")[0] ?? "",
          notifiedAt: Date.now(),
        });
        sentCount++;
      }
    }
  }

  // Save updated state
  if (sentCount > 0) {
    saveNotificationState(state);
  }

  logDebug("reminders_checked", {
    totalEvents: events.length,
    notificationsSent: sentCount,
  });

  return sentCount;
}

/**
 * Clears the notification state (for testing/reset).
 */
export function clearNotificationState(): void {
  try {
    localStorage.removeItem(NOTIFICATION_STATE_KEY);
  } catch {
    // Silently fail
  }
}

/**
 * Gets upcoming events that will need reminders soon.
 *
 * @param events All events.
 * @param withinMinutes Look ahead window in minutes.
 * @returns Events starting within the time window.
 */
export function getUpcomingEvents(
  events: ICalEvent[],
  withinMinutes: number
): ICalEvent[] {
  const now = Date.now();
  const windowEnd = now + withinMinutes * 60 * 1000;

  return events.filter((event) => {
    if (!event.dtstart || event.isAllDay) {
      return false;
    }

    const start = event.dtstart.getTime();
    return start > now && start <= windowEnd;
  });
}
