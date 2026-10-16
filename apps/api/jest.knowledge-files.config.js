// An isolated parser + disposable PostgreSQL gate, with no production/global schema setup.
module.exports = {
    preset: 'ts-jest',
    rootDir: __dirname,
    testEnvironment: 'node',
    roots: ['<rootDir>/src/modules/knowledge', '<rootDir>/src/modules/crm/services/custom-attributes', '<rootDir>/src/modules/crm/services/segments', '<rootDir>/src/modules/identity', '<rootDir>/src/modules/conversations'],
    testRegex: '(knowledge-file-(parsing|type.postgres)|knowledge-public-legacy.postgres|custom-attribute-definitions.postgres|segments-preview.postgres|identity-counts.postgres|prechat-admin.postgres)\\.spec\\.ts$',
    moduleNameMapper: { '^@parallext/shared$': '<rootDir>/../../packages/shared/src/index.ts' },
};
