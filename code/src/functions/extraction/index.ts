import { AirdropEvent, EventType, spawn } from '@devrev/ts-adaas';

export interface ExtractorState {
  users: {
    completed: boolean;
    offset: string;
  };
  tasks: {
    completed: boolean;
    offset: string;
    modifiedSince?: string;
  };
  attachments: {
    completed: boolean;
  };
}

export const initialState: ExtractorState = {
  users: { completed: false, offset: '' },
  tasks: { completed: false, offset: '' },
  attachments: { completed: false },
};

function getWorkerPerExtractionPhase(event: AirdropEvent) {
  let path;
  switch (event.payload.event_type) {
    case EventType.ExtractionExternalSyncUnitsStart:
      path = __dirname + '/workers/external-sync-units-extraction';
      break;
    case EventType.ExtractionMetadataStart:
      path = __dirname + '/workers/metadata-extraction';
      break;
    case EventType.ExtractionDataStart:
    case EventType.ExtractionDataContinue:
      path = __dirname + '/workers/data-extraction';
      break;
    case EventType.ExtractionAttachmentsStart:
    case EventType.ExtractionAttachmentsContinue:
      path = __dirname + '/workers/attachments-extraction';
      break;
  }
  return path;
}

const run = async (events: AirdropEvent[]) => {
  for (const event of events) {
    const file = getWorkerPerExtractionPhase(event);
    await spawn<ExtractorState>({
      event,
      initialState,
      workerPath: file,
    });
  }
};

export default run;
