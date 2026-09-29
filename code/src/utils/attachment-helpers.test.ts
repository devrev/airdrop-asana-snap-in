import type { AsanaTask } from '@asana/types';

import {
  buildExternalAttachmentLinks,
  externalAttachmentUrl,
  extractAttachmentGidFromCommentText,
  extractAttachmentsFromTask,
  extractInlineAttachmentGids,
  isExternalAttachment,
  stripAssetUrlsFromText,
} from './attachment-helpers';

describe('extractAttachmentsFromTask', () => {
  it('should return empty array when task has no attachments', () => {
    const task = { gid: 'task1', name: 'Test Task' };

    const result = extractAttachmentsFromTask(task);

    expect(result).toEqual([]);
  });

  it('should return empty array when attachments array is empty', () => {
    const task = { gid: 'task1', name: 'Test Task', attachments: [] };

    const result = extractAttachmentsFromTask(task);

    expect(result).toEqual([]);
  });

  it('should add parent_id to each attachment', () => {
    const task = {
      gid: 'task1',
      name: 'Test Task',
      attachments: [
        { gid: 'att1', name: 'file1.pdf' },
        { gid: 'att2', name: 'file2.png' },
      ],
    };

    const result = extractAttachmentsFromTask(task);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ gid: 'att1', name: 'file1.pdf', parent_id: 'task1', inline: false });
    expect(result[1]).toEqual({ gid: 'att2', name: 'file2.png', parent_id: 'task1', inline: false });
  });

  it('should preserve all original attachment properties', () => {
    const task = {
      gid: 'task1',
      attachments: [
        {
          gid: 'att1',
          name: 'document.pdf',
          resource_type: 'attachment',
          download_url: 'https://example.com/file.pdf',
          host: 'asana',
        },
      ],
    };

    const result = extractAttachmentsFromTask(task);

    expect(result[0]).toEqual({
      gid: 'att1',
      name: 'document.pdf',
      resource_type: 'attachment',
      download_url: 'https://example.com/file.pdf',
      host: 'asana',
      parent_id: 'task1',
      inline: false,
    });
  });

  it('should set parent_id to comment GID when attachment is in attachmentToCommentMap', () => {
    const task = {
      gid: 'task1',
      name: 'Test Task',
      attachments: [
        { gid: 'att1', name: 'file1.pdf' },
        { gid: 'att2', name: 'file2.png' },
      ],
    };
    const attachmentToCommentMap = new Map([['att2', 'comment1']]);

    const result = extractAttachmentsFromTask(task, undefined, attachmentToCommentMap);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ gid: 'att1', name: 'file1.pdf', parent_id: 'task1', inline: false });
    expect(result[1]).toEqual({ gid: 'att2', name: 'file2.png', parent_id: 'comment1', inline: false });
  });

  it('should handle all attachments being posted via comments', () => {
    const task = {
      gid: 'task1',
      name: 'Test Task',
      attachments: [
        { gid: 'att1', name: 'image1.png' },
        { gid: 'att2', name: 'image2.png' },
      ],
    };
    const attachmentToCommentMap = new Map([
      ['att1', 'comment1'],
      ['att2', 'comment2'],
    ]);

    const result = extractAttachmentsFromTask(task, undefined, attachmentToCommentMap);

    expect(result[0].parent_id).toBe('comment1');
    expect(result[1].parent_id).toBe('comment2');
  });

  it('should combine inlineAttachmentGids and attachmentToCommentMap correctly', () => {
    const task = {
      gid: 'task1',
      attachments: [
        { gid: 'att1', name: 'inline-image.png' },
        { gid: 'att2', name: 'comment-image.png' },
        { gid: 'att3', name: 'regular-file.pdf' },
      ],
    };
    const inlineAttachmentGids = new Set(['att1']);
    const attachmentToCommentMap = new Map([['att2', 'comment1']]);

    const result = extractAttachmentsFromTask(task, inlineAttachmentGids, attachmentToCommentMap);

    expect(result[0]).toEqual({ gid: 'att1', name: 'inline-image.png', parent_id: 'task1', inline: true });
    expect(result[1]).toEqual({ gid: 'att2', name: 'comment-image.png', parent_id: 'comment1', inline: false });
    expect(result[2]).toEqual({ gid: 'att3', name: 'regular-file.pdf', parent_id: 'task1', inline: false });
  });
});

describe('extractAttachmentGidFromCommentText', () => {
  it('should extract attachment GID from valid Asana asset URL', () => {
    const text = 'https://app.asana.com/app/asana/-/get_asset?asset_id=1213429391687031\n';

    const result = extractAttachmentGidFromCommentText(text);

    expect(result).toBe('1213429391687031');
  });

  it('should extract attachment GID from URL without trailing newline', () => {
    const text = 'https://app.asana.com/app/asana/-/get_asset?asset_id=1213429391687031';

    const result = extractAttachmentGidFromCommentText(text);

    expect(result).toBe('1213429391687031');
  });

  it('should extract attachment GID from URL with trailing whitespace', () => {
    const text = 'https://app.asana.com/app/asana/-/get_asset?asset_id=9876543210   ';

    const result = extractAttachmentGidFromCommentText(text);

    expect(result).toBe('9876543210');
  });

  it('should return null for null input', () => {
    const result = extractAttachmentGidFromCommentText(null);

    expect(result).toBeNull();
  });

  it('should return null for undefined input', () => {
    const result = extractAttachmentGidFromCommentText(undefined);

    expect(result).toBeNull();
  });

  it('should return null for empty string', () => {
    const result = extractAttachmentGidFromCommentText('');

    expect(result).toBeNull();
  });

  it('should return null when text contains more than just the URL', () => {
    const text = 'Check out this image: https://app.asana.com/app/asana/-/get_asset?asset_id=1234567890';

    const result = extractAttachmentGidFromCommentText(text);

    expect(result).toBeNull();
  });

  it('should return null for regular comment text', () => {
    const text = 'This is a regular comment without any attachment URL';

    const result = extractAttachmentGidFromCommentText(text);

    expect(result).toBeNull();
  });

  it('should return null for non-Asana URLs', () => {
    const text = 'https://example.com/image.png';

    const result = extractAttachmentGidFromCommentText(text);

    expect(result).toBeNull();
  });

  it('should return null for malformed Asana URLs', () => {
    const text = 'https://app.asana.com/app/asana/-/get_asset?asset_id=';

    const result = extractAttachmentGidFromCommentText(text);

    expect(result).toBeNull();
  });

  it('should return null for Asana URLs with non-numeric asset_id', () => {
    const text = 'https://app.asana.com/app/asana/-/get_asset?asset_id=abc123';

    const result = extractAttachmentGidFromCommentText(text);

    expect(result).toBeNull();
  });
});

describe('stripAssetUrlsFromText', () => {
  it('should strip single asset URL from text', () => {
    const text = 'Check this file: https://app.asana.com/app/asana/-/get_asset?asset_id=1234567890';

    const result = stripAssetUrlsFromText(text);

    expect(result).toBe('Check this file:');
  });

  it('should strip multiple asset URLs from text', () => {
    const text =
      'Here are the files: https://app.asana.com/app/asana/-/get_asset?asset_id=111 and https://app.asana.com/app/asana/-/get_asset?asset_id=222';

    const result = stripAssetUrlsFromText(text);

    expect(result).toBe('Here are the files: and');
  });

  it('should return empty string for text containing only asset URL', () => {
    const text = 'https://app.asana.com/app/asana/-/get_asset?asset_id=1234567890';

    const result = stripAssetUrlsFromText(text);

    expect(result).toBe('');
  });

  it('should return empty string for text containing only asset URL with trailing whitespace', () => {
    const text = 'https://app.asana.com/app/asana/-/get_asset?asset_id=1234567890   ';

    const result = stripAssetUrlsFromText(text);

    expect(result).toBe('');
  });

  it('should return text unchanged if no asset URLs present', () => {
    const text = 'This is a regular comment with no asset URLs';

    const result = stripAssetUrlsFromText(text);

    expect(result).toBe('This is a regular comment with no asset URLs');
  });

  it('should return empty string for null input', () => {
    const result = stripAssetUrlsFromText(null);

    expect(result).toBe('');
  });

  it('should return empty string for undefined input', () => {
    const result = stripAssetUrlsFromText(undefined);

    expect(result).toBe('');
  });

  it('should return empty string for empty string input', () => {
    const result = stripAssetUrlsFromText('');

    expect(result).toBe('');
  });

  it('should preserve text before and after asset URL', () => {
    const text = 'Before https://app.asana.com/app/asana/-/get_asset?asset_id=123 after';

    const result = stripAssetUrlsFromText(text);

    expect(result).toBe('Before after');
  });

  it('should handle asset URL at the beginning of text', () => {
    const text = 'https://app.asana.com/app/asana/-/get_asset?asset_id=123 Some text after';

    const result = stripAssetUrlsFromText(text);

    expect(result).toBe('Some text after');
  });
});

describe('extractInlineAttachmentGids', () => {
  it('should return empty set for null input', () => {
    expect(extractInlineAttachmentGids(null)).toEqual(new Set());
  });

  it('should return empty set for undefined input', () => {
    expect(extractInlineAttachmentGids(undefined)).toEqual(new Set());
  });

  it('should return empty set for empty string', () => {
    expect(extractInlineAttachmentGids('')).toEqual(new Set());
  });

  it('should return empty set for HTML without inline images', () => {
    expect(extractInlineAttachmentGids('<p>Hello world</p>')).toEqual(new Set());
  });

  it('should extract GID from single inline image', () => {
    const html = '<p>Text <img src="https://example.com/img.png" data-asana-gid="123456"> more text</p>';
    expect(extractInlineAttachmentGids(html)).toEqual(new Set(['123456']));
  });

  it('should extract GIDs from multiple inline images', () => {
    const html =
      '<img data-asana-gid="111" src="a.png"><p>text</p><img src="b.png" data-asana-gid="222">';
    expect(extractInlineAttachmentGids(html)).toEqual(new Set(['111', '222']));
  });

  it('should deduplicate GIDs', () => {
    const html = '<img data-asana-gid="111"><img data-asana-gid="111">';
    expect(extractInlineAttachmentGids(html)).toEqual(new Set(['111']));
    expect(extractInlineAttachmentGids(html).size).toBe(1);
  });

  it('should ignore img tags without data-asana-gid', () => {
    const html = '<img src="https://example.com/photo.png" alt="photo">';
    expect(extractInlineAttachmentGids(html)).toEqual(new Set());
  });
});

describe('isExternalAttachment', () => {
  it('treats a gdrive attachment (no download_url, has view_url) as external', () => {
    expect(
      isExternalAttachment({ gid: '1', name: 'doc', host: 'gdrive', download_url: null, view_url: 'https://docs.google.com/x' })
    ).toBe(true);
  });

  it('treats an Asana-hosted attachment (has download_url) as not external', () => {
    expect(
      isExternalAttachment({ gid: '1', name: 'file.png', download_url: 'https://asana/file.png', view_url: null })
    ).toBe(false);
  });

  it('is not external when there is neither a download_url nor a view/permanent url', () => {
    expect(isExternalAttachment({ gid: '1', name: 'x' })).toBe(false);
  });

  it('is external when only permanent_url is present', () => {
    expect(isExternalAttachment({ gid: '1', name: 'x', permanent_url: 'https://app.asana.com/app/asana/-/get_asset?asset_id=1' })).toBe(true);
  });
});

describe('externalAttachmentUrl', () => {
  it('prefers view_url over permanent_url', () => {
    expect(externalAttachmentUrl({ gid: '1', view_url: 'https://view', permanent_url: 'https://perm' })).toBe('https://view');
  });

  it('falls back to permanent_url when view_url is absent', () => {
    expect(externalAttachmentUrl({ gid: '1', permanent_url: 'https://perm' })).toBe('https://perm');
  });

  it('returns null when no link is present', () => {
    expect(externalAttachmentUrl({ gid: '1' })).toBeNull();
  });
});

describe('buildExternalAttachmentLinks', () => {
  it('returns null when the task has no attachments', () => {
    expect(buildExternalAttachmentLinks({ gid: 't1' } as AsanaTask)).toBeNull();
  });

  it('returns null when all attachments are Asana-hosted (have download_url)', () => {
    const task = {
      gid: 't1',
      attachments: [{ gid: 'a1', name: 'file.png', download_url: 'https://asana/file.png' }],
    } as AsanaTask;
    expect(buildExternalAttachmentLinks(task)).toBeNull();
  });

  it('renders a gdrive attachment as a Markdown link with a host label', () => {
    const task = {
      gid: 't1',
      attachments: [
        {
          gid: 'a1',
          name: 'Design doc',
          host: 'gdrive',
          download_url: null,
          view_url: 'https://docs.google.com/document/d/abc/edit',
        },
      ],
    } as AsanaTask;
    expect(buildExternalAttachmentLinks(task)).toBe(
      '**Attachments:**\n- [Design doc](https://docs.google.com/document/d/abc/edit) (Google Drive)'
    );
  });

  it('lists multiple external attachments and skips Asana-hosted ones', () => {
    const task = {
      gid: 't1',
      attachments: [
        { gid: 'a1', name: 'file.png', download_url: 'https://asana/file.png' },
        { gid: 'a2', name: 'Sheet', host: 'gdrive', view_url: 'https://docs.google.com/spreadsheets/d/xyz' },
        { gid: 'a3', name: 'Box file', host: 'box', view_url: 'https://box.com/f/1' },
      ],
    } as AsanaTask;
    expect(buildExternalAttachmentLinks(task)).toBe(
      '**Attachments:**\n' +
        '- [Sheet](https://docs.google.com/spreadsheets/d/xyz) (Google Drive)\n' +
        '- [Box file](https://box.com/f/1) (Box)'
    );
  });

  it('omits the host label for an unknown host and falls back to a default name', () => {
    const task = {
      gid: 't1',
      attachments: [{ gid: 'a1', name: '  ', host: 'someunknownhost', view_url: 'https://x/y' }],
    } as AsanaTask;
    expect(buildExternalAttachmentLinks(task)).toBe('**Attachments:**\n- [Attachment](https://x/y)');
  });
});
