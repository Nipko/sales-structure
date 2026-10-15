// An isolated parser + disposable PostgreSQL gate, with no production/global schema setup.
module.exports = {
    preset: 'ts-jest',
    rootDir: __dirname,
    testEnvironment: 'node',
    roots: ['<rootDir>/src/modules/knowledge'],
    testRegex: '(knowledge-file-(parsing|type.postgres)|knowledge-public-legacy.postgres)\\.spec\\.ts$',
    moduleNameMapper: { '^@parallext/shared$': '<rootDir>/../../packages/shared/src/index.ts' },
};
