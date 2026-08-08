const path = require('path');

require('ts-node').register({
    project: path.resolve(__dirname, '../tsconfig.json'),
    transpileOnly: true,
});

require('./run-vertical-contract-matrix.ts');
