const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const evidenceFile = path.join(repoRoot, 'docs', 'vertical-competitive-evidence.json');
const matrixFile = path.join(repoRoot, 'docs', 'vertical-competitive-matrix-2026-08.md');
const evidence = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
const matrix = fs.readFileSync(matrixFile, 'utf8');
const expected = [
  'salud', 'moda_belleza', 'inmobiliaria', 'restaurantes', 'automotriz', 'turismo',
  'education', 'finanzas', 'servicios_profesionales', 'retail', 'technology',
  'veterinaria', 'gimnasios', 'seguros', 'servicios_hogar', 'pet_services',
  'fotografia', 'otro',
];
const today = process.env.COMPETITIVE_EVIDENCE_VALIDATION_DATE
  || new Date().toISOString().slice(0, 10);
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

assert(evidence.version === 1, 'Benchmark evidence registry must be version 1');
assert(evidence.reviewCadence === 'quarterly_and_before_claim', 'Benchmark cadence must be quarterly and before claims');
assert(evidence.owner === 'product-marketing', 'Benchmark owner is required');
assert(/^\d{4}-\d{2}-\d{2}$/.test(evidence.verifiedAt || ''), 'verifiedAt is invalid');
assert(/^\d{4}-\d{2}-\d{2}$/.test(evidence.expiresAt || ''), 'expiresAt is invalid');
assert(evidence.expiresAt >= today, `Benchmark evidence expired on ${evidence.expiresAt}`);
assert(Array.isArray(evidence.entries) && evidence.entries.length === 18, 'Exactly 18 benchmark entries are required');
assert(new Set(evidence.entries.map((entry) => entry.industry)).size === 18, 'Benchmark industries must be unique');
assert(JSON.stringify(evidence.entries.map((entry) => entry.industry)) === JSON.stringify(expected), 'Benchmark industries/order must match the canonical catalog');

for (const entry of evidence.entries || []) {
  assert(/^https:\/\//.test(entry.canonicalUrl || ''), `${entry.industry}: canonical HTTPS URL is required`);
  assert(typeof entry.vendor === 'string' && entry.vendor.length > 0, `${entry.industry}: vendor is required`);
  assert(typeof entry.tier === 'string' && entry.tier.length > 0, `${entry.industry}: tier is required`);
  assert(typeof entry.region === 'string' && entry.region.length > 0, `${entry.industry}: region is required`);
  assert(typeof entry.maturity === 'string' && entry.maturity.length > 0, `${entry.industry}: maturity is required`);
  assert(typeof entry.capabilitySignal === 'string' && entry.capabilitySignal.length >= 10, `${entry.industry}: capability signal is required`);
  assert(typeof entry.internalAcceptanceTest === 'string' && entry.internalAcceptanceTest.length >= 20, `${entry.industry}: internal acceptance test is required`);
  assert(matrix.includes(entry.canonicalUrl), `${entry.industry}: canonical URL must be present in the competitive matrix`);
}

if (failures.length) {
  console.error(`Competitive evidence contract failed (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Competitive evidence contract passed for 18 verticals.');
