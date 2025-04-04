import { ExtractorEventType, processTask } from '@devrev/ts-adaas';

// Importing external domain metadata from a JSON file.
import externalDomainMetadata from '../../asana/external_domain_metadata.json';

// Define the repo setup for 'external_domain_metadata'.
const repos = [
  {
    itemType: 'external_domain_metadata',
  },
];

processTask({
  task: async ({ adapter }) => {
    // Initialize repo using the adapter.
    adapter.initializeRepos(repos);

    // Push the externally loaded domain metadata into its corresponding repository.
    await adapter.getRepo('external_domain_metadata')?.push([externalDomainMetadata]);

    // Emit an event indicating that the extraction process for metadata is complete.
    await adapter.emit(ExtractorEventType.ExtractionMetadataDone);
  },
  onTimeout: async ({ adapter }) => {
    // Handle the scenario where the task does not complete in the expected timeframe.
    // Emit an error event to signal that metadata extraction failed due to a timeout.
    await adapter.emit(ExtractorEventType.ExtractionMetadataError, {
      error: { message: 'Failed to extract metadata. Lambda timeout.' },
    });
  },
});
