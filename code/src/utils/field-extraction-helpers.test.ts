import { CustomFieldType } from '@asana/constants';
import type { AsanaCustomField } from '@asana/types';

import { extractCustomFields, toDateOnly } from './field-extraction-helpers';

describe('toDateOnly', () => {
  it('should return null for null/undefined/empty', () => {
    expect(toDateOnly(null)).toBeNull();
    expect(toDateOnly(undefined)).toBeNull();
    expect(toDateOnly('')).toBeNull();
  });

  it('should return date-only string as-is', () => {
    expect(toDateOnly('2024-06-15')).toBe('2024-06-15');
  });

  it('should extract date from ISO datetime string', () => {
    expect(toDateOnly('2024-06-15T14:30:00.000Z')).toBe('2024-06-15');
  });

  it('should extract date from datetime without timezone', () => {
    expect(toDateOnly('2024-06-15T14:30:00')).toBe('2024-06-15');
  });

  it('should return null for invalid format', () => {
    expect(toDateOnly('not-a-date')).toBeNull();
    expect(toDateOnly('June 15, 2024')).toBeNull();
  });
});

describe('extractCustomFields', () => {
  const field = (overrides: Partial<AsanaCustomField>): AsanaCustomField =>
    ({ gid: '111', name: 'Field', ...overrides } as AsanaCustomField);

  it('should return an empty object for null/undefined/empty input', () => {
    expect(extractCustomFields(null)).toEqual({});
    expect(extractCustomFields(undefined)).toEqual({});
    expect(extractCustomFields([])).toEqual({});
  });

  it('should skip fields missing gid or name', () => {
    const fields = [
      field({ gid: undefined, name: 'NoGid', type: CustomFieldType.TEXT, text_value: 'x' }),
      field({ gid: '222', name: undefined, type: CustomFieldType.TEXT, text_value: 'y' }),
    ] as AsanaCustomField[];
    expect(extractCustomFields(fields)).toEqual({});
  });

  describe('DATE fields (ISS-317765)', () => {
    it('should normalize a date-only value to an ISO-8601 timestamp', () => {
      const fields = [
        field({ gid: 'd1', name: 'Launch Date', type: CustomFieldType.DATE, date_value: { date: '2026-07-10' } }),
      ] as AsanaCustomField[];
      // Metadata declares DATE as 'timestamp' — a bare YYYY-MM-DD is invalid and was the bug.
      expect(extractCustomFields(fields)).toEqual({ d1: '2026-07-10T00:00:00.000Z' });
    });

    it('should preserve a full date_time value', () => {
      const fields = [
        field({ gid: 'd1', name: 'Launch Date', type: CustomFieldType.DATE, date_value: { date: '2026-07-10', date_time: '2026-07-10T17:00:00.000Z' } }),
      ] as AsanaCustomField[];
      expect(extractCustomFields(fields)).toEqual({ d1: '2026-07-10T17:00:00.000Z' });
    });

    it('should omit a DATE field with no date_value', () => {
      const fields = [field({ gid: 'd1', name: 'Launch Date', type: CustomFieldType.DATE })] as AsanaCustomField[];
      expect(extractCustomFields(fields)).toEqual({});
    });

    it('should omit a DATE field whose value is an unparseable string', () => {
      const fields = [
        field({ gid: 'd1', name: 'Launch Date', type: CustomFieldType.DATE, date_value: { date: 'not-a-date' } }),
      ] as AsanaCustomField[];
      expect(extractCustomFields(fields)).toEqual({});
    });
  });

  it('should extract text, number, enum, multi_enum and people fields', () => {
    const fields = [
      field({ gid: 't', name: 'T', type: CustomFieldType.TEXT, text_value: 'hello' }),
      field({ gid: 'n', name: 'N', type: CustomFieldType.NUMBER, number_value: 42 }),
      field({ gid: 'e', name: 'E', type: CustomFieldType.ENUM, enum_value: { gid: 'opt1' } }),
      field({ gid: 'm', name: 'M', type: CustomFieldType.MULTI_ENUM, multi_enum_values: [{ gid: 'a' }, { gid: 'b' }] }),
      field({ gid: 'p', name: 'P', type: CustomFieldType.PEOPLE, people_value: [{ gid: 'u1' }] }),
    ] as AsanaCustomField[];
    expect(extractCustomFields(fields)).toEqual({
      t: 'hello',
      n: 42,
      e: 'opt1',
      m: ['a', 'b'],
      p: ['u1'],
    });
  });
});
