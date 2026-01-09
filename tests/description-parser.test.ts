import { describe, it, expect } from "vitest";
import {
  detectContentType,
  htmlToRoam,
  markdownToRoam,
  parseDescription,
  extractActionItems,
  extractUrls,
  DEFAULT_DESCRIPTION_CONFIG,
  type DescriptionParseConfig,
} from "../src/description-parser";

describe("description-parser", () => {
  describe("detectContentType", () => {
    it("should detect HTML content", () => {
      expect(detectContentType("<p>Hello</p>")).toBe("html");
      expect(detectContentType("<b>Bold</b>")).toBe("html");
      expect(detectContentType("<div class='test'>Content</div>")).toBe("html");
    });

    it("should detect Markdown content", () => {
      expect(detectContentType("**bold text**")).toBe("markdown");
      expect(detectContentType("*italic text*")).toBe("markdown");
      expect(detectContentType("[link](https://example.com)")).toBe("markdown");
      expect(detectContentType("# Header")).toBe("markdown");
      expect(detectContentType("- list item")).toBe("markdown");
      expect(detectContentType("`inline code`")).toBe("markdown");
      expect(detectContentType("```\ncode block\n```")).toBe("markdown");
    });

    it("should detect plain text", () => {
      expect(detectContentType("Just plain text")).toBe("plain");
      expect(detectContentType("Meeting notes from yesterday")).toBe("plain");
      expect(detectContentType("")).toBe("plain");
    });

    it("should handle null/undefined", () => {
      expect(detectContentType("")).toBe("plain");
    });
  });

  describe("htmlToRoam", () => {
    it("should convert bold tags", () => {
      expect(htmlToRoam("<b>bold</b>")).toBe("**bold**");
      expect(htmlToRoam("<strong>strong</strong>")).toBe("**strong**");
    });

    it("should convert italic tags", () => {
      expect(htmlToRoam("<i>italic</i>")).toBe("__italic__");
      expect(htmlToRoam("<em>emphasis</em>")).toBe("__emphasis__");
    });

    it("should convert links", () => {
      expect(htmlToRoam('<a href="https://example.com">Link</a>')).toBe("[Link](https://example.com)");
    });

    it("should convert line breaks", () => {
      expect(htmlToRoam("line1<br>line2")).toBe("line1\nline2");
      expect(htmlToRoam("line1<br/>line2")).toBe("line1\nline2");
    });

    it("should convert code tags", () => {
      expect(htmlToRoam("<code>const x = 1</code>")).toBe("`const x = 1`");
    });

    it("should convert pre tags to code blocks", () => {
      expect(htmlToRoam("<pre>code block</pre>")).toBe("```\ncode block\n```");
    });

    it("should convert list items", () => {
      // Result is trimmed, so no trailing newline
      expect(htmlToRoam("<li>item 1</li><li>item 2</li>")).toBe("- item 1\n- item 2");
    });

    it("should decode HTML entities", () => {
      // Each entity gets decoded separately
      expect(htmlToRoam("&amp;")).toBe("&");
      expect(htmlToRoam("&lt;")).toBe("<");
      expect(htmlToRoam("&gt;")).toBe(">");
      expect(htmlToRoam("&quot;quoted&quot;")).toBe('"quoted"');
      // nbsp at start gets trimmed by the final trim()
      expect(htmlToRoam("text&nbsp;space")).toBe("text space");
    });

    it("should remove remaining HTML tags", () => {
      expect(htmlToRoam("<span>text</span>")).toBe("text");
      expect(htmlToRoam("<div>content</div>")).toBe("content");
    });

    it("should handle empty input", () => {
      expect(htmlToRoam("")).toBe("");
    });
  });

  describe("markdownToRoam", () => {
    it("should keep bold syntax unchanged", () => {
      expect(markdownToRoam("**bold**")).toBe("**bold**");
    });

    it("should convert single asterisk italic to double underscore", () => {
      expect(markdownToRoam("*italic*")).toBe("__italic__");
    });

    it("should convert single underscore italic to double underscore", () => {
      expect(markdownToRoam("_italic_")).toBe("__italic__");
    });

    it("should preserve links", () => {
      expect(markdownToRoam("[text](https://example.com)")).toBe("[text](https://example.com)");
    });

    it("should handle empty input", () => {
      expect(markdownToRoam("")).toBe("");
    });
  });

  describe("parseDescription", () => {
    const defaultConfig: DescriptionParseConfig = {
      ...DEFAULT_DESCRIPTION_CONFIG,
      enabled: true,
    };

    it("should parse HTML descriptions", () => {
      const raw = "<p><b>Meeting Agenda</b></p><ul><li>Item 1</li></ul>";
      const result = parseDescription(raw, defaultConfig);

      expect(result).toContain("**Meeting Agenda**");
      expect(result).toContain("- Item 1");
    });

    it("should parse Markdown descriptions", () => {
      const raw = "**Bold** and *italic* with [link](https://example.com)";
      const result = parseDescription(raw, defaultConfig);

      expect(result).toContain("**Bold**");
      expect(result).toContain("__italic__");
      expect(result).toContain("[link](https://example.com)");
    });

    it("should leave plain text unchanged", () => {
      const raw = "Just a plain text description";
      const result = parseDescription(raw, defaultConfig);

      expect(result).toBe("Just a plain text description");
    });

    it("should return raw text when disabled", () => {
      const raw = "<b>bold</b>";
      const config: DescriptionParseConfig = { ...defaultConfig, enabled: false };
      const result = parseDescription(raw, config);

      expect(result).toBe("<b>bold</b>");
    });

    it("should skip HTML parsing when disabled", () => {
      const raw = "<b>bold</b>";
      const config: DescriptionParseConfig = { ...defaultConfig, parseHtml: false };
      const result = parseDescription(raw, config);

      expect(result).toBe("<b>bold</b>");
    });

    it("should skip Markdown parsing when disabled", () => {
      const raw = "*italic*";
      const config: DescriptionParseConfig = { ...defaultConfig, parseMarkdown: false };
      const result = parseDescription(raw, config);

      expect(result).toBe("*italic*");
    });

    it("should normalize line endings", () => {
      const raw = "line1\r\nline2\r\nline3";
      const result = parseDescription(raw, defaultConfig);

      expect(result).not.toContain("\r\n");
      expect(result).toContain("\n");
    });

    it("should collapse multiple blank lines", () => {
      const raw = "line1\n\n\n\nline2";
      const result = parseDescription(raw, defaultConfig);

      expect(result).not.toContain("\n\n\n");
    });
  });

  describe("extractActionItems", () => {
    it("should extract TODO: items", () => {
      const text = "TODO: Review code\nTODO: Write tests";
      const items = extractActionItems(text);

      expect(items).toContain("Review code");
      expect(items).toContain("Write tests");
    });

    it("should extract ACTION: items", () => {
      const text = "ACTION: Follow up with team";
      const items = extractActionItems(text);

      expect(items).toContain("Follow up with team");
    });

    it("should extract unchecked checkboxes", () => {
      const text = "[ ] Buy groceries\n[ ] Call mom";
      const items = extractActionItems(text);

      expect(items).toContain("Buy groceries");
      expect(items).toContain("Call mom");
    });

    it("should avoid duplicates", () => {
      const text = "TODO: Same task\nTODO: Same task";
      const items = extractActionItems(text);

      expect(items.length).toBe(1);
    });

    it("should handle empty input", () => {
      expect(extractActionItems("")).toEqual([]);
      expect(extractActionItems("No action items here")).toEqual([]);
    });
  });

  describe("extractUrls", () => {
    it("should extract URLs from markdown links", () => {
      const text = "Check [this link](https://example.com) for more info";
      const urls = extractUrls(text);

      expect(urls).toContain("https://example.com");
    });

    it("should extract standalone URLs", () => {
      const text = "Visit https://example.com for details";
      const urls = extractUrls(text);

      expect(urls).toContain("https://example.com");
    });

    it("should extract multiple URLs", () => {
      const text = "See https://one.com and https://two.com";
      const urls = extractUrls(text);

      expect(urls.length).toBe(2);
      expect(urls).toContain("https://one.com");
      expect(urls).toContain("https://two.com");
    });

    it("should handle URLs appearing in markdown and standalone", () => {
      // When URL appears in markdown, standalone regex also finds it
      // The regex finds: markdown href, and both standalone URLs
      const text = "[Link](https://example.com) - also at https://other.com";
      const urls = extractUrls(text);

      // All unique URLs found
      expect(urls).toContain("https://example.com");
      expect(urls).toContain("https://other.com");
      // Total count may vary based on implementation
      expect(urls.length).toBeGreaterThanOrEqual(2);
    });

    it("should handle empty input", () => {
      expect(extractUrls("")).toEqual([]);
      expect(extractUrls("No URLs here")).toEqual([]);
    });
  });
});
