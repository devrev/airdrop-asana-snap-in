import { EventType, ExtractionAdapter, SyncMode } from '@devrev/airsync-sdk';
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios';

import { ExtractorState, initialState } from '../functions/extraction';
import { handleExtractionError, isExpiredPaginationTokenError, prepareStateForExtraction } from './data-helpers';
import { extractExternalIdFromRef, handleLoadingError } from './loading-helpers';
import { parseRetryAfter } from './retry-after';

// RFC 9110 §10.2.3 permits every digit sequence. Valid delays beyond safe integer seconds
// fail explicitly rather than scheduling an early retry; invalid/missing values still use 60s.
const unrepresentableDelays = ['9007199254740992', '9007199254740993', '9'.repeat(400)];
const unrepresentableDelayError = {
  message: 'Cannot honor Retry-After: valid delay-seconds exceeds the safe integer range; refusing to retry early.',
};

describe('Retry-After interpretation', () => {
  const now = Date.parse('2026-10-19T15:00:00.250Z');
  it.each([
    ['0', 0], ['120', 120], [' 12 ', 12], ['86400', 86400], ['9007199254740991', 9007199254740991],
    [undefined, 60], [null, 60], ['', 60], [' ', 60], [[], 60], [['12'], 60],
    ['-1', 60], ['+1', 60], ['1.5', 60], ['Infinity', 60], ['NaN', 60],
    ['invalid date', 60], ['Mon, invalid GMT', 60], ['Mon, 1', 60], ['Mon, 19 Oct 2026', 60],
    ['Monday, 19-Oct-26 15:00:02 GMT', 2], ['Mon Oct 19 15:00:02 2026', 2],
    ['Mon, 19 Oct 2026 15:00:02 GMT', 2], ['Mon, 19 Oct 2026 15:00:00 GMT', 0],
    ['Mon, 19 Oct 2026 14:00:00 GMT', 0],
  ])('parses %j as %s seconds with fixed time', (input, expected) => {
    expect(parseRetryAfter(input, now)).toBe(expected);
  });
  it.each(unrepresentableDelays)('returns an explicit error for valid unrepresentable digit sequence %s', (header) => {
    expect(parseRetryAfter(header, now)).toEqual({ error: unrepresentableDelayError });
  });
  it('returns zero for a date exactly equal to the supplied clock', () => {
    expect(parseRetryAfter('Mon, 19 Oct 2026 15:00:00 GMT', Date.parse('2026-10-19T15:00:00Z'))).toBe(0);
  });
});

function responseError(status: number, headers = new AxiosHeaders(), data: unknown = {}): AxiosError {
  const error = new AxiosError('Asana rejected request');
  error.response = { status, headers, data, statusText: 'Error' } as AxiosResponse;
  return error;
}

describe('connector error results from supplied errors', () => {
  it.each([['0', 0], ['30', 30], ['86400', 86400], ['9007199254740991', 9007199254740991], ['-3', 60], ['', 60], ['oops', 60]])(
    'preserves 429 delay %s across forward and reverse sync', (header, seconds) => {
      const error = responseError(429, new AxiosHeaders({ 'retry-after': header }));
      expect(handleExtractionError(error)).toEqual({ delay: seconds });
      expect(handleLoadingError(error)).toEqual({ status: 'delay', delaySeconds: seconds });
    }
  );
  it.each(unrepresentableDelays)('returns an extraction error without a delay or uncaught exception for %s', (header) => {
    const error = responseError(429, new AxiosHeaders({ 'retry-after': header }));
    expect(handleExtractionError(error)).toEqual({ error: unrepresentableDelayError });
  });
  it.each(unrepresentableDelays)('returns a loading error without a delay or uncaught exception for %s', (header) => {
    const error = responseError(429, new AxiosHeaders({ 'retry-after': header }));
    expect(handleLoadingError(error)).toEqual({ status: 'error', error: unrepresentableDelayError });
  });
  it('uses the 60-second fallback with no header', () => {
    const error = responseError(429);
    expect(handleExtractionError(error)).toEqual({ delay: 60 });
    expect(handleLoadingError(error)).toEqual({ status: 'delay', delaySeconds: 60 });
  });
  it.each([400, 401, 403, 404, 422, 500, 503])('reports HTTP %s rather than requesting a rate-limit delay', (status) => {
    const error = responseError(status);
    expect(handleExtractionError(error)).toEqual({ error: { message: `Error while extracting data: Asana rejected request | request: UNKNOWN UNKNOWN | status: ${status} Error | response: {}` } });
    expect(handleLoadingError(error)).toEqual({ status: 'error', error: { message: `Error during loading: Asana rejected request | request: UNKNOWN UNKNOWN | status: ${status} Error | response: {}` } });
  });
  it('reports an exhausted network error without inventing a rate-limit delay', () => {
    const error = new AxiosError('Network failed', 'ERR_NETWORK');
    expect(handleExtractionError(error)).toEqual({ error: { message: 'Error while extracting data: Network failed | request: UNKNOWN UNKNOWN | code: ERR_NETWORK' } });
    expect(handleLoadingError(error)).toEqual({ status: 'error', error: { message: 'Error during loading: Network failed | request: UNKNOWN UNKNOWN | code: ERR_NETWORK' } });
  });
  it('recognizes only the Asana expired-pagination 400 response', () => {
    const data = { errors: [{ message: 'Pagination token has expired' }] };
    expect(isExpiredPaginationTokenError(responseError(400, undefined, data))).toBe(true);
    expect(isExpiredPaginationTokenError(responseError(403, undefined, data))).toBe(false);
    expect(isExpiredPaginationTokenError(responseError(400, undefined, { errors: [{ message: 'Invalid task' }] }))).toBe(false);
    expect(isExpiredPaginationTokenError(new Error('Pagination token has expired'))).toBe(false);
  });
});

describe('new-run and continuation state preparation', () => {
  function savedState(): ExtractorState {
    const state = JSON.parse(JSON.stringify(initialState)) as ExtractorState;
    Object.values(state).forEach((progress) => { progress.completed = true; progress.total = 7; });
    state.tasks.offset = 'opaque-task-token';
    state.tasks.lastExtractedTaskIndex = 3;
    state.users.offset = 'opaque-user-token';
    state.groups.offset = 'opaque-group-token';
    return state;
  }
  function input(eventType: EventType, mode: SyncMode) {
    // Only event/state data consumed by this function; no SDK methods or replacement dependencies.
    return {
      state: savedState(),
      event: { payload: { event_type: eventType, event_context: { mode, extract_from: '2026-01-01T00:00:00Z', extract_to: '2026-02-01T00:00:00Z' } } },
    } as ExtractionAdapter<ExtractorState>;
  }
  it('resets all entity progress for a new incremental sync run without mutating event bounds or defaults', () => {
    const adapter = input(EventType.StartExtractingData, SyncMode.INCREMENTAL);
    const eventBefore = JSON.stringify(adapter.event);
    prepareStateForExtraction(adapter);
    expect(adapter.state).toEqual(initialState);
    expect(JSON.stringify(adapter.event)).toBe(eventBefore);
    for (const key of Object.keys(initialState) as (keyof ExtractorState)[]) expect(adapter.state[key]).not.toBe(initialState[key]);
    adapter.state.tasks.total = 9;
    expect(initialState.tasks.total).toBe(0);
  });
  it.each([SyncMode.INITIAL, SyncMode.INCREMENTAL])('preserves saved progress and bounds on %s continuation', (mode) => {
    const adapter = input(EventType.ContinueExtractingData, mode);
    const before = JSON.stringify(adapter);
    prepareStateForExtraction(adapter);
    expect(JSON.stringify(adapter)).toBe(before);
  });
  it('retains initial-run progress', () => {
    const adapter = input(EventType.StartExtractingData, SyncMode.INITIAL);
    const before = JSON.stringify(adapter);
    prepareStateForExtraction(adapter);
    expect(JSON.stringify(adapter)).toBe(before);
  });
});

it('extracts only supplied external reference identity without substituting another audience', () => {
  expect(extractExternalIdFromRef({ external: '123', devrev: 'DEVU-1' })).toBe('123');
  expect(extractExternalIdFromRef({ devrev: 'DEVU-1' })).toBeNull();
  expect(extractExternalIdFromRef(null)).toBeNull();
  expect(extractExternalIdFromRef('123')).toBe('123');
});
