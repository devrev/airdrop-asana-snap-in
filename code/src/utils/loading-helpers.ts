import type { ExternalSystemItemLoadingResponse, MappersGetByTargetIdParams } from '@devrev/ts-adaas';
import axios from 'axios';

import { serializeError } from '@utils/serialize-error';

export type IdResolver = (devrevId: string) => Promise<string | null>;

interface ReferenceObject {
  devrev?: string;
  external?: string;
}

/** Extract an external ID from a reference value (string or reference object). */
export function extractExternalIdFromRef(ref: unknown): string | null {
  if (!ref) return null;
  if (typeof ref === 'string') return ref;
  if (typeof ref === 'object' && ref !== null && 'external' in ref) {
    return (ref as ReferenceObject).external ?? null;
  }
  return null;
}

// If the external ID is numeric (Asana GID), use directly; otherwise resolve via mapper.
// Also handles { devrev: "..." } refs by resolving the devrev ID through the mapper.
/** Resolve a reference to an Asana GID, using the mapper for non-numeric IDs. */
export async function resolveRef(ref: unknown, resolveId: IdResolver): Promise<string | null> {
  const externalId = extractExternalIdFromRef(ref);
  if (externalId) {
    if (/^\d+$/.test(externalId)) return externalId;
    return resolveId(externalId);
  }

  // No external ID — try devrev ID from reference object
  if (typeof ref === 'object' && ref !== null && 'devrev' in ref) {
    const devrevId = (ref as ReferenceObject).devrev;
    if (devrevId) return resolveId(devrevId);
  }

  return null;
}

/** Handle loading errors, returning a delay for 429s or an error message otherwise. */
export function handleLoadingError(error: unknown): ExternalSystemItemLoadingResponse {
  if (axios.isAxiosError(error) && error.response?.status === 429) {
    // Fall back to 60s if Retry-After header is missing or non-numeric
    const retryAfter = Number(error.response.headers['retry-after']) || 60;
    return { delay: retryAfter };
  }

  return { error: `Error during loading: ${serializeError(error)}` };
}

/** Look up the external (Asana) ID for a given DevRev ID via the sync mapper. */
export async function resolveExternalId(
  mappers: { getByTargetId(params: MappersGetByTargetIdParams): Promise<{ data?: { sync_mapper_record?: { external_ids?: string[] } } }> },
  syncUnit: string,
  devrevId: string
): Promise<string | null> {
  try {
    const response = await mappers.getByTargetId({ sync_unit: syncUnit, target: devrevId });
    const externalIds = response.data?.sync_mapper_record?.external_ids;
    return externalIds?.[0] ?? null;
  } catch (error) {
    console.warn(`Failed to resolve external ID for devrevId=${devrevId}: ${serializeError(error)}`);
    return null;
  }
}
