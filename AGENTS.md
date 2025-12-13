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

- Package manager: npm (CI uses `./build.sh`); lockfile `pnpm-lock.yaml` for local development with pnpm.
- Install deps before running scripts: `npm install` or `npx pnpm install`.
- Build command: `./build.sh` or `npm run build` (runs `tsc` then `vite build` producing `extension.js` in project root).
- Lint command: `npx pnpm exec eslint ./src --ext .ts`.
- Check command: `npx pnpm check` (runs lint + build in sequence).
- Target Node version matches CI (`actions/setup-node@v3`) using Node 20.8+.

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
- `fetchICalCalendar`: Fetches and parses a single calendar URL.
- `fetchAllCalendars`: Fetches multiple calendars in parallel.
- `formatRoamDate`: Converts Date to Roam format (e.g., "January 2nd, 2025").
- `safeText`: Sanitizes text for block content.
- `sanitizeEventId`: Creates safe event IDs for page names.
- `sortEventsByDateDescending`: Sorts events by date (most recent first); events without dates go to the end.
- `shouldExcludeEvent`: Checks if an event title matches any exclude pattern.
- `filterExcludedEvents`: Filters out events whose titles match exclude patterns.
- `isEventInDateRange`: Checks if an event falls within the configured sync window.
- `filterEventsByDateRange`: Filters events to only include those within the sync window (days past/future).

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
- `parseCalendarsConfig`: Parses calendar URL list from settings (format: `name|url`).
- Settings keys: `page_prefix`, `sync_interval_minutes`, `calendars`, `cors_proxy`, `enable_debug_logs`, `batch_size`, `batch_delay_ms`, `exclude_title_patterns`, `sync_days_past`, `sync_days_future`, `title_prefix`.

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
| CORS Proxy | `cors_proxy` | `https://corsproxy.io/?url=` | CORS proxy URL to bypass browser restrictions |
| Enable Debug Logs | `enable_debug_logs` | `false` | Show debug logs in console |
| Batch Size | `batch_size` | `50` | Number of events to process per batch. Lower values reduce UI freezing |
| Batch Delay (ms) | `batch_delay_ms` | `500` | Delay between batches in milliseconds. Higher values reduce UI freezing |
| Exclude Title Patterns | `exclude_title_patterns` | `^Busy$` | Regex patterns (one per line) to exclude events by title |
| Sync Days Past | `sync_days_past` | `30` | Number of days in the past to include events |
| Sync Days Future | `sync_days_future` | `30` | Number of days in the future to include events |
| Title Prefix | `title_prefix` | `#gcal` | Optional prefix prepended to event titles. Can be any text or tag |

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

- Run `npm install` or `npx pnpm install` when dependencies change.
- Run `npx pnpm exec eslint ./src --ext .ts`.
- Run `./build.sh` or `npm run build` to ensure type-checking and bundling succeed.
