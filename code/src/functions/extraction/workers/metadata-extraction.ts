import { ExternalDomainMetadata, ExtractorEventType, processTask, WorkerAdapter } from '@devrev/ts-adaas';

import { AsanaClient } from '@asana/api-client';
import { ItemType } from '@asana/constants';
import baseExternalDomainMetadata from '@asana/external_domain_metadata.json';
import type { ExtractListResponse } from '@utils/data-helpers';
import {
  enrichMetadataWithCustomFields,
  enrichMetadataWithSections,
  enrichMetadataWithSubtaskStages,
} from '@utils/metadata-helpers';

import type { ExtractorState } from '../index';

/** Emit a delay or error for a failed enrichment step. Returns true if an event was emitted. */
async function emitEnrichmentFailure(
  adapter: WorkerAdapter<ExtractorState>,
  step: string,
  result: ExtractListResponse | void
): Promise<boolean> {
  if (result?.delay) {
    console.warn(`Rate limited while extracting metadata ${step}. Delaying for ${result.delay}s.`);
    await adapter.emit(ExtractorEventType.MetadataExtractionDelayed, { delay: result.delay });
    return true;
  }

  if (result?.error) {
    console.error(result.error.message);
    await adapter.emit(ExtractorEventType.MetadataExtractionError, { error: result.error });
    return true;
  }

  return false;
}

processTask<ExtractorState>({
  task: async ({ adapter }) => {
    adapter.initializeRepos([{ itemType: ItemType.EXTERNAL_DOMAIN_METADATA }]);

    const asanaClient = new AsanaClient(adapter.event);
    const metadata: ExternalDomainMetadata = structuredClone(baseExternalDomainMetadata) as ExternalDomainMetadata;

    const customFieldsResult = await enrichMetadataWithCustomFields(metadata, asanaClient);
    if (await emitEnrichmentFailure(adapter, 'custom fields', customFieldsResult)) {
      return;
    }

    const sectionsResult = await enrichMetadataWithSections(metadata, asanaClient);
    if (await emitEnrichmentFailure(adapter, 'sections', sectionsResult)) {
      return;
    }

    enrichMetadataWithSubtaskStages(metadata);

    await adapter.getRepo(ItemType.EXTERNAL_DOMAIN_METADATA)?.push([metadata]);
    await adapter.emit(ExtractorEventType.MetadataExtractionDone);
  },
  onTimeout: async ({ adapter }) => {
    // The phase keeps no state, so CONTINUE_EXTRACTING_METADATA just rebuilds the metadata from scratch.
    await adapter.emit(ExtractorEventType.MetadataExtractionProgress);
  },
});
