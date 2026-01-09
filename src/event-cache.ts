/**
 * Event-level caching for smart sync.
 * Tracks changes to individual events to avoid rewriting unchanged events.
 */

import type { ICalEvent } from "./ical";

/**
 * Cache entry for a single event.
 */
export interface EventCacheEntry {
  /** Hash of the event content */
  hash: string;
  /** Timestamp when this entry was last updated */
  lastModified: number;
}

/**
 * Statistics from smart sync comparison.
 */
export interface SmartSyncStats {
  /** Total number of events processed */
  totalEvents: number;
  /** Events that haven't changed since last sync */
  unchanged: number;
  /** Events that were updated */
  updated: number;
  /** New events that were created */
  created: number;
}

/**
 * Storage key for the event cache in localStorage.
 */
const EVENT_CACHE_STORAGE_KEY = "roam-ical-sync-event-cache";

/**
 * Maximum age for cache entries (7 days in milliseconds).
 * Entries older than this are automatically pruned.
 */
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Simple FNV-1a hash function for event content.
 * Produces a consistent hash for detecting changes.
 *
 * @param str String to hash.
 * @returns Hexadecimal hash string.
 */
function fnv1aHash(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(16);
}

/**
 * Creates a hash of an event's content for change detection.
 * Includes all fields that would affect the block content.
 *
 * @param event Event to hash.
 * @returns Hash string representing the event content.
 */
export function hashEvent(event: ICalEvent): string {
  const content = [
    event.uid,
    event.summary,
    event.description,
    event.location,
    event.url,
    event.meetingUrl ?? "",
    event.dtstart?.toISOString() ?? "",
    event.dtend?.toISOString() ?? "",
    event.isAllDay.toString(),
    event.isRecurring.toString(),
    event.dtstartTzid ?? "",
    event.dtendTzid ?? "",
    event.attendees.map(a => `${a.name}:${a.email}`).sort().join(","),
  ].join("|");

  return fnv1aHash(content);
}

/**
 * Creates a unique key for an event in the cache.
 * Combines UID with date to handle recurring events.
 *
 * @param event Event to create key for.
 * @returns Unique cache key string.
 */
function createEventKey(event: ICalEvent): string {
  const dateStr = event.dtstart?.toISOString().split("T")[0] ?? "no-date";
  return `${event.uid}_${dateStr}`;
}

/**
 * Loads the event cache from localStorage.
 *
 * @returns Map of event keys to cache entries.
 */
export function loadEventCache(): Map<string, EventCacheEntry> {
  try {
    const stored = localStorage.getItem(EVENT_CACHE_STORAGE_KEY);
    if (!stored) {
      return new Map();
    }

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return new Map();
    }

    const now = Date.now();
    const cache = new Map<string, EventCacheEntry>();

    // Filter out expired entries while loading
    for (const [key, entry] of parsed) {
      if (typeof key === "string" && entry && typeof entry.hash === "string") {
        const age = now - (entry.lastModified ?? 0);
        if (age < CACHE_MAX_AGE_MS) {
          cache.set(key, entry);
        }
      }
    }

    return cache;
  } catch {
    return new Map();
  }
}

/**
 * Saves the event cache to localStorage.
 *
 * @param cache Map of event keys to cache entries.
 */
export function saveEventCache(cache: Map<string, EventCacheEntry>): void {
  try {
    const entries = Array.from(cache.entries());
    localStorage.setItem(EVENT_CACHE_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Silently fail if localStorage is unavailable or full
  }
}

/**
 * Clears the event cache.
 */
export function clearEventCache(): void {
  try {
    localStorage.removeItem(EVENT_CACHE_STORAGE_KEY);
  } catch {
    // Silently fail
  }
}

/**
 * Result from detecting event changes.
 */
export interface DetectChangesResult {
  /** Events that need to be written (new or changed) */
  eventsToWrite: ICalEvent[];
  /** Events that haven't changed */
  unchangedEvents: ICalEvent[];
  /** Statistics about the comparison */
  stats: SmartSyncStats;
}

/**
 * Compares events against the cache to detect changes.
 * Returns only the events that need to be written (new or changed).
 *
 * @param events All events from the current sync.
 * @param cache Current event cache.
 * @returns Events to write and sync statistics.
 */
export function detectEventChanges(
  events: ICalEvent[],
  cache: Map<string, EventCacheEntry>
): DetectChangesResult {
  const eventsToWrite: ICalEvent[] = [];
  const unchangedEvents: ICalEvent[] = [];
  let unchanged = 0;
  let updated = 0;
  let created = 0;

  for (const event of events) {
    const key = createEventKey(event);
    const hash = hashEvent(event);
    const cached = cache.get(key);

    if (cached && cached.hash === hash) {
      // Event hasn't changed
      unchanged++;
      unchangedEvents.push(event);
    } else if (cached) {
      // Event was updated
      updated++;
      eventsToWrite.push(event);
    } else {
      // New event
      created++;
      eventsToWrite.push(event);
    }
  }

  const stats: SmartSyncStats = {
    totalEvents: events.length,
    unchanged,
    updated,
    created,
  };

  return { eventsToWrite, unchangedEvents, stats };
}

/**
 * Updates the cache with current events.
 * Call this after successfully writing events.
 *
 * @param events Events that were synced.
 * @param cache Cache to update.
 */
export function updateEventCache(
  events: ICalEvent[],
  cache: Map<string, EventCacheEntry>
): void {
  const now = Date.now();

  for (const event of events) {
    const key = createEventKey(event);
    const hash = hashEvent(event);
    cache.set(key, { hash, lastModified: now });
  }
}

/**
 * Prunes old entries from the cache.
 * Removes entries that are no longer in the current event set.
 *
 * @param events Current events to keep.
 * @param cache Cache to prune.
 */
export function pruneEventCache(
  events: ICalEvent[],
  cache: Map<string, EventCacheEntry>
): void {
  const currentKeys = new Set(events.map(createEventKey));

  for (const key of cache.keys()) {
    if (!currentKeys.has(key)) {
      cache.delete(key);
    }
  }
}
