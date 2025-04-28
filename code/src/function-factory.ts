import extraction from './functions/extraction';
import loading from './functions/loading';

export const functionFactory = {
  extraction,
  loading,
} as const;

export type FunctionFactoryType = keyof typeof functionFactory;
