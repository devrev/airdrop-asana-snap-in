import { EventType, ExtractorEventType, processTask } from '@devrev/ts-adaas';

import { normalizeAttachment, normalizeIssue, normalizeUser } from '../../external-system/data-normalization';

// Dummy data that originally would be fetched from an external source
const issues = [
  {
    id: 'issue-1',
    created_date: '1999-12-25T01:00:03+01:00',
    modified_date: '1999-12-25T01:00:03+01:00',
    body: '<p>This is issue 1</p>',
    creator: 'user-1',
    owner: 'user-1',
    title: 'Issue 1',
  },
  {
    id: 'issue-2',
    created_date: '1999-12-27T15:31:34+01:00',
    modified_date: '2002-04-09T01:55:31+02:00',
    body: '<p>This is issue 2</p>',
    creator: 'user-2',
    owner: 'user-2',
    title: 'Issue 2',
  },
];

const users = [
  {
    id: 'user-1',
    created_date: '1999-12-25T01:00:03+01:00',
    modified_date: '1999-12-25T01:00:03+01:00',
    data: {
      email: 'johndoe@test.com',
      name: 'John Doe',
    },
  },
  {
    id: 'user-2',
    created_date: '1999-12-27T15:31:34+01:00',
    modified_date: '2002-04-09T01:55:31+02:00',
    data: {
      email: 'janedoe@test.com',
      name: 'Jane Doe',
    },
  },
];

const attachments = [
  {
    url: 'https://app.devrev.ai/favicon.ico',
    id: 'attachment-1',
    file_name: 'favicon1.ico',
    author_id: 'user-1',
    parent_id: 'issue-1',
  },
  {
    url: 'https://app.devrev.ai/favicon.ico',
    id: 'attachment-2',
    file_name: 'favicon2.ico',
    author_id: 'user-2',
    parent_id: 'issue-2',
  },
];

const repos = [
  {
    itemType: 'issues',
    normalize: normalizeIssue,
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

processTask({
  task: async ({ adapter }) => {
    adapter.initializeRepos(repos);
    if (adapter.event.payload.event_type === EventType.ExtractionDataStart) {
      await adapter.getRepo('issues')?.push(issues);
      await adapter.emit(ExtractorEventType.ExtractionDataProgress, {
        progress: 50,
      });
    } else {
      await adapter.getRepo('users')?.push(users);
      await adapter.getRepo('attachments')?.push(attachments);
      await adapter.emit(ExtractorEventType.ExtractionDataDone, {
        progress: 100,
      });
    }
  },
  onTimeout: async ({ adapter }) => {
    await adapter.emit(ExtractorEventType.ExtractionDataProgress, {
      progress: 50,
    });
  },
});
