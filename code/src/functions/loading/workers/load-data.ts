import { LoaderEventType, processTask } from '@devrev/ts-adaas';

import {
  ExternalSystemItem,
  ExternalSystemItemLoadingParams,
  ExternalSystemItemLoadingResponse,
} from '@devrev/ts-adaas';

import { AsanaClient } from '../../asana/client';

async function createTask({
  item,
  mappers,
  event,
}: ExternalSystemItemLoadingParams<ExternalSystemItem>): Promise<ExternalSystemItemLoadingResponse> {
  const client = new AsanaClient(event);
  const projectId = event.payload.event_context.external_sync_unit_id;

  let body = {
    data: {
      projects: [projectId],
      assignee: item.data.assignee?.external,
      name: item.data.name || '',
      notes: item.data.description?.content?.[0] ? item.data?.description?.content?.[0] : '',
    },
  };

  try {
    const response = await client.createTask(body);

    return { id: response.data.data.gid };
  } catch (error: any) {
    console.log('Could not create a task in Asana.', error);
    return { error: 'Could not create a task in Asana.' };
  }
}

async function updateTask({
  item,
  mappers,
  event,
}: ExternalSystemItemLoadingParams<ExternalSystemItem>): Promise<ExternalSystemItemLoadingResponse> {
  const client = new AsanaClient(event);
  const taskId = item.id.external as string;

  const body = {
    data: {
      assignee: item.data.assignee?.external,
      name: item.data.name || '',
      notes: item.data.description?.content?.[0] ? item.data?.description?.content?.[0] : '',
    },
  };

  try {
    const response = await client.updateTask(taskId, body);

    return { id: response.data.data.gid };
  } catch (error: any) {
    console.log('Could not update a task in Asana.', error);
    return { error: 'Could not update a task in Asana.' };
  }
}

processTask({
  task: async ({ adapter }) => {
    const client = new AsanaClient(adapter.event);

    const { reports, processed_files } = await adapter.loadItemTypes({
      itemTypesToLoad: [
        {
          itemType: 'tasks',
          create: createTask,
          update: updateTask,
        },
      ],
    });

    await adapter.emit(LoaderEventType.DataLoadingDone, {
      reports,
      processed_files,
    });
  },
  onTimeout: async ({ adapter }) => {
    await adapter.postState();
    await adapter.emit(LoaderEventType.DataLoadingProgress, {
      reports: adapter.reports,
      processed_files: adapter.processedFiles,
    });
  },
});
