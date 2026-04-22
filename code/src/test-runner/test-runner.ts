import { AirdropEvent } from '@devrev/ts-adaas';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { functionFactory, FunctionFactoryType } from '../function-factory';

export interface TestRunnerProps {
  functionName: FunctionFactoryType;
  fixturePath: string;
}
export function addCredentials(events: AirdropEvent[], env: dotenv.DotenvParseOutput): AirdropEvent[] {
  return events.map((event: AirdropEvent) => {
    return {
      ...event,
      context: {
        ...event.context,
        secrets: {
          ...event.context.secrets,
          service_account_token: env['DEVREV_PAT'],
        },
      },
    };
  });
}

export const testRunner = async ({ functionName, fixturePath }: TestRunnerProps) => {
  const env = dotenv.config();

  console.log('env:', env);

  if (!functionFactory[functionName]) {
    console.error(`${functionName} is not found in the functionFactory`);
    console.error('Add your function to the function-factory.ts file');
    throw new Error('Function is not found in the functionFactory');
  }

  const run = functionFactory[functionName];

  const fixturesDir = path.resolve(__dirname, '../fixtures');
  const resolvedFixturePath = path.resolve(fixturesDir, fixturePath);
  if (!resolvedFixturePath.startsWith(fixturesDir + path.sep)) {
    throw new Error('Invalid fixture path: path traversal detected');
  }
  const eventFixture = require(resolvedFixturePath);

  if (env.parsed) {
    await run(addCredentials(eventFixture, env.parsed));
  } else {
    await run(eventFixture);
  }
};
