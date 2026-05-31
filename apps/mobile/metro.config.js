// Metro config for the Parallly mobile app living inside the monorepo.
// Lets Metro resolve `@parallext/shared` (linked via file:) from packages/shared,
// even though apps/mobile is NOT part of the root npm workspace.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch the whole monorepo so changes in packages/shared are picked up.
config.watchFolders = [monorepoRoot];

// 2. Resolve modules from the app first, then the monorepo root.
config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(monorepoRoot, 'node_modules'),
];

// 3. Avoid hoisting surprises with duplicate React copies.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
