import ICAL from "ical.js";
import { logDebug, logError, logInfo } from "./logger";

/**
 * Cache entry for incremental sync.
 * Stores ETag, Last-Modified headers, and content hash to avoid re-downloading unchanged calendars.
 */
export interface CalendarCacheEntry {
  url: string;
  etag?: string;
  lastModified?: string;
  contentHash: string;
  lastFetched: number;
}

/**
 * In-memory cache for calendar data.
 * Persisted per session to enable incremental sync.
 */
const calendarCache = new Map<string, CalendarCacheEntry>();

/**
 * Clears the calendar cache.
 * Call this when the user forces a full refresh.
 */
export function clearCalendarCache(): void {
  calendarCache.clear();
  logDebug("cache_cleared", { message: "Calendar cache cleared" });
}

/**
 * Gets cache statistics for debugging.
 */
export function getCacheStats(): { size: number; entries: string[] } {
  return {
    size: calendarCache.size,
    entries: Array.from(calendarCache.keys()),
  };
}

/**
 * Simple hash function for content comparison (FNV-1a).
 * Used to detect if calendar content has changed.
 */
function hashContent(content: string): string {
  const FNV_PRIME = 0x01000193;
  const FNV_OFFSET = 0x811c9dc5;

  let hash = FNV_OFFSET;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Yields control back to the main thread to prevent UI freezing.
 * Uses scheduler.yield() when available (modern browsers), otherwise falls back to setTimeout.
 */
function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as unknown as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) {
    return scheduler.yield();
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Gets the CORS proxy URL from Roam's native API.
 * Uses roamAlphaAPI.constants.corsAnywhereProxyUrl which is hosted by the Roam team.
 * @see https://roamresearch.com/#/app/developer-documentation/page/TuLoib22N
 */
function getRoamProxyUrl(): string {
  const roamAPI = (window as unknown as {
    roamAlphaAPI?: {
      constants?: {
        corsAnywhereProxyUrl?: string;
      };
    };
  }).roamAlphaAPI;

  const proxyUrl = roamAPI?.constants?.corsAnywhereProxyUrl;
  if (!proxyUrl) {
    throw new Error("Roam CORS proxy URL not available. Make sure you are running in Roam Research.");
  }
  return proxyUrl;
}

/**
 * Number of operations between yields during parsing.
 */
const PARSE_YIELD_BATCH_SIZE = 50;

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
  meetingUrl?: string;
  attendees: { name: string; email: string }[];
}

/**
 * Meeting service patterns for video conference URL detection.
 * Each pattern includes the service name for logging/debugging.
 */
const MEETING_URL_PATTERNS: { name: string; pattern: RegExp }[] = [
  // Zoom: matches /j/, /my/, /s/ (webinar), and /wc/ links
  {
    name: "Zoom",
    pattern: /https:\/\/(?:[\w-]+\.)?zoom\.us\/(?:j|my|s|wc)\/[a-zA-Z0-9]+(?:\?[a-zA-Z0-9=&_-]+)?/i,
  },
  // Google Meet: matches standard meet.google.com patterns
  {
    name: "Google Meet",
    pattern: /https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i,
  },
  // Microsoft Teams: matches meetup-join and meeting links
  {
    name: "Microsoft Teams",
    pattern: /https:\/\/teams\.(?:microsoft|live)\.com\/(?:l\/meetup-join|meet)\/[a-zA-Z0-9%._/-]+/i,
  },
  // Webex: matches standard join links and personal room links
  {
    name: "Webex",
    pattern: /https:\/\/(?:[\w-]+\.)?webex\.com\/(?:meet|join|m|wbxmjs)\/[a-zA-Z0-9./_-]+/i,
  },
  // GoToMeeting
  {
    name: "GoToMeeting",
    pattern: /https:\/\/(?:global\.gotomeeting\.com\/join|gotomeet\.me)\/[0-9]+/i,
  },
  // Whereby (formerly appear.in)
  {
    name: "Whereby",
    pattern: /https:\/\/whereby\.com\/[a-zA-Z0-9_-]+/i,
  },
  // Jitsi Meet (including self-hosted instances)
  {
    name: "Jitsi",
    pattern: /https:\/\/(?:meet\.jit\.si|8x8\.vc|[\w-]+\.jitsi\.net)\/[a-zA-Z0-9_-]+/i,
  },
  // Discord (voice channel invites)
  {
    name: "Discord",
    pattern: /https:\/\/discord\.(?:gg|com\/invite)\/[a-zA-Z0-9]+/i,
  },
  // Slack Huddles
  {
    name: "Slack",
    pattern: /https:\/\/[\w-]+\.slack\.com\/(?:huddle|call)\/[a-zA-Z0-9./_-]+/i,
  },
  // Amazon Chime
  {
    name: "Amazon Chime",
    pattern: /https:\/\/(?:chime\.aws|app\.chime\.aws)\/meetings\/[a-zA-Z0-9-]+/i,
  },
  // BlueJeans
  {
    name: "BlueJeans",
    pattern: /https:\/\/(?:[\w-]+\.)?bluejeans\.com\/[0-9]+(?:\/[a-zA-Z0-9]+)?/i,
  },
  // RingCentral
  {
    name: "RingCentral",
    pattern: /https:\/\/(?:[\w-]+\.)?ringcentral\.com\/(?:j|join)\/[0-9]+/i,
  },
  // Loom (video messages with optional meeting context)
  {
    name: "Loom",
    pattern: /https:\/\/www\.loom\.com\/share\/[a-zA-Z0-9]+/i,
  },
  // Around
  {
    name: "Around",
    pattern: /https:\/\/meet\.around\.co\/r\/[a-zA-Z0-9_-]+/i,
  },
  // Skype
  {
    name: "Skype",
    pattern: /https:\/\/(?:join\.skype\.com|meet\.lync\.com)\/[a-zA-Z0-9./_-]+/i,
  },
  // Gather.town
  {
    name: "Gather",
    pattern: /https:\/\/(?:gather\.town|app\.gather\.town)\/app\/[a-zA-Z0-9./_-]+/i,
  },
  // Tuple (pair programming)
  {
    name: "Tuple",
    pattern: /https:\/\/tuple\.app\/[a-zA-Z0-9./_-]+/i,
  },
  // Pop (screen sharing)
  {
    name: "Pop",
    pattern: /https:\/\/pop\.com\/[a-zA-Z0-9_-]+/i,
  },
  // Riverside.fm (podcast recording)
  {
    name: "Riverside",
    pattern: /https:\/\/riverside\.fm\/studio\/[a-zA-Z0-9_-]+/i,
  },
  // Streamyard
  {
    name: "StreamYard",
    pattern: /https:\/\/streamyard\.com\/[a-zA-Z0-9]+/i,
  },
];

/**
 * Extracts video conference URLs from text.
 * Supports: Zoom, Google Meet, Microsoft Teams, Webex, GoToMeeting,
 * Whereby, Jitsi, Discord, Slack Huddles, Amazon Chime, BlueJeans,
 * RingCentral, Loom, Around, Skype, Gather, Tuple, Pop, Riverside, StreamYard.
 *
 * @param text Text to search for meeting URLs.
 * @returns First matching meeting URL found, or undefined.
 */
export function extractMeetingUrl(text: string | null | undefined): string | undefined {
  if (!text) return undefined;

  for (const { pattern } of MEETING_URL_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return match[0];
    }
  }

  return undefined;
}

/**
 * Extracts meeting URL with service name identification.
 * Useful for logging and debugging.
 *
 * @param text Text to search for meeting URLs.
 * @returns Object with URL and service name, or undefined.
 */
export function extractMeetingUrlWithService(
  text: string | null | undefined
): { url: string; service: string } | undefined {
  if (!text) return undefined;

  for (const { name, pattern } of MEETING_URL_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return { url: match[0], service: name };
    }
  }

  return undefined;
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
 * Yields to main thread periodically to prevent UI freezing with large calendars.
 *
 * @param content Raw .ics file content.
 * @param calendarName Name to use for the calendar.
 */
export async function parseICalContent(content: string, calendarName: string): Promise<ICalEvent[]> {
  const events: ICalEvent[] = [];

  try {
    // Yield before heavy parsing operation
    await yieldToMain();

    const jcalData = ICAL.parse(content);
    const comp = new ICAL.Component(jcalData);

    // Yield after parsing jcal data
    await yieldToMain();

    // Get calendar name from X-WR-CALNAME if not provided
    const calName = calendarName || comp.getFirstPropertyValue("x-wr-calname") || "Calendar";

    const vevents = comp.getAllSubcomponents("vevent");

    for (let i = 0; i < vevents.length; i++) {
      const vevent = vevents[i];

      try {
        const event = new ICAL.Event(vevent);

        const location = event.location || "";
        const url = String(vevent.getFirstPropertyValue("url") || "");
        const description = event.description || "";

        // Extract attendees
        const attendees: { name: string; email: string }[] = [];
        if (event.attendees && event.attendees.length > 0) {
          for (const att of event.attendees) {
            // att has multiple properties, jCal is one way to access them.
            // But usually ical.js exposes common properties on the wrapper.
            // Let's use getParameter for CN as it is the standard way.

            // The 'att' object in the loop over event.attendees is typically an ICAL.Property if event.attendees is populated via strict mode or similar,
            // but ical.js's high-level Event class usually returns plain objects or wrappers?
            // Checking ical.js documentation or source is tricky without internet, but typically:
            // event.attendees returns an array of ICAL.Property objects.

            const emailRaw = att.jCal ? att.jCal[3] : ""; // Fallback to raw jCal value if available
            // Correct way to get parameter in ical.js Property:
            const cn = (att.getParameter ? att.getParameter("cn") : "") as string;

            // If jCal is not direct, try to get the value
            const emailValue = typeof att.getValues === "function" ? att.getValues()[0] : emailRaw;

            // Skip if no useful info
            if (!emailValue && !cn) continue;

            attendees.push({
              name: cn,
              // Clean up mailto: prefix if present
              email: String(emailValue).replace(/^mailto:/i, ""),
            });
          }
        }

        // Try to find meeting URL in location, description, or explicit URL property
        const meetingUrl =
          extractMeetingUrl(location) ||
          extractMeetingUrl(description) ||
          extractMeetingUrl(url);

        const icalEvent: ICalEvent = {
          uid: event.uid || "",
          summary: event.summary || "",
          description: description,
          dtstart: icalTimeToDate(event.startDate),
          dtend: icalTimeToDate(event.endDate),
          location: location,
          url: url,
          meetingUrl: meetingUrl,
          attendees,
        };

        if (icalEvent.uid) {
          events.push(icalEvent);
        }
      } catch (eventError) {
        logDebug("parse_event_error", { error: String(eventError) });
      }

      // Yield periodically to prevent UI freezing
      if ((i + 1) % PARSE_YIELD_BATCH_SIZE === 0) {
        await yieldToMain();
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
 * Builds the proxied URL using Roam's native CORS proxy.
 * Format: {proxyUrl}/{targetUrl}
 * @see https://roamresearch.com/#/app/developer-documentation/page/TuLoib22N
 * @param targetUrl The target URL to proxy
 */
function buildProxiedUrl(targetUrl: string): string {
  const proxyUrl = getRoamProxyUrl();
  return `${proxyUrl}/${targetUrl}`;
}

/**
 * Result from an incremental fetch operation.
 */
export interface IncrementalFetchResult {
  content: string;
  changed: boolean;
  cached: boolean;
  etag?: string;
  lastModified?: string;
}

/**
 * Fetches content through Roam's native CORS proxy with incremental sync support.
 * Uses ETag/Last-Modified headers and content hashing to detect changes.
 * Yields to main thread before and after fetch to prevent UI freezing.
 *
 * @param url Original URL to fetch.
 * @param forceRefresh If true, ignores cache and fetches fresh content.
 */
async function fetchWithCorsProxy(url: string, forceRefresh = false): Promise<IncrementalFetchResult> {
  const proxyUrl = buildProxiedUrl(url);
  const cacheEntry = calendarCache.get(url);

  logDebug("fetch_with_proxy", {
    originalUrl: url,
    proxyUrl,
    hasCacheEntry: !!cacheEntry,
    forceRefresh,
  });

  // Yield before fetch to ensure UI is responsive
  await yieldToMain();

  // Build request headers for conditional fetch
  const headers: HeadersInit = {};
  if (!forceRefresh && cacheEntry) {
    if (cacheEntry.etag) {
      headers["If-None-Match"] = cacheEntry.etag;
    }
    if (cacheEntry.lastModified) {
      headers["If-Modified-Since"] = cacheEntry.lastModified;
    }
  }

  const response = await fetch(proxyUrl, { headers });

  // Yield after fetch completes
  await yieldToMain();

  // Handle 304 Not Modified - content hasn't changed
  if (response.status === 304 && cacheEntry) {
    logInfo(`Calendar unchanged (304): ${url}`);

    // Update last fetched time
    cacheEntry.lastFetched = Date.now();
    calendarCache.set(url, cacheEntry);

    return {
      content: "", // Empty content signals no change
      changed: false,
      cached: true,
      etag: cacheEntry.etag,
      lastModified: cacheEntry.lastModified,
    };
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const text = await response.text();

  // Yield after reading response body
  await yieldToMain();

  // Extract caching headers
  const etag = response.headers.get("ETag") ?? undefined;
  const lastModified = response.headers.get("Last-Modified") ?? undefined;
  const contentHash = hashContent(text);

  // Check if content actually changed (even if server doesn't support conditional requests)
  const contentChanged = !cacheEntry || cacheEntry.contentHash !== contentHash;

  if (!contentChanged) {
    logInfo(`Calendar unchanged (hash match): ${url}`);
  } else {
    logDebug("content_changed", {
      url,
      oldHash: cacheEntry?.contentHash,
      newHash: contentHash,
    });
  }

  // Update cache
  calendarCache.set(url, {
    url,
    etag,
    lastModified,
    contentHash,
    lastFetched: Date.now(),
  });

  return {
    content: text,
    changed: contentChanged,
    cached: false,
    etag,
    lastModified,
  };
}

/**
 * Result from fetching an iCal calendar with incremental sync info.
 */
export interface ICalCalendarResult extends ICalCalendar {
  /** Whether the calendar content changed since last fetch */
  changed: boolean;
  /** Whether the result came from cache (304 Not Modified) */
  cached: boolean;
}

/**
 * Stored events cache for calendars that haven't changed.
 * Used to return previous events when content hasn't changed.
 */
const eventsCache = new Map<string, ICalEvent[]>();

/**
 * Fetches and parses an iCal feed from a URL.
 * Uses Roam's native CORS proxy (roamAlphaAPI.constants.corsAnywhereProxyUrl).
 * Supports incremental sync by detecting unchanged content.
 * Yields to main thread to prevent UI freezing.
 *
 * @param config Calendar configuration with name and URL.
 * @param forceRefresh If true, ignores cache and fetches fresh content.
 */
export async function fetchICalCalendar(
  config: CalendarConfig,
  forceRefresh = false
): Promise<ICalCalendarResult> {
  logDebug("fetch_ical_start", { name: config.name, url: config.url, forceRefresh });

  try {
    const fetchResult = await fetchWithCorsProxy(config.url, forceRefresh);

    // If content hasn't changed, return cached events
    if (!fetchResult.changed) {
      const cachedEvents = eventsCache.get(config.url) ?? [];
      logDebug("fetch_ical_cached", {
        name: config.name,
        eventsCount: cachedEvents.length,
        cached: fetchResult.cached,
      });

      return {
        name: config.name,
        url: config.url,
        events: cachedEvents,
        changed: false,
        cached: fetchResult.cached,
      };
    }

    // Yield before parsing
    await yieldToMain();

    const events = await parseICalContent(fetchResult.content, config.name);

    // Cache the parsed events
    eventsCache.set(config.url, events);

    logDebug("fetch_ical_complete", {
      name: config.name,
      eventsCount: events.length,
      changed: true,
    });

    return {
      name: config.name,
      url: config.url,
      events,
      changed: true,
      cached: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`Failed to fetch calendar "${config.name}"`, { url: config.url, error: message });
    throw error;
  }
}

/**
 * Result from fetching all calendars with sync statistics.
 */
export interface FetchAllResult {
  calendars: ICalCalendarResult[];
  stats: {
    total: number;
    changed: number;
    cached: number;
    failed: number;
  };
}

/**
 * Fetches multiple iCal calendars sequentially with yields between each.
 * Sequential processing prevents UI freezing when parsing multiple large calendars.
 * Uses Roam's native CORS proxy (roamAlphaAPI.constants.corsAnywhereProxyUrl).
 * Supports incremental sync by tracking which calendars have changed.
 *
 * @param configs Array of calendar configurations.
 * @param forceRefresh If true, ignores cache and fetches fresh content for all calendars.
 */
export async function fetchAllCalendars(
  configs: CalendarConfig[],
  forceRefresh = false
): Promise<FetchAllResult> {
  if (configs.length === 0) {
    return {
      calendars: [],
      stats: { total: 0, changed: 0, cached: 0, failed: 0 },
    };
  }

  const calendars: ICalCalendarResult[] = [];
  let changed = 0;
  let cached = 0;
  let failed = 0;

  // Process calendars sequentially to prevent UI blocking
  // Each calendar fetch/parse already yields internally
  for (let i = 0; i < configs.length; i++) {
    const config = configs[i];

    try {
      const calendar = await fetchICalCalendar(config, forceRefresh);
      calendars.push(calendar);

      if (calendar.changed) {
        changed++;
      }
      if (calendar.cached) {
        cached++;
      }

      // Yield between calendars to ensure UI responsiveness
      await yieldToMain();
    } catch (error) {
      logError(`Calendar fetch failed: ${config.name}`, error);
      failed++;
      // Continue with next calendar on error
    }
  }

  const stats = {
    total: configs.length,
    changed,
    cached,
    failed,
  };

  logDebug("fetch_all_complete", stats);

  return { calendars, stats };
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
 * Yields to main thread periodically to prevent UI freezing.
 *
 * @param events Array of iCal events to filter.
 * @param excludePatterns Array of regex patterns for exclusion.
 * @returns New filtered array (does not mutate input).
 */
export async function filterExcludedEvents(
  events: ICalEvent[],
  excludePatterns: RegExp[]
): Promise<ICalEvent[]> {
  if (excludePatterns.length === 0) return events;

  const filtered: ICalEvent[] = [];

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const excluded = shouldExcludeEvent(event.summary, excludePatterns);

    if (excluded) {
      logDebug("event_excluded", { title: event.summary, uid: event.uid });
    } else {
      filtered.push(event);
    }

    // Yield periodically to prevent UI freezing
    if ((i + 1) % PARSE_YIELD_BATCH_SIZE === 0) {
      await yieldToMain();
    }
  }

  return filtered;
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
 * Yields to main thread periodically to prevent UI freezing with large event lists.
 *
 * @param events Array of iCal events to filter.
 * @param config Date range configuration.
 * @returns New filtered array (does not mutate input).
 */
export async function filterEventsByDateRange(
  events: ICalEvent[],
  config: DateRangeConfig
): Promise<ICalEvent[]> {
  const beforeCount = events.length;
  const filtered: ICalEvent[] = [];

  for (let i = 0; i < events.length; i++) {
    if (isEventInDateRange(events[i], config)) {
      filtered.push(events[i]);
    }

    // Yield periodically to prevent UI freezing
    if ((i + 1) % PARSE_YIELD_BATCH_SIZE === 0) {
      await yieldToMain();
    }
  }

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
