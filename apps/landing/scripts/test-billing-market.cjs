const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/lib/billing-market.ts'), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const loaded = { exports: {} };
new Function('module', 'exports', output)(loaded, loaded.exports);
const { resolveBillingCountry, subscriptionProvider } = loaded.exports;
const supported = ['CO', 'US', 'FR', 'BR'];

assert.equal(resolveBillingCountry('fr', 'CO', 'US', supported), 'FR');
assert.equal(resolveBillingCountry(null, 'BR', 'CO', supported), 'BR');
assert.equal(resolveBillingCountry('ZZ', null, 'US', supported), 'US');
assert.equal(resolveBillingCountry(null, null, null, supported), null);
assert.equal(resolveBillingCountry(null, null, 'ZZ', supported), null);
assert.equal(subscriptionProvider('CO'), 'wompi');
assert.equal(subscriptionProvider('FR'), 'stripe');
assert.equal(subscriptionProvider(null), null);

const apiSource = fs.readFileSync(path.join(__dirname, '../src/lib/api.ts'), 'utf8');
const apiOutput = ts.transpileModule(apiSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const apiLoaded = { exports: {} };
new Function('module', 'exports', apiOutput)(apiLoaded, apiLoaded.exports);
const { formatMoney } = apiLoaded.exports;
assert.match(formatMoney(12_990_000, 'COP', 'es-CO'), /COP/);
assert.match(formatMoney(2_900, 'USD', 'es-CO'), /USD/);

console.log('Billing market: country resolution, payment provider and explicit COP/USD price labels passed.');
