/**
 * Settings management for the iCal Sync extension.
 * Handles reading/writing settings from Roam's extension panel or config page.
 */

import {
  CONFIG_PAGE_TITLE,
  DEFAULT_PAGE_PREFIX,
  DEFAULT_BATCH_SIZE,
  DEFAULT_BATCH_DELAY_MS,
  DEFAULT_EXCLUDE_PATTERNS,
  DEFAULT_SYNC_DAYS_PAST,
  DEFAULT_SYNC_DAYS_FUTURE,
  DEFAULT_TITLE_PREFIX,
  DEFAULT_SHOW_TIME,
  DEFAULT_TIME_FORMAT,
  DEFAULT_RECURRING_INDICATOR,
  DEFAULT_SHOW_TIMEZONE,
  DEFAULT_ENABLE_SMART_SYNC,
  DEFAULT_ENABLE_ERROR_REPORTS,
  DEFAULT_ENABLE_REMINDERS,
  DEFAULT_REMINDER_MINUTES,
} from "./constants";
import type { TimeFormat } from "./ical";
import { logWarn } from "./logger";
import type { ExtensionAPI } from "./main";
import type { CalendarConfig } from "./ical";
import {
  getBasicTreeByParentUid,
  getPageUidByPageTitle,
  createPage,
  createBlock,
  type RoamBasicNode,
  type InputTextNode,
} from "./roam-api";
import { registerSettingsPanel, SETTINGS_KEYS, DEFAULT_SETTINGS } from "./settings-panel";
import { isValidUrl } from "./url-validation";

// Re-export from roam-api for backward compatibility
export {
  getBasicTreeByParentUid,
  getPageUidByPageTitle,
  getPageTitlesStartingWithPrefix,
  createPage,
  createBlock,
  updateBlock,
  deleteBlock,
  delay,
  yieldToMain,
  maybeYield,
  MUTATION_DELAY_MS,
  YIELD_BATCH_SIZE,
  type RoamBasicNode,
  type InputTextNode,
} from "./roam-api";

// Re-export validation utilities
export { isValidUrl, validateCalendarUrl, type CalendarValidationResult } from "./url-validation";

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
  // Time display settings
  showTime: boolean;
  timeFormat: TimeFormat;
  // Recurring event indicator
  recurringIndicator: string;
  // Timezone settings
  showTimezone: boolean;
  // Smart sync settings
  enableSmartSync: boolean;
  // Error reporting settings
  enableErrorReports: boolean;
  // Reminder settings
  enableReminders: boolean;
  reminderMinutes: number;
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

  // Time display settings
  const showTime = getBoolean(allSettings, SETTINGS_KEYS.showTime, DEFAULT_SHOW_TIME);
  const timeFormatRaw = getString(allSettings, SETTINGS_KEYS.timeFormat) ?? DEFAULT_TIME_FORMAT;
  const timeFormat: TimeFormat = timeFormatRaw === "12h" ? "12h" : "24h";

  // Recurring event indicator
  const recurringIndicator = getString(allSettings, SETTINGS_KEYS.recurringIndicator) ?? DEFAULT_RECURRING_INDICATOR;

  // Timezone settings
  const showTimezone = getBoolean(allSettings, SETTINGS_KEYS.showTimezone, DEFAULT_SHOW_TIMEZONE);

  // Smart sync settings
  const enableSmartSync = getBoolean(allSettings, SETTINGS_KEYS.enableSmartSync, DEFAULT_ENABLE_SMART_SYNC);

  // Error reporting settings
  const enableErrorReports = getBoolean(allSettings, SETTINGS_KEYS.enableErrorReports, DEFAULT_ENABLE_ERROR_REPORTS);

  // Reminder settings
  const enableReminders = getBoolean(allSettings, SETTINGS_KEYS.enableReminders, DEFAULT_ENABLE_REMINDERS);
  const reminderMinutes = getNumber(allSettings, SETTINGS_KEYS.reminderMinutes, DEFAULT_REMINDER_MINUTES);

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
    showTime,
    timeFormat,
    recurringIndicator,
    showTimezone,
    enableSmartSync,
    enableErrorReports,
    enableReminders,
    reminderMinutes,
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

  // Time display settings (use defaults for page-based config)
  const showTime = hasFlag(tree, "Show Event Time") || DEFAULT_SHOW_TIME;
  const timeFormatRaw = getSettingValueFromTree({
    tree,
    key: "Time Format",
    defaultValue: DEFAULT_TIME_FORMAT,
  });
  const timeFormat: TimeFormat = timeFormatRaw === "12h" ? "12h" : "24h";

  // Recurring event indicator (use defaults for page-based config)
  const recurringIndicator = getSettingValueFromTree({
    tree,
    key: "Recurring Indicator",
    defaultValue: DEFAULT_RECURRING_INDICATOR,
  });

  // Timezone settings (use defaults for page-based config)
  const showTimezone = hasFlag(tree, "Show Timezone");

  // Smart sync settings (use defaults for page-based config)
  const enableSmartSync = hasFlag(tree, "Enable Smart Sync") || DEFAULT_ENABLE_SMART_SYNC;

  // Error reporting settings (use defaults for page-based config)
  const enableErrorReports = hasFlag(tree, "Enable Error Reports");

  // Reminder settings (use defaults for page-based config)
  const enableReminders = hasFlag(tree, "Enable Reminders");
  const reminderMinutes = getSettingIntFromTree({
    tree,
    key: "Reminder Minutes",
    defaultValue: DEFAULT_REMINDER_MINUTES,
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
    showTime,
    timeFormat,
    recurringIndicator,
    showTimezone,
    enableSmartSync,
    enableErrorReports,
    enableReminders,
    reminderMinutes,
  };
}

/**
 * Parses exclude patterns from a multi-line string into RegExp array.
 * Invalid patterns are logged and skipped.
 */
function parseExcludePatterns(raw: string): RegExp[] {
  if (!raw) return [];

  const patterns: RegExp[] = [];
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    let trimmed = line.trim();
    if (!trimmed) continue;

    // Remove inline flags that are not supported in JavaScript
    trimmed = trimmed.replace(/\(\?[imsuxyUJ]+\)/g, "");

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
 * Validates a color string (hex code or CSS color name).
 * @param color Color string to validate.
 * @returns true if valid color format.
 */
export function isValidColor(color: string): boolean {
  if (!color) return false;
  const trimmed = color.trim().toLowerCase();

  // Hex color: #RGB, #RRGGBB, or #RRGGBBAA
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed)) {
    return true;
  }

  // CSS named colors (common subset)
  const namedColors = new Set([
    "red", "blue", "green", "yellow", "orange", "purple", "pink",
    "cyan", "magenta", "brown", "black", "white", "gray", "grey",
    "teal", "navy", "maroon", "olive", "lime", "aqua", "fuchsia",
    "silver", "coral", "salmon", "tomato", "gold", "indigo", "violet",
  ]);
  return namedColors.has(trimmed);
}

/**
 * Parses calendar configuration from a multi-line string.
 * Format: name|url or name|url|color (one per line)
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

    const parts = trimmed.split("|").map(p => p.trim());

    if (parts.length === 1) {
      // Assume it's just a URL, use URL hostname as name
      if (isValidUrl(parts[0])) {
        try {
          const url = new URL(parts[0]);
          calendars.push({
            name: url.hostname,
            url: parts[0],
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

    const [name, url, color] = parts;

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

    // Validate color if provided
    const calendarConfig: CalendarConfig = { name, url };
    if (color) {
      if (isValidColor(color)) {
        calendarConfig.color = color;
      } else {
        // Log warning but don't fail - just skip the color
        logWarn("Invalid color format (skipped)", { color, calendar: name });
      }
    }

    calendars.push(calendarConfig);
  }

  return { calendars, errors };
}

/**
 * Legacy wrapper for backward compatibility.
 */
function parseCalendarsConfigLegacy(raw: string): CalendarConfig[] {
  const result = parseCalendarsConfig(raw);
  return result.calendars;
}

// Helper functions

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

function toFlexRegex(key: string): RegExp {
  return new RegExp(`^\\s*${key.replace(/([()])/g, "\\$1")}\\s*(#\\.[\\w\\d-]*\\s*)?$`, "i");
}

function getSettingValueFromTree(config: { tree: RoamBasicNode[]; key: string; defaultValue: string }): string {
  const node = config.tree.find((n) => toFlexRegex(config.key).test(n.text.trim()));
  return node?.children?.[0]?.text?.trim() ?? config.defaultValue;
}

function getSettingIntFromTree(config: { tree: RoamBasicNode[]; key: string; defaultValue: number }): number {
  const value = getSettingValueFromTree({ tree: config.tree, key: config.key, defaultValue: "" });
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? config.defaultValue : parsed;
}

function getSettingValuesFromTree(config: { tree: RoamBasicNode[]; key: string; defaultValue: string[] }): string[] {
  const node = config.tree.find((n) => toFlexRegex(config.key).test(n.text.trim()));
  if (!node?.children) return config.defaultValue;
  return node.children.map((c) => c.text.trim());
}

function hasFlag(tree: RoamBasicNode[], key: string): boolean {
  const regex = toFlexRegex(key);
  return tree.some((node) => regex.test(node.text.trim()));
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
