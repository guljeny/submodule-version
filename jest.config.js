/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  moduleDirectories: ['node_modules'],
  testEnvironment: "node",
  transform: {
    "^.+.tsx?$": ["ts-jest", {}],
  },
};
