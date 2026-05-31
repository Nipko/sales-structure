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
//    (Hierarchical lookup stays ENABLED — apps/mobile is a standalone install,
//    not a hoisted workspace, so nested node_modules must still resolve.)
config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(monorepoRoot, 'node_modules'),
];

module.exports = config;
