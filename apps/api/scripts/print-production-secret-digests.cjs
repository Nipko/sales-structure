#!/usr/bin/env node
/*
 * Turns the production secrets into something the staging workflow may hold.
 *
 *   STAGING_ISOLATION_DIGEST_SALT=<a long random string> \
 *   DATABASE_PASSWORD=... PROD_JWT_SECRET=... [...] \
 *   node scripts/print-production-secret-digests.cjs
 *
 * Run this ONCE, by the owner, on a machine where the production values already
 * are — never in CI. It prints salted SHA-256 digests, one per line, and nothing
 * else. Paste the block into the `PRODUCTION_SECRET_DIGESTS` secret and the salt
 * into `STAGING_ISOLATION_DIGEST_SALT`.
 *
 * WHY DIGESTS AND NOT THE VALUES. The staging guard has to answer "is this
 * staging secret the same as the production one", and the obvious way to answer
 * it — give the staging workflow both — would make the staging workflow able to
 * read every production credential. That is precisely the coupling the guard
 * exists to prevent, so the comparison happens over one-way digests and neither
 * environment ever holds the other's values.
 *
 * The salt matters: without one, a digest is a rainbow-table lookup away from
 * the value, and several of these are short. Rotate the salt whenever you rotate
 * a production secret, and regenerate the block.
 */
const { createHash } = require('node:crypto');

/**
 * The production variables worth comparing. Every one of them, shared with
 * staging, would let a staging session, key or connection act in production.
 */
const PRODUCTION_SECRETS = [
    'DATABASE_URL', 'DATABASE_PASSWORD', 'REDIS_PASSWORD',
    'PROD_JWT_SECRET', 'JWT_REFRESH_SECRET', 'INTERNAL_JWT_SECRET', 'INTERNAL_API_KEY',
    'ENCRYPTION_KEY', 'TENANT_SECRET_KEY', 'TENANT_PAYMENT_CREDENTIAL_KEY',
    'CLOUDFLARE_TUNNEL_TOKEN', 'SERVER_SSH_KEY',
    'META_APP_SECRET', 'META_VERIFY_TOKEN', 'INSTAGRAM_APP_SECRET',
    'WOMPI_PRIVATE_KEY', 'WOMPI_EVENTS_SECRET', 'WOMPI_INTEGRITY_SECRET',
    'SMTP_PASS', 'SENTRY_AUTH_TOKEN', 'OWNER_COUPON_PIN',
];

const salt = String(process.env.STAGING_ISOLATION_DIGEST_SALT || '').trim();
if (salt.length < 24) {
    console.error('::error::Set STAGING_ISOLATION_DIGEST_SALT to a random string of at least 24 characters first.');
    console.error('  e.g.  export STAGING_ISOLATION_DIGEST_SALT="$(openssl rand -hex 24)"');
    process.exit(2);
}

const digests = [];
const missing = [];
for (const name of PRODUCTION_SECRETS) {
    const value = String(process.env[name] || '').trim();
    if (!value) { missing.push(name); continue; }
    digests.push(createHash('sha256').update(`${salt} ${value}`).digest('hex'));
}

if (!digests.length) {
    console.error('::error::No production secrets were present in the environment; there is nothing to compare against.');
    process.exit(2);
}

// Names of what was MISSING go to stderr — useful, and not a value. Nothing
// that could reconstruct a secret is printed anywhere.
if (missing.length) {
    console.error(`# not present in this shell, so not covered by the guard: ${missing.join(', ')}`);
}
console.error(`# ${digests.length} digest(s). Paste the lines below into PRODUCTION_SECRET_DIGESTS.`);
for (const digest of digests) console.log(digest);
