/**
 * URL validation utilities for calendar URLs.
 */

import { logDebug } from "./logger";
import { getRoamProxyUrl } from "./roam-api";

/**
 * Validation result for a calendar URL.
 */
export interface CalendarValidationResult {
  url: string;
  valid: boolean;
  error?: string;
  contentType?: string;
  status?: number;
}

/**
 * Validates if a string is a valid URL.
 */
export function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validates a calendar URL by checking format and optionally testing connectivity.
 *
 * @param url URL to validate.
 * @param testConnection If true, attempts to fetch the URL to verify it's accessible.
 */
export async function validateCalendarUrl(
  url: string,
  testConnection = false
): Promise<CalendarValidationResult> {
  // Basic URL format validation
  if (!url || url.trim() === "") {
    return { url, valid: false, error: "URL is empty" };
  }

  const trimmedUrl = url.trim();

  if (!isValidUrl(trimmedUrl)) {
    return { url: trimmedUrl, valid: false, error: "Invalid URL format" };
  }

  // Check for common iCal URL patterns
  const urlLower = trimmedUrl.toLowerCase();
  const isICalUrl =
    urlLower.endsWith(".ics") ||
    urlLower.includes("/ical") ||
    urlLower.includes("/calendar") ||
    urlLower.includes("webcal://") ||
    urlLower.includes("calendar.google.com") ||
    urlLower.includes("outlook.office365.com") ||
    urlLower.includes("caldav");

  if (!isICalUrl) {
    logDebug("url_validation_warning", {
      url: trimmedUrl,
      message: "URL does not appear to be an iCal feed",
    });
  }

  if (!testConnection) {
    return { url: trimmedUrl, valid: true };
  }

  // Test connectivity
  try {
    const proxyUrl = getRoamProxyUrl();
    if (!proxyUrl) {
      return {
        url: trimmedUrl,
        valid: true,
        error: "Cannot test connection: Roam proxy not available",
      };
    }

    const fetchUrl = `${proxyUrl}/${trimmedUrl}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch(fetchUrl, {
      method: "HEAD", // Use HEAD to avoid downloading full content
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const contentType = response.headers.get("Content-Type") ?? undefined;
    const isValidContentType =
      !contentType ||
      contentType.includes("text/calendar") ||
      contentType.includes("text/plain") ||
      contentType.includes("application/octet-stream");

    if (!response.ok) {
      return {
        url: trimmedUrl,
        valid: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        status: response.status,
        contentType,
      };
    }

    if (!isValidContentType) {
      return {
        url: trimmedUrl,
        valid: false,
        error: `Unexpected content type: ${contentType}`,
        contentType,
        status: response.status,
      };
    }

    return {
      url: trimmedUrl,
      valid: true,
      contentType,
      status: response.status,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("abort")) {
      return { url: trimmedUrl, valid: false, error: "Connection timeout (10s)" };
    }
    return { url: trimmedUrl, valid: false, error: `Connection failed: ${message}` };
  }
}
