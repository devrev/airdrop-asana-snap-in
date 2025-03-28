import { LoaderEventType, processTask } from '@devrev/ts-adaas';

import { HttpClient } from '../../external-system/http-client';

processTask({
  task: async ({ adapter }) => {
    const httpClient = new HttpClient(adapter.event);

    const { reports, processed_files } = await adapter.loadItemTypes({
      itemTypesToLoad: [
        {
          itemType: 'issues',
          create: httpClient.createIssue,
          update: httpClient.updateIssue,
        },
      ],
    });

    await adapter.emit(LoaderEventType.DataLoadingDone, {
      reports,
      processed_files,
    });
  },
  onTimeout: async ({ adapter }) => {
    await adapter.emit(LoaderEventType.DataLoadingProgress, {
      reports: adapter.reports,
      processed_files: adapter.processedFiles,
    });
  },
});
