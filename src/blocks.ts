import {
  getBasicTreeByParentUid,
  getPageUidByPageTitle,
  getPageTitlesStartingWithPrefix,
  createPage,
  createBlock,
  updateBlock,
  deleteBlock,
  delay,
  maybeYield,
  MUTATION_DELAY_MS,
  type RoamBasicNode,
  type InputTextNode,
} from "./settings";

import {
  ICAL_ID_PROPERTY,
  ICAL_DESC_PROPERTY,
  ICAL_LOCATION_PROPERTY,
  ICAL_URL_PROPERTY,
  ICAL_MEETING_URL_PROPERTY,
  ICAL_ATTENDEES_PROPERTY,
  ICAL_END_PROPERTY,
  ICAL_TIMEZONE_PROPERTY,
  ICAL_COLOR_PROPERTY,
  DEFAULT_BATCH_SIZE,
  DEFAULT_BATCH_DELAY_MS,
  DEFAULT_TITLE_PREFIX,
  DEFAULT_SHOW_TIME,
  DEFAULT_TIME_FORMAT,
  DEFAULT_RECURRING_INDICATOR,
  DEFAULT_SHOW_TIMEZONE,
} from "./constants";

import {
  type ICalEvent,
  type ICalCalendar,
  type TimeFormat,
  formatRoamDate,
  formatTime,
  formatTimeWithTimezone,
  safeText,
  sanitizeEventId,
  sortEventsByDateDescending,
  filterExcludedEvents,
} from "./ical";

import { logDebug, logInfo } from "./logger";

/**
 * Session cache for page UIDs created during this sync.
 * This avoids race conditions where getPageUidByPageTitle
 * returns undefined for a page we just created.
 */
const pageUidCache = new Map<string, string>();

/**
 * Clears the page UID cache. Call this at the start of each sync.
 */
export function clearPageCache(): void {
  pageUidCache.clear();
}

type BlockPayload = {
  text: string;
  children: BlockPayload[];
};

type EventWithBlock = {
  event: ICalEvent;
  calendarName: string;
  block: BlockPayload;
};

/**
 * Configuration for batch processing during sync.
 */
export type BatchConfig = {
  batchSize: number;
  batchDelayMs: number;
  excludePatterns: RegExp[];
  titlePrefix: string;
  attendeeAliases: Map<string, string>;
  // Time display settings
  showTime: boolean;
  timeFormat: TimeFormat;
  // Recurring event indicator
  recurringIndicator: string;
  // Timezone settings
  showTimezone: boolean;
};

/**
 * Progress callback for batch processing.
 */
export type BatchProgressCallback = (processed: number, total: number) => void;

/**
 * Creates a property block with the standard format `key:: value`.
 */
function createPropertyBlock(key: string, value: string): BlockPayload {
  return { text: `${key}:: ${value}`, children: [] };
}

/**
 * Extracts ical-id from text content.
 */
function extractICalId(content: string): string | undefined {
  const match = content.match(new RegExp(`^${ICAL_ID_PROPERTY}::\\s*(.+)$`, "mi"));
  return match ? match[1].trim() : undefined;
}

/**
 * Extracts ical-id from a node, checking both main text and children.
 */
function extractICalIdFromNode(node: RoamBasicNode): string | undefined {
  let id = extractICalId(node.text ?? "");
  if (id) return id;

  for (const child of node.children ?? []) {
    id = extractICalId(child.text ?? "");
    if (id) return id;
  }
  return undefined;
}

/**
 * Extracts ical-id from a BlockPayload.
 */
function extractICalIdFromBlock(block: BlockPayload): string | undefined {
  let id = extractICalId(block.text ?? "");
  if (id) return id;

  for (const child of block.children ?? []) {
    id = extractICalId(child.text ?? "");
    if (id) return id;
  }
  return undefined;
}

/**
 * Determines the destination page name for an event.
 * Format: prefix/calendarName/eventId
 *
 * @param event iCal event.
 * @param calendarName Name of the calendar.
 * @param pagePrefix Base page name prefix from settings.
 */
export function resolveEventPageName(
  event: ICalEvent,
  calendarName: string,
  pagePrefix: string
): string {
  const sanitizedId = sanitizeEventId(event.uid);
  return `${pagePrefix}/${calendarName}/${sanitizedId}`;
}

/**
 * Writes calendar events to their dedicated Roam pages.
 * Events are sorted by date (most recent first) and processed in batches
 * to prevent UI freezing with large calendars.
 *
 * @param pagePrefix Base page name prefix from settings.
 * @param calendars Array of calendars with their events.
 * @param batchConfig Optional batch configuration (defaults to constants).
 * @param onProgress Optional callback for progress updates.
 */
export async function writeBlocks(
  pagePrefix: string,
  calendars: ICalCalendar[],
  batchConfig?: BatchConfig,
  onProgress?: BatchProgressCallback
): Promise<void> {
  // Clear page cache at start of each sync to ensure fresh state
  clearPageCache();

  const config: BatchConfig = {
    batchSize: batchConfig?.batchSize ?? DEFAULT_BATCH_SIZE,
    batchDelayMs: batchConfig?.batchDelayMs ?? DEFAULT_BATCH_DELAY_MS,
    excludePatterns: batchConfig?.excludePatterns ?? [],
    titlePrefix: batchConfig?.titlePrefix ?? DEFAULT_TITLE_PREFIX,
    attendeeAliases: batchConfig?.attendeeAliases ?? new Map(),
    showTime: batchConfig?.showTime ?? DEFAULT_SHOW_TIME,
    timeFormat: batchConfig?.timeFormat ?? DEFAULT_TIME_FORMAT,
    recurringIndicator: batchConfig?.recurringIndicator ?? DEFAULT_RECURRING_INDICATOR,
    showTimezone: batchConfig?.showTimezone ?? DEFAULT_SHOW_TIMEZONE,
  };

  // Collect all events from all calendars
  const allEvents: { event: ICalEvent; calendarName: string; calendarColor?: string }[] = [];
  for (const calendar of calendars) {
    // Filter out excluded events before processing (async to yield during filtering)
    const filteredEvents = await filterExcludedEvents(calendar.events, config.excludePatterns);
    for (const event of filteredEvents) {
      allEvents.push({ event, calendarName: calendar.name, calendarColor: calendar.color });
    }
  }

  // Sort events by date (most recent first)
  const sortedEvents = sortEventsByDateDescending(allEvents.map((e) => e.event));

  // Create maps to find calendar info by event UID
  const eventCalendarMap = new Map<string, { name: string; color?: string }>();
  for (const { event, calendarName, calendarColor } of allEvents) {
    eventCalendarMap.set(event.uid, { name: calendarName, color: calendarColor });
  }

  // Build events with blocks in sorted order
  const sortedEventsWithBlocks: EventWithBlock[] = sortedEvents.map((event) => {
    const calendarInfo = eventCalendarMap.get(event.uid) ?? { name: "Unknown" };
    const block = buildEventBlock(event, calendarInfo.name, config, calendarInfo.color);
    return { event, calendarName: calendarInfo.name, block };
  });

  const totalEvents = sortedEventsWithBlocks.length;

  logDebug("write_blocks_start", {
    totalEvents,
    batchSize: config.batchSize,
    batchDelayMs: config.batchDelayMs,
  });

  // Process events in batches
  let processedCount = 0;
  for (let i = 0; i < sortedEventsWithBlocks.length; i += config.batchSize) {
    const batch = sortedEventsWithBlocks.slice(i, i + config.batchSize);

    // Group batch events by page
    const batchByPage = new Map<string, EventWithBlock[]>();
    for (const ewb of batch) {
      const pageName = resolveEventPageName(ewb.event, ewb.calendarName, pagePrefix);
      if (!batchByPage.has(pageName)) {
        batchByPage.set(pageName, []);
      }
      batchByPage.get(pageName)!.push(ewb);
    }

    // Write batch events to their pages
    for (const [pageName, eventsWithBlocks] of batchByPage.entries()) {
      const blocks = eventsWithBlocks.map((e) => e.block);
      await writeBlocksToPage(pageName, blocks);
    }

    processedCount += batch.length;

    // Report progress
    if (onProgress) {
      onProgress(processedCount, totalEvents);
    }

    logDebug("batch_processed", {
      batchNumber: Math.floor(i / config.batchSize) + 1,
      batchEvents: batch.length,
      processedCount,
      totalEvents,
    });

    // Delay between batches to allow UI to breathe
    if (i + config.batchSize < sortedEventsWithBlocks.length && config.batchDelayMs > 0) {
      await delay(config.batchDelayMs);
    }
  }

  // Build final map for cleanup (need all events, not just processed)
  const eventsByPage = new Map<string, EventWithBlock[]>();
  for (const ewb of sortedEventsWithBlocks) {
    const pageName = resolveEventPageName(ewb.event, ewb.calendarName, pagePrefix);
    if (!eventsByPage.has(pageName)) {
      eventsByPage.set(pageName, []);
    }
    eventsByPage.get(pageName)!.push(ewb);
  }

  await cleanupObsoletePages(pagePrefix, eventsByPage);

  logDebug("write_blocks_complete", {
    totalEvents,
    pageCount: eventsByPage.size,
  });
}

/**
 * Sanitizes a calendar name for use as a Roam tag.
 * Removes special characters and replaces spaces with hyphens.
 *
 * @param name Calendar name to sanitize.
 * @returns Safe tag name.
 */
function sanitizeTagName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "");
}

/**
 * Attendee info extracted from iCal event.
 */
interface AttendeeInfo {
  name: string;
  email: string;
}

/**
 * Extracts a clean display name from an attendee.
 * Handles various edge cases like email-as-name, mailto: prefixes, etc.
 *
 * @param attendee Attendee info from iCal event.
 * @returns Clean display name or undefined if not extractable.
 */
function extractAttendeeDisplayName(attendee: AttendeeInfo): string | undefined {
  // Clean up email by removing mailto: prefix
  const cleanEmail = attendee.email?.replace(/^mailto:/i, "").trim() || "";
  const name = attendee.name?.trim() || "";

  // Case 1: Name is provided and is not an email address
  if (name && !name.includes("@")) {
    return name;
  }

  // Case 2: Name looks like an email - extract from email part
  const emailToUse = name.includes("@") ? name : cleanEmail;
  if (!emailToUse) {
    return undefined;
  }

  // Extract local part before @ and format it
  const localPart = emailToUse.split("@")[0];
  if (!localPart) {
    return undefined;
  }

  // Convert "john.doe" or "john_doe" or "john-doe" to "John Doe"
  return localPart
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Builds Roam page references for attendees.
 * Handles alias mapping and formats names as proper page references.
 *
 * @param attendees Array of attendee info from iCal event.
 * @param aliases Map of name/email to Roam page names.
 * @returns Array of formatted page reference strings.
 */
function buildAttendeeReferences(
  attendees: AttendeeInfo[],
  aliases?: Map<string, string>
): string[] {
  const references: string[] = [];

  for (const attendee of attendees) {
    // Clean email for alias lookup
    const cleanEmail = attendee.email?.replace(/^mailto:/i, "").trim().toLowerCase() || "";
    const cleanName = attendee.name?.trim().toLowerCase() || "";

    // 1. Check aliases first (by name or email)
    let pageName = aliases?.get(cleanName) || aliases?.get(cleanEmail);

    if (pageName) {
      // Ensure alias has proper Roam brackets
      if (!pageName.startsWith("[[") && !pageName.startsWith("http")) {
        pageName = `[[${pageName}]]`;
      }
      references.push(pageName);
      continue;
    }

    // 2. Extract display name and create page reference
    const displayName = extractAttendeeDisplayName(attendee);
    if (displayName) {
      // Format as @mention style: [[@Name]]
      references.push(`[[@${displayName}]]`);
    }
  }

  // Remove duplicates while preserving order
  return [...new Set(references)];
}

/**
 * Builds the time range string for an event.
 * Format: "10:00-11:30" or "10:00 AM-11:30 AM" depending on format.
 * Returns empty string if no start time or if all-day event.
 */
function buildTimeRangeString(
  event: ICalEvent,
  config: BatchConfig
): string {
  if (!config.showTime || event.isAllDay || !event.dtstart) {
    return "";
  }

  const startTime = config.showTimezone && event.dtstartTzid
    ? formatTimeWithTimezone(event.dtstart, config.timeFormat, event.dtstartTzid)
    : formatTime(event.dtstart, config.timeFormat);

  if (!event.dtend) {
    return startTime;
  }

  // If same day, show end time without timezone (to avoid redundancy)
  const startDate = formatRoamDate(event.dtstart);
  const endDate = formatRoamDate(event.dtend);

  if (startDate === endDate) {
    const endTime = formatTime(event.dtend, config.timeFormat);
    return `${startTime}-${endTime}`;
  }

  return startTime;
}

/**
 * Sanitizes a hex color code for use as a Roam tag.
 * Removes the # prefix to create a valid tag name.
 *
 * @param color Hex color code (e.g., "#4285f4").
 * @returns Sanitized tag name (e.g., "color-4285f4").
 */
function sanitizeColorTag(color: string): string {
  // Remove # prefix and create color tag
  const cleanColor = color.replace(/^#/, "").toLowerCase();
  return `color-${cleanColor}`;
}

/**
 * Builds the block content for an event.
 * Format: [prefix] [[Date]] [time] Event Title [recurring] #calendarName [#color-xxx]
 *
 * @param event iCal event to format.
 * @param calendarName Calendar name to use as tag.
 * @param config Batch configuration including time/timezone/recurring settings.
 * @param calendarColor Optional color for the calendar (hex code or color name).
 */
function buildEventBlock(
  event: ICalEvent,
  calendarName: string,
  config: BatchConfig,
  calendarColor?: string
): BlockPayload {
  const dateText = event.dtstart ? formatRoamDate(event.dtstart) : "No date";
  const title = safeText(event.summary) || "Untitled event";
  const calendarTag = sanitizeTagName(calendarName);
  const timeRange = buildTimeRangeString(event, config);
  const recurringIndicator = event.isRecurring && config.recurringIndicator
    ? ` ${config.recurringIndicator}`
    : "";

  // Build main text: [prefix] [[Date]] [time] Title [recurring] #tag
  const parts: string[] = [];

  // Add title prefix if present
  if (config.titlePrefix && config.titlePrefix.trim()) {
    parts.push(config.titlePrefix.trim());
  }

  // Add date
  parts.push(`[[${dateText}]]`);

  // Add time range if present
  if (timeRange) {
    parts.push(timeRange);
  }

  // Add title with recurring indicator and calendar tag
  let titleWithTags = `${title}${recurringIndicator} #${calendarTag}`;

  // Add color tag if calendar has a color
  if (calendarColor) {
    const colorTag = sanitizeColorTag(calendarColor);
    titleWithTags += ` #${colorTag}`;
  }

  parts.push(titleWithTags);

  const mainText = parts.join(" ");
  const children: BlockPayload[] = [];

  // Always add ical-id for identification
  children.push(createPropertyBlock(ICAL_ID_PROPERTY, event.uid));

  // Add description if present
  const description = safeText(event.description);
  if (description) {
    children.push(createPropertyBlock(ICAL_DESC_PROPERTY, description));
  }

  // Add location if present
  const location = safeText(event.location);
  if (location) {
    children.push(createPropertyBlock(ICAL_LOCATION_PROPERTY, location));
  }

  // Add meeting URL if present (detected from location/desc/url)
  if (event.meetingUrl) {
    children.push(
      createPropertyBlock(ICAL_MEETING_URL_PROPERTY, `**[JOIN MEETING](${event.meetingUrl})**`)
    );
  }

  // Add attendees using the dedicated helper function
  if (event.attendees && event.attendees.length > 0) {
    const attendeeLinks = buildAttendeeReferences(event.attendees, config.attendeeAliases);
    if (attendeeLinks.length > 0) {
      children.push(createPropertyBlock(ICAL_ATTENDEES_PROPERTY, attendeeLinks.join(", ")));
    }
  }

  // Add URL if present
  if (event.url) {
    children.push(createPropertyBlock(ICAL_URL_PROPERTY, `[link](${event.url})`));
  }

  // Add end date if present and different from start
  if (event.dtend) {
    const endText = formatRoamDate(event.dtend);
    if (endText !== dateText) {
      children.push(createPropertyBlock(ICAL_END_PROPERTY, `[[${endText}]]`));
    }
  }

  // Add timezone if enabled and available
  if (config.showTimezone && event.dtstartTzid) {
    children.push(createPropertyBlock(ICAL_TIMEZONE_PROPERTY, event.dtstartTzid));
  }

  // Add calendar color if defined
  if (calendarColor) {
    children.push(createPropertyBlock(ICAL_COLOR_PROPERTY, calendarColor));
  }

  return { text: mainText, children };
}

async function writeBlocksToPage(pageName: string, blocks: BlockPayload[]): Promise<void> {
  const pageUid = await ensurePage(pageName);
  const existingTree = getBasicTreeByParentUid(pageUid);
  const blockMap = buildBlockMap(existingTree);

  logDebug("write_blocks_to_page", {
    pageName,
    pageUid,
    existingBlocksCount: existingTree.length,
    newBlocksCount: blocks.length,
  });

  const seenIds = new Set<string>();
  let blockCount = 0;

  for (const block of blocks) {
    const icalId = extractICalIdFromBlock(block);
    if (!icalId) {
      continue;
    }

    // Extract date from block text for recurring event support
    // Block format: "[[Date]] Event Title #tag" or "#prefix [[Date]] Event Title #tag"
    const dateMatch = block.text.match(/\[\[([^\]]+)\]\]/);
    const eventDate = dateMatch ? dateMatch[1] : "";

    // Create unique key combining UID and date
    // This allows recurring events (same UID, different dates) to be stored separately
    const uniqueKey = `${icalId}_${eventDate}`;

    // Skip if we already processed this ical-id + date combination in this batch
    if (seenIds.has(uniqueKey)) {
      logDebug("skip_duplicate_event", { icalId, eventDate, pageName });
      continue;
    }
    seenIds.add(uniqueKey);

    const existing = blockMap.get(icalId);
    if (existing) {
      // Update main block text if changed
      if (existing.text !== block.text) {
        logDebug("update_existing_block", { icalId, uid: existing.uid });
        await updateBlock({ uid: existing.uid, text: block.text });
        await delay(MUTATION_DELAY_MS);
      }
      // Sync children (properties)
      await syncChildren(existing.uid, block.children);
    } else {
      logDebug("create_new_block", { icalId, pageName });
      await createBlock({
        parentUid: pageUid,
        order: "last",
        node: toInputNode(block),
      });
    }

    blockCount++;
    await maybeYield(blockCount);
  }

  await removeObsoleteBlocks(blockMap, seenIds);
}

/**
 * Attempts to find page UID with retries to handle eventual consistency.
 */
async function findPageUidWithRetry(
  pageName: string,
  maxRetries: number = 3
): Promise<string | undefined> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const uid = getPageUidByPageTitle(pageName);
    if (uid) {
      return uid;
    }
    if (attempt < maxRetries) {
      // Exponential backoff: 100ms, 200ms, 400ms
      const backoff = MUTATION_DELAY_MS * Math.pow(2, attempt);
      await delay(backoff);
    }
  }
  return undefined;
}

/**
 * Ensures a page exists, creating it if necessary.
 * Uses session cache and robust retry logic to handle Roam API eventual consistency.
 */
async function ensurePage(pageName: string): Promise<string> {
  // Check session cache first (handles pages we just created)
  const cachedUid = pageUidCache.get(pageName);
  if (cachedUid) {
    return cachedUid;
  }

  // Check if page already exists in Roam
  const existingUid = getPageUidByPageTitle(pageName);
  if (existingUid) {
    pageUidCache.set(pageName, existingUid);
    return existingUid;
  }

  // Try to create the page, handle "already exists" error gracefully
  try {
    const uid = await createPage({ title: pageName });
    pageUidCache.set(pageName, uid);
    logDebug("page_created", { pageName, uid });
    return uid;
  } catch (error) {
    // If page already exists (race condition or query timing issue), find it with retries
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("already exists")) {
      logInfo(`Page "${pageName}" already exists, searching for UID...`);

      // Use retry logic with exponential backoff
      const retryUid = await findPageUidWithRetry(pageName, 5);
      if (retryUid) {
        pageUidCache.set(pageName, retryUid);
        logDebug("page_found_after_retry", { pageName, uid: retryUid });
        return retryUid;
      }

      // If still not found, this is unexpected - log and throw
      logDebug("page_not_found_after_retries", { pageName, attempts: 6 });
    }
    throw error;
  }
}

async function removeObsoleteBlocks(
  blockMap: Map<string, RoamBasicNode>,
  seenIds: Set<string>
): Promise<void> {
  let removeCount = 0;
  for (const [icalId, node] of blockMap.entries()) {
    if (seenIds.has(icalId)) {
      continue;
    }
    await deleteBlock(node.uid);
    await delay(MUTATION_DELAY_MS);

    removeCount++;
    await maybeYield(removeCount);
  }
}

/**
 * Synchronizes child blocks (properties) for an existing event block.
 */
async function syncChildren(parentUid: string, newChildren: BlockPayload[]): Promise<void> {
  const existingChildren = getBasicTreeByParentUid(parentUid);

  // Build a map of existing property blocks by their property key
  const existingPropsMap = new Map<string, RoamBasicNode>();
  for (const child of existingChildren) {
    const propKey = extractPropertyKey(child.text);
    if (propKey) {
      existingPropsMap.set(propKey, child);
    }
  }

  let childCount = 0;
  for (const newChild of newChildren) {
    const propKey = extractPropertyKey(newChild.text);

    if (propKey) {
      const existing = existingPropsMap.get(propKey);
      if (existing) {
        // Update if changed
        if (existing.text !== newChild.text) {
          await updateBlock({ uid: existing.uid, text: newChild.text });
          await delay(MUTATION_DELAY_MS);
        }
        existingPropsMap.delete(propKey);
      } else {
        // Create new property
        await createBlock({
          parentUid,
          order: "last",
          node: toInputNode(newChild),
        });
      }
    }

    childCount++;
    await maybeYield(childCount);
  }
}

/**
 * Extracts the property key from a Roam property line.
 */
function extractPropertyKey(text: string): string | undefined {
  const match = text.match(/^([\w-]+)::/);
  return match ? match[1] : undefined;
}

async function cleanupObsoletePages(
  pagePrefix: string,
  currentEventsByPage: Map<string, EventWithBlock[]>
): Promise<void> {
  const currentEventIds = new Set<string>();
  for (const eventsWithBlocks of currentEventsByPage.values()) {
    for (const { event } of eventsWithBlocks) {
      currentEventIds.add(event.uid);
    }
  }

  const prefix = `${pagePrefix}/`;
  const pageTitles = getPageTitlesStartingWithPrefix(prefix);
  let cleanupCount = 0;

  for (const pageTitle of pageTitles) {
    if (currentEventsByPage.has(pageTitle)) {
      continue;
    }

    const pageUid = getPageUidByPageTitle(pageTitle);
    if (!pageUid) {
      continue;
    }

    const tree = getBasicTreeByParentUid(pageUid);
    const blockMap = buildBlockMap(tree);

    for (const [icalId, node] of blockMap.entries()) {
      if (currentEventIds.has(icalId)) {
        continue;
      }
      await deleteBlock(node.uid);
      await delay(MUTATION_DELAY_MS);

      cleanupCount++;
      await maybeYield(cleanupCount);
    }
  }
}

/**
 * Builds a map of existing blocks indexed by ical-id.
 */
function buildBlockMap(tree: RoamBasicNode[]): Map<string, RoamBasicNode> {
  const map = new Map<string, RoamBasicNode>();

  for (const node of tree) {
    const id = extractICalIdFromNode(node);
    if (id) {
      map.set(id, node);
      logDebug("build_block_map_found", { id, uid: node.uid });
    }
  }
  return map;
}

function toInputNode(payload: BlockPayload): InputTextNode {
  return {
    text: payload.text,
    children: payload.children.map(toInputNode),
  };
}
