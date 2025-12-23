import { AirdropEvent, spawn } from '@devrev/ts-adaas';

import initialDomainMapping from '../asana/initial_domain_mapping.json';

// This interface defines the adapter state used for data extraction, ensuring that the
// process can be resumed and managed effectively between snap-in invocations.
// The 'offset' field is utilized for handling pagination. It helps in keeping track of
// the current position in the data set so if a sync run is interrupted, we can continue
// where we left off.
// The 'completed' field is a boolean flag that indicates whether the data extraction
// process for a particular record type (users, tasks, or attachments) is finished.
// The 'modifiedSince' field is used to store the date and time of the last modification
// for tasks. This field is useful for performing incremental syncs, where
// only records that have been changed after this date are retrieved.
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

const run = async (events: AirdropEvent[]) => {
  for (const event of events) {
    await spawn<ExtractorState>({
      event,
      initialState,
      initialDomainMapping,
      baseWorkerPath: __dirname,
    });
  }
};

export default run;
