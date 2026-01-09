/** Default page prefix for iCal events */
export const DEFAULT_PAGE_PREFIX = "ical";

/** Property names for event blocks */
export const ICAL_ID_PROPERTY = "ical-id";
export const ICAL_DESC_PROPERTY = "ical-desc";
export const ICAL_LOCATION_PROPERTY = "ical-location";
export const ICAL_URL_PROPERTY = "ical-url";
export const ICAL_MEETING_URL_PROPERTY = "ical-meeting-url";
export const ICAL_ATTENDEES_PROPERTY = "ical-attendees";
export const ICAL_END_PROPERTY = "ical-end";

/** Config page title for fallback settings */
export const CONFIG_PAGE_TITLE = "roam/js/ical-sync";

/** Command palette label */
export const COMMAND_LABEL = "iCal: Sync calendars";

/** Topbar button configuration */
export const TOPBAR_BUTTON_ID = "roam-ical-sync-button";
export const TOPBAR_ICON_NAME = "calendar";

/** Batch processing defaults */
export const DEFAULT_BATCH_SIZE = 50;
export const DEFAULT_BATCH_DELAY_MS = 500;

/** Default patterns to exclude from sync (one per line) */
export const DEFAULT_EXCLUDE_PATTERNS = "^Busy$";

/** Default sync window in days (past and future) */
export const DEFAULT_SYNC_DAYS_PAST = 30;
export const DEFAULT_SYNC_DAYS_FUTURE = 30;

/** Default title prefix for event blocks */
export const DEFAULT_TITLE_PREFIX = "#gcal";

/** Time display settings */
export const DEFAULT_SHOW_TIME = true;
export const DEFAULT_TIME_FORMAT = "24h" as const;

/** Recurring event indicator settings */
export const DEFAULT_RECURRING_INDICATOR = "🔄"; // Options: "", "🔄", "#recurring"

/** Timezone display settings */
export const DEFAULT_SHOW_TIMEZONE = false;
export const ICAL_TIMEZONE_PROPERTY = "ical-timezone";

/** Calendar color settings */
export const ICAL_COLOR_PROPERTY = "ical-color";
export const DEFAULT_CALENDAR_COLORS = [
  "#4285f4", // Google Blue
  "#ea4335", // Google Red
  "#fbbc04", // Google Yellow
  "#34a853", // Google Green
  "#8e24aa", // Purple
  "#e67c73", // Salmon
  "#f6bf26", // Tangerine
  "#33b679", // Teal
];

/** Smart sync settings */
export const DEFAULT_ENABLE_SMART_SYNC = true;

/** Error reporting settings */
export const DEFAULT_ENABLE_ERROR_REPORTS = false;

/** Search command label */
export const SEARCH_COMMAND_LABEL = "iCal: Search events";
