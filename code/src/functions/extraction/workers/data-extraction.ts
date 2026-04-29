import { ExtractorEventType, processTask, RepoInterface, WorkerAdapter } from '@devrev/ts-adaas';

import { AsanaClient } from '@asana/api-client';
import { ItemType } from '@asana/constants';
import {
  normalizeAsanaAttachment,
  normalizeAsanaComment,
  normalizeAsanaLink,
  normalizeAsanaSubtask,
  normalizeAsanaTag,
  normalizeAsanaTask,
  normalizeAsanaUser,
} from '@asana/data-normalization';
import type { AsanaLink } from '@asana/types';
import {
  extractGroups,
  extractTags,
  extractTasks,
  extractUsers,
  handleExtractionError,
  prepareStateForExtraction,
} from '@utils/data-helpers';
import { extractPermissions } from '@utils/permissions-helpers';

import type { ExtractorState } from '../index';

const repos: RepoInterface[] = [
  {
    itemType: ItemType.USERS,
    normalize: normalizeAsanaUser,
  },
  {
    itemType: ItemType.TAGS,
    normalize: normalizeAsanaTag,
  },
  {
    itemType: ItemType.TASKS,
    normalize: normalizeAsanaTask,
  },
  {
    itemType: ItemType.SUBTASKS,
    normalize: normalizeAsanaSubtask,
  },
  {
    itemType: ItemType.ATTACHMENTS,
    normalize: normalizeAsanaAttachment,
  },
  {
    itemType: ItemType.COMMENTS,
    normalize: normalizeAsanaComment,
  },
  {
    itemType: ItemType.LINKS,
    normalize: (record: object) => normalizeAsanaLink(record as AsanaLink),
  },
  {
    itemType: ItemType.GROUPS,
  },
  {
    itemType: ItemType.GROUP_MEMBERSHIPS,
  },
  {
    itemType: ItemType.ACCESS_RULES,
  },
];

export interface ItemTypeToExtract {
  name: typeof ItemType.USERS | typeof ItemType.TAGS | typeof ItemType.GROUPS | typeof ItemType.TASKS;
  extractFunction: (asanaClient: AsanaClient, adapter: WorkerAdapter<ExtractorState>) => Promise<void>;
}

const itemTypesToExtract: ItemTypeToExtract[] = [
  {
    name: ItemType.USERS,
    extractFunction: extractUsers,
  },
  {
    name: ItemType.TAGS,
    extractFunction: extractTags,
  },
  {
    name: ItemType.GROUPS,
    extractFunction: extractGroups,
  },
  {
    name: ItemType.TASKS,
    extractFunction: extractTasks,
  },
];

processTask<ExtractorState>({
  task: async ({ adapter }) => {
    adapter.initializeRepos(repos);
    const asanaClient = new AsanaClient(adapter.event);
    prepareStateForExtraction(adapter);

    for (const itemType of itemTypesToExtract) {
      if (adapter.isTimeout) return;

      if (!adapter.shouldExtract(itemType.name)) {
        console.log(`Skipping extraction of ${itemType.name} as it's not in the extraction scope.`);
        continue;
      }

      if (adapter.state[itemType.name].completed) {
        console.log(`Skipping extraction of ${itemType.name} as it's already marked as complete.`);
        continue;
      }

      try {
        console.log(
          `${adapter.state[itemType.name].total > 0 ? 'Continuing' : 'Starting'} extraction of ${itemType.name}.`
        );
        await itemType.extractFunction(asanaClient, adapter);
        if (adapter.isTimeout) return;

        adapter.state[itemType.name].completed = true;
        console.log(`Finished extracting ${adapter.state[itemType.name].total} ${itemType.name}. Marked as complete.`);

        if (itemType.name === ItemType.GROUPS) {
          adapter.state.group_memberships.completed = true;
          console.log(`Extracted ${adapter.state.group_memberships.total} group memberships.`);
        }

        if (itemType.name === ItemType.TASKS) {
          adapter.state.attachments.completed = true;
          adapter.state.comments.completed = true;
          adapter.state.subtasks.completed = true;
          adapter.state.links.completed = true;

          console.log(
            `Extracted ${adapter.state.attachments.total} attachments, ${adapter.state.comments.total} comments, ${adapter.state.subtasks.total} subtasks, and ${adapter.state.links.total} links.`
          );

          if (adapter.shouldExtract(ItemType.ACCESS_RULES)) {
            await extractPermissions(asanaClient, adapter);
          } else {
            console.log('Skipping permissions extraction as access_rules is not in the extraction scope.');
          }
        }
      } catch (error) {
        const { delay, error: extractionError } = handleExtractionError(error);

        if (delay) {
          console.warn(`Rate limited during ${itemType.name} extraction. Delaying for ${delay}s.`);
          await adapter.emit(ExtractorEventType.DataExtractionDelayed, { delay });
        } else {
          console.error(`Error during ${itemType.name} extraction: ${extractionError?.message}`);
          await adapter.emit(ExtractorEventType.DataExtractionError, { error: extractionError });
        }

        return;
      }
    }

    console.log(
      `Finished extracting ${itemTypesToExtract
        .map((item) => `${item.name}: ${adapter.state[item.name].total}`)
        .join(', ')}.`
    );
    await adapter.emit(ExtractorEventType.DataExtractionDone);
  },
  onTimeout: async ({ adapter }) => {
    await adapter.emit(ExtractorEventType.DataExtractionProgress);
  },
});
