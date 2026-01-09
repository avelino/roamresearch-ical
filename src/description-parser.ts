/**
 * Rich description parsing for calendar events.
 * Converts HTML and Markdown descriptions to Roam-compatible format.
 */

/**
 * Configuration for description parsing.
 */
export interface DescriptionParseConfig {
  /** Whether rich description parsing is enabled */
  enabled: boolean;
  /** Parse HTML tags to Roam format */
  parseHtml: boolean;
  /** Parse Markdown syntax to Roam format */
  parseMarkdown: boolean;
  /** Preserve code blocks with proper formatting */
  preserveCodeBlocks: boolean;
}

/**
 * Default configuration for description parsing.
 */
export const DEFAULT_DESCRIPTION_CONFIG: DescriptionParseConfig = {
  enabled: true,
  parseHtml: true,
  parseMarkdown: true,
  preserveCodeBlocks: true,
};

/**
 * Detects the content type of a description text.
 *
 * @param text Description text to analyze.
 * @returns Detected content type.
 */
export function detectContentType(text: string): "html" | "markdown" | "plain" {
  if (!text) return "plain";

  // Check for HTML tags
  if (/<[a-z][\s\S]*>/i.test(text)) {
    return "html";
  }

  // Check for Markdown indicators
  const markdownPatterns = [
    /\*\*[^*]+\*\*/, // Bold **text**
    /__[^_]+__/, // Italic __text__
    /\*[^*\s][^*]*\*/, // Italic *text*
    /\[[^\]]+\]\([^)]+\)/, // Links [text](url)
    /^#+\s/m, // Headers # text
    /^[-*]\s/m, // Unordered lists - item
    /^\d+\.\s/m, // Ordered lists 1. item
    /`[^`]+`/, // Inline code `code`
    /```[\s\S]*?```/, // Code blocks
  ];

  for (const pattern of markdownPatterns) {
    if (pattern.test(text)) {
      return "markdown";
    }
  }

  return "plain";
}

/**
 * Converts HTML tags to Roam-compatible format.
 *
 * @param html HTML string to convert.
 * @returns Roam-formatted string.
 */
export function htmlToRoam(html: string): string {
  if (!html) return "";

  let result = html;

  // Decode HTML entities first
  result = decodeHtmlEntities(result);

  // Convert line breaks
  result = result.replace(/<br\s*\/?>/gi, "\n");

  // Convert bold tags
  result = result.replace(/<(b|strong)>([\s\S]*?)<\/\1>/gi, "**$2**");

  // Convert italic tags
  result = result.replace(/<(i|em)>([\s\S]*?)<\/\1>/gi, "__$2__");

  // Convert underline (use Roam highlight)
  result = result.replace(/<u>([\s\S]*?)<\/u>/gi, "^^$1^^");

  // Convert strike-through
  result = result.replace(/<(s|strike|del)>([\s\S]*?)<\/\1>/gi, "~~$1~~");

  // Convert links
  result = result.replace(/<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");

  // Convert inline code
  result = result.replace(/<code>([\s\S]*?)<\/code>/gi, "`$1`");

  // Convert code blocks
  result = result.replace(/<pre>([\s\S]*?)<\/pre>/gi, "```\n$1\n```");

  // Convert paragraphs to line breaks
  result = result.replace(/<p>([\s\S]*?)<\/p>/gi, "$1\n\n");

  // Convert headers to Roam format
  result = result.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "**$1**\n");
  result = result.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "**$1**\n");
  result = result.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "**$1**\n");

  // Convert list items (basic support)
  result = result.replace(/<li>([\s\S]*?)<\/li>/gi, "- $1\n");

  // Remove remaining HTML tags
  result = result.replace(/<[^>]*>/g, "");

  // Clean up extra whitespace
  result = result.replace(/\n{3,}/g, "\n\n");
  result = result.trim();

  return result;
}

/**
 * Decodes common HTML entities.
 *
 * @param text Text with HTML entities.
 * @returns Decoded text.
 */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
    "&ndash;": "–",
    "&mdash;": "—",
    "&hellip;": "…",
    "&copy;": "©",
    "&reg;": "®",
    "&trade;": "™",
  };

  let result = text;
  for (const [entity, char] of Object.entries(entities)) {
    result = result.replace(new RegExp(entity, "gi"), char);
  }

  // Decode numeric entities
  result = result.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
  result = result.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));

  return result;
}

/**
 * Converts Markdown syntax to Roam-compatible format.
 * Note: Roam already supports most Markdown, so this mainly normalizes formatting.
 *
 * @param markdown Markdown string to convert.
 * @returns Roam-formatted string.
 */
export function markdownToRoam(markdown: string): string {
  if (!markdown) return "";

  let result = markdown;

  // Markdown bold ** -> Roam bold ** (already compatible)
  // Markdown italic * -> Roam italic __ (convert single asterisks)
  result = result.replace(/(?<!\*)\*([^*\s][^*]*[^*\s]|[^*\s])\*(?!\*)/g, "__$1__");

  // Convert _italic_ to __italic__ for consistency
  result = result.replace(/(?<!_)_([^_\s][^_]*[^_\s]|[^_\s])_(?!_)/g, "__$1__");

  // Headers are already compatible with Roam

  // Lists are already compatible

  // Links [text](url) are already compatible

  // Code blocks are already compatible

  return result.trim();
}

/**
 * Parses and converts a description to Roam format.
 *
 * @param raw Raw description text.
 * @param config Parsing configuration.
 * @returns Roam-formatted description.
 */
export function parseDescription(raw: string, config: DescriptionParseConfig): string {
  if (!raw || !config.enabled) {
    return raw ?? "";
  }

  const contentType = detectContentType(raw);

  let result = raw;

  switch (contentType) {
    case "html":
      if (config.parseHtml) {
        result = htmlToRoam(raw);
      }
      break;

    case "markdown":
      if (config.parseMarkdown) {
        result = markdownToRoam(raw);
      }
      break;

    case "plain":
      // No conversion needed for plain text
      break;
  }

  // Clean up the result
  result = result.trim();

  // Normalize line endings
  result = result.replace(/\r\n/g, "\n");

  // Collapse multiple blank lines
  result = result.replace(/\n{3,}/g, "\n\n");

  return result;
}

/**
 * Extracts action items from a description.
 * Looks for patterns like "TODO:", "ACTION:", "[ ]", etc.
 *
 * @param text Description text to analyze.
 * @returns Array of action item strings.
 */
export function extractActionItems(text: string): string[] {
  if (!text) return [];

  const items: string[] = [];
  const patterns = [
    /(?:TODO|ACTION|TASK):\s*(.+)/gi,
    /\[\s*\]\s*(.+)/g, // [ ] unchecked checkboxes
    /^[-*]\s*(?:TODO|ACTION):\s*(.+)/gim,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const item = match[1].trim();
      if (item && !items.includes(item)) {
        items.push(item);
      }
    }
  }

  return items;
}

/**
 * Extracts URLs from a description.
 *
 * @param text Description text to analyze.
 * @returns Array of extracted URLs.
 */
export function extractUrls(text: string): string[] {
  if (!text) return [];

  const urls: string[] = [];

  // Match URLs in markdown links
  const markdownLinkPattern = /\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = markdownLinkPattern.exec(text)) !== null) {
    urls.push(match[2]);
  }

  // Match standalone URLs
  const standaloneUrlPattern = /https?:\/\/[^\s<>"'[\]]+/gi;
  while ((match = standaloneUrlPattern.exec(text)) !== null) {
    const url = match[0];
    // Avoid duplicates from markdown links
    if (!urls.includes(url)) {
      urls.push(url);
    }
  }

  return urls;
}
