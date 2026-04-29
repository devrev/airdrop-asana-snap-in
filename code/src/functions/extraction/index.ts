import { AirdropEvent, spawn } from '@devrev/ts-adaas';

import initialDomainMapping from '@asana/initial_domain_mapping.json';

// This interface defines the adapter state used for data extraction, ensuring that the
// process can be resumed and managed effectively between snap-in invocations.
// The 'offset' field is utilized for handling pagination. It helps in keeping track of
// the current position in the data set so if a sync run is interrupted, we can continue
// where we left off.
// The 'completed' field is a boolean flag that indicates whether the data extraction
// process for a particular record type (users, tasks, or attachments) is finished.
export interface ExtractorState {
  users: {
    completed: boolean;
    offset: string;
    total: number;
  };
  tasks: {
    completed: boolean;
    offset: string;
    total: number;
    lastExtractedTaskIndex: number;
  };
  attachments: {
    completed: boolean;
    total: number;
  };
  comments: {
    completed: boolean;
    total: number;
  };
  tags: {
    completed: boolean;
    offset: string;
    total: number;
  };
  subtasks: {
    completed: boolean;
    total: number;
  };
  links: {
    completed: boolean;
    total: number;
  };
  groups: {
    completed: boolean;
    offset: string;
    total: number;
  };
  group_memberships: {
    completed: boolean;
    total: number;
  };
  access_rules: {
    completed: boolean;
    total: number;
  };
}

export const initialState: ExtractorState = {
  users: { completed: false, offset: '', total: 0 },
  tasks: { completed: false, offset: '', total: 0, lastExtractedTaskIndex: -1 },
  attachments: { completed: false, total: 0 },
  comments: { completed: false, total: 0 },
  tags: { completed: false, offset: '', total: 0 },
  subtasks: { completed: false, total: 0 },
  links: { completed: false, total: 0 },
  groups: { completed: false, offset: '', total: 0 },
  group_memberships: { completed: false, total: 0 },
  access_rules: { completed: false, total: 0 },
};

const run = async (events: AirdropEvent[]): Promise<void> => {
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
