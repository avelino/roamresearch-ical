import { describe, it, expect } from "vitest";
import {
  classifyError,
  formatErrorSummary,
  formatErrorReportBlocks,
  type CalendarError,
  type ErrorReport,
} from "../src/error-report";

describe("error-report", () => {
  describe("classifyError", () => {
    it("should classify HTTP 404 errors", () => {
      const error = new Error("Request failed with status: 404");
      const result = classifyError(error);

      expect(result.type).toBe("http");
      expect(result.httpStatus).toBe(404);
    });

    it("should classify HTTP 403 errors", () => {
      const error = new Error("Request failed with status: 403 Forbidden");
      const result = classifyError(error);

      expect(result.type).toBe("http");
      expect(result.httpStatus).toBe(403);
    });

    it("should classify HTTP 500 errors", () => {
      const error = new Error("Request failed with status: 500 Internal Server Error");
      const result = classifyError(error);

      expect(result.type).toBe("http");
      expect(result.httpStatus).toBe(500);
    });

    it("should classify CORS errors", () => {
      const error = new Error("CORS policy blocked the request");
      const result = classifyError(error);

      expect(result.type).toBe("cors");
    });

    it("should classify timeout errors", () => {
      const error = new Error("Request timeout after 30 seconds");
      const result = classifyError(error);

      expect(result.type).toBe("timeout");
    });

    it("should classify parse errors", () => {
      const error = new Error("Failed to parse iCal content");
      const result = classifyError(error);

      expect(result.type).toBe("parse");
    });

    it("should classify unknown errors", () => {
      const error = new Error("Something went wrong");
      const result = classifyError(error);

      expect(result.type).toBe("unknown");
    });

    it("should handle non-Error objects", () => {
      const result = classifyError("string error");

      expect(result.type).toBe("unknown");
    });

    it("should handle permission errors", () => {
      const error = new Error("Permission denied");
      const result = classifyError(error);

      expect(result.type).toBe("permission");
    });
  });

  describe("formatErrorSummary", () => {
    it("should format single error", () => {
      const errors: CalendarError[] = [
        {
          calendarName: "Work",
          url: "https://example.com/calendar.ics",
          errorType: "http",
          httpStatus: 404,
          message: "Calendar not found",
          timestamp: new Date(),
        },
      ];

      const summary = formatErrorSummary(errors);

      expect(summary).toContain("Work");
      // Summary format: "N calendar(s) failed: calendar1, calendar2"
      expect(summary).toContain("1 calendar failed");
    });

    it("should format multiple errors", () => {
      const errors: CalendarError[] = [
        {
          calendarName: "Work",
          url: "https://example.com/work.ics",
          errorType: "http",
          httpStatus: 404,
          message: "Not found",
          timestamp: new Date(),
        },
        {
          calendarName: "Personal",
          url: "https://example.com/personal.ics",
          errorType: "cors",
          message: "CORS blocked",
          timestamp: new Date(),
        },
      ];

      const summary = formatErrorSummary(errors);

      expect(summary).toContain("Work");
      expect(summary).toContain("Personal");
    });

    it("should handle empty errors array", () => {
      const summary = formatErrorSummary([]);
      expect(summary).toBe("");
    });
  });

  describe("formatErrorReportBlocks", () => {
    it("should create block structure for error report", () => {
      const report: ErrorReport = {
        timestamp: new Date("2025-01-15T10:00:00Z"),
        totalCalendars: 3,
        successCount: 1,
        failedCount: 2,
        errors: [
          {
            calendarName: "Work",
            url: "https://example.com/work.ics",
            errorType: "http",
            httpStatus: 404,
            message: "Calendar not found",
            timestamp: new Date("2025-01-15T10:00:00Z"),
          },
          {
            calendarName: "Personal",
            url: "https://example.com/personal.ics",
            errorType: "cors",
            message: "CORS blocked",
            timestamp: new Date("2025-01-15T10:00:00Z"),
          },
        ],
      };

      const blocks = formatErrorReportBlocks(report);

      expect(blocks.length).toBeGreaterThan(0);

      // Should have summary block
      const summaryText = JSON.stringify(blocks);
      expect(summaryText).toContain("3");
      expect(summaryText).toContain("1");
      expect(summaryText).toContain("2");

      // Should have error details
      expect(summaryText).toContain("Work");
      expect(summaryText).toContain("Personal");
    });

    it("should handle empty errors", () => {
      const report: ErrorReport = {
        timestamp: new Date(),
        totalCalendars: 2,
        successCount: 2,
        failedCount: 0,
        errors: [],
      };

      const blocks = formatErrorReportBlocks(report);

      // Should still create some blocks
      expect(blocks.length).toBeGreaterThan(0);
    });

    it("should include error type in blocks", () => {
      const report: ErrorReport = {
        timestamp: new Date(),
        totalCalendars: 1,
        successCount: 0,
        failedCount: 1,
        errors: [
          {
            calendarName: "Test",
            url: "https://example.com/test.ics",
            errorType: "timeout",
            message: "Request timed out",
            timestamp: new Date(),
          },
        ],
      };

      const blocks = formatErrorReportBlocks(report);
      const blocksText = JSON.stringify(blocks);

      expect(blocksText).toContain("timeout");
    });

    it("should include HTTP status when available", () => {
      const report: ErrorReport = {
        timestamp: new Date(),
        totalCalendars: 1,
        successCount: 0,
        failedCount: 1,
        errors: [
          {
            calendarName: "Test",
            url: "https://example.com/test.ics",
            errorType: "http",
            httpStatus: 403,
            message: "Forbidden",
            timestamp: new Date(),
          },
        ],
      };

      const blocks = formatErrorReportBlocks(report);
      const blocksText = JSON.stringify(blocks);

      expect(blocksText).toContain("403");
    });
  });
});
