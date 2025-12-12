import ICAL from "ical.js";
import { logDebug, logError } from "./logger";

/**
 * Represents a parsed iCal event.
 */
export interface ICalEvent {
  uid: string;
  summary: string;
  description: string;
  dtstart: Date | null;
  dtend: Date | null;
  location: string;
  url: string;
}

/**
 * Represents a calendar with its metadata and events.
 */
export interface ICalCalendar {
  name: string;
  url: string;
  events: ICalEvent[];
}

/**
 * Configuration for a calendar URL.
 */
export interface CalendarConfig {
  name: string;
  url: string;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Returns ordinal suffix for a day number (1st, 2nd, 3rd, etc.).
 */
function getOrdinalSuffix(day: number): string {
  const remainder = day % 100;
  if (remainder >= 11 && remainder <= 13) {
    return "th";
  }
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/**
 * Formats a Date into Roam-style date (e.g., "January 2nd, 2025").
 */
export function formatRoamDate(date: Date): string {
  const month = MONTH_NAMES[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month} ${day}${getOrdinalSuffix(day)}, ${year}`;
}

/**
 * Converts an ICAL.Time to a JavaScript Date.
 */
function icalTimeToDate(icalTime: ICAL.Time | null): Date | null {
  if (!icalTime) return null;
  try {
    return icalTime.toJSDate();
  } catch {
    return null;
  }
}

/**
 * Parses raw iCal (.ics) content into events using ical.js.
 *
 * @param content Raw .ics file content.
 * @param calendarName Name to use for the calendar.
 */
export function parseICalContent(content: string, calendarName: string): ICalEvent[] {
  const events: ICalEvent[] = [];

  try {
    const jcalData = ICAL.parse(content);
    const comp = new ICAL.Component(jcalData);

    // Get calendar name from X-WR-CALNAME if not provided
    const calName = calendarName || comp.getFirstPropertyValue("x-wr-calname") || "Calendar";

    const vevents = comp.getAllSubcomponents("vevent");

    for (const vevent of vevents) {
      try {
        const event = new ICAL.Event(vevent);

        const icalEvent: ICalEvent = {
          uid: event.uid || "",
          summary: event.summary || "",
          description: event.description || "",
          dtstart: icalTimeToDate(event.startDate),
          dtend: icalTimeToDate(event.endDate),
          location: event.location || "",
          url: String(vevent.getFirstPropertyValue("url") || ""),
        };

        if (icalEvent.uid) {
          events.push(icalEvent);
        }
      } catch (eventError) {
        logDebug("parse_event_error", { error: String(eventError) });
      }
    }

    logDebug("parse_ical_content", {
      calendarName: calName,
      eventsFound: events.length,
    });
  } catch (error) {
    logError("Failed to parse iCal content", error);
  }

  return events;
}

/**
 * Default CORS proxy URL. Users can configure their own.
 * corsproxy.io format: https://corsproxy.io/?url={encoded_url}
 */
export const DEFAULT_CORS_PROXY = "https://corsproxy.io/?url=";

/**
 * Builds the proxied URL for corsproxy.io or similar CORS proxies.
 * corsproxy.io format: https://corsproxy.io/?url={encoded_url}
 *
 * @param proxyUrl The proxy base URL (e.g., "https://corsproxy.io/?url=")
 * @param targetUrl The target URL to proxy
 */
function buildProxiedUrl(proxyUrl: string, targetUrl: string): string {
  // corsproxy.io expects: https://corsproxy.io/?url={encoded_url}
  // If proxy ends with "=" we just append the encoded URL (corsproxy.io style)
  // Otherwise we append ?url= for custom proxies
  if (proxyUrl.endsWith("=")) {
    return `${proxyUrl}${encodeURIComponent(targetUrl)}`;
  }
  return `${proxyUrl}?url=${encodeURIComponent(targetUrl)}`;
}

/**
 * Fetches content through a CORS proxy.
 *
 * @param url Original URL to fetch.
 * @param corsProxy CORS proxy URL prefix.
 */
async function fetchWithCorsProxy(url: string, corsProxy: string): Promise<string> {
  const proxyUrl = buildProxiedUrl(corsProxy, url);

  logDebug("fetch_with_proxy", { originalUrl: url, proxyUrl });

  const response = await fetch(proxyUrl);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.text();
}

/**
 * Fetches and parses an iCal feed from a URL.
 * Always uses CORS proxy since most calendar providers block cross-origin requests.
 *
 * @param config Calendar configuration with name and URL.
 * @param corsProxy CORS proxy URL prefix.
 */
export async function fetchICalCalendar(
  config: CalendarConfig,
  corsProxy: string = DEFAULT_CORS_PROXY
): Promise<ICalCalendar> {
  logDebug("fetch_ical_start", { name: config.name, url: config.url, proxy: corsProxy });

  try {
    const content = await fetchWithCorsProxy(config.url, corsProxy);
    const events = parseICalContent(content, config.name);

    logDebug("fetch_ical_complete", {
      name: config.name,
      eventsCount: events.length,
    });

    return {
      name: config.name,
      url: config.url,
      events,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`Failed to fetch calendar "${config.name}"`, { url: config.url, error: message });
    throw error;
  }
}

/**
 * Fetches multiple iCal calendars in parallel.
 *
 * @param configs Array of calendar configurations.
 * @param corsProxy CORS proxy URL prefix.
 */
export async function fetchAllCalendars(
  configs: CalendarConfig[],
  corsProxy: string = DEFAULT_CORS_PROXY
): Promise<ICalCalendar[]> {
  if (configs.length === 0) {
    return [];
  }

  const results = await Promise.allSettled(
    configs.map((config) => fetchICalCalendar(config, corsProxy))
  );

  const calendars: ICalCalendar[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      calendars.push(result.value);
    } else {
      logError(`Calendar fetch failed: ${configs[i].name}`, result.reason);
    }
  }

  return calendars;
}

/**
 * Sanitizes text for safe inclusion in Roam blocks.
 * Trims whitespace and normalizes line breaks.
 */
export function safeText(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/[\r\n]+/g, " ").trim();
}

/**
 * Simple FNV-1a hash implementation.
 * Produces a deterministic 32-bit hash from a string.
 *
 * @param str Input string to hash.
 * @returns 32-bit unsigned integer hash.
 */
function fnv1aHash(str: string): number {
  const FNV_PRIME = 0x01000193;
  const FNV_OFFSET = 0x811c9dc5;

  let hash = FNV_OFFSET;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0; // Convert to unsigned 32-bit integer
}

/**
 * Creates a short, deterministic hash from an event UID.
 * Uses FNV-1a hash combined with a portion of the original ID for uniqueness.
 *
 * @param uid Original event UID.
 * @returns Safe alphanumeric hash string for use in page names.
 */
export function hashEventId(uid: string): string {
  // Create two hashes with different seeds for more bits
  const hash1 = fnv1aHash(uid);
  const hash2 = fnv1aHash(uid + "_salt");

  // Convert to base36 for compact alphanumeric representation
  const part1 = hash1.toString(36);
  const part2 = hash2.toString(36);

  // Combine for ~12-14 character hash (safe for page names)
  return `${part1}${part2}`;
}

/**
 * Creates a safe event ID for use in page names.
 * Uses a hash to avoid special characters that break Roam page creation.
 * The original UID is preserved in the ical-id:: property.
 *
 * @param uid Original event UID.
 * @returns Hash-based ID safe for page names.
 */
export function sanitizeEventId(uid: string): string {
  return hashEventId(uid);
}

/**
 * Gets the effective date for sorting an event.
 * Prioritizes dtstart, falls back to dtend, then returns null for events without dates.
 *
 * @param event iCal event to get date from.
 * @returns Date for sorting, or null if no date available.
 */
function getEventSortDate(event: ICalEvent): Date | null {
  return event.dtstart ?? event.dtend ?? null;
}

/**
 * Sorts events by date, most recent first.
 * Events without dates are placed at the end.
 *
 * @param events Array of iCal events to sort.
 * @returns New sorted array (does not mutate input).
 */
export function sortEventsByDateDescending(events: ICalEvent[]): ICalEvent[] {
  return [...events].sort((a, b) => {
    const dateA = getEventSortDate(a);
    const dateB = getEventSortDate(b);

    // Events without dates go to the end
    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;

    // Most recent first (descending order)
    return dateB.getTime() - dateA.getTime();
  });
}

/**
 * Checks if an event title matches any of the exclude patterns.
 *
 * @param title Event title to check.
 * @param patterns Array of regex patterns to match against.
 * @returns True if the title matches any pattern (should be excluded).
 */
export function shouldExcludeEvent(title: string, patterns: RegExp[]): boolean {
  if (!title || patterns.length === 0) return false;
  return patterns.some((pattern) => pattern.test(title));
}

/**
 * Filters out events whose titles match any of the exclude patterns.
 *
 * @param events Array of iCal events to filter.
 * @param excludePatterns Array of regex patterns for exclusion.
 * @returns New filtered array (does not mutate input).
 */
export function filterExcludedEvents(
  events: ICalEvent[],
  excludePatterns: RegExp[]
): ICalEvent[] {
  if (excludePatterns.length === 0) return events;

  return events.filter((event) => {
    const excluded = shouldExcludeEvent(event.summary, excludePatterns);
    if (excluded) {
      logDebug("event_excluded", { title: event.summary, uid: event.uid });
    }
    return !excluded;
  });
}

/**
 * Configuration for date range filtering.
 */
export interface DateRangeConfig {
  daysPast: number;
  daysFuture: number;
}

/**
 * Checks if an event's date falls within the specified range.
 *
 * @param event iCal event to check.
 * @param config Date range configuration.
 * @returns True if the event is within the date range.
 */
export function isEventInDateRange(event: ICalEvent, config: DateRangeConfig): boolean {
  const eventDate = event.dtstart ?? event.dtend;

  // Events without dates are excluded from date filtering
  if (!eventDate) {
    return false;
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Calculate date boundaries
  const pastBoundary = new Date(startOfToday);
  pastBoundary.setDate(pastBoundary.getDate() - config.daysPast);

  const futureBoundary = new Date(startOfToday);
  futureBoundary.setDate(futureBoundary.getDate() + config.daysFuture + 1); // +1 to include the full day

  return eventDate >= pastBoundary && eventDate < futureBoundary;
}

/**
 * Filters events to only include those within the specified date range.
 *
 * @param events Array of iCal events to filter.
 * @param config Date range configuration.
 * @returns New filtered array (does not mutate input).
 */
export function filterEventsByDateRange(
  events: ICalEvent[],
  config: DateRangeConfig
): ICalEvent[] {
  const beforeCount = events.length;

  const filtered = events.filter((event) => isEventInDateRange(event, config));

  const afterCount = filtered.length;
  if (beforeCount !== afterCount) {
    logDebug("filter_by_date_range", {
      daysPast: config.daysPast,
      daysFuture: config.daysFuture,
      beforeCount,
      afterCount,
      filtered: beforeCount - afterCount,
    });
  }

  return filtered;
}
