import { ExternalDomainMetadata, ExtractorEventType, processTask } from '@devrev/ts-adaas';

import { AsanaClient } from '@asana/api-client';
import { ItemType } from '@asana/constants';
import baseExternalDomainMetadata from '@asana/external_domain_metadata.json';
import {
  enrichMetadataWithCustomFields,
  enrichMetadataWithSections,
  enrichMetadataWithSubtaskStages,
} from '@utils/metadata-helpers';

import type { ExtractorState } from '../index';

processTask<ExtractorState>({
  task: async ({ adapter }) => {
    adapter.initializeRepos([{ itemType: ItemType.EXTERNAL_DOMAIN_METADATA }]);

    const asanaClient = new AsanaClient(adapter.event);
    const metadata: ExternalDomainMetadata = structuredClone(baseExternalDomainMetadata) as ExternalDomainMetadata;

    const customFieldsError = await enrichMetadataWithCustomFields(metadata, asanaClient);
    if (customFieldsError) {
      await adapter.emit(ExtractorEventType.MetadataExtractionError, {
        error: { message: customFieldsError },
      });
      return;
    }

    const sectionsError = await enrichMetadataWithSections(metadata, asanaClient);
    if (sectionsError) {
      await adapter.emit(ExtractorEventType.MetadataExtractionError, {
        error: { message: sectionsError },
      });
      return;
    }

    enrichMetadataWithSubtaskStages(metadata);

    await adapter.getRepo(ItemType.EXTERNAL_DOMAIN_METADATA)?.push([metadata]);
    await adapter.emit(ExtractorEventType.MetadataExtractionDone);
  },
  onTimeout: async ({ adapter }) => {
    await adapter.emit(ExtractorEventType.MetadataExtractionError, {
      error: {
        message: 'Failed to extract metadata from Asana due to timeout. Please check the logs for more details.',
      },
    });
  },
});
