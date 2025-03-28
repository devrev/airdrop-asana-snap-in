import { ExternalSyncUnit, ExtractorEventType, processTask } from '@devrev/ts-adaas';

import { AsanaClient } from '../../asana/client';

processTask({
  task: async ({ adapter }) => {
    const asanaClient = new AsanaClient(adapter.event);

    // Projects from Asana will be external sync units
    try {
      const response = await asanaClient.getProjects();
      const projects = response?.data?.data;

      const externalSyncUnits: ExternalSyncUnit[] = await Promise.all(
        projects?.map(async (project: { gid: string; name: string; resource_type: string }) => {
          let itemCount: number | undefined;

          try {
            const responseProject = await asanaClient.getProjectTaskCount(project.gid);
            itemCount = responseProject?.data?.data?.num_tasks;
          } catch (error) {
            console.error(`Error fetching project task count for project ${project.gid}: ${error}`);
          }

          return {
            id: project.gid,
            name: project.name,
            description: project.resource_type,
            ...(itemCount !== undefined && { item_count: itemCount }), // Conditionally add item_count
          };
        })
      );

      await adapter.emit(ExtractorEventType.ExtractionExternalSyncUnitsDone, {
        external_sync_units: externalSyncUnits,
      });
    } catch (error) {
      await adapter.emit(ExtractorEventType.ExtractionExternalSyncUnitsError, {
        error: {
          message: `Failed to extract external sync units. Error fetching from Asana: ${error}`,
        },
      });
    }
  },
  onTimeout: async ({ adapter }) => {
    await adapter.emit(ExtractorEventType.ExtractionExternalSyncUnitsError, {
      error: {
        message: 'Failed to extract external sync units. Lambda timeout.',
      },
    });
  },
});
