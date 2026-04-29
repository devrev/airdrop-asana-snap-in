import { toDateOnly } from './field-extraction-helpers';

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
