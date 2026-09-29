import type { AsanaAttachment, AsanaTask, AsanaTaskAttachment } from '@asana/types';

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

/**
 * External attachments (Google Drive, Dropbox, OneDrive, Box, external URLs) are hosted outside
 * Asana and have no download_url, so they cannot be streamed as blobs. They are identified by the
 * presence of a view_url (or permanent_url) without a download_url.
 */
export function isExternalAttachment(attachment: AsanaTaskAttachment): boolean {
  return !attachment.download_url && !!(attachment.view_url || attachment.permanent_url);
}

/** Pick the best usable link for an external attachment (the viewer URL, else Asana's asset URL). */
export function externalAttachmentUrl(attachment: AsanaTaskAttachment): string | null {
  return attachment.view_url || attachment.permanent_url || null;
}

/**
 * Build a Markdown links block for a task's external attachments, to append to the item body.
 * Returns null when the task has no external attachments. External files can't be synced as
 * DevRev attachments (no downloadable blob), so we surface them as links instead of dropping them.
 */
export function buildExternalAttachmentLinks(task: AsanaTask): string | null {
  const external = (task.attachments ?? []).filter(isExternalAttachment);
  if (external.length === 0) {
    return null;
  }

  const lines = external
    .map((attachment) => {
      const url = externalAttachmentUrl(attachment);
      if (!url) return null;
      const name = attachment.name?.trim() || 'Attachment';
      const host = formatAttachmentHost(attachment.host);
      return `- [${name}](${url})${host ? ` (${host})` : ''}`;
    })
    .filter((line): line is string => !!line);

  if (lines.length === 0) {
    return null;
  }

  return `**Attachments:**\n${lines.join('\n')}`;
}

/** Map an Asana attachment host id to a human-readable label. */
function formatAttachmentHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const labels: Record<string, string> = {
    gdrive: 'Google Drive',
    dropbox: 'Dropbox',
    box: 'Box',
    onedrive: 'OneDrive',
    external: 'External',
  };
  return labels[host] ?? null;
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
