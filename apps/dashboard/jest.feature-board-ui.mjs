// Feature changelog canonical month and native board response ordering:8 strict-memory contracts.
// CI uses existing full-workspace npm ci and its existing Prisma generation.
// No local E client path, no DB globalSetup, no receipt32 or generic suites.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardRequire = createRequire(path.join(__dirname, 'package.json'));
const apiRoot = path.resolve(__dirname, '../api');
const apiRequire = createRequire(path.join(apiRoot, 'package.json'));
const environmentRequire = createRequire(dashboardRequire.resolve('jest-environment-jsdom'));
export default {
    rootDir: apiRoot,
    testEnvironment: 'node',
    roots: ['<rootDir>/src', '<rootDir>/../dashboard/src'],
    testMatch: ['<rootDir>/src/modules/feature-requests/feature-changelog-month.ui.spec.tsx','<rootDir>/src/modules/feature-requests/feature-board-status-order.ui.spec.tsx'],
    moduleFileExtensions: ['ts','tsx','js','mjs','json','node'],
    moduleNameMapper: {
        '^@parallext/shared$': '<rootDir>/../../packages/shared/src/index.ts',
        '^@/(.*)$': '<rootDir>/../dashboard/src/$1',
        '^@prisma/client$': apiRequire.resolve('@prisma/client'),
        '^jsdom$': environmentRequire.resolve('jsdom'),
        '^react$': dashboardRequire.resolve('react'),
        '^react/jsx-runtime$': dashboardRequire.resolve('react/jsx-runtime'),
        '^react/jsx-dev-runtime$': dashboardRequire.resolve('react/jsx-dev-runtime'),
        '^react-dom$': dashboardRequire.resolve('react-dom'),
        '^react-dom/client$': dashboardRequire.resolve('react-dom/client'),
        '^next-intl$': dashboardRequire.resolve('next-intl'),
    },
    transform: {
        '^.+\\.(t|m?j)sx?$': [dashboardRequire.resolve('ts-jest'), { tsconfig: {
            target: 'ES2022', module: 'commonjs', moduleResolution: 'node', jsx: 'react-jsx',
            experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true,
            allowSyntheticDefaultImports: true, allowJs: true, checkJs: false, skipLibCheck: true, strict: true,
        }, isolatedModules: true, diagnostics: false }],
    },
    transformIgnorePatterns: ['node_modules/(?!(next-intl|use-intl|intl-messageformat|@formatjs)/)'],
    testEnvironmentOptions: { customExportConditions: ['node','node-addons'] },
    setupFiles: [], setupFilesAfterEnv: [], testTimeout: 60000, maxWorkers: 1,
};
