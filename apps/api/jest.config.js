module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testRegex: ".*\\.spec\\.ts$",
  moduleFileExtensions: ["ts", "js", "json"],
  // The package runtime entry is compiled JavaScript. Unit tests run before
  // Turbo builds in CI, so ts-jest must deliberately load the TypeScript
  // source while the production boot path continues to use dist/index.js.
  moduleNameMapper: {
    "^@parallext/shared$": "<rootDir>/../../packages/shared/src/index.ts",
  },
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  // One PostgreSQL database per worker, made fresh each run. Sharing one
  // database was what made two suites able to interfere with each other; there
  // is no concurrency inside a worker, so splitting by worker removes it.
  globalSetup: "<rootDir>/jest.global-setup.js",
  setupFiles: ["<rootDir>/jest.setup-worker-database.js"],
  collectCoverageFrom: ["src/**/*.ts", "!src/main.ts"],
};
