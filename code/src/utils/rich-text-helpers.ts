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
};

const ASANA_MENTION_REGEX = /<a\s+([^>]*data-asana-gid[^>]*)>([^<]*)<\/a>/gi;

const ASANA_INLINE_ATTACHMENT_REGEX = /<img[^>]*data-asana-type="attachment"[^>]*>/gi;

function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripMarkdownImages(text: string): string {
  return text.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
}

function normalizeNewlines(text: string): string {
  return text
    .replace(/\\n/g, '\n')       // Normalize literal \n (backslash+n) to actual newlines
    .replace(/\\\n/g, '\n');     // Normalize backslash-before-newline to plain newline
}

function textToHtml(text: string): string {
  return escapeHtml(normalizeNewlines(stripMarkdownImages(text))).replace(/\n/g, '<br />');
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
      parts.push(normalizeNewlines(stripMarkdownImages(part)));
    } else {
      const displayName = part.fallback_record_name || 'Unknown';
      parts.push(`@${displayName}`);
    }
  }

  return parts.join('');
}
