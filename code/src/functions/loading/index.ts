import { AirdropEvent, EventType, spawn } from '@devrev/ts-adaas';

import initialDomainMapping from '../asana/initial_domain_mapping.json';

export type LoaderState = {};

function getWorkerPerLoadingPhase(event: AirdropEvent) {
  let path;
  switch (event.payload.event_type) {
    case EventType.StartLoadingData:
    case EventType.ContinueLoadingData:
      path = __dirname + '/workers/load-data';
      break;
    case EventType.StartLoadingAttachments:
    case EventType.ContinueLoadingAttachments:
      path = __dirname + '/workers/load-attachments';
      break;
  }
  return path;
}

const run = async (events: AirdropEvent[]) => {
  for (const event of events) {
    const file = getWorkerPerLoadingPhase(event);
    await spawn<LoaderState>({
      event,
      initialState: {},
      workerPath: file,
      initialDomainMapping
    });
  }
};

export default run;
