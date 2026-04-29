import {
  ExternalSystemAttachmentStreamingParams,
  ExternalSystemAttachmentStreamingResponse,
  ExtractorEventType,
  processTask,
} from '@devrev/ts-adaas';
import axios from 'axios';

import { handleExtractionError } from '@utils/data-helpers';

import type { ExtractorState } from '../index';

async function stream({
  item,
}: ExternalSystemAttachmentStreamingParams): Promise<ExternalSystemAttachmentStreamingResponse> {
  const { url } = item;

  try {
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
      console.warn(`Rate limited while streaming attachment (url=${url}). Delaying for ${delay}s.`);
      return { delay };
    } else {
      console.error(`Failed to stream attachment (url=${url}): ${extractionError?.message}`);
      return { error: extractionError };
    }
  }
}

processTask<ExtractorState>({
  task: async ({ adapter }) => {
    const response = await adapter.streamAttachments({
      stream,
      batchSize: 50,
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
