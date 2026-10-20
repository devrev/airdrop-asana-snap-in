import { ExternalDomainMetadata, processExtractionTask, TaskResult } from '@devrev/airsync-sdk';

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

function getEnrichmentFailure(
  step: string,
  result: ExtractListResponse | void
): TaskResult | null {
  if (result?.delay !== undefined) {
    console.warn(`Rate limited while extracting metadata ${step}. Delaying for ${result.delay}s.`);
    return { status: 'delay', delaySeconds: result.delay };
  }

  if (result?.error) {
    console.error(result.error.message);
    return { status: 'error', error: result.error };
  }

  return null;
}

processExtractionTask<ExtractorState>({
  task: async ({ adapter }) => {
    adapter.initializeRepos([{ itemType: ItemType.EXTERNAL_DOMAIN_METADATA }]);

    const asanaClient = new AsanaClient(adapter.event);
    const metadata: ExternalDomainMetadata = structuredClone(baseExternalDomainMetadata) as ExternalDomainMetadata;

    const customFieldsResult = await enrichMetadataWithCustomFields(metadata, asanaClient);
    const customFieldsFailure = getEnrichmentFailure('custom fields', customFieldsResult);
    if (customFieldsFailure) return customFieldsFailure;

    const sectionsResult = await enrichMetadataWithSections(metadata, asanaClient);
    const sectionsFailure = getEnrichmentFailure('sections', sectionsResult);
    if (sectionsFailure) return sectionsFailure;

    enrichMetadataWithSubtaskStages(metadata);

    await adapter.getRepo(ItemType.EXTERNAL_DOMAIN_METADATA)?.push([metadata]);
    return { status: 'success' };
  },
});
