import {
  ExternalSystemAttachmentStreamingParams,
  ExternalSystemAttachmentStreamingResponse,
  ExtractorEventType,
  processTask,
} from '@devrev/ts-adaas';
import axios from 'axios';

import { AsanaClient } from '@asana/api-client';
import { handleExtractionError } from '@utils/data-helpers';

import type { ExtractorState } from '../index';

// Asana download URLs expire within minutes, and the stored ones may be days old, so each is refreshed right before use.
// Kept low because every download needs its own DNS lookup and socket; 50 exhausted the Lambda (EMFILE, getaddrinfo EBUSY).
const ATTACHMENT_BATCH_SIZE = 10;

let asanaClient: AsanaClient | undefined;

async function stream({
  item,
  event,
}: ExternalSystemAttachmentStreamingParams): Promise<ExternalSystemAttachmentStreamingResponse> {
  asanaClient ??= new AsanaClient(event);

  try {
    const response = await asanaClient.getAttachment(item.id);
    const url = response.data?.data?.download_url;
    if (!url) {
      return { error: { message: `Asana returned no download_url for attachment ${item.id}.` } };
    }

    const httpStream = await axios.get(url, {
      responseType: 'stream',
      headers: {
        'Accept-Encoding': 'identity',
      },
    });

    return { httpStream };
  } catch (error) {
    const { delay, error: extractionError } = handleExtractionError(error);
    if (delay) {
      console.warn(`Rate limited while streaming attachment ${item.id}. Delaying for ${delay}s.`);
      return { delay };
    } else {
      console.warn(`Failed to stream attachment ${item.id}: ${extractionError?.message}`);
      return { error: extractionError };
    }
  }
}

processTask<ExtractorState>({
  task: async ({ adapter }) => {
    const response = await adapter.streamAttachments({
      stream,
      batchSize: ATTACHMENT_BATCH_SIZE,
    });

    if (response?.delay) {
      await adapter.emit(ExtractorEventType.AttachmentExtractionDelayed, {
        delay: response.delay,
      });
    } else if (response?.error) {
      await adapter.emit(ExtractorEventType.AttachmentExtractionError, {
        error: response.error,
      });
    } else {
      console.log('Attachment streaming completed.');
      await adapter.emit(ExtractorEventType.AttachmentExtractionDone);
    }
  },
  onTimeout: async ({ adapter }) => {
    await adapter.emit(ExtractorEventType.AttachmentExtractionProgress);
  },
});
