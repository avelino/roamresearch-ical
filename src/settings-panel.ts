/**
 * Settings panel React components for Roam's extension settings.
 * Uses React from window to avoid version conflicts with Roam's React.
 */

import type { ExtensionAPI } from "./main";
import type { CalendarConfig } from "./ical";
import {
  DEFAULT_PAGE_PREFIX,
  DEFAULT_BATCH_SIZE,
  DEFAULT_BATCH_DELAY_MS,
  DEFAULT_SYNC_DAYS_PAST,
  DEFAULT_SYNC_DAYS_FUTURE,
  DEFAULT_TITLE_PREFIX,
} from "./constants";
import { validateCalendarUrl, type CalendarValidationResult } from "./url-validation";

// Use React from window to avoid version conflicts with Roam's React
const getReact = () => (window as unknown as { React: typeof import("react") }).React;

/**
 * Settings keys used in the panel.
 */
export const SETTINGS_KEYS = {
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

/**
 * Default settings values.
 */
export const DEFAULT_SETTINGS: Record<string, unknown> = {
  [SETTINGS_KEYS.pagePrefix]: DEFAULT_PAGE_PREFIX,
  [SETTINGS_KEYS.intervalMinutes]: 30,
  [SETTINGS_KEYS.calendars]: "",
  [SETTINGS_KEYS.enableDebugLogs]: false,
  [SETTINGS_KEYS.batchSize]: DEFAULT_BATCH_SIZE,
  [SETTINGS_KEYS.batchDelayMs]: DEFAULT_BATCH_DELAY_MS,
  [SETTINGS_KEYS.excludePatterns]: "^Busy$",
  [SETTINGS_KEYS.attendeeAliases]: "",
  [SETTINGS_KEYS.syncDaysPast]: DEFAULT_SYNC_DAYS_PAST,
  [SETTINGS_KEYS.syncDaysFuture]: DEFAULT_SYNC_DAYS_FUTURE,
  [SETTINGS_KEYS.titlePrefix]: DEFAULT_TITLE_PREFIX,
};

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

/**
 * Validates all calendar configurations.
 */
async function validateAllCalendars(
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
 * Parses calendar configuration from a multi-line string.
 * Format: name|url (one per line)
 */
function parseCalendarsForValidation(raw: string): { calendars: CalendarConfig[]; errors: { line: string; error: string }[] } {
  if (!raw) return { calendars: [], errors: [] };

  const calendars: CalendarConfig[] = [];
  const errors: { line: string; error: string }[] = [];
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#") || trimmed.startsWith("//")) continue;

    const pipeIndex = trimmed.indexOf("|");
    if (pipeIndex === -1) {
      try {
        const url = new URL(trimmed);
        if (url.protocol === "http:" || url.protocol === "https:") {
          calendars.push({ name: url.hostname, url: trimmed });
        } else {
          errors.push({ line: trimmed, error: "Invalid URL format" });
        }
      } catch {
        errors.push({ line: trimmed, error: "Invalid URL format (must start with http:// or https://)" });
      }
      continue;
    }

    const name = trimmed.slice(0, pipeIndex).trim();
    const url = trimmed.slice(pipeIndex + 1).trim();

    if (!name) {
      errors.push({ line: trimmed, error: "Calendar name is empty" });
      continue;
    }

    if (!url) {
      errors.push({ line: trimmed, error: "Calendar URL is empty" });
      continue;
    }

    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        errors.push({ line: trimmed, error: "Invalid URL format (must start with http:// or https://)" });
        continue;
      }
    } catch {
      errors.push({ line: trimmed, error: "Invalid URL format (must start with http:// or https://)" });
      continue;
    }

    calendars.push({ name, url });
  }

  return { calendars, errors };
}

/**
 * Registers the settings panel with Roam's extension API.
 */
export function registerSettingsPanel(extensionAPI: ExtensionAPI): void {
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
      const result = parseCalendarsForValidation(value);
      setValidationErrors(result.errors);
      setValidCount(result.calendars.length);
      // Clear connection results when calendars change
      setConnectionResults(new Map());
    }, [value]);

    const testConnections = async () => {
      setIsValidating(true);
      const result = parseCalendarsForValidation(value);
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
