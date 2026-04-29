import { AirSyncDefaultItemTypes, ExtractorEventType, processTask } from '@devrev/ts-adaas';

import { AsanaClient } from '@asana/api-client';
import { buildExternalSyncUnits, checkUserWorkspaceRole, fetchAllProjects } from '@utils/external-sync-units-helpers';
import { serializeError } from '@utils/serialize-error';

import type { ExtractorState } from '../index';

processTask<ExtractorState>({
  task: async ({ adapter }) => {
    adapter.initializeRepos([{ itemType: AirSyncDefaultItemTypes.EXTERNAL_SYNC_UNITS }]);

    const asanaClient = new AsanaClient(adapter.event);

    await checkUserWorkspaceRole(asanaClient);

    let asanaProjects;
    try {
      asanaProjects = await fetchAllProjects(asanaClient);
    } catch (error) {
      await adapter.emit(ExtractorEventType.ExternalSyncUnitExtractionError, {
        error: {
          message: `Error paginating projects list from Asana: ${serializeError(error)}`,
        },
      });
      return;
    }
    console.log(`Fetched ${asanaProjects.length} projects from Asana workspace. Building sync units...`);

    const externalSyncUnits = await buildExternalSyncUnits(asanaProjects, asanaClient);
    console.log(`External sync unit extraction complete. ${externalSyncUnits.length} projects available for sync.`);

    await adapter.getRepo(AirSyncDefaultItemTypes.EXTERNAL_SYNC_UNITS)?.push(externalSyncUnits);
    await adapter.emit(ExtractorEventType.ExternalSyncUnitExtractionDone);
  },
  onTimeout: async ({ adapter }) => {
    await adapter.emit(ExtractorEventType.ExternalSyncUnitExtractionError, {
      error: {
        message: 'Failed to extract external sync units due to timeout.',
      },
    });
  },
});
