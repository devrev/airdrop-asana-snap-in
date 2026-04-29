import { toDateOnly } from '@utils/field-extraction-helpers';
import { type IdResolver, resolveRef } from '@utils/loading-helpers';
import { type RichTextContent, serializeToAsanaHtml, serializeToPlainText, unwrapRichText } from '@utils/rich-text-helpers';

import type { CreateAsanaCommentRequest, CreateAsanaTaskRequest } from './types';


export interface DenormalizedTaskPayload {
  createRequest: CreateAsanaTaskRequest;
  updateRequest: CreateAsanaTaskRequest;
  sectionGid?: string | null;
  tagGids?: string[];
}

/** Convert DevRev task data into Asana create/update payloads. */
export async function denormalizeTask(
  data: Record<string, unknown>,
  resolveId: IdResolver
): Promise<DenormalizedTaskPayload> {
  let assignee: string | null = null;
  const ownedByIds = data.assignee;
  if (ownedByIds) {
    const firstOwner = Array.isArray(ownedByIds) ? ownedByIds[0] : ownedByIds;
    if (firstOwner) {
      assignee = await resolveRef(firstOwner, resolveId);
    }
  }

  let sectionGid: string | null = null;
  if (data.section) {
    sectionGid = await resolveRef(data.section, resolveId);
  }

  const tagGids: string[] = [];
  const tags = data.tags as unknown[] | null;
  if (tags?.length) {
    for (const tagRef of tags) {
      const tagGid = await resolveRef(tagRef, resolveId);
      if (tagGid) tagGids.push(tagGid);
    }
  }

  const richTextBody = data.description as RichTextContent[] | null;
  // Use html_notes when rich text contains mentions; plain notes otherwise to avoid Asana XML parsing issues
  const unwrappedBody = unwrapRichText(richTextBody);
  const hasMentions = unwrappedBody?.some((part) => typeof part !== 'string') ?? false;
  const htmlNotes = hasMentions ? serializeToAsanaHtml(richTextBody, (id) => id) : undefined;
  const plainNotes = !hasMentions ? serializeToPlainText(richTextBody) : undefined;

  const taskData = {
    name: (data.name as string) ?? undefined,
    ...(htmlNotes ? { html_notes: htmlNotes } : {}),
    ...(plainNotes ? { notes: plainNotes } : {}),
    assignee: assignee,
    due_on: toDateOnly(data.due_date as string | null),
    start_on: toDateOnly(data.start_date as string | null),
    completed: data.completed as boolean | undefined,
  };

  return {
    createRequest: { data: taskData },
    updateRequest: { data: taskData },
    sectionGid,
    tagGids,
  };
}

export interface DenormalizedCommentPayload {
  parentGid: string | null;
  request: CreateAsanaCommentRequest;
}

/** Convert DevRev comment data into an Asana comment creation payload. */
export async function denormalizeComment(
  data: Record<string, unknown>,
  resolveId: IdResolver
): Promise<DenormalizedCommentPayload> {
  const parentGid = await resolveRef(data.parent_id, resolveId);

  const richTextBody = data.body as RichTextContent[] | null;
  const htmlText = serializeToAsanaHtml(richTextBody, (id) => id);

  return {
    parentGid,
    request: { data: { html_text: htmlText ?? '' } },
  };
}

export interface DenormalizedLinkAction {
  linkType: string;
  sourceGid: string;
  targetGid: string;
}

/** Convert DevRev link data into an Asana dependency action. */
export async function denormalizeLink(
  data: Record<string, unknown>,
  resolveId: IdResolver
): Promise<DenormalizedLinkAction | null> {
  const linkType = data.link_type as string;

  if (!linkType || !data.source || !data.target) return null;

  const sourceGid = await resolveRef(data.source, resolveId);
  const targetGid = await resolveRef(data.target, resolveId);

  if (!sourceGid || !targetGid) {
    return null;
  }

  return { linkType, sourceGid, targetGid };
}

