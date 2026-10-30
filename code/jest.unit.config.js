const base = require('./jest.config');

// Direct connector-function tests only. Other suites replace dependencies or execute workers.
module.exports = {
  ...base,
  testMatch: [
    '<rootDir>/src/utils/attachment-helpers.test.ts',
    '<rootDir>/src/utils/field-extraction-helpers.test.ts',
    '<rootDir>/src/utils/rich-text-helpers.test.ts',
    '<rootDir>/src/utils/serialize-error.test.ts',
    '<rootDir>/src/utils/control-scenarios.test.ts',
    '<rootDir>/src/utils/metadata-permission-scenarios.test.ts',
    '<rootDir>/src/asana/normalization-scenarios.test.ts',
    '<rootDir>/src/asana/reverse-sync-scenarios.test.ts',
  ],
  // These existing cases supply replacement mapper callbacks; exclude the whole group.
  testNamePattern: '^(?!.*resolveExternalId callback)',
  coverageDirectory: 'coverage/unit',
  // Keep whole-connector coverage visible; the default 80% gate includes I/O and SDK orchestration.
  coverageThreshold: {},
};
