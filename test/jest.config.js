const path = require('node:path');

const root = path.resolve(__dirname, '..');

/** @type {import('jest').Config} */
const common = {
  rootDir: root,
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/test/tsconfig.json' }],
  },
  clearMocks: true,
  restoreMocks: true,
};

/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      ...common,
      displayName: 'unit',
      testMatch: ['<rootDir>/test/unit/**/*.spec.ts'],
    },
    {
      ...common,
      displayName: 'e2e',
      testMatch: ['<rootDir>/test/e2e/**/*.e2e-spec.ts'],
      setupFiles: ['<rootDir>/test/support/env.setup.ts'],
      globalSetup: '<rootDir>/test/support/global-setup.ts',
      testTimeout: 30_000,
    },
  ],

  collectCoverageFrom: [
    path.join(root, 'src/**/*.ts'),
    '!' + path.join(root, 'src/main.ts'),
    '!' + path.join(root, 'src/database/**'),
  ],
  coverageDirectory: path.join(root, 'coverage'),
};
