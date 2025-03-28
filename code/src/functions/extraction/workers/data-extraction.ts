import {
  axios,
  ErrorRecord,
  EventType,
  ExtractorEventType,
  processTask,
  serializeAxiosError,
  SyncMode,
  WorkerAdapter,
} from '@devrev/ts-adaas';

import { ApiParams } from 'functions/asana/types';
import { AsanaClient } from '../../asana/client';
import { normalizeAttachment, normalizeTask, normalizeUser } from '../../asana/data-normalization';
import { ExtractorState, initialState } from '../index';

interface ExtractListResponse {
  delay?: number;
  error?: ErrorRecord;
}

const repos = [
  {
    itemType: 'tasks',
    normalize: normalizeTask,
  },
  {
    itemType: 'users',
    normalize: normalizeUser,
  },
  {
    itemType: 'attachments',
    normalize: normalizeAttachment,
  },
];

processTask<ExtractorState>({
  task: async ({ adapter }) => {
    adapter.initializeRepos(repos);

    const asanaClient = new AsanaClient(adapter.event);

    // Set state for periodic sync
    if (
      adapter.event.payload.event_type === EventType.ExtractionDataStart &&
      adapter.event.payload.event_context.mode === SyncMode.INCREMENTAL
    ) {
      adapter.state.users = {
        ...initialState.users,
        offset: '',
      };
      adapter.state.tasks = {
        ...initialState.tasks,
        offset: '',
        modifiedSince: adapter.state.lastSuccessfulSyncStarted,
      };
      adapter.state.attachments = { ...initialState.attachments };
    }

    // Extract users
    if (adapter.state.users.completed) {
      console.log(`Skipping extracting users as it's already marked as complete.`);
    } else {
      const { delay, error } = await extractUsers(asanaClient, adapter);
      if (delay) {
        await adapter.emit(ExtractorEventType.ExtractionDataDelay, { delay });
        return;
      } else if (error) {
        await adapter.emit(ExtractorEventType.ExtractionDataError, { error });
        return;
      } else {
        adapter.state['users'].completed = true;
        console.log(`Finished extracting users. Marked as complete.`);
      }
    }

    // Extract tasks
    if (adapter.state.tasks.completed) {
      console.log(`Skipping extracting tasks as it's already marked as complete.`);
    } else {
      const { delay, error } = await extractTasks(asanaClient, adapter);
      if (delay) {
        await adapter.emit(ExtractorEventType.ExtractionDataDelay, { delay });
        return;
      } else if (error) {
        await adapter.emit(ExtractorEventType.ExtractionDataError, { error });
        return;
      } else {
        adapter.state['tasks'].completed = true;
        adapter.state['attachments'].completed = true;
        console.log(`Finished extracting tasks. Marked as complete.`);
      }
    }

    await adapter.emit(ExtractorEventType.ExtractionDataDone, {
      progress: 100,
    });
  },
  onTimeout: async ({ adapter }) => {
    await adapter.postState();
    await adapter.emit(ExtractorEventType.ExtractionDataProgress, {
      progress: 50,
    });
  },
});

async function extractUsers(
  asanaClient: AsanaClient,
  adapter: WorkerAdapter<ExtractorState>
): Promise<ExtractListResponse> {
  // Users per page
  const USERS_LIMIT = 100;
  const params: ApiParams = { limit: USERS_LIMIT };

  try {
    let hasNextPage = true;

    while (hasNextPage) {
      const response = await asanaClient.getUsers({
        ...params,
        ...(adapter.state.users.offset && { offset: adapter.state.users.offset }),
      });

      const users = response.data?.data || [];
      const nextPage = response.data?.next_page;

      if (users.length > 0) {
        await adapter.getRepo('users')?.push(users);
      }

      // Update offset for next iteration
      if (nextPage) {
        adapter.state.users.offset = nextPage.offset;
      } else {
        hasNextPage = false;
      }
    }

    return {};
  } catch (error) {
    return handleExtractionError(error);
  }
}

async function extractTasks(
  asanaClient: AsanaClient,
  adapter: WorkerAdapter<ExtractorState>
): Promise<ExtractListResponse> {
  // Tasks per page
  const TASKS_LIMIT = 100;
  const params: ApiParams = { limit: TASKS_LIMIT };

  const createItemUrl = (taskId: string, projectId: string) => `https://app.asana.com/0/${projectId}/${taskId}`;

  try {
    let hasNextPage = true;

    while (hasNextPage) {
      const response = await asanaClient.getTasks({
        ...params,
        ...(adapter.state.tasks.offset && { offset: adapter.state.tasks.offset }),
        ...(adapter.state.tasks.modifiedSince && { modified_since: adapter.state.tasks.modifiedSince }),
      });

      const tasks = response.data?.data || [];
      const nextPage = response.data?.next_page;

      // Process tasks
      const newTasks = tasks.map((task: any) => ({
        ...task,
        item_url_field: createItemUrl(task.gid, asanaClient.projectId),
      }));

      if (newTasks.length > 0) {
        await adapter.getRepo('tasks')?.push(newTasks);
      }

      // Process attachments
      const newAttachments = tasks
        .filter((task: any) => task.attachments && task.attachments.length > 0)
        .flatMap((task: any) =>
          task.attachments.map((attachment: any) => ({
            ...attachment,
            parent_id: task.gid,
          }))
        );

      if (newAttachments.length > 0) {
        await adapter.getRepo('attachments')?.push(newAttachments);
      }

      // Update offset for next iteration
      if (nextPage) {
        adapter.state.tasks.offset = nextPage.offset;
      } else {
        hasNextPage = false;
      }
    }

    return {};
  } catch (error) {
    return handleExtractionError(error);
  }
}

function handleExtractionError(error: unknown): ExtractListResponse {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 429) {
      console.log(`Rate limit hit. Retrying after ${error.response.headers['Retry-After']} seconds.`);
      return { delay: Number(error.response.headers['Retry-After']) };
    } else {
      console.error(`Error with extraction`, serializeAxiosError(error));
      return { error: { message: JSON.stringify(error) } };
    }
  } else {
    console.error(`Error with extraction`, error);
    return { error: { message: JSON.stringify(error) } };
  }
}
