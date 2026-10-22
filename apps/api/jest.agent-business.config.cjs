// These suites own random schemas and refuse non-loopback disposable databases.
// They do not need the shared global fixture database or worker cloning.
const base = require('./jest.config.js');
// Full type checking is a separate mandatory CI step. Transpile each test here
// without building another whole-repository TypeScript program for every suite.
module.exports = { ...base, rootDir: __dirname, globalSetup: undefined, setupFiles: [],
  transform: { '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true, diagnostics: false }] } };
