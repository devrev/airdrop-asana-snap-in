import {
  ExternalSystemAttachmentStreamingParams,
  ExternalSystemAttachmentStreamingResponse,
  processExtractionTask,
} from '@devrev/airsync-sdk';
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
      return { status: 'error', error: { message: `Asana returned no download_url for attachment ${item.id}.` } };
    }

    const httpStream = await axios.get(url, {
      responseType: 'stream',
      headers: {
        'Accept-Encoding': 'identity',
      },
    });

    return { status: 'success', httpStream };
  } catch (error) {
    const { delay, error: extractionError } = handleExtractionError(error);
    if (delay !== undefined) {
      console.warn(`Rate limited while streaming attachment ${item.id}. Delaying for ${delay}s.`);
      return { status: 'delay', delaySeconds: delay };
    } else {
      console.warn(`Failed to stream attachment ${item.id}: ${extractionError?.message}`);
      return { status: 'error', error: extractionError ?? { message: 'Attachment streaming failed' } };
    }
  }
}

processExtractionTask<ExtractorState>({
  task: async ({ adapter }) => adapter.streamAttachments({
    stream,
    batchSize: ATTACHMENT_BATCH_SIZE,
  }),
});
