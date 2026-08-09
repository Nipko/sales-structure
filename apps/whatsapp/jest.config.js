module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testRegex: ".*\\.spec\\.ts$",
  moduleFileExtensions: ["ts", "js", "json"],
  // Keep direct Jest runs working on a fresh checkout; runtime services load
  // the compiled @parallext/shared entry after Turbo builds it.
  moduleNameMapper: {
    "^@parallext/shared$": "<rootDir>/../../packages/shared/src/index.ts",
  },
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
};
