import { AirdropEvent, spawn } from '@devrev/ts-adaas';

import initialDomainMapping from '../asana/initial_domain_mapping.json';

export type LoaderState = {};

const run = async (events: AirdropEvent[]) => {
  for (const event of events) {
    await spawn<LoaderState>({
      event,
      initialState: {},
      baseWorkerPath: __dirname,
      initialDomainMapping,
    });
  }
};

export default run;
