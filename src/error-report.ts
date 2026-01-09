/**
 * Error reporting and tracking for sync operations.
 * Creates detailed error reports as Roam pages.
 */

import type { InputTextNode } from "./roam-api";
import { createPage, getPageUidByPageTitle, createBlock, getBasicTreeByParentUid, deleteBlock } from "./roam-api";
import { formatRoamDate } from "./ical";
import { logDebug } from "./logger";

/**
 * Types of errors that can occur during sync.
 */
export type ErrorType = "http" | "parse" | "timeout" | "cors" | "permission" | "unknown";

/**
 * Error details for a single calendar.
 */
export interface CalendarError {
  /** Name of the calendar that failed */
  calendarName: string;
  /** URL of the calendar */
  url: string;
  /** Type of error */
  errorType: ErrorType;
  /** HTTP status code if applicable */
  httpStatus?: number;
  /** Human-readable error message */
  message: string;
  /** When the error occurred */
  timestamp: Date;
}

/**
 * Complete error report for a sync operation.
 */
export interface ErrorReport {
  /** When the sync was attempted */
  timestamp: Date;
  /** Total number of calendars attempted */
  totalCalendars: number;
  /** Number of successful syncs */
  successCount: number;
  /** Number of failed syncs */
  failedCount: number;
  /** Details of each failure */
  errors: CalendarError[];
}

/**
 * Page title prefix for error reports.
 */
const ERROR_REPORT_PREFIX = "ical-sync-errors";

/**
 * Maximum number of error report pages to keep.
 * Reserved for future cleanup feature.
 */
const _MAX_ERROR_REPORTS = 10;

/**
 * Classifies an error into a specific type.
 *
 * @param error Error to classify.
 * @returns Classified error type.
 */
export function classifyError(error: unknown): { type: ErrorType; httpStatus?: number } {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // HTTP errors
    const httpMatch = message.match(/status[:\s]*(\d{3})/);
    if (httpMatch) {
      return { type: "http", httpStatus: parseInt(httpMatch[1], 10) };
    }

    // CORS errors
    if (message.includes("cors") || message.includes("cross-origin") || message.includes("blocked")) {
      return { type: "cors" };
    }

    // Timeout errors
    if (message.includes("timeout") || message.includes("timed out")) {
      return { type: "timeout" };
    }

    // Parse errors
    if (message.includes("parse") || message.includes("invalid") || message.includes("unexpected")) {
      return { type: "parse" };
    }

    // Permission errors
    if (message.includes("permission") || message.includes("forbidden") || message.includes("unauthorized")) {
      return { type: "permission" };
    }
  }

  return { type: "unknown" };
}

/**
 * Creates a CalendarError from an exception.
 *
 * @param calendarName Name of the calendar.
 * @param url Calendar URL.
 * @param error The error that occurred.
 * @returns Structured CalendarError.
 */
export function createCalendarError(
  calendarName: string,
  url: string,
  error: unknown
): CalendarError {
  const classified = classifyError(error);
  const message = error instanceof Error ? error.message : String(error);

  return {
    calendarName,
    url,
    errorType: classified.type,
    httpStatus: classified.httpStatus,
    message,
    timestamp: new Date(),
  };
}

/**
 * Formats a single error as Roam blocks.
 *
 * @param error Calendar error to format.
 * @returns Block tree for the error.
 */
function formatErrorBlocks(error: CalendarError): InputTextNode {
  const children: InputTextNode[] = [
    { text: `error-type:: ${error.errorType}` },
    { text: `url:: ${error.url}` },
    { text: `message:: ${error.message}` },
    { text: `timestamp:: ${error.timestamp.toISOString()}` },
  ];

  if (error.httpStatus) {
    children.push({ text: `http-status:: ${error.httpStatus}` });
  }

  // Add troubleshooting hints based on error type
  const hints = getTroubleshootingHints(error.errorType, error.httpStatus);
  if (hints.length > 0) {
    children.push({
      text: "Troubleshooting",
      children: hints.map(hint => ({ text: hint })),
    });
  }

  return {
    text: `❌ **${error.calendarName}**`,
    children,
  };
}

/**
 * Gets troubleshooting hints for an error type.
 *
 * @param errorType Type of error.
 * @param httpStatus HTTP status code if applicable.
 * @returns Array of hint strings.
 */
function getTroubleshootingHints(errorType: ErrorType, httpStatus?: number): string[] {
  const hints: string[] = [];

  switch (errorType) {
    case "http":
      if (httpStatus === 401 || httpStatus === 403) {
        hints.push("The calendar URL may require authentication");
        hints.push("Try making the calendar public or generating a new sharing link");
      } else if (httpStatus === 404) {
        hints.push("The calendar URL may be incorrect or the calendar was deleted");
        hints.push("Verify the URL is correct and the calendar still exists");
      } else if (httpStatus && httpStatus >= 500) {
        hints.push("The calendar server is experiencing issues");
        hints.push("Try again later or check if the service is down");
      }
      break;

    case "cors":
      hints.push("Cross-origin request was blocked");
      hints.push("The calendar provider may not support direct access");
      hints.push("Try using the calendar's public .ics URL instead");
      break;

    case "timeout":
      hints.push("The request took too long to complete");
      hints.push("Check your internet connection");
      hints.push("The calendar server may be slow or overloaded");
      break;

    case "parse":
      hints.push("The calendar data could not be parsed");
      hints.push("The URL may not point to a valid iCal (.ics) file");
      hints.push("Check if the URL returns proper iCal format");
      break;

    case "permission":
      hints.push("Access to the calendar was denied");
      hints.push("Check sharing settings on the calendar");
      hints.push("Try regenerating the calendar share link");
      break;

    default:
      hints.push("An unexpected error occurred");
      hints.push("Check the error message for details");
      hints.push("Try removing and re-adding the calendar");
  }

  return hints;
}

/**
 * Formats an error report as Roam blocks.
 *
 * @param report Error report to format.
 * @returns Array of block nodes for the report.
 */
export function formatErrorReportBlocks(report: ErrorReport): InputTextNode[] {
  const blocks: InputTextNode[] = [];

  // Summary block
  const summaryChildren: InputTextNode[] = [
    { text: `total-calendars:: ${report.totalCalendars}` },
    { text: `successful:: ${report.successCount}` },
    { text: `failed:: ${report.failedCount}` },
    { text: `timestamp:: ${report.timestamp.toISOString()}` },
  ];

  blocks.push({
    text: "**Sync Summary**",
    children: summaryChildren,
  });

  // Error details
  if (report.errors.length > 0) {
    const errorBlocks = report.errors.map(formatErrorBlocks);
    blocks.push({
      text: `**Errors (${report.errors.length})**`,
      children: errorBlocks,
    });
  }

  return blocks;
}

/**
 * Creates or updates an error report page in Roam.
 *
 * @param report Error report to save.
 * @returns UID of the created/updated page.
 */
export async function createErrorReportPage(report: ErrorReport): Promise<string> {
  const dateStr = formatRoamDate(report.timestamp);
  const pageTitle = `${ERROR_REPORT_PREFIX}/${dateStr}`;

  let pageUid = getPageUidByPageTitle(pageTitle);

  if (!pageUid) {
    pageUid = await createPage({ title: pageTitle });
  } else {
    // Clear existing content
    const existingTree = getBasicTreeByParentUid(pageUid);
    for (const node of existingTree) {
      await deleteBlock(node.uid);
    }
  }

  // Add report blocks
  const blocks = formatErrorReportBlocks(report);
  for (let i = 0; i < blocks.length; i++) {
    await createBlock({
      parentUid: pageUid,
      order: i,
      node: blocks[i],
    });
  }

  logDebug("error_report_created", { pageTitle, errorCount: report.errors.length });

  // Cleanup old reports
  await cleanupOldErrorReports();

  return pageUid;
}

/**
 * Removes old error report pages to prevent clutter.
 */
async function cleanupOldErrorReports(): Promise<void> {
  // This would require listing pages by prefix, which isn't directly available
  // For now, we'll skip automatic cleanup and let users manage old reports
  // Future enhancement: implement page listing and cleanup
}

/**
 * Formats a summary string for display in status messages.
 *
 * @param errors Array of calendar errors.
 * @returns Human-readable summary string.
 */
export function formatErrorSummary(errors: CalendarError[]): string {
  if (errors.length === 0) {
    return "";
  }

  if (errors.length === 1) {
    return `1 calendar failed: ${errors[0].calendarName}`;
  }

  const names = errors.slice(0, 3).map(e => e.calendarName);
  const remaining = errors.length - 3;

  if (remaining > 0) {
    return `${errors.length} calendars failed: ${names.join(", ")} and ${remaining} more`;
  }

  return `${errors.length} calendars failed: ${names.join(", ")}`;
}
