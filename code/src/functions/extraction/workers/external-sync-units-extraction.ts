import { AirSyncDefaultItemTypes, processExtractionTask } from '@devrev/airsync-sdk';

import { AsanaClient } from '@asana/api-client';
import { handleExtractionError } from '@utils/data-helpers';
import { buildExternalSyncUnits, checkUserWorkspaceRole, fetchAllProjects } from '@utils/external-sync-units-helpers';
import { serializeError } from '@utils/serialize-error';

import type { ExtractorState } from '../index';

processExtractionTask<ExtractorState>({
  task: async ({ adapter }) => {
    adapter.initializeRepos([{ itemType: AirSyncDefaultItemTypes.EXTERNAL_SYNC_UNITS }]);

    const asanaClient = new AsanaClient(adapter.event);

    try {
      await checkUserWorkspaceRole(asanaClient);
      const asanaProjects = await fetchAllProjects(asanaClient);
      const externalSyncUnits = await buildExternalSyncUnits(asanaProjects, asanaClient);
      await adapter.getRepo(AirSyncDefaultItemTypes.EXTERNAL_SYNC_UNITS)?.push(externalSyncUnits);
      return { status: 'success' };
    } catch (error) {
      // This phase has no *_DELAYED event, so a rate limit fails it and the user retries later.
      const { delay, error: extractionError } = handleExtractionError(error);
      const message = delay
        ? `Rate limited by Asana (HTTP 429) while listing projects. Retry in ${delay} seconds.`
        : `Error paginating projects list from Asana: ${serializeError(error)}`;
      return { status: 'error', error: { ...extractionError, message } };
    }
  },
});
