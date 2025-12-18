# Roam iCal Sync – Agent Guidelines

## Project Snapshot

- Roam Research extension written in strict TypeScript, bundled with Vite (`./build.sh` or `npm run build`).
- Main entry: `src/main.ts`; supporting modules: `ical.ts`, `blocks.ts`, `settings.ts`, `scheduler.ts`, `ui.ts`, `logger.ts`, `constants.ts`.
- Exports `{ onload, onunload }` object for Roam Depot compatibility (ES module format).
- Interacts with the Roam runtime via direct `roamAlphaAPI` calls for UI, scheduling, and page mutations; fetches iCal feeds via HTTPS.
- Configuration is managed via Roam Depot → Extension Settings → "iCal Sync". Defaults are applied on first load; respect user edits and persist values using `extensionAPI.settings`. Falls back to config page `roam/js/ical-sync` when settings panel is unavailable.
- Events are organized in pages: `{pagePrefix}/{calendarName}/{eventId}`. Dates displayed follow the Roam daily note pattern (`MMMM Do, YYYY` – e.g., "January 1st, 2025").
- Event properties (id, description, location, url, end) are stored as child blocks under the main event block.

## Environment & Tooling

- Package manager: npm with `package-lock.json`.
- Install deps: `npm install` (or `npm ci` for CI environments).
- Build command: `npm run build` (runs `tsc` then `vite build` producing `extension.js` in project root).
- Lint command: `npm run lint`.
- Test command: `npm test` (runs Vitest unit tests).
- Check command: `npm run check` (runs lint + test + build in sequence).
- Target Node versions: 20.x, 22.x (see CI workflow).

## Code Structure Rules

- Preserve module boundaries:
  - `ical.ts`: iCal DTOs, parsing utilities, fetch helpers, date formatting.
  - `blocks.ts`: Block composition, page organization, `resolveEventPageName`, `writeBlocks`.
  - `settings.ts`: Roam API wrappers, settings reading/initialization, panel registration.
  - `scheduler.ts`: `scheduleAutoSync`, `cancelScheduledSync` for automatic sync timing.
  - `logger.ts`: Logging helpers (`logInfo`, `logWarn`, `logDebug`, `logError`) with debug flag control.
  - `ui.ts`: UI wiring (command palette, topbar button).
  - `constants.ts`: Runtime constants (property names, default values).
- UI wiring (command palette, top bar icons) must remain in `ui.ts`.
- Reuse logging helpers instead of raw `console.*`.
- Document public functions with concise JSDoc.

## Module Details

### main.ts

- Entry point for the extension with `onload` and `onunload` handlers.
- Manages extension lifecycle: settings initialization, command/button registration, auto-sync scheduling.
- Orchestrates sync flow: fetch calendars → parse events → write blocks.

### ical.ts

- `parseICalContent`: Parses raw .ics file content into `ICalEvent[]`.
- `fetchICalCalendar`: Fetches and parses a single calendar URL. Uses Roam's native CORS proxy. Supports incremental sync with caching.
- `fetchAllCalendars`: Fetches multiple calendars with incremental sync support. Returns `FetchAllResult` with stats on changed/cached/failed calendars.
- `formatRoamDate`: Converts Date to Roam format (e.g., "January 2nd, 2025").
- `safeText`: Sanitizes text for block content.
- `sanitizeEventId`: Creates safe event IDs for page names.
- `sortEventsByDateDescending`: Sorts events by date (most recent first); events without dates go to the end.
- `shouldExcludeEvent`: Checks if an event title matches any exclude pattern.
- `filterExcludedEvents`: Filters out events whose titles match exclude patterns.
- `isEventInDateRange`: Checks if an event falls within the configured sync window.
- `filterEventsByDateRange`: Filters events to only include those within the sync window (days past/future).
- `clearCalendarCache`: Clears the incremental sync cache (used for force sync).
- `extractVideoConferenceUrl`: Extracts video conference URLs from event location/description. Supports 20+ services.

#### Incremental Sync

The module implements an incremental sync system to avoid re-downloading unchanged calendars:

- **Cache System**: `CalendarCacheEntry` stores URL, ETag, Last-Modified header, content hash, and last fetch timestamp.
- **HTTP Caching**: Uses `If-None-Match` and `If-Modified-Since` headers for conditional requests.
- **Content Hashing**: FNV-1a hash of calendar content for change detection when HTTP caching is unavailable.
- **Force Sync**: Calling `clearCalendarCache()` forces a full re-download of all calendars.

#### Supported Video Conference Services

The `extractVideoConferenceUrl` function detects URLs for:
- Zoom, Google Meet, Microsoft Teams, Webex
- Whereby, Jitsi, Discord, Slack Huddles
- Amazon Chime, BlueJeans, RingCentral
- Loom, Around, Skype, Gather
- Tuple, Pop, Riverside, StreamYard

### blocks.ts

- `resolveEventPageName`: Returns `{pagePrefix}/{calendarName}/{eventId}` as destination page.
- `writeBlocks`: Distributes events to their dedicated pages using batch processing. Events are sorted by date (most recent first) to prioritize current events during initial sync. Accepts optional `BatchConfig` for controlling batch size and delay.
- `buildEventBlock`: Generates the block structure for an event.
- `BatchConfig`: Type defining batch processing settings (`batchSize`, `batchDelayMs`).
- `BatchProgressCallback`: Optional callback type for progress reporting during sync.

### settings.ts

- Roam API wrappers: `getBasicTreeByParentUid`, `getPageUidByPageTitle`, `createPage`, `createBlock`, etc.
- `initializeSettings`: Detects settings panel support; registers panel or creates config page.
- `readSettings`: Returns `SettingsSnapshot` from panel or page-based config.
- `parseCalendarsConfig`: Parses calendar URL list from settings (format: `name|url`). Returns validation results.
- `isValidUrl`: Validates URL format.
- `validateCalendarUrl`: Validates a single calendar URL with optional connection test.
- `validateAllCalendars`: Validates all configured calendars.
- Settings keys: `page_prefix`, `sync_interval_minutes`, `calendars`, `enable_debug_logs`, `batch_size`, `batch_delay_ms`, `exclude_title_patterns`, `sync_days_past`, `sync_days_future`, `title_prefix`.

#### URL Validation

The module provides calendar URL validation with visual feedback:

- **Format Validation**: Checks URL syntax, requires HTTPS protocol, validates .ics extension or webcal scheme.
- **Connection Testing**: Optional test that fetches the URL to verify accessibility and content type.
- **React Component**: `CalendarsTextArea` component with visual validation indicators and "Test Connections" button.
- **Validation States**: Shows green checkmarks for valid URLs, red X for invalid, with error messages.

### scheduler.ts

- `scheduleAutoSync`: Idempotent scheduling with `setTimeout`; cancels previous timer before creating new one.
- `cancelScheduledSync`: Clears pending timer on unload or settings change.

### ui.ts

- `registerCommand`: Adds "iCal: Sync calendars" to command palette.
- `registerTopbarButton`: Creates icon button in Roam topbar with `calendar` icon.

### logger.ts

- `setDebugEnabled`: Toggles debug/info log visibility.
- `logInfo`, `logWarn`: Conditional logging when debug is enabled.
- `logError`: Always visible regardless of debug setting.
- `logDebug`: Structured logging with operation name and data object.

### constants.ts

- Property names: `ical-id`, `ical-desc`, `ical-location`, `ical-url`, `ical-end`.
- Default values: page prefix (`ical`), batch size (`50`), batch delay (`500ms`), sync days past (`30`), sync days future (`30`), title prefix (`#gcal`).
- UI constants: command label, topbar button ID/icon.

## Block Structure

Events are written with the following structure:

```
#gcal [[Date]] Event title #calendar-name
  ical-id:: unique-event-uid
  ical-desc:: Full description (if present)
  ical-location:: Location (if present)
  ical-url:: [link](url) (if present)
  ical-end:: [[End Date]] (if different from start)
```

The calendar name is sanitized to lowercase, spaces replaced with hyphens, and special characters removed (e.g., "Work Calendar" becomes `#work-calendar`). The title prefix (default: `#gcal`) is prepended before the date and can be customized or left empty.

## Settings Reference

| Setting | Key | Default | Description |
|---------|-----|---------|-------------|
| Target Page Prefix | `page_prefix` | `ical` | Prefix for event pages |
| Sync Interval | `sync_interval_minutes` | `30` | Minutes between auto-syncs (min: 1) |
| Calendars | `calendars` | (empty) | Calendar URLs in format `name|url`, one per line |
| Enable Debug Logs | `enable_debug_logs` | `false` | Show debug logs in console |
| Batch Size | `batch_size` | `50` | Number of events to process per batch. Lower values reduce UI freezing |
| Batch Delay (ms) | `batch_delay_ms` | `500` | Delay between batches in milliseconds. Higher values reduce UI freezing |
| Exclude Title Patterns | `exclude_title_patterns` | `^Busy$` | Regex patterns (one per line) to exclude events by title |
| Sync Days Past | `sync_days_past` | `30` | Number of days in the past to include events |
| Sync Days Future | `sync_days_future` | `30` | Number of days in the future to include events |
| Title Prefix | `title_prefix` | `#gcal` | Optional prefix prepended to event titles. Can be any text or tag |

> **CORS Proxy**: The extension uses Roam's native CORS proxy (`roamAlphaAPI.constants.corsAnywhereProxyUrl`) to bypass browser restrictions when fetching calendar feeds. This proxy is hosted by the Roam team and only works from Roam domains.

## Performance & Batch Processing

To prevent UI freezing with large calendars:

1. **Non-blocking fetch**: Calendar fetching yields to main thread before and after network requests, ensuring UI remains responsive during downloads.
2. **Non-blocking parsing**: iCal parsing yields every 50 events to prevent blocking during heavy parsing operations.
3. **Sequential calendar processing**: Calendars are fetched and parsed sequentially (not in parallel) with yields between each, preventing CPU spikes.
4. **Non-blocking filtering**: Date range and exclusion filtering yield periodically to prevent blocking with large event lists.
5. **Date range filtering**: Events are filtered to only include those within the configured sync window (default: 30 days past, 30 days future). This significantly reduces the number of events processed.
6. **Date-based sorting**: Events are sorted by date (most recent first) before processing. This ensures current/upcoming events are synced first during initial imports.
7. **Batch processing**: Events are processed in configurable batches (default: 50 events per batch).
8. **Inter-batch delay**: A configurable delay (default: 500ms) between batches allows the UI to remain responsive.
9. **Yielding to main thread**: Within each batch, the extension periodically yields control back to the browser to prevent blocking.
10. **Duplicate detection**: Events with the same UID (recurring events) are deduplicated to prevent creating multiple blocks for the same event.

## Quality Gates

- Run `npm install` when dependencies change.
- Run `npm run lint` to check code style.
- Run `npm test` to run unit tests (93 tests covering ical.ts and settings.ts).
- Run `npm run build` to ensure type-checking and bundling succeed.
- Run `npm run check` to run all checks (lint + test + build) in sequence.

## Testing

The project uses Vitest for unit testing with the following structure:

- **Test files**: `tests/*.test.ts` (also supports `src/**/*.test.ts`)
- **Configuration**: `vitest.config.ts` with `tsconfig.test.json`
- **Coverage**: v8 provider with 70% threshold for statements, branches, functions, and lines

### Test Suites

- **tests/ical.test.ts** (63 tests): Tests for iCal parsing, date formatting, event filtering, video conference URL extraction, and incremental sync cache.
- **tests/settings.test.ts** (30 tests): Tests for URL validation, calendar config parsing, and settings utilities.

## CI/CD

GitHub Actions workflow (`.github/workflows/ci.yml`) runs on push/PR to main:

1. Tests on Node.js 20.x and 22.x
2. Steps: checkout → setup node → npm ci → lint → test → build
