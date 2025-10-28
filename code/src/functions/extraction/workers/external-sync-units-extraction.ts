import { ExternalSyncUnit, ExtractorEventType, processTask } from '@devrev/ts-adaas';

import { AsanaClient } from '../../asana/client';

processTask({
  task: async ({ adapter }) => {
    const asanaClient = new AsanaClient(adapter.event);

    // The function passes projects from Asana as external sync units.
    // External sync units must be passed as an array of objects that conform
    // to the `ExternalSyncUnit` interface.
    try {
      // Fetch the list of projects from Asana.
      const response = await asanaClient.getProjects();
      const projects = response?.data?.data;

      // Transform each project into the `ExternalSyncUnit` format.
      const externalSyncUnits: ExternalSyncUnit[] = await Promise.all(
        projects?.map(async (project: { gid: string; name: string; resource_type: string }) => {
          let itemCount: number | undefined;

          try {
            // Fetch the task count for each project.
            const responseProject = await asanaClient.getProjectTaskCount(project.gid);
            itemCount = responseProject?.data?.data?.num_tasks;
          } catch (error) {
            // Log any errors encountered when fetching the task count for a project.
            console.error(`Error fetching project task count for project ${project.gid}: ${error}`);
          }

          // Return object structured according to `ExternalSyncUnit` with conditional item count.
          return {
            id: project.gid,
            name: project.name,
            description: project.resource_type,
            item_type: 'tasks',
            ...(itemCount !== undefined && { item_count: itemCount }), // Conditionally include item_count if defined
          };
        })
      );

      // Emit an event to signal the completion of external sync units extraction
      // and pass the extracted external sync units.
      await adapter.emit(ExtractorEventType.ExtractionExternalSyncUnitsDone, {
        external_sync_units: externalSyncUnits,
      });
    } catch (error) {
      // If an error occurs during the process, emit an error event with the details.
      await adapter.emit(ExtractorEventType.ExtractionExternalSyncUnitsError, {
        error: {
          message: `Failed to extract external sync units. Error fetching from Asana: ${error}`,
        },
      });
    }
  },
  onTimeout: async ({ adapter }) => {
    // Handle task timeout situations by emitting an error event with a timeout-specific message.
    await adapter.emit(ExtractorEventType.ExtractionExternalSyncUnitsError, {
      error: {
        message: 'Failed to extract external sync units. Lambda timeout.',
      },
    });
  },
});
