import extraction from './functions/extraction';
import install_initial_domain_mapping from './functions/install_initial_domain_mapping';
import loading from './functions/loading';

export const functionFactory = {
  extraction,
  install_initial_domain_mapping,
  loading,
} as const;

export type FunctionFactoryType = keyof typeof functionFactory;
