// Use React from window to avoid version conflicts with Roam's React
const getReact = () => (window as unknown as { React: typeof import("react") }).React;

import {
  CONFIG_PAGE_TITLE,
  DEFAULT_PAGE_PREFIX,
  DEFAULT_BATCH_SIZE,
  DEFAULT_BATCH_DELAY_MS,
  DEFAULT_EXCLUDE_PATTERNS,
  DEFAULT_SYNC_DAYS_PAST,
  DEFAULT_SYNC_DAYS_FUTURE,
  DEFAULT_TITLE_PREFIX,
} from "./constants";
import { logWarn, logDebug } from "./logger";
import type { ExtensionAPI } from "./main";
import type { CalendarConfig } from "./ical";

/**
 * Validation result for a calendar URL.
 */
export interface CalendarValidationResult {
  url: string;
  valid: boolean;
  error?: string;
  contentType?: string;
  status?: number;
}

/**
 * Validates if a string is a valid URL.
 */
export function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Gets the Roam CORS proxy URL.
 */
function getRoamProxyUrl(): string | undefined {
  const roamAPI = (window as unknown as {
    roamAlphaAPI?: {
      constants?: {
        corsAnywhereProxyUrl?: string;
      };
    };
  }).roamAlphaAPI;

  return roamAPI?.constants?.corsAnywhereProxyUrl;
}

/**
 * Validates a calendar URL by checking format and optionally testing connectivity.
 *
 * @param url URL to validate.
 * @param testConnection If true, attempts to fetch the URL to verify it's accessible.
 */
export async function validateCalendarUrl(
  url: string,
  testConnection = false
): Promise<CalendarValidationResult> {
  // Basic URL format validation
  if (!url || url.trim() === "") {
    return { url, valid: false, error: "URL is empty" };
  }

  const trimmedUrl = url.trim();

  if (!isValidUrl(trimmedUrl)) {
    return { url: trimmedUrl, valid: false, error: "Invalid URL format" };
  }

  // Check for common iCal URL patterns
  const urlLower = trimmedUrl.toLowerCase();
  const isICalUrl =
    urlLower.endsWith(".ics") ||
    urlLower.includes("/ical") ||
    urlLower.includes("/calendar") ||
    urlLower.includes("webcal://") ||
    urlLower.includes("calendar.google.com") ||
    urlLower.includes("outlook.office365.com") ||
    urlLower.includes("caldav");

  if (!isICalUrl) {
    logDebug("url_validation_warning", {
      url: trimmedUrl,
      message: "URL does not appear to be an iCal feed",
    });
  }

  if (!testConnection) {
    return { url: trimmedUrl, valid: true };
  }

  // Test connectivity
  try {
    const proxyUrl = getRoamProxyUrl();
    if (!proxyUrl) {
      return {
        url: trimmedUrl,
        valid: true,
        error: "Cannot test connection: Roam proxy not available",
      };
    }

    const fetchUrl = `${proxyUrl}/${trimmedUrl}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch(fetchUrl, {
      method: "HEAD", // Use HEAD to avoid downloading full content
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const contentType = response.headers.get("Content-Type") ?? undefined;
    const isValidContentType =
      !contentType ||
      contentType.includes("text/calendar") ||
      contentType.includes("text/plain") ||
      contentType.includes("application/octet-stream");

    if (!response.ok) {
      return {
        url: trimmedUrl,
        valid: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        status: response.status,
        contentType,
      };
    }

    if (!isValidContentType) {
      return {
        url: trimmedUrl,
        valid: false,
        error: `Unexpected content type: ${contentType}`,
        contentType,
        status: response.status,
      };
    }

    return {
      url: trimmedUrl,
      valid: true,
      contentType,
      status: response.status,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("abort")) {
      return { url: trimmedUrl, valid: false, error: "Connection timeout (10s)" };
    }
    return { url: trimmedUrl, valid: false, error: `Connection failed: ${message}` };
  }
}

/**
 * Validates all calendar configurations.
 */
export async function validateAllCalendars(
  calendars: CalendarConfig[],
  testConnection = false
): Promise<Map<string, CalendarValidationResult>> {
  const results = new Map<string, CalendarValidationResult>();

  for (const calendar of calendars) {
    const result = await validateCalendarUrl(calendar.url, testConnection);
    results.set(calendar.url, result);
  }

  return results;
}

/**
 * Roam basic node type for tree traversal.
 */
interface RoamBasicNode {
  text: string;
  uid: string;
  children?: RoamBasicNode[];
}

/**
 * Input node for creating blocks.
 */
interface InputTextNode {
  text: string;
  children?: InputTextNode[];
}

/**
 * Gets the Roam Alpha API from window.
 */
function getRoamAPI() {
  return (window as unknown as { roamAlphaAPI?: RoamAlphaAPI }).roamAlphaAPI;
}

interface RoamAlphaAPI {
  q?: (query: string, ...args: unknown[]) => unknown[][];
  data?: {
    pull?: (selector: string, eid: string) => unknown;
  };
  util?: {
    generateUID?: () => string;
  };
  createPage?: (config: { page: { title: string; uid?: string } }) => Promise<void>;
  createBlock?: (config: { location: { "parent-uid": string; order: number | "last" }; block: { string: string; uid?: string } }) => Promise<void>;
}

/**
 * Gets tree by parent UID using Roam API.
 * Returns direct children blocks of the parent.
 */
function getBasicTreeByParentUid(parentUid: string): RoamBasicNode[] {
  const api = getRoamAPI() as unknown as {
    q?: (query: string) => unknown[][];
    pull?: (selector: string, uid: string) => unknown;
  };

  if (!api) return [];

  if (api.q) {
    const result = api.q(
      `[:find ?string ?uid ?order
        :where
        [?parent :block/uid "${parentUid}"]
        [?parent :block/children ?child]
        [?child :block/string ?string]
        [?child :block/uid ?uid]
        [?child :block/order ?order]]`
    );

    if (result && result.length > 0) {
      const nodes: RoamBasicNode[] = [];
      for (const row of result) {
        const [text, uid, order] = row as [string, string, number];
        const children = getBasicTreeByParentUid(uid);
        nodes.push({
          text: text ?? "",
          uid: uid ?? "",
          children,
          order,
        } as RoamBasicNode & { order: number });
      }

      return nodes.sort((a, b) => {
        const orderA = (a as RoamBasicNode & { order?: number }).order ?? 0;
        const orderB = (b as RoamBasicNode & { order?: number }).order ?? 0;
        return orderA - orderB;
      });
    }
  }

  return [];
}

/**
 * Gets page UID by title using Roam API.
 */
function getPageUidByPageTitle(title: string): string | undefined {
  const api = getRoamAPI();
  if (!api?.q) return undefined;

  const result = api.q(
    `[:find ?uid :where [?p :node/title "${title}"] [?p :block/uid ?uid]]`
  );

  return result?.[0]?.[0] as string | undefined;
}

/**
 * Gets page titles starting with prefix.
 */
function getPageTitlesStartingWithPrefix(prefix: string): string[] {
  const api = getRoamAPI();
  if (!api?.q) return [];

  const result = api.q(
    `[:find ?title :where [?p :node/title ?title] [(clojure.string/starts-with? ?title "${prefix}")]]`
  );

  return (result || []).map((row) => row[0] as string);
}

/**
 * Creates a page using Roam API.
 */
async function createPage(config: { title: string; tree?: InputTextNode[] }): Promise<string> {
  const api = getRoamAPI();
  const uid = api?.util?.generateUID?.() ?? generateUID();

  if (api?.createPage) {
    await api.createPage({ page: { title: config.title, uid } });
    await delay(MUTATION_DELAY_MS);
    await yieldToMain();

    if (config.tree && config.tree.length > 0) {
      for (let i = 0; i < config.tree.length; i++) {
        await createBlockRecursive(uid, config.tree[i], i);
      }
    }
  }

  return uid;
}

/**
 * Creates a block using Roam API.
 */
async function createBlock(config: { parentUid: string; order: number | "last"; node: InputTextNode }): Promise<string> {
  const api = getRoamAPI();
  const uid = api?.util?.generateUID?.() ?? generateUID();

  if (api?.createBlock) {
    await api.createBlock({
      location: { "parent-uid": config.parentUid, order: config.order },
      block: { string: config.node.text, uid },
    });
    await delay(MUTATION_DELAY_MS);
    await yieldToMain();

    if (config.node.children && config.node.children.length > 0) {
      for (let i = 0; i < config.node.children.length; i++) {
        await createBlockRecursive(uid, config.node.children[i], i);
      }
    }
  }

  return uid;
}

async function createBlockRecursive(parentUid: string, node: InputTextNode, order: number, depth = 0): Promise<void> {
  const api = getRoamAPI();
  const uid = api?.util?.generateUID?.() ?? generateUID();

  if (api?.createBlock) {
    await api.createBlock({
      location: { "parent-uid": parentUid, order },
      block: { string: node.text, uid },
    });
    await delay(MUTATION_DELAY_MS);

    if (depth % YIELD_BATCH_SIZE === 0) {
      await yieldToMain();
    }

    if (node.children && node.children.length > 0) {
      for (let i = 0; i < node.children.length; i++) {
        await createBlockRecursive(uid, node.children[i], i, depth + 1);
      }
    }
  }
}

/**
 * Updates a block using Roam API.
 */
async function updateBlock(config: { uid: string; text: string }): Promise<void> {
  const api = getRoamAPI() as unknown as { updateBlock?: (config: { block: { uid: string; string: string } }) => Promise<void> };
  if (api?.updateBlock) {
    await api.updateBlock({ block: { uid: config.uid, string: config.text } });
  }
}

/**
 * Deletes a block using Roam API.
 */
async function deleteBlock(uid: string): Promise<void> {
  const api = getRoamAPI() as unknown as { deleteBlock?: (config: { block: { uid: string } }) => Promise<void> };
  if (api?.deleteBlock) {
    await api.deleteBlock({ block: { uid } });
  }
}

function generateUID(): string {
  return Math.random().toString(36).substring(2, 11);
}

/**
 * Delays execution for the specified milliseconds.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Yields control back to the main thread.
 */
export function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as unknown as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) {
    return scheduler.yield();
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Conditionally yields to main thread based on operation count.
 */
export async function maybeYield(count: number): Promise<void> {
  if (count % YIELD_BATCH_SIZE === 0) {
    await yieldToMain();
  }
}

/**
 * Throttle delay between Roam API mutations (in ms).
 */
export const MUTATION_DELAY_MS = 100;

/**
 * Number of operations to process before yielding to main thread.
 */
export const YIELD_BATCH_SIZE = 3;

// Export the helpers for use in blocks.ts
export {
  getBasicTreeByParentUid,
  getPageUidByPageTitle,
  getPageTitlesStartingWithPrefix,
  createPage,
  createBlock,
  updateBlock,
  deleteBlock,
  type RoamBasicNode,
  type InputTextNode,
};

export type SettingsSnapshot = {
  pagePrefix: string;
  intervalMs: number;
  calendars: CalendarConfig[];
  enableDebugLogs: boolean;
  batchSize: number;
  batchDelayMs: number;
  excludePatterns: RegExp[];
  attendeeAliases: Map<string, string>;
  syncDaysPast: number;
  syncDaysFuture: number;
  titlePrefix: string;
};

export type SettingsHandle =
  | {
      mode: "panel";
      dispose: () => void;
    }
  | {
      mode: "page";
      pageUid: string;
      dispose: () => void;
    };

const SETTINGS_KEYS = {
  pagePrefix: "page_prefix",
  intervalMinutes: "sync_interval_minutes",
  calendars: "calendars",
  enableDebugLogs: "enable_debug_logs",
  batchSize: "batch_size",
  batchDelayMs: "batch_delay_ms",
  excludePatterns: "exclude_title_patterns",
  attendeeAliases: "attendee_aliases",
  syncDaysPast: "sync_days_past",
  syncDaysFuture: "sync_days_future",
  titlePrefix: "title_prefix",
} as const;

const DEFAULT_SETTINGS: Record<string, unknown> = {
  [SETTINGS_KEYS.pagePrefix]: DEFAULT_PAGE_PREFIX,
  [SETTINGS_KEYS.intervalMinutes]: 30,
  [SETTINGS_KEYS.calendars]: "",
  [SETTINGS_KEYS.enableDebugLogs]: false,
  [SETTINGS_KEYS.batchSize]: DEFAULT_BATCH_SIZE,
  [SETTINGS_KEYS.batchDelayMs]: DEFAULT_BATCH_DELAY_MS,
  [SETTINGS_KEYS.excludePatterns]: DEFAULT_EXCLUDE_PATTERNS,
  [SETTINGS_KEYS.attendeeAliases]: "",
  [SETTINGS_KEYS.syncDaysPast]: DEFAULT_SYNC_DAYS_PAST,
  [SETTINGS_KEYS.syncDaysFuture]: DEFAULT_SYNC_DAYS_FUTURE,
  [SETTINGS_KEYS.titlePrefix]: DEFAULT_TITLE_PREFIX,
};

const SETTINGS_TEMPLATE: InputTextNode[] = [
  { text: "Target Page Prefix", children: [{ text: DEFAULT_PAGE_PREFIX }] },
  { text: "Sync Interval (minutes)", children: [{ text: "30" }] },
  { text: "Calendars (name|url, one per line)", children: [{ text: "" }] },
  { text: "Enable Debug Logs" },
  { text: "Batch Size", children: [{ text: String(DEFAULT_BATCH_SIZE) }] },
  { text: "Batch Delay (ms)", children: [{ text: String(DEFAULT_BATCH_DELAY_MS) }] },
  { text: "Exclude Title Patterns (regex, one per line)", children: [{ text: DEFAULT_EXCLUDE_PATTERNS }] },
  { text: "Attendee Aliases (CN;Page, one per line)", children: [{ text: "" }] },
  { text: "Sync Days Past", children: [{ text: String(DEFAULT_SYNC_DAYS_PAST) }] },
  { text: "Sync Days Future", children: [{ text: String(DEFAULT_SYNC_DAYS_FUTURE) }] },
  { text: "Title Prefix", children: [{ text: DEFAULT_TITLE_PREFIX }] },
];

export async function initializeSettings(
  extensionAPI: ExtensionAPI
): Promise<SettingsHandle> {
  const hasPanel = typeof extensionAPI.settings.panel?.create === "function";
  if (hasPanel) {
    await ensureDefaults(extensionAPI);
    registerSettingsPanel(extensionAPI);
    return { mode: "panel", dispose: () => undefined };
  }

  const pageUid = await ensureSettingsPage();
  return { mode: "page", pageUid, dispose: () => undefined };
}

export function readSettings(
  extensionAPI: ExtensionAPI,
  handle: SettingsHandle
): SettingsSnapshot {
  if (handle.mode === "panel") {
    return readSettingsFromPanel(extensionAPI);
  }
  return readSettingsFromPage(handle.pageUid);
}

function readSettingsFromPanel(
  extensionAPI: ExtensionAPI
): SettingsSnapshot {
  const allSettings = extensionAPI.settings.getAll() ?? {};
  const pagePrefix = getString(allSettings, SETTINGS_KEYS.pagePrefix) || DEFAULT_PAGE_PREFIX;
  const intervalMinutes = Math.max(
    getNumber(allSettings, SETTINGS_KEYS.intervalMinutes, 30),
    1
  );
  const calendarsRaw = getString(allSettings, SETTINGS_KEYS.calendars) ?? "";
  const calendars = parseCalendarsConfigLegacy(calendarsRaw);
  const enableDebugLogs = getBoolean(
    allSettings,
    SETTINGS_KEYS.enableDebugLogs,
    false
  );
  const batchSize = Math.max(
    getNumber(allSettings, SETTINGS_KEYS.batchSize, DEFAULT_BATCH_SIZE),
    1
  );
  const batchDelayMs = Math.max(
    getNumber(allSettings, SETTINGS_KEYS.batchDelayMs, DEFAULT_BATCH_DELAY_MS),
    0
  );
  const excludePatternsRaw = getString(allSettings, SETTINGS_KEYS.excludePatterns) ?? DEFAULT_EXCLUDE_PATTERNS;
  const excludePatterns = parseExcludePatterns(excludePatternsRaw);
  const attendeeAliasesRaw = getString(allSettings, SETTINGS_KEYS.attendeeAliases) ?? "";
  const attendeeAliases = parseAttendeeAliases(attendeeAliasesRaw);
  const syncDaysPast = Math.max(
    getNumber(allSettings, SETTINGS_KEYS.syncDaysPast, DEFAULT_SYNC_DAYS_PAST),
    0
  );
  const syncDaysFuture = Math.max(
    getNumber(allSettings, SETTINGS_KEYS.syncDaysFuture, DEFAULT_SYNC_DAYS_FUTURE),
    0
  );
  const titlePrefix = getString(allSettings, SETTINGS_KEYS.titlePrefix) ?? DEFAULT_TITLE_PREFIX;

  return {
    pagePrefix,
    intervalMs: intervalMinutes * 60 * 1000,
    calendars,
    enableDebugLogs,
    batchSize,
    batchDelayMs,
    excludePatterns,
    attendeeAliases,
    syncDaysPast,
    syncDaysFuture,
    titlePrefix,
  };
}

function readSettingsFromPage(pageUid: string): SettingsSnapshot {
  const tree = getBasicTreeByParentUid(pageUid);

  const pagePrefix =
    getSettingValueFromTree({
      tree,
      key: "Target Page Prefix",
      defaultValue: DEFAULT_PAGE_PREFIX,
    }).trim() || DEFAULT_PAGE_PREFIX;

  const intervalMinutes = Math.max(
    getSettingIntFromTree({
      tree,
      key: "Sync Interval",
      defaultValue: 30,
    }),
    1
  );
  const intervalMs = intervalMinutes * 60 * 1000;

  const calendarsRaw = getSettingValuesFromTree({
    tree,
    key: "Calendars",
    defaultValue: [],
  }).join("\n");
  const calendars = parseCalendarsConfigLegacy(calendarsRaw);

  const enableDebugLogs = hasFlag(tree, "Enable Debug Logs");

  const batchSize = Math.max(
    getSettingIntFromTree({
      tree,
      key: "Batch Size",
      defaultValue: DEFAULT_BATCH_SIZE,
    }),
    1
  );

  const batchDelayMs = Math.max(
    getSettingIntFromTree({
      tree,
      key: "Batch Delay",
      defaultValue: DEFAULT_BATCH_DELAY_MS,
    }),
    0
  );

  const excludePatternsRaw = getSettingValuesFromTree({
    tree,
    key: "Exclude Title Patterns",
    defaultValue: [DEFAULT_EXCLUDE_PATTERNS],
  }).join("\n");
  const excludePatterns = parseExcludePatterns(excludePatternsRaw);

  const attendeeAliasesRaw = getSettingValuesFromTree({
    tree,
    key: "Attendee Aliases",
    defaultValue: [],
  }).join("\n");
  const attendeeAliases = parseAttendeeAliases(attendeeAliasesRaw);

  const syncDaysPast = Math.max(
    getSettingIntFromTree({
      tree,
      key: "Sync Days Past",
      defaultValue: DEFAULT_SYNC_DAYS_PAST,
    }),
    0
  );

  const syncDaysFuture = Math.max(
    getSettingIntFromTree({
      tree,
      key: "Sync Days Future",
      defaultValue: DEFAULT_SYNC_DAYS_FUTURE,
    }),
    0
  );

  const titlePrefix = getSettingValueFromTree({
    tree,
    key: "Title Prefix",
    defaultValue: DEFAULT_TITLE_PREFIX,
  });

  return {
    pagePrefix,
    intervalMs,
    calendars,
    enableDebugLogs,
    batchSize,
    batchDelayMs,
    excludePatterns,
    attendeeAliases,
    syncDaysPast,
    syncDaysFuture,
    titlePrefix,
  };
}

/**
 * Parses exclude patterns from a multi-line string into RegExp array.
 * Invalid patterns are logged and skipped.
 * Note: All patterns are case-insensitive by default (flag "i" is applied).
 * Inline flags like (?i) are automatically stripped since they're not supported in JS.
 *
 * @param raw Multi-line string with regex patterns.
 * @returns Array of compiled RegExp patterns.
 */
function parseExcludePatterns(raw: string): RegExp[] {
  if (!raw) return [];

  const patterns: RegExp[] = [];
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    let trimmed = line.trim();
    if (!trimmed) continue;

    // Remove inline flags that are not supported in JavaScript
    // Handles: (?i), ^(?i), (?im), etc. anywhere in the pattern
    trimmed = trimmed.replace(/\(\?[imsuxyUJ]+\)/g, "");

    // Skip if pattern becomes empty after removing flags
    if (!trimmed) continue;

    try {
      patterns.push(new RegExp(trimmed, "i"));
    } catch {
      logWarn("Invalid exclude pattern (skipped)", { pattern: trimmed });
    }
  }

  return patterns;
}

/**
 * Parses attendee aliases from a multi-line string.
 * Format: "Name;Page" (e.g. "Thiago Avelino;@avelino")
 */
function parseAttendeeAliases(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) return map;

  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(";");
    if (parts.length >= 2) {
      const key = parts[0].trim().toLowerCase();
      const value = parts[1].trim();
      if (key && value) {
        map.set(key, value);
      }
    }
  }

  return map;
}

/**
 * Result from parsing calendar configuration.
 */
export interface ParseCalendarsResult {
  calendars: CalendarConfig[];
  errors: { line: string; error: string }[];
}

/**
 * Parses calendar configuration from a multi-line string.
 * Format: name|url (one per line)
 * Returns both valid calendars and parsing errors.
 */
export function parseCalendarsConfig(raw: string): ParseCalendarsResult {
  if (!raw) return { calendars: [], errors: [] };

  const calendars: CalendarConfig[] = [];
  const errors: { line: string; error: string }[] = [];
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip comment lines
    if (trimmed.startsWith("#") || trimmed.startsWith("//")) {
      continue;
    }

    const pipeIndex = trimmed.indexOf("|");
    if (pipeIndex === -1) {
      // Assume it's just a URL, use URL hostname as name
      if (isValidUrl(trimmed)) {
        try {
          const url = new URL(trimmed);
          calendars.push({
            name: url.hostname,
            url: trimmed,
          });
        } catch {
          errors.push({ line: trimmed, error: "Invalid URL format" });
          logWarn("Invalid calendar URL", { url: trimmed });
        }
      } else {
        errors.push({ line: trimmed, error: "Invalid URL format (must start with http:// or https://)" });
        logWarn("Invalid calendar URL format", { url: trimmed });
      }
      continue;
    }

    const name = trimmed.slice(0, pipeIndex).trim();
    const url = trimmed.slice(pipeIndex + 1).trim();

    if (!name) {
      errors.push({ line: trimmed, error: "Calendar name is empty" });
      logWarn("Empty calendar name", { line: trimmed });
      continue;
    }

    if (!url) {
      errors.push({ line: trimmed, error: "Calendar URL is empty" });
      logWarn("Empty calendar URL", { line: trimmed });
      continue;
    }

    if (!isValidUrl(url)) {
      errors.push({ line: trimmed, error: "Invalid URL format (must start with http:// or https://)" });
      logWarn("Invalid calendar URL format", { url });
      continue;
    }

    calendars.push({ name, url });
  }

  return { calendars, errors };
}

/**
 * Legacy wrapper for backward compatibility.
 * Returns only valid calendars, logging errors.
 */
function parseCalendarsConfigLegacy(raw: string): CalendarConfig[] {
  const result = parseCalendarsConfig(raw);
  return result.calendars;
}

/**
 * Creates a flexible regex for matching setting keys.
 */
function toFlexRegex(key: string): RegExp {
  return new RegExp(`^\\s*${key.replace(/([()])/g, "\\$1")}\\s*(#\\.[\\w\\d-]*\\s*)?$`, "i");
}

/**
 * Gets setting value from tree.
 */
function getSettingValueFromTree(config: { tree: RoamBasicNode[]; key: string; defaultValue: string }): string {
  const node = config.tree.find((n) => toFlexRegex(config.key).test(n.text.trim()));
  return node?.children?.[0]?.text?.trim() ?? config.defaultValue;
}

/**
 * Gets setting int from tree.
 */
function getSettingIntFromTree(config: { tree: RoamBasicNode[]; key: string; defaultValue: number }): number {
  const value = getSettingValueFromTree({ tree: config.tree, key: config.key, defaultValue: "" });
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? config.defaultValue : parsed;
}

/**
 * Gets setting values (array) from tree.
 */
function getSettingValuesFromTree(config: { tree: RoamBasicNode[]; key: string; defaultValue: string[] }): string[] {
  const node = config.tree.find((n) => toFlexRegex(config.key).test(n.text.trim()));
  if (!node?.children) return config.defaultValue;
  return node.children.map((c) => c.text.trim());
}

function getString(settings: Record<string, unknown>, key: string): string | undefined {
  const value = settings[key];
  return typeof value === "string" ? value : undefined;
}

function getNumber(settings: Record<string, unknown>, key: string, fallback: number): number {
  const value = settings[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function getBoolean(settings: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = settings[key];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }
  return fallback;
}

async function ensureDefaults(extensionAPI: ExtensionAPI) {
  const current = extensionAPI.settings.getAll() ?? {};
  await Promise.all(
    Object.entries(DEFAULT_SETTINGS).map(async ([key, value]) => {
      if (current[key] === undefined) {
        await extensionAPI.settings.set(key, value);
      }
    })
  );
}

function registerSettingsPanel(extensionAPI: ExtensionAPI) {
  const React = getReact();
  const { useState, useEffect } = React;

  const TextInput = (key: string, type: "text" | "number" = "text", placeholder = "") =>
    function TextInputComponent() {
      const getInitial = () => {
        const settings = extensionAPI.settings.getAll() ?? {};
        if (type === "number") {
          return String(
            getNumber(
              settings,
              key,
              Number(DEFAULT_SETTINGS[key]) || 0
            )
          );
        }
        return getString(settings, key) ?? String(DEFAULT_SETTINGS[key] ?? "");
      };
      const [value, setValue] = useState(getInitial());
      useEffect(() => {
        setValue(getInitial());
      }, []);
      return React.createElement("input", {
        type,
        placeholder,
        value,
        style: { width: "100%" },
        onChange: (event: { target: { value: string } }) => {
          const next = event.target.value;
          setValue(next);
          void extensionAPI.settings.set(
            key,
            type === "number" ? Number(next) || Number(DEFAULT_SETTINGS[key]) || 0 : next
          );
        },
      });
    };

  const TextArea = (key: string, placeholder = "") =>
    function TextAreaComponent() {
      const getInitial = () =>
        getString(extensionAPI.settings.getAll() ?? {}, key) ?? String(DEFAULT_SETTINGS[key] ?? "");
      const [value, setValue] = useState(getInitial());
      useEffect(() => {
        setValue(getInitial());
      }, []);
      return React.createElement("textarea", {
        placeholder,
        value,
        style: { width: "100%", minHeight: "8rem", fontFamily: "monospace" },
        onChange: (event: { target: { value: string } }) => {
          const next = event.target.value;
          setValue(next);
          void extensionAPI.settings.set(key, next);
        },
      });
    };

  /**
   * Calendars TextArea with validation feedback.
   */
  const CalendarsTextArea = () => {
    const getInitial = () =>
      getString(extensionAPI.settings.getAll() ?? {}, SETTINGS_KEYS.calendars) ?? "";
    const [value, setValue] = useState(getInitial());
    const [validationErrors, setValidationErrors] = useState<{ line: string; error: string }[]>([]);
    const [validCount, setValidCount] = useState(0);
    const [isValidating, setIsValidating] = useState(false);
    const [connectionResults, setConnectionResults] = useState<Map<string, CalendarValidationResult>>(new Map());

    useEffect(() => {
      setValue(getInitial());
    }, []);

    // Validate on value change
    useEffect(() => {
      const result = parseCalendarsConfig(value);
      setValidationErrors(result.errors);
      setValidCount(result.calendars.length);
      // Clear connection results when calendars change
      setConnectionResults(new Map());
    }, [value]);

    const testConnections = async () => {
      setIsValidating(true);
      const result = parseCalendarsConfig(value);
      const results = await validateAllCalendars(result.calendars, true);
      setConnectionResults(results);
      setIsValidating(false);
    };

    return React.createElement(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: "0.5rem" } },
      // TextArea
      React.createElement("textarea", {
        placeholder: "Work|https://example.com/calendar.ics",
        value,
        style: {
          width: "100%",
          minHeight: "8rem",
          fontFamily: "monospace",
          borderColor: validationErrors.length > 0 ? "#e53e3e" : undefined,
        },
        onChange: (event: { target: { value: string } }) => {
          const next = event.target.value;
          setValue(next);
          void extensionAPI.settings.set(SETTINGS_KEYS.calendars, next);
        },
      }),
      // Validation status
      React.createElement(
        "div",
        { style: { fontSize: "0.85rem", color: "#666" } },
        validCount > 0
          ? `${validCount} calendar(s) configured`
          : "No calendars configured"
      ),
      // Validation errors
      validationErrors.length > 0 &&
        React.createElement(
          "div",
          {
            style: {
              fontSize: "0.85rem",
              color: "#e53e3e",
              backgroundColor: "#fff5f5",
              padding: "0.5rem",
              borderRadius: "4px",
              border: "1px solid #feb2b2",
            },
          },
          validationErrors.map((err, i) =>
            React.createElement(
              "div",
              { key: i },
              `Line "${err.line.substring(0, 30)}${err.line.length > 30 ? "..." : ""}": ${err.error}`
            )
          )
        ),
      // Test connection button
      validCount > 0 &&
        React.createElement(
          "button",
          {
            onClick: testConnections,
            disabled: isValidating,
            style: {
              padding: "0.5rem 1rem",
              cursor: isValidating ? "wait" : "pointer",
              backgroundColor: "#4299e1",
              color: "white",
              border: "none",
              borderRadius: "4px",
              fontSize: "0.85rem",
            },
          },
          isValidating ? "Testing..." : "Test Connections"
        ),
      // Connection test results
      connectionResults.size > 0 &&
        React.createElement(
          "div",
          {
            style: {
              fontSize: "0.85rem",
              padding: "0.5rem",
              borderRadius: "4px",
              border: "1px solid #e2e8f0",
            },
          },
          Array.from(connectionResults.entries()).map(([url, result]) =>
            React.createElement(
              "div",
              {
                key: url,
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.25rem 0",
                },
              },
              React.createElement("span", {
                style: {
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: result.valid ? "#48bb78" : "#e53e3e",
                },
              }),
              React.createElement(
                "span",
                { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis" } },
                url.substring(0, 50) + (url.length > 50 ? "..." : "")
              ),
              !result.valid &&
                React.createElement(
                  "span",
                  { style: { color: "#e53e3e" } },
                  result.error
                )
            )
          )
        )
    );
  };

  const Toggle = (key: string) =>
    function ToggleComponent() {
      const getInitial = () =>
        getBoolean(extensionAPI.settings.getAll() ?? {}, key, Boolean(DEFAULT_SETTINGS[key]));
      const [checked, setChecked] = useState(getInitial());
      useEffect(() => {
        setChecked(getInitial());
      }, []);
      return React.createElement(
        "label",
        { style: { display: "inline-flex", alignItems: "center", gap: "0.5rem" } },
        React.createElement("input", {
          type: "checkbox",
          checked,
          onChange: (event: { target: { checked: boolean } }) => {
            const next = event.target.checked;
            setChecked(next);
            void extensionAPI.settings.set(key, next);
          },
        }),
        checked ? "Enabled" : "Disabled"
      );
    };

  extensionAPI.settings.panel!.create({
    tabTitle: "iCal Sync",
    settings: [
      {
        id: SETTINGS_KEYS.pagePrefix,
        name: "Target Page Prefix",
        description:
          "Prefix for destination pages in Roam. Events are saved to `prefix/<calendar>/<event-id>`.",
        action: {
          type: "reactComponent",
          component: TextInput(SETTINGS_KEYS.pagePrefix, "text", DEFAULT_PAGE_PREFIX),
        },
      },
      {
        id: SETTINGS_KEYS.intervalMinutes,
        name: "Sync Interval (minutes)",
        description: "Minutes between automatic syncs (minimum: 1).",
        action: {
          type: "reactComponent",
          component: TextInput(SETTINGS_KEYS.intervalMinutes, "number", "30"),
        },
      },
      {
        id: SETTINGS_KEYS.calendars,
        name: "Calendars",
        description:
          "Add your iCal (.ics) URLs. Format: name|url (one per line). Lines starting with # or // are comments. Example:\nWork|https://calendar.google.com/calendar/ical/work%40gmail.com/public/basic.ics",
        action: {
          type: "reactComponent",
          component: CalendarsTextArea,
        },
      },
      {
        id: SETTINGS_KEYS.enableDebugLogs,
        name: "Enable Debug Logs",
        description:
          "Display additional logs in the browser console (useful for debugging).",
        action: {
          type: "reactComponent",
          component: Toggle(SETTINGS_KEYS.enableDebugLogs),
        },
      },
      {
        id: SETTINGS_KEYS.batchSize,
        name: "Batch Size",
        description:
          "Number of events to process per batch. Lower values reduce UI freezing but slow down sync. Default: 50.",
        action: {
          type: "reactComponent",
          component: TextInput(SETTINGS_KEYS.batchSize, "number", String(DEFAULT_BATCH_SIZE)),
        },
      },
      {
        id: SETTINGS_KEYS.batchDelayMs,
        name: "Batch Delay (ms)",
        description:
          "Delay in milliseconds between batches. Higher values reduce UI freezing. Default: 500.",
        action: {
          type: "reactComponent",
          component: TextInput(SETTINGS_KEYS.batchDelayMs, "number", String(DEFAULT_BATCH_DELAY_MS)),
        },
      },
      {
        id: SETTINGS_KEYS.excludePatterns,
        name: "Exclude Title Patterns",
        description:
          "Regex patterns to exclude events by title (one per line). Events matching any pattern are skipped. Default: ^Busy$ (excludes calendar blocking events).",
        action: {
          type: "reactComponent",
          component: TextArea(SETTINGS_KEYS.excludePatterns, "^Busy$\n^Private$"),
        },
      },
      {
        id: SETTINGS_KEYS.attendeeAliases,
        name: "Attendee Aliases",
        description:
          "Map participant names/emails to Roam pages (one per line). Format: Name;Page. Example: Thiago Avelino;@avelino",
        action: {
          type: "reactComponent",
          component: TextArea(SETTINGS_KEYS.attendeeAliases, "Thiago Avelino;@avelino\navelino@example.com;@avelino"),
        },
      },
      {
        id: SETTINGS_KEYS.syncDaysPast,
        name: "Sync Days Past",
        description:
          "Number of days in the past to include events. Events older than this are skipped. Default: 30.",
        action: {
          type: "reactComponent",
          component: TextInput(SETTINGS_KEYS.syncDaysPast, "number", String(DEFAULT_SYNC_DAYS_PAST)),
        },
      },
      {
        id: SETTINGS_KEYS.syncDaysFuture,
        name: "Sync Days Future",
        description:
          "Number of days in the future to include events. Events further out are skipped. Default: 30.",
        action: {
          type: "reactComponent",
          component: TextInput(SETTINGS_KEYS.syncDaysFuture, "number", String(DEFAULT_SYNC_DAYS_FUTURE)),
        },
      },
      {
        id: SETTINGS_KEYS.titlePrefix,
        name: "Title Prefix",
        description:
          "Optional prefix prepended to event titles. Can be a tag like #gcal or any text. Leave empty for no prefix. Default: #gcal.",
        action: {
          type: "reactComponent",
          component: TextInput(SETTINGS_KEYS.titlePrefix, "text", DEFAULT_TITLE_PREFIX),
        },
      },
    ],
  });
}

async function ensureSettingsPage(): Promise<string> {
  let pageUid = getPageUidByPageTitle(CONFIG_PAGE_TITLE);
  if (!pageUid) {
    pageUid = await createPage({
      title: CONFIG_PAGE_TITLE,
      tree: SETTINGS_TEMPLATE,
    });
  } else {
    await ensureSettingsTemplate(pageUid);
  }
  return pageUid;
}

function hasFlag(tree: RoamBasicNode[], key: string): boolean {
  const regex = toFlexRegex(key);
  return tree.some((node) => regex.test(node.text.trim()));
}

async function ensureSettingsTemplate(pageUid: string): Promise<void> {
  const tree = getBasicTreeByParentUid(pageUid);
  const map = new Map<string, RoamBasicNode>();
  for (const node of tree) {
    map.set(node.text.trim().toLowerCase(), node);
  }

  for (const template of SETTINGS_TEMPLATE) {
    const key = template.text.trim().toLowerCase();
    const existing = map.get(key);
    if (!existing) {
      await createBlock({
        parentUid: pageUid,
        order: "last",
        node: template,
      });
      continue;
    }

    if (template.children && template.children.length > 0) {
      const hasChildren = Array.isArray(existing.children) && existing.children.length > 0;
      if (!hasChildren) {
        for (let index = 0; index < template.children.length; index += 1) {
          const child = template.children[index];
          await createBlock({
            parentUid: existing.uid,
            order: index,
            node: child,
          });
        }
      }
    }
  }
}
