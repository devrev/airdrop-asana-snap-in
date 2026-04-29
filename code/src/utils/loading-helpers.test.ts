import { AxiosError, AxiosHeaders } from 'axios';

import { extractExternalIdFromRef, handleLoadingError, resolveExternalId, resolveRef } from './loading-helpers';

describe('handleLoadingError', () => {
  it('should return delay for 429 rate limit with Retry-After header', () => {
    const error = new AxiosError('Too Many Requests', '429', undefined, undefined, {
      status: 429,
      statusText: 'Too Many Requests',
      headers: { 'retry-after': '30' },
      config: { headers: new AxiosHeaders() },
      data: {},
    });

    const result = handleLoadingError(error);
    expect(result).toEqual({ delay: 30 });
  });

  it('should default delay to 60 when Retry-After header is missing', () => {
    const error = new AxiosError('Too Many Requests', '429', undefined, undefined, {
      status: 429,
      statusText: 'Too Many Requests',
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: {},
    });

    const result = handleLoadingError(error);
    expect(result).toEqual({ delay: 60 });
  });

  it('should return error message for non-429 Axios error', () => {
    const error = new AxiosError('Server Error', '500', undefined, undefined, {
      status: 500,
      statusText: 'Internal Server Error',
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: {},
    });

    const result = handleLoadingError(error);
    expect(result.error).toContain('Error during loading:');
    expect(result.delay).toBeUndefined();
  });

  it('should return error message for non-Axios error', () => {
    const result = handleLoadingError(new Error('Something went wrong'));
    expect(result.error).toContain('Error during loading:');
    expect(result.error).toContain('Something went wrong');
  });

  it('should return error message for string error', () => {
    const result = handleLoadingError('unexpected failure');
    expect(result.error).toContain('Error during loading:');
    expect(result.error).toContain('unexpected failure');
  });
});

describe('resolveExternalId', () => {
  it('should return first external_id when mapper finds record', async () => {
    const mappers = {
      getByTargetId: jest.fn().mockResolvedValue({
        data: { sync_mapper_record: { external_ids: ['asana-gid-123', 'asana-gid-456'] } },
      }),
    };

    const result = await resolveExternalId(mappers, 'sync-unit-1', 'devrev-id-1');
    expect(result).toBe('asana-gid-123');
    expect(mappers.getByTargetId).toHaveBeenCalledWith({
      sync_unit: 'sync-unit-1',
      target: 'devrev-id-1',
    });
  });

  it('should return null when mapper returns no external_ids', async () => {
    const mappers = {
      getByTargetId: jest.fn().mockResolvedValue({
        data: { sync_mapper_record: { external_ids: [] } },
      }),
    };

    const result = await resolveExternalId(mappers, 'sync-unit-1', 'devrev-id-1');
    expect(result).toBeNull();
  });

  it('should return null when mapper returns no record', async () => {
    const mappers = {
      getByTargetId: jest.fn().mockResolvedValue({ data: {} }),
    };

    const result = await resolveExternalId(mappers, 'sync-unit-1', 'devrev-id-1');
    expect(result).toBeNull();
  });

  it('should return null when mapper throws', async () => {
    const mappers = {
      getByTargetId: jest.fn().mockRejectedValue(new Error('API failure')),
    };

    const result = await resolveExternalId(mappers, 'sync-unit-1', 'devrev-id-1');
    expect(result).toBeNull();
  });
});

describe('extractExternalIdFromRef', () => {
  it('should return null for null/undefined', () => {
    expect(extractExternalIdFromRef(null)).toBeNull();
    expect(extractExternalIdFromRef(undefined)).toBeNull();
  });

  it('should return the string directly when ref is a string', () => {
    expect(extractExternalIdFromRef('12345')).toBe('12345');
    expect(extractExternalIdFromRef('some-id')).toBe('some-id');
  });

  it('should extract external field from { external } objects', () => {
    expect(extractExternalIdFromRef({ external: 'ext-123', devrev: 'dev-456' })).toBe('ext-123');
  });

  it('should return null for objects without external field', () => {
    expect(extractExternalIdFromRef({ devrev: 'dev-456' })).toBeNull();
  });

  it('should return null for objects with null external field', () => {
    expect(extractExternalIdFromRef({ external: null })).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(extractExternalIdFromRef('')).toBeNull();
  });
});

describe('resolveRef', () => {
  it('should return null for null ref', async () => {
    const resolver = jest.fn();
    expect(await resolveRef(null, resolver)).toBeNull();
    expect(resolver).not.toHaveBeenCalled();
  });

  it('should return numeric GID directly without calling resolver', async () => {
    const resolver = jest.fn();
    expect(await resolveRef('12345', resolver)).toBe('12345');
    expect(resolver).not.toHaveBeenCalled();
  });

  it('should return numeric GID from reference object directly', async () => {
    const resolver = jest.fn();
    expect(await resolveRef({ external: '67890' }, resolver)).toBe('67890');
    expect(resolver).not.toHaveBeenCalled();
  });

  it('should call resolver for non-numeric external IDs', async () => {
    const resolver = jest.fn().mockResolvedValue('99999');
    expect(await resolveRef('devrev-id-abc', resolver)).toBe('99999');
    expect(resolver).toHaveBeenCalledWith('devrev-id-abc');
  });

  it('should return null when resolver returns null', async () => {
    const resolver = jest.fn().mockResolvedValue(null);
    expect(await resolveRef('devrev-id-abc', resolver)).toBeNull();
  });

  it('should extract external ID from object and resolve', async () => {
    const resolver = jest.fn().mockResolvedValue('resolved-gid');
    expect(await resolveRef({ external: 'non-numeric-id', devrev: 'dev-1' }, resolver)).toBe('resolved-gid');
    expect(resolver).toHaveBeenCalledWith('non-numeric-id');
  });

  it('should resolve devrev ID when only devrev field is present', async () => {
    const resolver = jest.fn().mockResolvedValue('resolved-gid');
    expect(await resolveRef({ devrev: 'don:core:issue/30' }, resolver)).toBe('resolved-gid');
    expect(resolver).toHaveBeenCalledWith('don:core:issue/30');
  });

  it('should return null when devrev-only ref cannot be resolved', async () => {
    const resolver = jest.fn().mockResolvedValue(null);
    expect(await resolveRef({ devrev: 'don:core:issue/99' }, resolver)).toBeNull();
  });
});
