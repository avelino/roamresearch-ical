# [1.1.0](https://github.com/avelino/roamresearch-ical/compare/v1.0.0...v1.1.0) (2025-12-14)


### Bug Fixes

* buildEventBlock's JOIN MEETING link is now bolded correctly ([84314d0](https://github.com/avelino/roamresearch-ical/commit/84314d0502333bd966c3514dae11fa98d897ea28))
* compilation errors in attendee extraction and writeBlocks call ([014e843](https://github.com/avelino/roamresearch-ical/commit/014e843c7965e2c35f919937f995f1c1e4875836))
* prevent email addresses from being used as Roam page titles ([dd1616b](https://github.com/avelino/roamresearch-ical/commit/dd1616bd49fa228b71320342f4c1dcf15f126b07))


### Features

* add "Join Meeting" button detection for events ([10a030f](https://github.com/avelino/roamresearch-ical/commit/10a030fffb12b790ebb64513b22d03f6611bf908))
* add attendee extraction and alias mapping ([4df37a4](https://github.com/avelino/roamresearch-ical/commit/4df37a48a7cda75dbb3609c4dd712ea4110f979e))

# 1.0.0 (2025-12-12)


### Features

* overhaul performance guidelines, non-blocking batch sync improvements ([2751d7f](https://github.com/avelino/roamresearch-ical/commit/2751d7f9e194192146a2b5b21b9b067762bfb93a))
* **settings:** add custom title prefix option for event blocks ([d3209fd](https://github.com/avelino/roamresearch-ical/commit/d3209fd2fc78a32c0a29aced3ea30a7c8bed8036))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-01-02

### Added

- Initial release of Roam iCal Sync
- Support for multiple iCal (.ics) calendar URLs
- Automatic sync with configurable interval
- Manual sync via command palette and topbar button
- Events organized in dedicated pages: `ical/<calendar>/<event-id>`
- Roam-style date formatting (e.g., `[[January 2nd, 2025]]`)
- Event properties: description, location, URL, end date
- Settings panel for easy configuration
- Debug logging option for troubleshooting
