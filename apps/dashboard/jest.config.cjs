const TS_JEST_TSCONFIG = {
  target: "ES2022",
  module: "commonjs",
  moduleResolution: "node",
  jsx: "react-jsx",
  esModuleInterop: true,
  skipLibCheck: true,
  strict: true,
};

const tsJest = ["ts-jest", { tsconfig: TS_JEST_TSCONFIG }];

/** Same compiler, plus the `.js` of the ESM-only packages the a11y project needs. */
const tsJestAllowingJs = ["ts-jest", {
  tsconfig: { ...TS_JEST_TSCONFIG, allowJs: true, checkJs: false },
}];

const shared = {
  roots: ["<rootDir>/src"],
  moduleFileExtensions: ["ts", "tsx", "js", "json"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    // Jest runs before the workspace dependency build in the contract job.
    "^@parallext/shared$": "<rootDir>/../../packages/shared/src/index.ts",
  },
  transform: { "^.+\\.tsx?$": tsJest },
};

/**
 * Two projects, because a DOM costs time every suite has to pay.
 *
 * The contract/unit specs are pure functions over JSON and source text; they
 * run in a few seconds under `node` and must keep doing so. The accessibility
 * specs need a document, React rendering and axe, so they are named
 * `*.a11y.spec.tsx` and are the only thing that pays for jsdom. The `node`
 * project's regex ends at `.spec.ts`, which cannot match `.spec.tsx`, so the
 * two sets stay disjoint without an ignore list to keep in sync.
 */
module.exports = {
  projects: [
    {
      ...shared,
      displayName: "node",
      preset: "ts-jest",
      testEnvironment: "node",
      testRegex: ".*\\.spec\\.ts$",
    },
    {
      ...shared,
      displayName: "a11y",
      testEnvironment: "jsdom",
      testRegex: ".*\\.a11y\\.spec\\.tsx$",
      setupFilesAfterEnv: ["<rootDir>/src/test/a11y-setup.tsx"],
      // `next-intl` and `use-intl` publish ESM only, and the specs use the real
      // provider with the real messages on purpose — a stubbed translator would
      // make every accessible name pass by construction. Compile just those two
      // out of `node_modules` rather than faking them.
      transform: { "^.+\\.(t|m?j)sx?$": tsJestAllowingJs },
      // `use-intl` pulls the ICU formatter chain, which is ESM the whole way down.
      transformIgnorePatterns: [
        "node_modules/(?!(next-intl|use-intl|intl-messageformat|@formatjs)/)",
      ],
    },
  ],
};
