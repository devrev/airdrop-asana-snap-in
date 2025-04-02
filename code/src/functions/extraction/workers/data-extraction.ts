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

import { AsanaClient } from '../../asana/client';
import { normalizeAttachment, normalizeTask, normalizeUser } from '../../asana/data-normalization';
import { ExtractorState, initialState } from '../index';

interface ExtractListResponse {
  delay?: number;
  error?: ErrorRecord;
}

// The repos variable defines an array of repository configurations for extracting and processing data
// from Asana. Each repository is responsible for a specific item type: tasks, users, or attachments.
//
// For each repository object in the array:
// - The `itemType` property specifies the type of data to be extracted from Asana.
// - The `normalize` property is a function reference that handles the normalization of the data.
//
// Once the data is extracted from Asana, it is pushed into these repositories. The normalization
// process is automatically managed by the respective functions assigned in the `normalize` property,
// which ensures that the data is properly formatted before being uploaded to Airdrop.
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
    // Initialize repos for data extraction.
    adapter.initializeRepos(repos);

    // Initialize Asana Client
    const asanaClient = new AsanaClient(adapter.event);

    // Initialize the state for incremental synchronization:
    //
    // - This is necessary to ensure that only new or updated data is extracted,
    //   avoiding re-processing data that was successfully extracted in previous syncs.
    // - The `offset` is set to an empty string ('') to start pagination from the beginning.
    // - The `modifiedDate` is set to the timestamp of the last successful sync,
    //   which we will use to filter items when querying the Asana API,
    //   ensuring that only data changed after this date is retrieved.
    if (
      adapter.event.payload.event_type === EventType.ExtractionDataStart &&
      adapter.event.payload.event_context.mode === SyncMode.INCREMENTAL
    ) {
      adapter.state = initialState;
      adapter.state.tasks.modifiedSince = adapter.state.lastSuccessfulSyncStarted;
    }

    // The extractData function handles the extraction of data from Asana. It takes two parameters:
    // - `type`: A string indicating the type of data to extract ('users' or 'tasks').
    // - `extractFunction`: A function reference specific to the type of data being extracted.
    async function extractData(type: 'users' | 'tasks', extractFunction: Function) {
      // Check if the extraction for the specified type is already completed.
      if (adapter.state[type].completed) {
        console.log(`Skipping extracting ${type} as it's already marked as complete.`);
      } else {
        // Perform the data extraction using the provided function.
        const { delay, error } = await extractFunction(asanaClient, adapter);

        if (delay) {
          // Handle any delay in extraction:
          // If a delay is indicated, emit an event to notify of the delay and stop further processing.
          await adapter.emit(ExtractorEventType.ExtractionDataDelay, { delay });
          return;
        } else if (error) {
          // Handle any errors encountered during extraction:
          // If an error occurs, emit an event to to notify of the error and stop further processing.
          await adapter.emit(ExtractorEventType.ExtractionDataError, { error });
          return;
        } else {
          // If extraction is successful with no delays or errors,
          // mark the extraction as complete in the adapter's state.
          adapter.state[type].completed = true;
          console.log(`Finished extracting ${type}. Marked as complete.`);

          // Special case for 'tasks': Also mark related 'attachments' as complete,
          // because they are extracted simultaneously with tasks.
          if (type === 'tasks') {
            adapter.state['attachments'].completed = true;
          }
        }
      }
    }

    // Extract users and tasks
    await extractData('users', extractUsers);
    await extractData('tasks', extractTasks);

    await adapter.emit(ExtractorEventType.ExtractionDataDone);
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
  try {
    let hasNextPage = true;

    // Loop through pages starting from the current `offset` saved in adapter state.
    while (hasNextPage) {
      const response = await asanaClient.getUsers({
        ...(adapter.state.users.offset && { offset: adapter.state.users.offset }),
      });

      // Extract the list of users from the response.
      const users = response.data?.data || [];

      // Push users to the repository designated for 'users' data.
      await adapter.getRepo('users')?.push(users);

      // Check for a 'next_page' object in response to determine if further paging is necessary.
      const nextPage = response.data?.next_page;

      // Update the offset for the next page if available. If not, stop the paging loop.
      if (nextPage) {
        adapter.state.users.offset = nextPage.offset;
      } else {
        hasNextPage = false;
      }
    }

    // Return an empty response object, indicating completion without errors.
    return {};
  } catch (error) {
    // Handle any errors that occur during extraction.
    return handleExtractionError(error);
  }
}

async function extractTasks(
  asanaClient: AsanaClient,
  adapter: WorkerAdapter<ExtractorState>
): Promise<ExtractListResponse> {
  // Function to create a URL to view a specific task in a project on Asana.
  const createItemUrl = (taskId: string, projectId: string) => `https://app.asana.com/0/${projectId}/${taskId}`;

  try {
    let hasNextPage = true;

    // Loop through pages starting from the current `offset` saved in adapter state.
    while (hasNextPage) {
      // Request a page of task data from Asana, using offset and modifiedSince to fetch incrementally.
      const response = await asanaClient.getTasks({
        ...(adapter.state.tasks.offset && { offset: adapter.state.tasks.offset }),
        ...(adapter.state.tasks.modifiedSince && { modified_since: adapter.state.tasks.modifiedSince }),
      });

      // Extract the list of tasks from the response.
      const tasks = response.data?.data || [];
      const nextPage = response.data?.next_page;

      // Process tasks by mapping each one to include an item URL.
      const newTasks = tasks.map((task: any) => ({
        ...task,
        item_url_field: createItemUrl(task.gid, asanaClient.projectId),
      }));

      // Push processed tasks to the repository for 'tasks'.
      await adapter.getRepo('tasks')?.push(newTasks);

      // Process attachments by filtering tasks with attachments and mapping them to include parent task ID.
      const newAttachments = tasks
        .filter((task: any) => task.attachments && task.attachments.length > 0)
        .flatMap((task: any) =>
          task.attachments.map((attachment: any) => ({
            ...attachment,
            parent_id: task.gid,
          }))
        );

      // If processed attachments are available, push them to the repository for 'attachments'.
      if (newAttachments.length > 0) {
        await adapter.getRepo('attachments')?.push(newAttachments);
      }

      // Update the offset for the next page if available, otherwise stop the paging loop.
      if (nextPage) {
        adapter.state.tasks.offset = nextPage.offset;
      } else {
        hasNextPage = false;
      }
    }

    // Return an empty response object, indicating completion without errors.
    return {};
  } catch (error) {
    // Handle any errors that occur during extraction.
    return handleExtractionError(error);
  }
}

function handleExtractionError(error: unknown): ExtractListResponse {
  // Check if the error is an AxiosError.
  if (axios.isAxiosError(error)) {
    // Check if the error status code is 429, indicating a rate limit has been hit.
    if (error.response?.status === 429) {
      // Log a message indicating that a rate limit was reached and specify the retry delay.
      console.log(`Rate limit hit. Retrying after ${error.response.headers['Retry-After']} seconds.`);

      // Return an object with a delay, signaling how long the process should wait (in seconds) before retrying.
      return { delay: Number(error.response.headers['Retry-After']) };
    } else {
      // Log the error message for Axios errors that are not rate limit related.
      // Use a utility function 'serializeAxiosError' to serialize the AxiosError for standardized error logging.
      console.error(`Error with extraction`, serializeAxiosError(error));

      // Return an object containing a serialized error message.
      return { error: { message: JSON.stringify(error) } };
    }
  } else {
    // Handle errors that are not Axios-specific by logging the error.
    console.error(`Error with extraction`, error);

    // Return a generic error message indicating that an unhandled error type occurred.
    return { error: { message: JSON.stringify(error) } };
  }
}
