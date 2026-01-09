/**
 * Event search functionality for finding events in Roam.
 * Searches through synced event pages and blocks.
 */

import {
  getPageTitlesStartingWithPrefix,
  getPageUidByPageTitle,
  getBasicTreeByParentUid,
  type RoamBasicNode,
} from "./roam-api";
import { ICAL_ID_PROPERTY, ICAL_LOCATION_PROPERTY, ICAL_ATTENDEES_PROPERTY } from "./constants";
import { logDebug } from "./logger";

/**
 * Search query parameters.
 */
export interface EventSearchQuery {
  /** Search in event title */
  title?: string;
  /** Filter by date range start */
  dateStart?: Date;
  /** Filter by date range end */
  dateEnd?: Date;
  /** Search for specific attendee */
  attendee?: string;
  /** Search in location */
  location?: string;
  /** Filter by calendar name */
  calendar?: string;
}

/**
 * A search result representing a found event.
 */
export interface EventSearchResult {
  /** Title of the page containing the event */
  pageTitle: string;
  /** UID of the page */
  pageUid: string;
  /** UID of the event block */
  blockUid: string;
  /** Event ID from ical-id property */
  eventId: string;
  /** Event title/summary */
  title: string;
  /** Event date as string */
  date: string;
  /** Calendar name */
  calendar: string;
  /** Location if available */
  location?: string;
  /** Attendees if available */
  attendees?: string[];
}

/**
 * Extracts a property value from a node's children.
 *
 * @param node Parent node to search.
 * @param property Property key to find.
 * @returns Property value or undefined.
 */
function extractProperty(node: RoamBasicNode, property: string): string | undefined {
  for (const child of node.children ?? []) {
    if (child.text.startsWith(`${property}::`)) {
      return child.text.slice(property.length + 2).trim();
    }
  }
  return undefined;
}

/**
 * Extracts the date reference from block text.
 * Looks for [[Date]] pattern.
 *
 * @param text Block text to search.
 * @returns Extracted date string or undefined.
 */
function extractDateFromText(text: string): string | undefined {
  const match = text.match(/\[\[([^\]]+)\]\]/);
  return match ? match[1] : undefined;
}

/**
 * Extracts the calendar name from block text.
 * Looks for #calendar-name pattern.
 *
 * @param text Block text to search.
 * @returns Calendar name or undefined.
 */
function extractCalendarFromText(text: string): string | undefined {
  // Match the last hashtag (calendar tag is usually at the end)
  const matches = text.match(/#([a-z0-9-_]+)/gi);
  if (matches && matches.length > 0) {
    // The calendar tag is typically the last tag
    const lastTag = matches[matches.length - 1];
    return lastTag.slice(1); // Remove #
  }
  return undefined;
}

/**
 * Extracts the event title from block text.
 * Removes date references, tags, and time information.
 *
 * @param text Block text to search.
 * @returns Event title.
 */
function extractTitleFromText(text: string): string {
  let title = text;

  // Remove date references [[...]]
  title = title.replace(/\[\[[^\]]+\]\]/g, "");

  // Remove hashtags #...
  title = title.replace(/#[a-z0-9-_]+/gi, "");

  // Remove time patterns like 10:00-11:00 or 10:00 AM-11:00 PM
  title = title.replace(/\d{1,2}:\d{2}(?:\s*(?:AM|PM))?(?:\s*-\s*\d{1,2}:\d{2}(?:\s*(?:AM|PM))?)?/gi, "");

  // Remove timezone abbreviations
  title = title.replace(/\b[A-Z]{2,4}\b/g, "");

  // Remove recurring indicators
  title = title.replace(/🔄/g, "");

  // Clean up whitespace
  title = title.replace(/\s+/g, " ").trim();

  return title;
}

/**
 * Parses attendees from the ical-attendees property value.
 *
 * @param value Property value string.
 * @returns Array of attendee names.
 */
function parseAttendees(value: string): string[] {
  if (!value) return [];

  // Attendees are comma-separated page references like [[@Name1]], [[@Name2]]
  const matches = value.match(/\[\[@?([^\]]+)\]\]/g);
  if (!matches) return [];

  return matches.map((m) => {
    // Remove [[ ]] and @ prefix
    return m.replace(/^\[\[@?/, "").replace(/\]\]$/, "");
  });
}

/**
 * Checks if a search result matches the query.
 *
 * @param result Search result to check.
 * @param query Search query.
 * @returns True if result matches query.
 */
export function matchesQuery(result: EventSearchResult, query: EventSearchQuery): boolean {
  // Title search (case-insensitive)
  if (query.title) {
    const searchTerm = query.title.toLowerCase();
    if (!result.title.toLowerCase().includes(searchTerm)) {
      return false;
    }
  }

  // Date range filter
  if (query.dateStart || query.dateEnd) {
    const eventDate = parseRoamDate(result.date);
    if (eventDate) {
      if (query.dateStart && eventDate < query.dateStart) {
        return false;
      }
      if (query.dateEnd && eventDate > query.dateEnd) {
        return false;
      }
    }
  }

  // Attendee search (case-insensitive)
  if (query.attendee && result.attendees) {
    const searchTerm = query.attendee.toLowerCase();
    const hasAttendee = result.attendees.some((a) =>
      a.toLowerCase().includes(searchTerm)
    );
    if (!hasAttendee) {
      return false;
    }
  }

  // Location search (case-insensitive)
  if (query.location && result.location) {
    const searchTerm = query.location.toLowerCase();
    if (!result.location.toLowerCase().includes(searchTerm)) {
      return false;
    }
  }

  // Calendar filter (case-insensitive)
  if (query.calendar) {
    const searchTerm = query.calendar.toLowerCase();
    if (!result.calendar.toLowerCase().includes(searchTerm)) {
      return false;
    }
  }

  return true;
}

/**
 * Parses a Roam date string (e.g., "January 15th, 2025") to a Date object.
 *
 * @param dateStr Roam date string.
 * @returns Date object or undefined if parsing fails.
 */
function parseRoamDate(dateStr: string): Date | undefined {
  if (!dateStr) return undefined;

  // Remove ordinal suffixes (st, nd, rd, th)
  const cleaned = dateStr.replace(/(\d+)(st|nd|rd|th)/, "$1");

  const parsed = new Date(cleaned);
  return isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Searches for events across all synced calendar pages.
 *
 * @param query Search query parameters.
 * @param pagePrefix Page prefix for event pages.
 * @returns Array of matching search results.
 */
export async function searchEvents(
  query: EventSearchQuery,
  pagePrefix: string
): Promise<EventSearchResult[]> {
  const results: EventSearchResult[] = [];

  // Get all event pages
  const prefix = `${pagePrefix}/`;
  const pageTitles = getPageTitlesStartingWithPrefix(prefix);

  logDebug("search_events_start", {
    query,
    pageCount: pageTitles.length,
  });

  for (const pageTitle of pageTitles) {
    const pageUid = getPageUidByPageTitle(pageTitle);
    if (!pageUid) continue;

    const tree = getBasicTreeByParentUid(pageUid);

    // Parse page title to extract calendar name
    // Format: prefix/calendarName/eventId
    const parts = pageTitle.split("/");
    const calendarName = parts.length >= 2 ? parts[1] : "Unknown";

    for (const node of tree) {
      // Check if this is an event block (has ical-id property)
      const eventId = extractProperty(node, ICAL_ID_PROPERTY);
      if (!eventId) continue;

      const date = extractDateFromText(node.text);
      const title = extractTitleFromText(node.text);
      const calendar = extractCalendarFromText(node.text) ?? calendarName;
      const location = extractProperty(node, ICAL_LOCATION_PROPERTY);
      const attendeesRaw = extractProperty(node, ICAL_ATTENDEES_PROPERTY);
      const attendees = attendeesRaw ? parseAttendees(attendeesRaw) : undefined;

      const result: EventSearchResult = {
        pageTitle,
        pageUid,
        blockUid: node.uid,
        eventId,
        title: title || "Untitled Event",
        date: date ?? "",
        calendar,
        location,
        attendees,
      };

      // Check if result matches query
      if (matchesQuery(result, query)) {
        results.push(result);
      }
    }
  }

  // Sort by date (most recent first)
  results.sort((a, b) => {
    const dateA = parseRoamDate(a.date);
    const dateB = parseRoamDate(b.date);
    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;
    return dateB.getTime() - dateA.getTime();
  });

  logDebug("search_events_complete", {
    resultsCount: results.length,
  });

  return results;
}

/**
 * Searches for events happening today.
 *
 * @param pagePrefix Page prefix for event pages.
 * @returns Array of today's events.
 */
export async function searchTodayEvents(
  pagePrefix: string
): Promise<EventSearchResult[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  return searchEvents(
    {
      dateStart: today,
      dateEnd: tomorrow,
    },
    pagePrefix
  );
}

/**
 * Searches for events in the next N days.
 *
 * @param pagePrefix Page prefix for event pages.
 * @param days Number of days to look ahead.
 * @returns Array of upcoming events.
 */
export async function searchUpcomingEvents(
  pagePrefix: string,
  days: number
): Promise<EventSearchResult[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const future = new Date(today);
  future.setDate(future.getDate() + days);

  return searchEvents(
    {
      dateStart: today,
      dateEnd: future,
    },
    pagePrefix
  );
}

/**
 * Formats a search result for display.
 *
 * @param result Search result to format.
 * @returns Formatted string for display.
 */
export function formatSearchResult(result: EventSearchResult): string {
  let formatted = `**${result.title}**`;

  if (result.date) {
    formatted += ` - ${result.date}`;
  }

  if (result.calendar) {
    formatted += ` (#${result.calendar})`;
  }

  if (result.location) {
    formatted += `\n  📍 ${result.location}`;
  }

  if (result.attendees && result.attendees.length > 0) {
    formatted += `\n  👥 ${result.attendees.join(", ")}`;
  }

  return formatted;
}
