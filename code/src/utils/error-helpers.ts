import { AirSyncErrorCode } from '@devrev/airsync-sdk';
import axios from 'axios';

export function getAsanaAccessErrorCode(error: unknown): AirSyncErrorCode | undefined {
  if (!axios.isAxiosError(error)) return undefined;

  const url = error.config?.url;
  if (url && /^https?:\/\//i.test(url) && new URL(url).hostname !== 'app.asana.com') return undefined;

  if (error.response?.status === 401) return AirSyncErrorCode.EXTERNAL_SYSTEM_NO_ACCESS;
  if (error.response?.status === 403) return AirSyncErrorCode.EXTERNAL_SYSTEM_NO_PERMISSION;
  return undefined;
}
