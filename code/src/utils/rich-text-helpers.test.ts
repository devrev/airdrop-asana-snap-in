import { ItemType } from '@asana/constants';

import {
  MentionObject,
  parseAsanaRichText,
  serializeToAsanaHtml,
  serializeToPlainText,
  unwrapRichText,
} from './rich-text-helpers';

describe('unwrapRichText', () => {
  it('should return null for null input', () => {
    expect(unwrapRichText(null)).toBeNull();
  });

  it('should return null for undefined input', () => {
    expect(unwrapRichText(undefined)).toBeNull();
  });

  it('should return the array as-is when given an array', () => {
    const input = ['hello', 'world'];
    expect(unwrapRichText(input)).toBe(input);
  });

  it('should wrap a string in an array', () => {
    expect(unwrapRichText('hello')).toEqual(['hello']);
  });

  it('should extract content from a wrapper object', () => {
    const input = { content: ['hello', 'world'], type: 'rich_text' };
    expect(unwrapRichText(input as any)).toEqual(['hello', 'world']);
  });

  it('should return null for an object without content array', () => {
    expect(unwrapRichText({ type: 'other' } as any)).toBeNull();
  });
});

describe('parseAsanaRichText', () => {
  describe('handling null/undefined/empty input', () => {
    it('should return null for null input', () => {
      expect(parseAsanaRichText(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(parseAsanaRichText(undefined)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(parseAsanaRichText('')).toBeNull();
    });

    it('should return null for whitespace-only HTML', () => {
      expect(parseAsanaRichText('<body>   </body>')).toBeNull();
    });
  });

  describe('parsing plain text without mentions', () => {
    it('should parse simple text wrapped in body tags', () => {
      const result = parseAsanaRichText('<body>Hello world</body>');
      expect(result).toEqual(['Hello world']);
    });

    it('should preserve newlines from br tags', () => {
      const result = parseAsanaRichText('<body>Line 1<br/>Line 2</body>');
      expect(result).toEqual(['Line 1\nLine 2']);
    });

    it('should handle paragraph tags', () => {
      const result = parseAsanaRichText('<body><p>Paragraph 1</p><p>Paragraph 2</p></body>');
      expect(result).toEqual(['Paragraph 1\n\nParagraph 2']);
    });

    it('should decode HTML entities', () => {
      const result = parseAsanaRichText('<body>Tom &amp; Jerry &lt;3 &quot;movies&quot;</body>');
      expect(result).toEqual(['Tom & Jerry <3 "movies"']);
    });
  });

  describe('parsing mentions', () => {
    it('should parse a single user mention', () => {
      const html =
        '<body>Hello <a data-asana-gid="12345" data-asana-accessible="true" data-asana-type="user" data-asana-dynamic="true">@John Doe</a></body>';
      const result = parseAsanaRichText(html);

      expect(result).toHaveLength(2);
      // Text before mention gets trailing space added to prevent concatenation
      expect(result![0]).toBe('Hello ');
      expect(result![1]).toEqual({
        ref_type: ItemType.USERS,
        id: '12345',
        fallback_record_name: 'John Doe',
      });
    });

    it('should parse mention with text after', () => {
      const html = '<body><a data-asana-gid="12345" data-asana-type="user">@John</a> please review</body>';
      const result = parseAsanaRichText(html);

      expect(result).toHaveLength(2);
      expect(result![0]).toEqual({
        ref_type: ItemType.USERS,
        id: '12345',
        fallback_record_name: 'John',
      });
      // Text after mention preserves existing space
      expect(result![1]).toBe(' please review');
    });

    it('should parse mention surrounded by text', () => {
      const html = '<body>Hey <a data-asana-gid="12345" data-asana-type="user">@John</a> how are you?</body>';
      const result = parseAsanaRichText(html);

      expect(result).toHaveLength(3);
      // Text before mention gets trailing space added
      expect(result![0]).toBe('Hey ');
      expect(result![1]).toEqual({
        ref_type: ItemType.USERS,
        id: '12345',
        fallback_record_name: 'John',
      });
      // Text after mention preserves existing space
      expect(result![2]).toBe(' how are you?');
    });

    it('should parse multiple mentions', () => {
      const html =
        '<body><a data-asana-gid="111" data-asana-type="user">@Alice</a> and <a data-asana-gid="222" data-asana-type="user">@Bob</a> please collaborate</body>';
      const result = parseAsanaRichText(html);

      expect(result).toHaveLength(4);
      expect(result![0]).toEqual({
        ref_type: ItemType.USERS,
        id: '111',
        fallback_record_name: 'Alice',
      });
      // Text between mentions gets trailing space added before next mention
      expect(result![1]).toBe('and ');
      expect(result![2]).toEqual({
        ref_type: ItemType.USERS,
        id: '222',
        fallback_record_name: 'Bob',
      });
      // Text after mention preserves existing space
      expect(result![3]).toBe(' please collaborate');
    });

    it('should handle consecutive mentions without text between', () => {
      const html =
        '<body>CC: <a data-asana-gid="111" data-asana-type="user">@Alice</a><a data-asana-gid="222" data-asana-type="user">@Bob</a></body>';
      const result = parseAsanaRichText(html);

      expect(result).toHaveLength(3);
      // Text before first mention gets trailing space added
      expect(result![0]).toBe('CC: ');
      expect(result![1]).toEqual({
        ref_type: ItemType.USERS,
        id: '111',
        fallback_record_name: 'Alice',
      });
      expect(result![2]).toEqual({
        ref_type: ItemType.USERS,
        id: '222',
        fallback_record_name: 'Bob',
      });
    });

    it('should strip @ prefix from display name', () => {
      const html = '<a data-asana-gid="12345" data-asana-type="user">@John Doe</a>';
      const result = parseAsanaRichText(html);

      const mention = result![0] as MentionObject;
      expect(mention.fallback_record_name).toBe('John Doe');
    });

    it('should handle display name without @ prefix', () => {
      const html = '<a data-asana-gid="12345" data-asana-type="user">John Doe</a>';
      const result = parseAsanaRichText(html);

      const mention = result![0] as MentionObject;
      expect(mention.fallback_record_name).toBe('John Doe');
    });
  });

  describe('attribute parsing', () => {
    it('should handle attributes in different order', () => {
      const html =
        '<a data-asana-type="user" data-asana-dynamic="true" data-asana-gid="12345" data-asana-accessible="true">@John</a>';
      const result = parseAsanaRichText(html);

      expect(result).toHaveLength(1);
      expect(result![0]).toEqual({
        ref_type: ItemType.USERS,
        id: '12345',
        fallback_record_name: 'John',
      });
    });

    it('should default to user type when type attribute is missing', () => {
      const html = '<a data-asana-gid="12345">@John</a>';
      const result = parseAsanaRichText(html);

      const mention = result![0] as MentionObject;
      expect(mention.ref_type).toBe(ItemType.USERS);
    });

    it('should handle unknown Asana types by defaulting to users', () => {
      const html = '<a data-asana-gid="12345" data-asana-type="unknown_type">@SomeEntity</a>';
      const result = parseAsanaRichText(html);

      const mention = result![0] as MentionObject;
      expect(mention.ref_type).toBe(ItemType.USERS);
    });
  });

  describe('edge cases', () => {
    it('should handle HTML without body tags', () => {
      const html = 'Plain text without body tags';
      const result = parseAsanaRichText(html);
      expect(result).toEqual(['Plain text without body tags']);
    });

    it('should handle mention-only content', () => {
      const html = '<a data-asana-gid="12345" data-asana-type="user">@John</a>';
      const result = parseAsanaRichText(html);

      expect(result).toHaveLength(1);
      expect(result![0]).toEqual({
        ref_type: ItemType.USERS,
        id: '12345',
        fallback_record_name: 'John',
      });
    });

    it('should handle complex nested HTML', () => {
      const html =
        '<body><p>Task assigned to <a data-asana-gid="12345" data-asana-type="user">@John</a></p><p>Please complete by Friday.</p></body>';
      const result = parseAsanaRichText(html);

      expect(result).toHaveLength(3);
      // Text before mention gets trailing space added
      expect(result![0]).toBe('Task assigned to ');
      expect(result![1]).toEqual({
        ref_type: ItemType.USERS,
        id: '12345',
        fallback_record_name: 'John',
      });
      expect(result![2]).toContain('Please complete by Friday');
    });

    it('should handle regular anchor tags (non-Asana mentions)', () => {
      const html = '<body>Check <a href="https://example.com">this link</a> for details</body>';
      const result = parseAsanaRichText(html);

      // Regular links should be stripped, leaving only text
      expect(result).toEqual(['Check this link for details']);
    });

    it('should handle mixed regular links and mentions', () => {
      const html =
        '<body>Hey <a data-asana-gid="12345" data-asana-type="user">@John</a>, see <a href="https://example.com">docs</a></body>';
      const result = parseAsanaRichText(html);

      expect(result).toHaveLength(3);
      // Text before mention gets trailing space added
      expect(result![0]).toBe('Hey ');
      expect(result![1]).toEqual({
        ref_type: ItemType.USERS,
        id: '12345',
        fallback_record_name: 'John',
      });
      // Text after mention preserves existing space/comma (space is added before comma)
      expect(result![2]).toBe(' , see docs');
    });

    it('should handle real Asana task description format', () => {
      const html =
        '<body><a data-asana-gid="1234567890123" data-asana-accessible="true" data-asana-type="user" data-asana-dynamic="true">@Jane Smith</a> please review this when you have time.\n\nThis is the task description with details.</body>';
      const result = parseAsanaRichText(html);

      expect(result).toHaveLength(2);
      expect(result![0]).toEqual({
        ref_type: ItemType.USERS,
        id: '1234567890123',
        fallback_record_name: 'Jane Smith',
      });
      expect(result![1]).toContain('please review this when you have time');
      expect(result![1]).toContain('This is the task description with details');
    });

    it('should handle real Asana comment format', () => {
      const html =
        '<body><a data-asana-gid="9876543210987" data-asana-accessible="true" data-asana-type="user" data-asana-dynamic="true">@Team Lead</a> - can you review this?</body>';
      const result = parseAsanaRichText(html);

      expect(result).toHaveLength(2);
      expect(result![0]).toEqual({
        ref_type: ItemType.USERS,
        id: '9876543210987',
        fallback_record_name: 'Team Lead',
      });
      // Text after mention preserves existing space
      expect(result![1]).toBe(' - can you review this?');
    });

    it('should add space after mention when text follows without space', () => {
      const html =
        '<body><a data-asana-gid="123" data-asana-type="user">@Raddy Jork</a>please review this when you have time.</body>';
      const result = parseAsanaRichText(html);

      expect(result).toHaveLength(2);
      expect(result![0]).toEqual({
        ref_type: ItemType.USERS,
        id: '123',
        fallback_record_name: 'Raddy Jork',
      });
      // Text should start with a space to prevent concatenation
      expect(result![1]).toBe(' please review this when you have time.');
    });

    it('should preserve existing space after mention', () => {
      const html = '<body><a data-asana-gid="123" data-asana-type="user">@Raddy Jork</a> please review this.</body>';
      const result = parseAsanaRichText(html);

      expect(result).toHaveLength(2);
      expect(result![1]).toBe(' please review this.');
    });
  });

  describe('stripping inline attachment images', () => {
    it('should strip inline attachment image from html', () => {
      const html =
        '<body><img src="https://asanausercontent.com/..." data-asana-gid="123" data-asana-type="attachment" alt="image.png" /></body>';
      const result = parseAsanaRichText(html);

      expect(result).toBeNull();
    });

    it('should strip inline attachment image but preserve text', () => {
      const html =
        '<body>Check this image: <img src="https://asanausercontent.com/..." data-asana-gid="123" data-asana-type="attachment" alt="image.png" /></body>';
      const result = parseAsanaRichText(html);

      expect(result).toHaveLength(1);
      expect(result![0]).toBe('Check this image:');
    });

    it('should strip inline attachment image but preserve mentions', () => {
      const html =
        '<body><a data-asana-gid="456" data-asana-type="user">@John</a> <img src="https://asanausercontent.com/..." data-asana-gid="123" data-asana-type="attachment" /></body>';
      const result = parseAsanaRichText(html);

      expect(result).toHaveLength(1);
      expect(result![0]).toEqual({
        ref_type: 'users',
        id: '456',
        fallback_record_name: 'John',
      });
    });

    it('should strip multiple inline attachment images', () => {
      const html =
        '<body>Images: <img data-asana-type="attachment" data-asana-gid="1" /> and <img data-asana-type="attachment" data-asana-gid="2" /></body>';
      const result = parseAsanaRichText(html);

      expect(result).toHaveLength(1);
      expect(result![0]).toBe('Images:  and');
    });

    it('should preserve text and mentions while stripping attachment images', () => {
      const html =
        '<body>Hey <a data-asana-gid="789" data-asana-type="user">@Alice</a>, check this <img data-asana-type="attachment" data-asana-gid="123" /> attachment!</body>';
      const result = parseAsanaRichText(html);

      expect(result).toHaveLength(3);
      expect(result![0]).toBe('Hey ');
      expect(result![1]).toEqual({
        ref_type: 'users',
        id: '789',
        fallback_record_name: 'Alice',
      });
      expect(result![2]).toBe(' , check this  attachment!');
    });
  });
});

describe('serializeToAsanaHtml', () => {
  describe('handling null/undefined/empty input', () => {
    it('should return null for null input', () => {
      expect(serializeToAsanaHtml(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(serializeToAsanaHtml(undefined)).toBeNull();
    });

    it('should return null for empty array', () => {
      expect(serializeToAsanaHtml([])).toBeNull();
    });
  });

  describe('serializing plain text', () => {
    it('should wrap plain text in body tags', () => {
      expect(serializeToAsanaHtml(['Hello world'])).toBe('<body>Hello world</body>');
    });

    it('should convert newlines to br tags', () => {
      expect(serializeToAsanaHtml(['Line 1\nLine 2'])).toBe('<body>Line 1<br />Line 2</body>');
    });

    it('should escape HTML entities', () => {
      expect(serializeToAsanaHtml(['Tom & Jerry <3 "movies"'])).toBe(
        '<body>Tom &amp; Jerry &lt;3 &quot;movies&quot;</body>'
      );
    });

    it('should escape single quotes', () => {
      expect(serializeToAsanaHtml(["it's"])).toBe("<body>it&#39;s</body>");
    });

    it('should concatenate multiple text segments', () => {
      expect(serializeToAsanaHtml(['Hello ', 'world'])).toBe('<body>Hello world</body>');
    });
  });

  describe('serializing mentions', () => {
    it('should convert a user mention to Asana anchor tag', () => {
      const result = serializeToAsanaHtml([
        { ref_type: 'users', id: '12345', fallback_record_name: 'John Doe' },
      ]);

      expect(result).toBe('<body><a data-asana-gid="12345" data-asana-type="user">@John Doe</a></body>');
    });

    it('should use "Unknown" when fallback_record_name is empty', () => {
      const result = serializeToAsanaHtml([
        { ref_type: 'users', id: '12345', fallback_record_name: '' },
      ]);

      expect(result).toBe('<body><a data-asana-gid="12345" data-asana-type="user">@Unknown</a></body>');
    });

    it('should default to user type for unknown ref_type', () => {
      const result = serializeToAsanaHtml([
        { ref_type: 'unknown_type', id: '12345', fallback_record_name: 'Entity' },
      ]);

      expect(result).toBe('<body><a data-asana-gid="12345" data-asana-type="user">@Entity</a></body>');
    });

    it('should escape HTML in mention display name', () => {
      const result = serializeToAsanaHtml([
        { ref_type: 'users', id: '123', fallback_record_name: 'O\'Brien & <Co>' },
      ]);

      expect(result).toContain('@O&#39;Brien &amp; &lt;Co&gt;');
    });

    it('should escape HTML in mention GID', () => {
      const result = serializeToAsanaHtml([
        { ref_type: 'users', id: '"><script>', fallback_record_name: 'Test' },
      ]);

      expect(result).toContain('data-asana-gid="&quot;&gt;&lt;script&gt;"');
    });
  });

  describe('serializing mixed content', () => {
    it('should handle text before mention', () => {
      const result = serializeToAsanaHtml([
        'Hello ',
        { ref_type: 'users', id: '123', fallback_record_name: 'John' },
      ]);

      expect(result).toBe('<body>Hello <a data-asana-gid="123" data-asana-type="user">@John</a></body>');
    });

    it('should handle text after mention', () => {
      const result = serializeToAsanaHtml([
        { ref_type: 'users', id: '123', fallback_record_name: 'John' },
        ' please review',
      ]);

      expect(result).toBe('<body><a data-asana-gid="123" data-asana-type="user">@John</a> please review</body>');
    });

    it('should handle text between mentions', () => {
      const result = serializeToAsanaHtml([
        { ref_type: 'users', id: '111', fallback_record_name: 'Alice' },
        ' and ',
        { ref_type: 'users', id: '222', fallback_record_name: 'Bob' },
      ]);

      expect(result).toBe(
        '<body><a data-asana-gid="111" data-asana-type="user">@Alice</a> and <a data-asana-gid="222" data-asana-type="user">@Bob</a></body>'
      );
    });
  });

  describe('resolveExternalId callback', () => {
    it('should use resolveExternalId to remap mention IDs', () => {
      const resolver = (id: string) => (id === 'devrev-123' ? 'asana-456' : null);

      const result = serializeToAsanaHtml(
        [{ ref_type: 'users', id: 'devrev-123', fallback_record_name: 'John' }],
        resolver
      );

      expect(result).toBe('<body><a data-asana-gid="asana-456" data-asana-type="user">@John</a></body>');
    });

    it('should fall back to original ID when resolver returns null', () => {
      const resolver = () => null;

      const result = serializeToAsanaHtml(
        [{ ref_type: 'users', id: 'original-id', fallback_record_name: 'John' }],
        resolver
      );

      expect(result).toContain('data-asana-gid="original-id"');
    });

    it('should fall back to original ID when no resolver provided', () => {
      const result = serializeToAsanaHtml([
        { ref_type: 'users', id: 'original-id', fallback_record_name: 'John' },
      ]);

      expect(result).toContain('data-asana-gid="original-id"');
    });
  });
});

describe('serializeToPlainText', () => {
  it('should return null for null input', () => {
    expect(serializeToPlainText(null)).toBeNull();
  });

  it('should return null for empty array', () => {
    expect(serializeToPlainText([])).toBeNull();
  });

  it('should pass through plain text', () => {
    expect(serializeToPlainText(['Hello world'])).toBe('Hello world');
  });

  it('should convert mentions to @Name format', () => {
    expect(
      serializeToPlainText([
        { ref_type: 'users', id: '123', fallback_record_name: 'John' },
      ])
    ).toBe('@John');
  });

  it('should use "Unknown" for empty fallback_record_name', () => {
    expect(
      serializeToPlainText([
        { ref_type: 'users', id: '123', fallback_record_name: '' },
      ])
    ).toBe('@Unknown');
  });

  it('should concatenate mixed text and mentions', () => {
    expect(
      serializeToPlainText([
        'Hello ',
        { ref_type: 'users', id: '123', fallback_record_name: 'John' },
        ' please review',
      ])
    ).toBe('Hello @John please review');
  });
});
