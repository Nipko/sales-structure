// An isolated parser + disposable PostgreSQL gate, with no production/global schema setup.
module.exports = {
    preset: 'ts-jest',
    rootDir: __dirname,
    testEnvironment: 'node',
    roots: ['<rootDir>/src/modules/knowledge', '<rootDir>/src/modules/crm/services/custom-attributes'],
    testRegex: '(knowledge-file-(parsing|type.postgres)|knowledge-public-legacy.postgres|custom-attribute-definitions.postgres)\\.spec\\.ts$',
    moduleNameMapper: { '^@parallext/shared$': '<rootDir>/../../packages/shared/src/index.ts' },
};
