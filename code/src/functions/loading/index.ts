import { AirdropEvent, EventType, spawn } from '@devrev/ts-adaas';

import { LoaderState } from '../external-system/types';

function getWorkerPerLoadingPhase(event: AirdropEvent) {
  let path;
  switch (event.payload.event_type) {
    case EventType.StartLoadingData:
    case EventType.ContinueLoadingData:
      path = __dirname + '/workers/load-data';
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
    });
  }
};

export default run;
