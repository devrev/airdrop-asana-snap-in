import { AirdropEvent, spawn } from '@devrev/ts-adaas';

import initialDomainMapping from '@asana/initial_domain_mapping.json';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface LoaderState {}

export const initialLoaderState: LoaderState = {};

const run = async (events: AirdropEvent[]): Promise<void> => {
  for (const event of events) {
    await spawn<LoaderState>({
      event,
      initialState: initialLoaderState,
      initialDomainMapping,
      baseWorkerPath: __dirname,
    });
  }
};

export default run;
