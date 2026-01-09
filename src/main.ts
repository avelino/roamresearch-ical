import "./polyfills";

import { writeBlocks } from "./blocks";
import {
  fetchAllCalendars,
  filterEventsByDateRange,
  clearCalendarCache,
  type ICalCalendar,
  type ICalCalendarResult,
  type ICalEvent,
  type CalendarFetchError,
  type FetchAllResult,
} from "./ical";
import {
  initializeSettings,
  readSettings,
  type SettingsHandle,
  type SettingsSnapshot,
} from "./settings";
import { cancelScheduledSync, scheduleAutoSync } from "./scheduler";
import { registerCommand, registerTopbarButton, registerSearchCommand } from "./ui";
import { logError, logInfo, logDebug, setDebugEnabled } from "./logger";

// Feature modules
import {
  loadEventCache,
  saveEventCache,
  detectEventChanges,
  updateEventCache,
  type SmartSyncStats,
} from "./event-cache";
import {
  createErrorReportPage,
  classifyError,
  type CalendarError,
  type ErrorReport,
} from "./error-report";
import {
  detectConflicts,
  type ConflictDetectionConfig,
} from "./conflicts";
import {
  checkAndSendReminders,
  type ReminderConfig,
} from "./reminders";
import { searchEvents } from "./search";

/**
 * Extension API interface provided by Roam Research.
 */
export interface ExtensionAPI {
  settings: {
    get: (key: string) => unknown;
    getAll: () => Record<string, unknown>;
    set: (key: string, value: unknown) => Promise<void>;
    panel?: {
      create: (config: SettingsPanelConfig) => void;
    };
  };
  ui?: {
    commandPalette?: {
      addCommand: (config: { label: string; callback: () => void }) => Promise<void>;
      removeCommand: (config: { label: string }) => Promise<void>;
    };
  };
}

interface SettingsPanelConfig {
  tabTitle: string;
  settings: Array<{
    id: string;
    name: string;
    description: string;
    action: {
      type: string;
      component: React.ComponentType;
    };
  }>;
}

interface OnloadArgs {
  extensionAPI: ExtensionAPI;
}

let syncInProgress = false;
let settingsHandle: SettingsHandle | null = null;
let extensionAPIRef: ExtensionAPI | null = null;
let lastIntervalMs: number | null = null;
let lastCalendarCount: number | undefined;
let unregisterCommand: (() => Promise<void>) | null = null;
let unregisterSearchCommand: (() => Promise<void>) | null = null;
let removeTopbarButton: (() => void) | null = null;
let reminderIntervalId: ReturnType<typeof setInterval> | null = null;
let lastSyncedEvents: ICalEvent[] = [];
let initialized = false;

/** Reminder check interval in milliseconds (1 minute) */
const REMINDER_CHECK_INTERVAL_MS = 60 * 1000;

/**
 * Extension onload handler - called by Roam when the extension is loaded.
 */
async function onload(args: OnloadArgs): Promise<void> {
  if (initialized) {
    return;
  }

  try {
    // Wait a bit for Roam API to be fully ready
    await new Promise(resolve => setTimeout(resolve, 100));

    const { extensionAPI } = args;
    extensionAPIRef = extensionAPI;
    settingsHandle = await initializeSettings(extensionAPI);
    const settings = refreshSettings();

    // Register sync command and topbar button
    unregisterCommand = await registerCommand(extensionAPI, () => syncCalendars("manual"));
    removeTopbarButton = registerTopbarButton(() => syncCalendars("manual"));

    // Register search command
    unregisterSearchCommand = await registerSearchCommand(extensionAPI, async (query) => {
      return searchEvents(query, settings.pagePrefix);
    });

    // Start reminder checker if reminders are enabled
    startReminderChecker();

    initialized = true;
    logInfo("iCal Sync extension loaded successfully");
  } catch (error) {
    logError("Extension initialization failed", error);
  }
}

/**
 * Extension onunload handler - called by Roam when the extension is unloaded.
 */
function onunload(): void {
  cancelScheduledSync();
  stopReminderChecker();

  if (removeTopbarButton) {
    removeTopbarButton();
    removeTopbarButton = null;
  }
  if (unregisterCommand) {
    void unregisterCommand();
    unregisterCommand = null;
  }
  if (unregisterSearchCommand) {
    void unregisterSearchCommand();
    unregisterSearchCommand = null;
  }

  settingsHandle?.dispose();
  settingsHandle = null;
  extensionAPIRef = null;
  lastIntervalMs = null;
  lastCalendarCount = undefined;
  lastSyncedEvents = [];
  initialized = false;
  logInfo("iCal Sync extension unloaded");
}

/**
 * Default export for Roam extension system.
 */
const extension = {
  onload,
  onunload,
};

export default extension;

function refreshSettings(): SettingsSnapshot {
  if (!extensionAPIRef || !settingsHandle) {
    throw new Error("Settings have not been initialized.");
  }
  const snapshot = readSettings(extensionAPIRef, settingsHandle);
  setDebugEnabled(snapshot.enableDebugLogs);
  maybeRescheduleAutoSync(snapshot);
  return snapshot;
}

function maybeRescheduleAutoSync(snapshot: SettingsSnapshot) {
  const calendarCount = snapshot.calendars.length;

  if (calendarCount === 0) {
    cancelScheduledSync();
    lastIntervalMs = null;
    lastCalendarCount = undefined;
    return;
  }

  if (snapshot.intervalMs === lastIntervalMs && calendarCount === lastCalendarCount) {
    return;
  }

  scheduleAutoSync(() => syncCalendars("auto"), snapshot.intervalMs);
  lastIntervalMs = snapshot.intervalMs;
  lastCalendarCount = calendarCount;
}

async function syncCalendars(trigger: "manual" | "auto" | "force") {
  if (syncInProgress) {
    if (trigger === "manual" || trigger === "force") {
      showStatusMessage("Sync is already in progress.", "warning");
    }
    return;
  }

  const settings = refreshSettings();

  if (settings.calendars.length === 0) {
    if (trigger === "manual" || trigger === "force") {
      showStatusMessage(
        "Please add calendar URLs in extension settings (Roam Depot → Extension Settings → iCal Sync).",
        "warning"
      );
    }
    return;
  }

  // Force refresh clears the cache first
  const forceRefresh = trigger === "force";
  if (forceRefresh) {
    clearCalendarCache();
  }

  syncInProgress = true;
  const syncStartTime = performance.now();

  if (trigger === "manual" || trigger === "force") {
    showStatusMessage(`Syncing ${settings.calendars.length} calendar(s)...`, "info");
  }

  try {
    logDebug("sync_start", {
      trigger,
      calendarCount: settings.calendars.length,
      calendars: settings.calendars.map(c => c.name),
      syncDaysPast: settings.syncDaysPast,
      syncDaysFuture: settings.syncDaysFuture,
      forceRefresh,
    });

    const fetchResult = await fetchAllCalendars(settings.calendars, forceRefresh);
    const rawCalendars: ICalCalendarResult[] = fetchResult.calendars;
    const totalRawEvents = rawCalendars.reduce((sum, cal) => sum + cal.events.length, 0);

    // Check if any calendar changed
    const anyChanged = rawCalendars.some(cal => cal.changed);

    // For auto sync, skip writing if nothing changed
    if (trigger === "auto" && !anyChanged && fetchResult.stats.cached === fetchResult.stats.total) {
      logInfo(`Auto sync skipped: all ${fetchResult.stats.total} calendars unchanged`);
      return;
    }

    // Filter events by date range (async to yield during filtering)
    const dateRangeConfig = {
      daysPast: settings.syncDaysPast,
      daysFuture: settings.syncDaysFuture,
    };
    const calendars: ICalCalendar[] = [];
    for (const cal of rawCalendars) {
      const filteredEvents = await filterEventsByDateRange(cal.events, dateRangeConfig);
      calendars.push({
        ...cal,
        events: filteredEvents,
      });
    }

    const totalEvents = calendars.reduce((sum, cal) => sum + cal.events.length, 0);

    logDebug("sync_fetched", {
      calendarsLoaded: calendars.length,
      totalRawEvents,
      totalEventsAfterDateFilter: totalEvents,
      filteredOut: totalRawEvents - totalEvents,
      stats: fetchResult.stats,
    });

    // Handle any sync errors (create error report if enabled)
    await handleSyncErrors(fetchResult, settings);

    if (calendars.length === 0) {
      if (trigger === "manual" || trigger === "force") {
        showStatusMessage("No calendars could be loaded. Check your URLs.", "warning");
      }
      return;
    }

    // Collect all events for smart sync and conflict detection
    const allEvents: ICalEvent[] = calendars.flatMap(cal => cal.events);

    // Store events for reminder checking
    lastSyncedEvents = allEvents;

    // Apply smart sync to filter out unchanged events
    const smartSyncResult = applySmartSync(allEvents, settings.enableSmartSync);

    // Detect scheduling conflicts
    checkForConflicts(allEvents);

    // Log smart sync stats
    if (settings.enableSmartSync && smartSyncResult.stats.unchanged > 0) {
      logDebug("smart_sync_applied", { ...smartSyncResult.stats });
    }

    await writeBlocks(
      settings.pagePrefix,
      calendars,
      {
        batchSize: settings.batchSize,
        batchDelayMs: settings.batchDelayMs,
        excludePatterns: settings.excludePatterns,
        titlePrefix: settings.titlePrefix,
        attendeeAliases: settings.attendeeAliases,
        showTime: settings.showTime,
        timeFormat: settings.timeFormat,
        recurringIndicator: settings.recurringIndicator,
        showTimezone: settings.showTimezone,
      }
    );

    // Calculate sync metrics
    const syncDurationMs = Math.round(performance.now() - syncStartTime);
    const eventsPerSecond = syncDurationMs > 0 ? Math.round((totalEvents / syncDurationMs) * 1000) : 0;

    // Log detailed metrics for debugging
    logDebug("sync_complete", {
      trigger,
      durationMs: syncDurationMs,
      totalEvents,
      eventsPerSecond,
      calendarsTotal: fetchResult.stats.total,
      calendarsCached: fetchResult.stats.cached,
      calendarsChanged: fetchResult.stats.changed,
      calendarsFailed: fetchResult.stats.failed,
      eventsFilteredOut: totalRawEvents - totalEvents,
      smartSync: smartSyncResult.stats,
    });

    // Build status message with incremental sync info
    const statusParts: string[] = [];
    statusParts.push(`${totalEvents} event(s) from ${calendars.length} calendar(s)`);
    if (fetchResult.stats.cached > 0) {
      statusParts.push(`(${fetchResult.stats.cached} cached)`);
    }
    if (settings.enableSmartSync && smartSyncResult.stats.unchanged > 0) {
      statusParts.push(`(${smartSyncResult.stats.unchanged} unchanged)`);
    }
    statusParts.push(`in ${(syncDurationMs / 1000).toFixed(1)}s`);

    if (trigger === "manual" || trigger === "force") {
      showStatusMessage(`Synced ${statusParts.join(" ")}`, "success");
    } else {
      logInfo(`Automatic sync completed: ${statusParts.join(" ")}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError("Failed to sync calendars", error);
    showStatusMessage(`Failed to sync calendars: ${message}`, "error");
  } finally {
    syncInProgress = false;
  }
}

function showStatusMessage(message: string, type: "info" | "warning" | "success" | "error") {
  const roamUI = (window as unknown as {
    roamAlphaAPI?: {
      ui?: {
        mainWindow?: {
          setStatusMessage?: (options: { message: string; type: string }) => void
        }
      }
    }
  }).roamAlphaAPI?.ui;

  const setStatus = roamUI?.mainWindow?.setStatusMessage;
  if (typeof setStatus === "function") {
    setStatus({ message, type });
  } else if (type === "error") {
    console.error(message);
  } else {
    console.info(message);
  }
}

/**
 * Starts the reminder checker interval.
 * Checks every minute for upcoming events that need reminders.
 */
function startReminderChecker(): void {
  if (reminderIntervalId) {
    return; // Already running
  }

  reminderIntervalId = setInterval(async () => {
    if (!extensionAPIRef || !settingsHandle) {
      return;
    }

    try {
      // Read settings to check if reminders are enabled
      const settings = readSettings(extensionAPIRef, settingsHandle);

      // Build reminder config from settings
      const reminderConfig: ReminderConfig = {
        enabled: settings.enableReminders,
        reminderMinutes: settings.reminderMinutes,
      };

      if (reminderConfig.enabled && lastSyncedEvents.length > 0) {
        const sent = await checkAndSendReminders(lastSyncedEvents, reminderConfig);
        if (sent > 0) {
          logDebug("reminders_sent", { count: sent });
        }
      }
    } catch (error) {
      logError("Reminder check failed", error);
    }
  }, REMINDER_CHECK_INTERVAL_MS);

  logDebug("reminder_checker_started", { intervalMs: REMINDER_CHECK_INTERVAL_MS });
}

/**
 * Stops the reminder checker interval.
 */
function stopReminderChecker(): void {
  if (reminderIntervalId) {
    clearInterval(reminderIntervalId);
    reminderIntervalId = null;
    logDebug("reminder_checker_stopped", {});
  }
}

/**
 * Processes calendar fetch errors and creates error report if enabled.
 */
async function handleSyncErrors(
  fetchResult: FetchAllResult,
  settings: SettingsSnapshot
): Promise<void> {
  if (fetchResult.errors.length === 0 || !settings.enableErrorReports) {
    return;
  }

  const errors: CalendarError[] = fetchResult.errors.map((fetchError: CalendarFetchError) => {
    const classified = classifyError(fetchError.error);
    return {
      calendarName: fetchError.name,
      url: fetchError.url,
      errorType: classified.type,
      httpStatus: classified.httpStatus,
      message: fetchError.error.message,
      timestamp: new Date(),
    };
  });

  const report: ErrorReport = {
    timestamp: new Date(),
    totalCalendars: fetchResult.stats.total,
    successCount: fetchResult.stats.total - fetchResult.stats.failed,
    failedCount: fetchResult.stats.failed,
    errors,
  };

  try {
    await createErrorReportPage(report);
    logInfo(`Created error report for ${errors.length} failed calendar(s)`);
  } catch (err) {
    logError("Failed to create error report page", err);
  }
}

/**
 * Applies smart sync to filter out unchanged events.
 */
function applySmartSync(
  allEvents: ICalEvent[],
  enabled: boolean
): { eventsToWrite: ICalEvent[]; stats: SmartSyncStats } {
  if (!enabled) {
    return {
      eventsToWrite: allEvents,
      stats: {
        totalEvents: allEvents.length,
        unchanged: 0,
        updated: 0,
        created: allEvents.length,
      },
    };
  }

  const cache = loadEventCache();
  const result = detectEventChanges(allEvents, cache);

  // Update cache with all events (to track them for next sync)
  updateEventCache(allEvents, cache);
  saveEventCache(cache);

  return {
    eventsToWrite: result.eventsToWrite,
    stats: result.stats,
  };
}

/**
 * Detects conflicts among events and logs them.
 */
function checkForConflicts(events: ICalEvent[]): void {
  const config: ConflictDetectionConfig = {
    enabled: true,
    excludeAllDay: true,
    minimumOverlapMinutes: 15,
  };

  const result = detectConflicts(events, config);

  if (result.totalConflicts > 0) {
    logInfo(`Detected ${result.totalConflicts} scheduling conflict(s)`);
    logDebug("conflicts_detected", {
      totalConflicts: result.totalConflicts,
      conflictingEventUids: Array.from(result.conflictingEventUids),
    });
  }
}
