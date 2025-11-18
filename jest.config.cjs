/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  roots: ['<rootDir>'],
  testMatch: ['**/__tests__/**/*.test.(ts|tsx)'],
  verbose: true,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1'
  },
  setupFilesAfterEnv: [],
};
