import "./polyfills";

import { writeBlocks } from "./blocks";
import { fetchAllCalendars, filterEventsByDateRange, type ICalCalendar } from "./ical";
import {
  initializeSettings,
  readSettings,
  type SettingsHandle,
  type SettingsSnapshot,
} from "./settings";
import { cancelScheduledSync, scheduleAutoSync } from "./scheduler";
import { registerCommand, registerTopbarButton } from "./ui";
import { logError, logInfo, logDebug, setDebugEnabled } from "./logger";

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
let removeTopbarButton: (() => void) | null = null;
let initialized = false;

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
    refreshSettings();

    unregisterCommand = await registerCommand(extensionAPI, () => syncCalendars("manual"));
    removeTopbarButton = registerTopbarButton(() => syncCalendars("manual"));

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
  if (removeTopbarButton) {
    removeTopbarButton();
    removeTopbarButton = null;
  }
  if (unregisterCommand) {
    void unregisterCommand();
    unregisterCommand = null;
  }
  settingsHandle?.dispose();
  settingsHandle = null;
  extensionAPIRef = null;
  lastIntervalMs = null;
  lastCalendarCount = undefined;
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

async function syncCalendars(trigger: "manual" | "auto") {
  if (syncInProgress) {
    if (trigger === "manual") {
      showStatusMessage("Sync is already in progress.", "warning");
    }
    return;
  }

  const settings = refreshSettings();

  if (settings.calendars.length === 0) {
    if (trigger === "manual") {
      showStatusMessage(
        "Please add calendar URLs in extension settings (Roam Depot → Extension Settings → iCal Sync).",
        "warning"
      );
    }
    return;
  }

  syncInProgress = true;
  if (trigger === "manual") {
    showStatusMessage(`Syncing ${settings.calendars.length} calendar(s)...`, "info");
  }

  try {
    logDebug("sync_start", {
      calendarCount: settings.calendars.length,
      calendars: settings.calendars.map(c => c.name),
      syncDaysPast: settings.syncDaysPast,
      syncDaysFuture: settings.syncDaysFuture,
    });

    const rawCalendars: ICalCalendar[] = await fetchAllCalendars(settings.calendars, settings.corsProxy);
    const totalRawEvents = rawCalendars.reduce((sum, cal) => sum + cal.events.length, 0);

    // Filter events by date range
    const dateRangeConfig = {
      daysPast: settings.syncDaysPast,
      daysFuture: settings.syncDaysFuture,
    };
    const calendars: ICalCalendar[] = rawCalendars.map(cal => ({
      ...cal,
      events: filterEventsByDateRange(cal.events, dateRangeConfig),
    }));

    const totalEvents = calendars.reduce((sum, cal) => sum + cal.events.length, 0);

    logDebug("sync_fetched", {
      calendarsLoaded: calendars.length,
      totalRawEvents,
      totalEventsAfterDateFilter: totalEvents,
      filteredOut: totalRawEvents - totalEvents,
    });

    if (calendars.length === 0) {
      if (trigger === "manual") {
        showStatusMessage("No calendars could be loaded. Check your URLs.", "warning");
      }
      return;
    }

    await writeBlocks(
      settings.pagePrefix,
      calendars,
      {
        batchSize: settings.batchSize,
        batchDelayMs: settings.batchDelayMs,
        excludePatterns: settings.excludePatterns,
      }
    );

    if (trigger === "manual") {
      showStatusMessage(
        `Synced ${totalEvents} event(s) from ${calendars.length} calendar(s).`,
        "success"
      );
    } else {
      logInfo(`Automatic sync completed: ${totalEvents} events from ${calendars.length} calendars`);
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
