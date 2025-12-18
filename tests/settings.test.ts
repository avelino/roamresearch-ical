import { describe, it, expect } from "vitest";
import {
  isValidUrl,
  parseCalendarsConfig,
  validateCalendarUrl,
} from "../src/settings";

describe("isValidUrl", () => {
  it("should return true for valid HTTP URLs", () => {
    expect(isValidUrl("http://example.com")).toBe(true);
  });

  it("should return true for valid HTTPS URLs", () => {
    expect(isValidUrl("https://example.com")).toBe(true);
  });

  it("should return true for URLs with paths", () => {
    expect(isValidUrl("https://example.com/path/to/calendar.ics")).toBe(true);
  });

  it("should return true for URLs with query params", () => {
    expect(isValidUrl("https://example.com/calendar?key=value")).toBe(true);
  });

  it("should return false for FTP URLs", () => {
    expect(isValidUrl("ftp://example.com")).toBe(false);
  });

  it("should return false for invalid URLs", () => {
    expect(isValidUrl("not-a-url")).toBe(false);
  });

  it("should return false for empty string", () => {
    expect(isValidUrl("")).toBe(false);
  });

  it("should return false for relative paths", () => {
    expect(isValidUrl("/path/to/file")).toBe(false);
  });
});

describe("parseCalendarsConfig", () => {
  it("should parse valid name|url format", () => {
    const input = "Work|https://example.com/calendar.ics";
    const result = parseCalendarsConfig(input);

    expect(result.calendars).toHaveLength(1);
    expect(result.calendars[0]).toEqual({
      name: "Work",
      url: "https://example.com/calendar.ics",
    });
    expect(result.errors).toHaveLength(0);
  });

  it("should parse multiple calendars", () => {
    const input = `Work|https://work.com/cal.ics
Personal|https://personal.com/cal.ics`;

    const result = parseCalendarsConfig(input);

    expect(result.calendars).toHaveLength(2);
    expect(result.calendars[0].name).toBe("Work");
    expect(result.calendars[1].name).toBe("Personal");
    expect(result.errors).toHaveLength(0);
  });

  it("should skip empty lines", () => {
    const input = `Work|https://work.com/cal.ics

Personal|https://personal.com/cal.ics`;

    const result = parseCalendarsConfig(input);
    expect(result.calendars).toHaveLength(2);
  });

  it("should skip comment lines starting with #", () => {
    const input = `# This is a comment
Work|https://work.com/cal.ics`;

    const result = parseCalendarsConfig(input);
    expect(result.calendars).toHaveLength(1);
    expect(result.calendars[0].name).toBe("Work");
  });

  it("should skip comment lines starting with //", () => {
    const input = `// This is a comment
Work|https://work.com/cal.ics`;

    const result = parseCalendarsConfig(input);
    expect(result.calendars).toHaveLength(1);
  });

  it("should handle URL-only lines by extracting hostname", () => {
    const input = "https://calendar.google.com/calendar/ical/test.ics";
    const result = parseCalendarsConfig(input);

    expect(result.calendars).toHaveLength(1);
    expect(result.calendars[0].name).toBe("calendar.google.com");
    expect(result.calendars[0].url).toBe(input);
  });

  it("should report error for invalid URL format", () => {
    const input = "Work|not-a-valid-url";
    const result = parseCalendarsConfig(input);

    expect(result.calendars).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain("Invalid URL format");
  });

  it("should report error for empty name", () => {
    const input = "|https://example.com/cal.ics";
    const result = parseCalendarsConfig(input);

    expect(result.calendars).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain("name is empty");
  });

  it("should report error for empty URL", () => {
    const input = "Work|";
    const result = parseCalendarsConfig(input);

    expect(result.calendars).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain("URL is empty");
  });

  it("should report error for URL-only invalid format", () => {
    const input = "not-a-url";
    const result = parseCalendarsConfig(input);

    expect(result.calendars).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
  });

  it("should handle empty input", () => {
    const result = parseCalendarsConfig("");
    expect(result.calendars).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("should trim whitespace from names and URLs", () => {
    const input = "  Work  |  https://example.com/cal.ics  ";
    const result = parseCalendarsConfig(input);

    expect(result.calendars).toHaveLength(1);
    expect(result.calendars[0].name).toBe("Work");
    expect(result.calendars[0].url).toBe("https://example.com/cal.ics");
  });

  it("should handle mixed valid and invalid entries", () => {
    const input = `Work|https://work.com/cal.ics
Invalid|not-a-url
Personal|https://personal.com/cal.ics`;

    const result = parseCalendarsConfig(input);

    expect(result.calendars).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
  });

  it("should handle Windows-style line endings (CRLF)", () => {
    const input = "Work|https://work.com/cal.ics\r\nPersonal|https://personal.com/cal.ics";
    const result = parseCalendarsConfig(input);

    expect(result.calendars).toHaveLength(2);
  });
});

describe("validateCalendarUrl", () => {
  it("should return valid for correct HTTPS URL", async () => {
    const result = await validateCalendarUrl("https://example.com/calendar.ics", false);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("should return invalid for empty URL", async () => {
    const result = await validateCalendarUrl("", false);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("URL is empty");
  });

  it("should return invalid for malformed URL", async () => {
    const result = await validateCalendarUrl("not-a-url", false);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid URL format");
  });

  it("should trim whitespace from URL", async () => {
    const result = await validateCalendarUrl("  https://example.com/calendar.ics  ", false);
    expect(result.valid).toBe(true);
    expect(result.url).toBe("https://example.com/calendar.ics");
  });

  it("should return valid for HTTP URL", async () => {
    const result = await validateCalendarUrl("http://example.com/calendar.ics", false);
    expect(result.valid).toBe(true);
  });

  it("should return invalid for FTP URL", async () => {
    const result = await validateCalendarUrl("ftp://example.com/file.ics", false);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid URL format");
  });

  it("should validate Google Calendar URLs", async () => {
    const result = await validateCalendarUrl(
      "https://calendar.google.com/calendar/ical/test%40gmail.com/public/basic.ics",
      false
    );
    expect(result.valid).toBe(true);
  });

  it("should validate Outlook URLs", async () => {
    const result = await validateCalendarUrl(
      "https://outlook.office365.com/owa/calendar/abc123/calendar.ics",
      false
    );
    expect(result.valid).toBe(true);
  });
});
