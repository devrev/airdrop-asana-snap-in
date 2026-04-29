import type { AsanaAttachment, AsanaTask } from '@asana/types';

const INLINE_IMG_GID_REGEX = /<img[^>]*data-asana-gid="([^"]+)"[^>]*>/gi;

/** Extract attachment GIDs from inline `<img>` tags in Asana HTML. */
export function extractInlineAttachmentGids(html: string | null | undefined): Set<string> {
  const gids = new Set<string>();

  if (!html || typeof html !== 'string') {
    return gids;
  }

  // Reset regex state for fresh matching
  INLINE_IMG_GID_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = INLINE_IMG_GID_REGEX.exec(html)) !== null) {
    const gid = match[1];
    if (gid) {
      gids.add(gid);
    }
  }

  return gids;
}

// Matches comments that contain only an Asana asset URL (attachment-only comments)
const ASANA_ASSET_URL_REGEX = /^https:\/\/app\.asana\.com\/app\/asana\/-\/get_asset\?asset_id=(\d+)\s*$/;

/** Extract an attachment GID from a comment that contains only an Asana asset URL. */
export function extractAttachmentGidFromCommentText(text: string | null | undefined): string | null {
  if (!text || typeof text !== 'string') {
    return null;
  }
  const match = text.match(ASANA_ASSET_URL_REGEX);
  return match?.[1] ?? null;
}

const ASANA_ASSET_URL_GLOBAL_REGEX = /https:\/\/app\.asana\.com\/app\/asana\/-\/get_asset\?asset_id=\d+\s*/g;

/** Remove Asana asset URLs from text, returning the remaining content. */
export function stripAssetUrlsFromText(text: string | null | undefined): string {
  if (!text || typeof text !== 'string') {
    return '';
  }
  return text.replace(ASANA_ASSET_URL_GLOBAL_REGEX, '').trim();
}

/** Extract attachments from a task, marking inline status and mapping comment parents. */
export function extractAttachmentsFromTask(
  task: AsanaTask,
  inlineAttachmentGids?: Set<string>,
  attachmentToCommentMap?: Map<string, string>
): AsanaAttachment[] {
  if (!task.attachments || task.attachments.length === 0) {
    return [];
  }
  return task.attachments.map((attachment) => ({
    ...attachment,
    parent_id: attachmentToCommentMap?.get(attachment.gid ?? '') ?? task.gid ?? '',
    inline: inlineAttachmentGids?.has(attachment.gid ?? '') ?? false,
  }));
}
