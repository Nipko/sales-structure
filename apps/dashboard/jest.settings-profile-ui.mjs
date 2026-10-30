// Profile first-input label and supervisor role presentation:8 context-only UI contracts.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const dashboardRoot = path.dirname(fileURLToPath(import.meta.url));
const ownRequire = createRequire(path.join(dashboardRoot, 'package.json'));
const environmentRequire = createRequire(ownRequire.resolve('jest-environment-jsdom'));
export default {
    rootDir: dashboardRoot, testEnvironment: 'node', roots: ['<rootDir>/src'],
    testMatch: ['<rootDir>/src/app/admin/settings/profile/profile-first-input-label.ui.spec.tsx','<rootDir>/src/app/admin/settings/profile/profile-supervisor-role.ui.spec.tsx'],
    moduleFileExtensions: ['ts', 'tsx', 'js', 'mjs', 'json', 'node'],
    moduleNameMapper: {
        '^@parallext/shared$': '<rootDir>/../../packages/shared/src/index.ts',
        '^@parallext/business-spec$': '<rootDir>/../../packages/business-spec/src/index.ts',
        '^@parallext/business-spec/load$': '<rootDir>/../../packages/business-spec/src/load.ts',
        '^@/(.*)$': '<rootDir>/src/$1',
        '^jsdom$': environmentRequire.resolve('jsdom'),
        '^react$': ownRequire.resolve('react'),
        '^react/jsx-runtime$': ownRequire.resolve('react/jsx-runtime'),
        '^react/jsx-dev-runtime$': ownRequire.resolve('react/jsx-dev-runtime'),
        '^react-dom$': ownRequire.resolve('react-dom'),
        '^react-dom/client$': ownRequire.resolve('react-dom/client'),
        '^next-intl$': ownRequire.resolve('next-intl'),
        '^axe-core$': ownRequire.resolve('axe-core'),
    },
    transform: { '^.+\\.(t|m?j)sx?$': [ownRequire.resolve('ts-jest'), { tsconfig: {
        target: 'ES2022', module: 'commonjs', moduleResolution: 'node', jsx: 'react-jsx',
        esModuleInterop: true, allowSyntheticDefaultImports: true, allowJs: true,
        checkJs: false, skipLibCheck: true, strict: true,
    }, isolatedModules: true, diagnostics: false }] },
    transformIgnorePatterns: ['node_modules/(?!(next-intl|use-intl|intl-messageformat|@formatjs)/)'],
    testEnvironmentOptions: { customExportConditions: ['node', 'node-addons'] },
    setupFiles: [], setupFilesAfterEnv: [], testTimeout: 60000, maxWorkers: 1,
};
