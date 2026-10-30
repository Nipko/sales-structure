// Pure package: no database, no global setup. Run with --runInBand.
module.exports = {
    rootDir: __dirname,
    testEnvironment: 'node',
    roots: ['<rootDir>/test'],
    testRegex: '.*\.spec\.ts$',
    moduleFileExtensions: ['ts', 'js', 'json'],
    transform: { '^.+\.ts$': ['ts-jest', { isolatedModules: true, diagnostics: false }] },
};
