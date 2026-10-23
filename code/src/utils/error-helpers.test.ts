import { AirSyncErrorCode } from '@devrev/airsync-sdk';
import { AxiosError, AxiosResponse } from 'axios';

import { getAsanaAccessErrorCode } from './error-helpers';

it.each([
  [401, AirSyncErrorCode.EXTERNAL_SYSTEM_NO_ACCESS],
  [403, AirSyncErrorCode.EXTERNAL_SYSTEM_NO_PERMISSION],
  [404, undefined],
  [429, undefined],
  [500, undefined],
])('maps Asana HTTP %i to %s', (status, code) => {
  const error = new AxiosError('Rejected', undefined, undefined, undefined, { status } as AxiosResponse);
  expect(getAsanaAccessErrorCode(error)).toBe(code);
});

it.each([401, 403])('does not treat a signed download HTTP %i as lost Asana access', (status) => {
  const error = new AxiosError('Rejected', undefined, undefined, undefined, { status } as AxiosResponse);
  error.config = { url: 'https://files.example.com/download?signature=expired' } as typeof error.config;
  expect(getAsanaAccessErrorCode(error)).toBeUndefined();
});

it('does not classify a non-HTTP failure', () => {
  expect(getAsanaAccessErrorCode(new Error('local failure'))).toBeUndefined();
});
