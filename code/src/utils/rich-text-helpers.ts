import { ItemType } from '@asana/constants';

export interface MentionObject {
  ref_type: string;
  id: string;
  fallback_record_name: string;
}

export type RichTextContent = string | MentionObject;

interface RichTextWrapper {
  content: RichTextContent[];
  type: string;
}

/** Unwrap rich text from various input formats into a flat content array. */
export function unwrapRichText(
  input: RichTextContent[] | RichTextWrapper | string | null | undefined
): RichTextContent[] | null {
  if (!input) return null;
  if (Array.isArray(input)) return input;
  if (typeof input === 'string') return [input];
  if (typeof input === 'object' && 'content' in input && Array.isArray(input.content)) {
    return input.content;
  }
  return null;
}

const ASANA_TYPE_TO_REF_TYPE: Record<string, string> = {
  user: ItemType.USERS,
  task: ItemType.TASKS,
  subtask: ItemType.TASKS,
};

const ASANA_MENTION_REGEX = /<a\s+([^>]*data-asana-gid[^>]*)>([^<]*)<\/a>/gi;

const ASANA_INLINE_ATTACHMENT_REGEX = /<img[^>]*data-asana-type="attachment"[^>]*>/gi;

/**
 * ISS-317794: convert Asana HTML <table> blocks into GitHub-Flavored Markdown tables so DevRev's
 * rich-text renderer can display them as a table instead of concatenated text. A GFM table needs a
 * header row, a `| --- |` separator row, and one row per line (single newlines within the table).
 * The whole block is surrounded by blank lines so it is parsed as its own table block.
 */
function tablesToMarkdown(html: string): string {
  return html.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_full, tableInner: string) => {
    const rows: string[][] = [];
    const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRegex.exec(tableInner)) !== null) {
      const cells: string[] = [];
      const cellRegex = /<(td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
        const text = cellMatch[2]
          .replace(/<br\s*\/?>/gi, ' ') // line breaks inside a cell become spaces (can't span table rows)
          .replace(/<[^>]+>/g, '') // drop any inner tags
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/\|/g, '\\|'); // escape pipes so they don't split the column
        cells.push(text);
      }
      if (cells.length > 0) rows.push(cells);
    }

    if (rows.length === 0) return '';

    const colCount = Math.max(...rows.map((r) => r.length));
    const toLine = (cells: string[]): string => {
      const padded = [...cells];
      while (padded.length < colCount) padded.push('');
      return `| ${padded.join(' | ')} |`;
    };

    const lines = [toLine(rows[0]), `| ${Array(colCount).fill('---').join(' | ')} |`];
    for (let i = 1; i < rows.length; i++) {
      lines.push(toLine(rows[i]));
    }

    return `\n\n${lines.join('\n')}\n\n`;
  });
}

// Excludes &lt;/&gt;: kept encoded so the Markdown renderer shows a literal `<`/`>` rather than
// interpreting a reconstructed tag.
function decodeProseEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Full decode incl. angle brackets, only for code regions where content is shown verbatim.
function decodeAllEntities(text: string): string {
  return decodeProseEntities(text).replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// Convert <pre>/<code> to Markdown fenced/inline code, placeholder-protected so the later
// tag-strip / prose-decode steps leave the code untouched.
function extractCodeSegments(html: string): { text: string; segments: string[] } {
  const segments: string[] = [];
  const codePlaceholder = (i: number): string => `\uE000CODESEG${i}\uE001`;

  // Block code first (<pre>), then inline (<code>), so a <code> nested in <pre> is not double-handled.
  let text = html.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_full, inner: string) => {
    const code = decodeAllEntities(inner.replace(/<[^>]+>/g, '')).replace(/\n+$/, '');
    segments.push(`\n\n\`\`\`\n${code}\n\`\`\`\n\n`);
    return codePlaceholder(segments.length - 1);
  });

  text = text.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_full, inner: string) => {
    const code = decodeAllEntities(inner.replace(/<[^>]+>/g, ''));
    segments.push(`\`${code}\``);
    return codePlaceholder(segments.length - 1);
  });

  return { text, segments };
}

function stripHtmlTags(html: string): string {
  const { text, segments } = extractCodeSegments(tablesToMarkdown(html));

  const stripped = decodeProseEntities(
    text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Re-insert the protected code segments after all other transforms have run.
  return stripped.replace(/\uE000CODESEG(\d+)\uE001/g, (_m, i: string) => segments[Number(i)] ?? '').trim();
}

/** Parse Asana HTML into a rich text content array with mention objects. */
export function parseAsanaRichText(html: string | null | undefined): RichTextContent[] | null {
  if (!html || typeof html !== 'string') {
    return null;
  }

  // Strip inline attachment images before processing (they're handled separately as attachments)
  const cleanedHtml = html.replace(ASANA_INLINE_ATTACHMENT_REGEX, '');

  const result: RichTextContent[] = [];
  let lastIndex = 0;
  ASANA_MENTION_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = ASANA_MENTION_REGEX.exec(cleanedHtml)) !== null) {
    const [fullMatch, attributes, displayText] = match;
    const matchIndex = match.index;

    if (matchIndex > lastIndex) {
      const strippedText = stripHtmlTags(cleanedHtml.substring(lastIndex, matchIndex));
      if (strippedText) {
        result.push(/\s$/.test(strippedText) ? strippedText : `${strippedText} `);
      }
    }

    const gidMatch = attributes.match(/data-asana-gid="([^"]*)"/i);
    const typeMatch = attributes.match(/data-asana-type="([^"]*)"/i);

    if (gidMatch?.[1]) {
      const refType = ASANA_TYPE_TO_REF_TYPE[typeMatch?.[1] ?? 'user'] || ItemType.USERS;
      result.push({
        ref_type: refType,
        id: gidMatch[1],
        fallback_record_name: displayText.replace(/^@/, '').trim(),
      });
    } else {
      const strippedText = stripHtmlTags(displayText);
      if (strippedText) {
        result.push(strippedText);
      }
    }

    lastIndex = matchIndex + fullMatch.length;
  }

  if (lastIndex < cleanedHtml.length) {
    const strippedText = stripHtmlTags(cleanedHtml.substring(lastIndex));
    if (strippedText) {
      const needsLeadingSpace =
        result.length > 0 && typeof result[result.length - 1] !== 'string' && !/^\s/.test(strippedText);
      result.push(needsLeadingSpace ? ` ${strippedText}` : strippedText);
    }
  }

  return result.length > 0 ? result : null;
}

const REF_TYPE_TO_ASANA_TYPE: Record<string, string> = {
  [ItemType.USERS]: 'user',
  [ItemType.TASKS]: 'task',
  [ItemType.SUBTASKS]: 'task',
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Two variants: textToHtml's exec loop slices its input, so a shared global regex would leak
// lastIndex between callers.
const MARKDOWN_IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/;
const MARKDOWN_IMAGE_REGEX_GLOBAL = /!\[([^\]]*)\]\(([^)]+)\)/g;

function imageLabel(altText: string): string {
  return altText.trim() || 'Attachment';
}

/**
 * Render a DevRev markdown image reference as text instead of deleting it.
 *
 * A file in a DevRev body arrives as `![name](artifact-url)`. Deleting it lost the reference: the
 * image-less body round-tripped back and overwrote the DevRev body. Asana can't render an artifact
 * URL as an `<img>`, but keeping the URL means the file survives.
 */
function markdownImagesToPlainText(text: string): string {
  return text.replace(MARKDOWN_IMAGE_REGEX_GLOBAL, (_full, altText: string, url: string) => {
    return `${imageLabel(altText)} (${url})`;
  });
}

function normalizeNewlines(text: string): string {
  return text
    .replace(/\\n/g, '\n')       // Normalize literal \n (backslash+n) to actual newlines
    .replace(/\\\n/g, '\n');     // Normalize backslash-before-newline to plain newline
}

/**
 * Escape prose while keeping markdown image references as real links.
 *
 * Line breaks stay literal newlines: Asana rejects `<br />` (and `<br>`, `<br/>`), failing a task
 * description with `xml_parsing_error` and silently escaping an entire story body. Each anchor is
 * assembled after its surrounding text is escaped, so the href never carries raw user markup.
 */
function textToHtml(text: string): string {
  const normalized = normalizeNewlines(text);
  const segments: string[] = [];

  let rest = normalized;
  let match: RegExpExecArray | null;
  while ((match = MARKDOWN_IMAGE_REGEX.exec(rest)) !== null) {
    const [full, altText, url] = match;
    segments.push(escapeHtml(rest.substring(0, match.index)));
    segments.push(`<a href="${escapeHtml(url)}">${escapeHtml(imageLabel(altText))}</a>`);
    rest = rest.substring(match.index + full.length);
  }
  segments.push(escapeHtml(rest));

  return segments.join('');
}

function mentionToHtml(mention: MentionObject, resolveExternalId?: (id: string) => string | null): string {
  const asanaType = REF_TYPE_TO_ASANA_TYPE[mention.ref_type] ?? 'user';
  const externalId = resolveExternalId?.(mention.id) ?? mention.id;
  const displayName = mention.fallback_record_name || 'Unknown';
  return `<a data-asana-gid="${escapeHtml(externalId)}" data-asana-type="${asanaType}">@${escapeHtml(displayName)}</a>`;
}

/** Serialize rich text content array back to Asana-compatible HTML. */
export function serializeToAsanaHtml(
  richText: RichTextContent[] | RichTextWrapper | string | null | undefined,
  resolveExternalId?: (id: string) => string | null
): string | null {
  const unwrapped = unwrapRichText(richText);
  if (!unwrapped || unwrapped.length === 0) {
    return null;
  }
  const richTextArray = unwrapped;

  const htmlParts: string[] = [];
  for (const part of richTextArray) {
    if (typeof part === 'string') {
      htmlParts.push(textToHtml(part));
    } else {
      htmlParts.push(mentionToHtml(part, resolveExternalId));
    }
  }

  return `<body>${htmlParts.join('')}</body>`;
}

/** Serialize rich text content array to plain text with @mention fallbacks. */
export function serializeToPlainText(
  richText: RichTextContent[] | RichTextWrapper | string | null | undefined,
  _resolveExternalId?: (id: string) => string | null
): string | null {
  const unwrapped = unwrapRichText(richText);
  if (!unwrapped || unwrapped.length === 0) {
    return null;
  }

  const parts: string[] = [];
  for (const part of unwrapped) {
    if (typeof part === 'string') {
      parts.push(normalizeNewlines(markdownImagesToPlainText(part)));
    } else {
      const displayName = part.fallback_record_name || 'Unknown';
      parts.push(`@${displayName}`);
    }
  }

  return parts.join('');
}
