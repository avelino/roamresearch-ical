# Roam iCal Sync

A Roam Research extension that syncs iCal (`.ics`) calendar feeds into your Roam graph.

## Features

- **Multiple Calendar Support**: Add any number of iCal URLs from Google Calendar, Outlook, Apple Calendar, or any service that provides .ics feeds
- **Automatic Sync**: Set a sync interval to keep your calendar events up to date
- **Clean Organization**: Events are stored in dedicated pages under `ical/<calendar-name>/<event-id>`
- **Roam Date Links**: Event dates are formatted as Roam daily note links (e.g., `[[January 2nd, 2025]]`)

## Installation

1. Open Roam Research
2. Go to **Roam Depot** → **Extensions**
3. Search for "iCal Sync"
4. Click **Install**

## Configuration

After installation, go to **Roam Depot** → **Extension Settings** → **iCal Sync**:

| Setting | Description | Default |
|---------|-------------|---------|
| **Target Page Prefix** | Prefix for event pages | `ical` |
| **Sync Interval** | Minutes between automatic syncs | `30` |
| **Calendars** | Your calendar URLs (see format below) | — |
| **Enable Debug Logs** | Show detailed logs in console | `false` |

### Calendar URL Format

Add one calendar per line in the format:

```
Name|URL
```

**Examples:**

```
Work|https://calendar.google.com/calendar/ical/work%40gmail.com/public/basic.ics
Personal|https://calendar.google.com/calendar/ical/personal%40gmail.com/public/basic.ics
```

If you only provide a URL without a name, the hostname will be used:

```
https://calendar.google.com/calendar/ical/example/basic.ics
```

### Getting iCal URLs

**Google Calendar:**

1. Open Google Calendar
2. Click the three dots next to your calendar
3. Select "Settings and sharing"
4. Scroll to "Secret address in iCal format"
5. Copy the URL

**Outlook/Office 365:**

1. Go to calendar.live.com or outlook.office.com
2. Click the gear icon → View all Outlook settings
3. Go to Calendar → Shared calendars
4. Under "Publish a calendar", select your calendar and click "Create"
5. Copy the ICS link

## Event Format

Events are synced with the following block structure:

```
[[January 2nd, 2025]] Meeting with team
  ical-id:: event-uid-123
  ical-desc:: Full event description here
  ical-location:: Conference Room A
  ical-url:: [link](https://example.com)
  ical-end:: [[January 2nd, 2025]]
```

Properties are only added when the event has that information.

## Manual Sync

You can trigger a manual sync in two ways:

1. Click the **calendar icon** in the topbar
2. Use the command palette (`Cmd/Ctrl + P`) and search for "iCal: Sync calendars"

## Page Structure

Events are organized as:

```
ical/
├── Work/
│   ├── event-id-1/
│   ├── event-id-2/
│   └── ...
├── Personal/
│   ├── event-id-3/
│   └── ...
└── ...
```

## License

MIT
