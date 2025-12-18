import { describe, it, expect } from "vitest";
import {
  extractMeetingUrl,
  extractMeetingUrlWithService,
  formatRoamDate,
  safeText,
  hashEventId,
  sanitizeEventId,
  sortEventsByDateDescending,
  shouldExcludeEvent,
  isEventInDateRange,
  type ICalEvent,
  type DateRangeConfig,
} from "../src/ical";

describe("extractMeetingUrl", () => {
  describe("Zoom URLs", () => {
    it("should extract Zoom /j/ meeting URLs", () => {
      const text = "Join at https://zoom.us/j/123456789";
      expect(extractMeetingUrl(text)).toBe("https://zoom.us/j/123456789");
    });

    it("should extract Zoom /my/ personal meeting URLs", () => {
      const text = "Join at https://zoom.us/my/username";
      expect(extractMeetingUrl(text)).toBe("https://zoom.us/my/username");
    });

    it("should extract Zoom URLs with password", () => {
      const text = "Join at https://zoom.us/j/123456789?pwd=abc123";
      expect(extractMeetingUrl(text)).toBe("https://zoom.us/j/123456789?pwd=abc123");
    });

    it("should extract Zoom URLs with subdomain", () => {
      const text = "Join at https://company.zoom.us/j/123456789";
      expect(extractMeetingUrl(text)).toBe("https://company.zoom.us/j/123456789");
    });
  });

  describe("Google Meet URLs", () => {
    it("should extract Google Meet URLs", () => {
      const text = "Join at https://meet.google.com/abc-defg-hij";
      expect(extractMeetingUrl(text)).toBe("https://meet.google.com/abc-defg-hij");
    });

    it("should not match invalid Google Meet URLs", () => {
      const text = "Not a meet: https://meet.google.com/invalid";
      expect(extractMeetingUrl(text)).toBeUndefined();
    });
  });

  describe("Microsoft Teams URLs", () => {
    it("should extract Teams meetup-join URLs", () => {
      const text = "Join at https://teams.microsoft.com/l/meetup-join/19%3abc123";
      expect(extractMeetingUrl(text)).toBe("https://teams.microsoft.com/l/meetup-join/19%3abc123");
    });

    it("should extract Teams live.com URLs", () => {
      const text = "Join at https://teams.live.com/meet/abc123";
      expect(extractMeetingUrl(text)).toBe("https://teams.live.com/meet/abc123");
    });
  });

  describe("Webex URLs", () => {
    it("should extract Webex meet URLs", () => {
      const text = "Join at https://company.webex.com/meet/username";
      expect(extractMeetingUrl(text)).toBe("https://company.webex.com/meet/username");
    });

    it("should extract Webex join URLs", () => {
      const text = "Join at https://company.webex.com/join/meeting123";
      expect(extractMeetingUrl(text)).toBe("https://company.webex.com/join/meeting123");
    });
  });

  describe("GoToMeeting URLs", () => {
    it("should extract GoToMeeting URLs", () => {
      const text = "Join at https://global.gotomeeting.com/join/123456789";
      expect(extractMeetingUrl(text)).toBe("https://global.gotomeeting.com/join/123456789");
    });

    it("should extract gotomeet.me short URLs", () => {
      const text = "Join at https://gotomeet.me/123456789";
      expect(extractMeetingUrl(text)).toBe("https://gotomeet.me/123456789");
    });
  });

  describe("Whereby URLs", () => {
    it("should extract Whereby room URLs", () => {
      const text = "Join at https://whereby.com/my-room";
      expect(extractMeetingUrl(text)).toBe("https://whereby.com/my-room");
    });
  });

  describe("Jitsi URLs", () => {
    it("should extract Jitsi meet.jit.si URLs", () => {
      const text = "Join at https://meet.jit.si/MyMeeting";
      expect(extractMeetingUrl(text)).toBe("https://meet.jit.si/MyMeeting");
    });

    it("should extract 8x8 URLs", () => {
      const text = "Join at https://8x8.vc/my-meeting";
      expect(extractMeetingUrl(text)).toBe("https://8x8.vc/my-meeting");
    });
  });

  describe("Discord URLs", () => {
    it("should extract Discord invite URLs", () => {
      const text = "Join at https://discord.gg/abc123";
      expect(extractMeetingUrl(text)).toBe("https://discord.gg/abc123");
    });

    it("should extract Discord.com invite URLs", () => {
      const text = "Join at https://discord.com/invite/abc123";
      expect(extractMeetingUrl(text)).toBe("https://discord.com/invite/abc123");
    });
  });

  describe("Slack URLs", () => {
    it("should extract Slack huddle URLs", () => {
      const text = "Join at https://company.slack.com/huddle/C123/abc";
      expect(extractMeetingUrl(text)).toBe("https://company.slack.com/huddle/C123/abc");
    });
  });

  describe("Amazon Chime URLs", () => {
    it("should extract Chime meeting URLs", () => {
      const text = "Join at https://chime.aws/meetings/abc-123-def";
      expect(extractMeetingUrl(text)).toBe("https://chime.aws/meetings/abc-123-def");
    });
  });

  describe("BlueJeans URLs", () => {
    it("should extract BlueJeans meeting URLs", () => {
      const text = "Join at https://bluejeans.com/123456789";
      expect(extractMeetingUrl(text)).toBe("https://bluejeans.com/123456789");
    });
  });

  describe("RingCentral URLs", () => {
    it("should extract RingCentral join URLs", () => {
      const text = "Join at https://meetings.ringcentral.com/j/123456789";
      expect(extractMeetingUrl(text)).toBe("https://meetings.ringcentral.com/j/123456789");
    });
  });

  describe("Skype URLs", () => {
    it("should extract Skype join URLs", () => {
      const text = "Join at https://join.skype.com/abc123";
      expect(extractMeetingUrl(text)).toBe("https://join.skype.com/abc123");
    });
  });

  describe("Gather URLs", () => {
    it("should extract Gather.town URLs", () => {
      const text = "Join at https://gather.town/app/abc123/space";
      expect(extractMeetingUrl(text)).toBe("https://gather.town/app/abc123/space");
    });
  });

  describe("Edge cases", () => {
    it("should return undefined for null input", () => {
      expect(extractMeetingUrl(null)).toBeUndefined();
    });

    it("should return undefined for undefined input", () => {
      expect(extractMeetingUrl(undefined)).toBeUndefined();
    });

    it("should return undefined for empty string", () => {
      expect(extractMeetingUrl("")).toBeUndefined();
    });

    it("should return undefined for text without meeting URL", () => {
      expect(extractMeetingUrl("No meeting here")).toBeUndefined();
    });

    it("should extract first matching URL when multiple present", () => {
      const text = "Zoom: https://zoom.us/j/123 or Meet: https://meet.google.com/abc-defg-hij";
      expect(extractMeetingUrl(text)).toBe("https://zoom.us/j/123");
    });
  });
});

describe("extractMeetingUrlWithService", () => {
  it("should return URL and service name for Zoom", () => {
    const result = extractMeetingUrlWithService("https://zoom.us/j/123456789");
    expect(result).toEqual({ url: "https://zoom.us/j/123456789", service: "Zoom" });
  });

  it("should return URL and service name for Google Meet", () => {
    const result = extractMeetingUrlWithService("https://meet.google.com/abc-defg-hij");
    expect(result).toEqual({ url: "https://meet.google.com/abc-defg-hij", service: "Google Meet" });
  });

  it("should return undefined for non-meeting URL", () => {
    expect(extractMeetingUrlWithService("https://example.com")).toBeUndefined();
  });
});

describe("formatRoamDate", () => {
  it("should format date with ordinal suffix 'st'", () => {
    const date = new Date(2025, 0, 1); // January 1st, 2025
    expect(formatRoamDate(date)).toBe("January 1st, 2025");
  });

  it("should format date with ordinal suffix 'nd'", () => {
    const date = new Date(2025, 0, 2); // January 2nd, 2025
    expect(formatRoamDate(date)).toBe("January 2nd, 2025");
  });

  it("should format date with ordinal suffix 'rd'", () => {
    const date = new Date(2025, 0, 3); // January 3rd, 2025
    expect(formatRoamDate(date)).toBe("January 3rd, 2025");
  });

  it("should format date with ordinal suffix 'th'", () => {
    const date = new Date(2025, 0, 4); // January 4th, 2025
    expect(formatRoamDate(date)).toBe("January 4th, 2025");
  });

  it("should handle 11th, 12th, 13th exceptions", () => {
    expect(formatRoamDate(new Date(2025, 0, 11))).toBe("January 11th, 2025");
    expect(formatRoamDate(new Date(2025, 0, 12))).toBe("January 12th, 2025");
    expect(formatRoamDate(new Date(2025, 0, 13))).toBe("January 13th, 2025");
  });

  it("should handle 21st, 22nd, 23rd", () => {
    expect(formatRoamDate(new Date(2025, 0, 21))).toBe("January 21st, 2025");
    expect(formatRoamDate(new Date(2025, 0, 22))).toBe("January 22nd, 2025");
    expect(formatRoamDate(new Date(2025, 0, 23))).toBe("January 23rd, 2025");
  });

  it("should format all months correctly", () => {
    const months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    months.forEach((month, index) => {
      const date = new Date(2025, index, 15);
      expect(formatRoamDate(date)).toContain(month);
    });
  });
});

describe("safeText", () => {
  it("should return empty string for null", () => {
    expect(safeText(null)).toBe("");
  });

  it("should return empty string for undefined", () => {
    expect(safeText(undefined)).toBe("");
  });

  it("should trim whitespace", () => {
    expect(safeText("  hello  ")).toBe("hello");
  });

  it("should replace newlines with spaces", () => {
    expect(safeText("hello\nworld")).toBe("hello world");
  });

  it("should replace carriage returns with spaces", () => {
    expect(safeText("hello\r\nworld")).toBe("hello world");
  });

  it("should collapse multiple newlines", () => {
    expect(safeText("hello\n\n\nworld")).toBe("hello world");
  });
});

describe("hashEventId", () => {
  it("should produce consistent hash for same input", () => {
    const hash1 = hashEventId("test-event-id");
    const hash2 = hashEventId("test-event-id");
    expect(hash1).toBe(hash2);
  });

  it("should produce different hashes for different inputs", () => {
    const hash1 = hashEventId("event-1");
    const hash2 = hashEventId("event-2");
    expect(hash1).not.toBe(hash2);
  });

  it("should produce alphanumeric output", () => {
    const hash = hashEventId("test-event");
    expect(hash).toMatch(/^[a-z0-9]+$/);
  });

  it("should produce reasonably short output", () => {
    const hash = hashEventId("very-long-event-id-with-lots-of-characters-and-special@chars.com");
    expect(hash.length).toBeLessThan(20);
  });
});

describe("sanitizeEventId", () => {
  it("should produce same output as hashEventId", () => {
    const id = "test-event@example.com";
    expect(sanitizeEventId(id)).toBe(hashEventId(id));
  });
});

describe("sortEventsByDateDescending", () => {
  it("should sort events by date, most recent first", () => {
    const events: ICalEvent[] = [
      { uid: "1", summary: "First", dtstart: new Date(2025, 0, 1), dtend: null, description: "", location: "", url: "", attendees: [] },
      { uid: "2", summary: "Third", dtstart: new Date(2025, 0, 3), dtend: null, description: "", location: "", url: "", attendees: [] },
      { uid: "3", summary: "Second", dtstart: new Date(2025, 0, 2), dtend: null, description: "", location: "", url: "", attendees: [] },
    ];

    const sorted = sortEventsByDateDescending(events);
    expect(sorted[0].summary).toBe("Third");
    expect(sorted[1].summary).toBe("Second");
    expect(sorted[2].summary).toBe("First");
  });

  it("should not mutate original array", () => {
    const events: ICalEvent[] = [
      { uid: "1", summary: "First", dtstart: new Date(2025, 0, 1), dtend: null, description: "", location: "", url: "", attendees: [] },
      { uid: "2", summary: "Second", dtstart: new Date(2025, 0, 2), dtend: null, description: "", location: "", url: "", attendees: [] },
    ];

    const sorted = sortEventsByDateDescending(events);
    expect(sorted).not.toBe(events);
    expect(events[0].summary).toBe("First");
  });

  it("should place events without dates at the end", () => {
    const events: ICalEvent[] = [
      { uid: "1", summary: "No date", dtstart: null, dtend: null, description: "", location: "", url: "", attendees: [] },
      { uid: "2", summary: "Has date", dtstart: new Date(2025, 0, 1), dtend: null, description: "", location: "", url: "", attendees: [] },
    ];

    const sorted = sortEventsByDateDescending(events);
    expect(sorted[0].summary).toBe("Has date");
    expect(sorted[1].summary).toBe("No date");
  });

  it("should use dtend if dtstart is null", () => {
    const events: ICalEvent[] = [
      { uid: "1", summary: "Only end", dtstart: null, dtend: new Date(2025, 0, 2), description: "", location: "", url: "", attendees: [] },
      { uid: "2", summary: "Has start", dtstart: new Date(2025, 0, 1), dtend: null, description: "", location: "", url: "", attendees: [] },
    ];

    const sorted = sortEventsByDateDescending(events);
    expect(sorted[0].summary).toBe("Only end");
    expect(sorted[1].summary).toBe("Has start");
  });
});

describe("shouldExcludeEvent", () => {
  it("should return true for matching pattern", () => {
    const patterns = [/^Busy$/i];
    expect(shouldExcludeEvent("Busy", patterns)).toBe(true);
  });

  it("should return false for non-matching pattern", () => {
    const patterns = [/^Busy$/i];
    expect(shouldExcludeEvent("Meeting", patterns)).toBe(false);
  });

  it("should return true if any pattern matches", () => {
    const patterns = [/^Busy$/i, /^Private$/i];
    expect(shouldExcludeEvent("Private", patterns)).toBe(true);
  });

  it("should return false for empty patterns array", () => {
    expect(shouldExcludeEvent("Anything", [])).toBe(false);
  });

  it("should return false for empty title", () => {
    const patterns = [/^Busy$/i];
    expect(shouldExcludeEvent("", patterns)).toBe(false);
  });
});

describe("isEventInDateRange", () => {
  const config: DateRangeConfig = { daysPast: 30, daysFuture: 30 };

  it("should include event within date range", () => {
    const event: ICalEvent = {
      uid: "1",
      summary: "Today",
      dtstart: new Date(),
      dtend: null,
      description: "",
      location: "",
      url: "",
      attendees: [],
    };
    expect(isEventInDateRange(event, config)).toBe(true);
  });

  it("should exclude event before date range", () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 60);
    const event: ICalEvent = {
      uid: "1",
      summary: "Old event",
      dtstart: pastDate,
      dtend: null,
      description: "",
      location: "",
      url: "",
      attendees: [],
    };
    expect(isEventInDateRange(event, config)).toBe(false);
  });

  it("should exclude event after date range", () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 60);
    const event: ICalEvent = {
      uid: "1",
      summary: "Future event",
      dtstart: futureDate,
      dtend: null,
      description: "",
      location: "",
      url: "",
      attendees: [],
    };
    expect(isEventInDateRange(event, config)).toBe(false);
  });

  it("should exclude event without dates", () => {
    const event: ICalEvent = {
      uid: "1",
      summary: "No date",
      dtstart: null,
      dtend: null,
      description: "",
      location: "",
      url: "",
      attendees: [],
    };
    expect(isEventInDateRange(event, config)).toBe(false);
  });

  it("should use dtend if dtstart is null", () => {
    const event: ICalEvent = {
      uid: "1",
      summary: "Only end",
      dtstart: null,
      dtend: new Date(),
      description: "",
      location: "",
      url: "",
      attendees: [],
    };
    expect(isEventInDateRange(event, config)).toBe(true);
  });
});
