// PROPOSED ONLY. Copy as apps/api/jest.assist-content-receipt-ui.cjs after review.
// Kept separate from ordinary API .spec.ts selection and its PostgreSQL setup.
module.exports = {
    rootDir: __dirname,
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: [
        '<rootDir>/src/modules/copilot/assist-content-receipt.ui.spec.tsx',
        '<rootDir>/src/modules/copilot/assist-content-proposal-deadline.ui.spec.tsx',
    ],
    moduleFileExtensions: ['ts', 'tsx', 'js', 'mjs', 'json', 'node'],
    moduleNameMapper: { '^@parallext/shared$': '<rootDir>/../../packages/shared/src/index.ts' },
    transform: {
        '^.+\\.(t|m?j)sx?$': ['ts-jest', {
            tsconfig: {
                target: 'ES2022', module: 'commonjs', moduleResolution: 'node',
                jsx: 'react-jsx', experimentalDecorators: true, emitDecoratorMetadata: true,
                esModuleInterop: true, allowSyntheticDefaultImports: true,
                allowJs: true, checkJs: false, skipLibCheck: true, strict: true,
            },
            isolatedModules: true, diagnostics: false,
        }],
    },
    transformIgnorePatterns: ['node_modules/(?!(next-intl|use-intl|intl-messageformat|@formatjs)/)'],
    testEnvironmentOptions: { customExportConditions: ['node', 'node-addons'] },
    setupFiles: [], setupFilesAfterEnv: [], testTimeout: 20000, maxWorkers: 1,
};
