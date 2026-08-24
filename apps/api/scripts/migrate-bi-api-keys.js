#!/usr/bin/env node
'use strict';

/**
 * Move legacy plaintext `tenant.settings.biApiKey` values into the hashed,
 * revocable `api_keys` store used by the Public API. The raw key is never
 * logged and is removed from JSONB in the same transaction as its hash write.
 *
 * Usage:
 *   node scripts/migrate-bi-api-keys.js --dry-run
 *   node scripts/migrate-bi-api-keys.js --apply
 *   node scripts/migrate-bi-api-keys.js --cutover
 */
const { PrismaClient } = require('@prisma/client');
const { createHash } = require('crypto');

const MODES = ['--dry-run', '--apply', '--cutover'];
const mode = MODES.find((entry) => process.argv.includes(entry));
const prisma = new PrismaClient();

function legacyBiKey(settings) {
    const value = settings && settings.biApiKey;
    return typeof value === 'string' && value.trim().length >= 16 ? value : null;
}

function hashKey(rawKey) {
    return createHash('sha256').update(rawKey).digest('hex');
}

function withAnalyticsScope(scopes) {
    return Array.from(new Set([...(Array.isArray(scopes) ? scopes : []), 'read:analytics']));
}

async function migrateTenant(client, tenant) {
    return client.$transaction(async (tx) => {
        const live = await tx.tenant.findUnique({
            where: { id: tenant.id },
            select: { settings: true },
        });
        const rawKey = legacyBiKey(live && live.settings);
        if (!rawKey) return 'already_migrated';

        const keyHash = hashKey(rawKey);
        const existing = await tx.apiKey.findUnique({ where: { keyHash } });
        if (existing && existing.tenantId !== tenant.id) {
            throw new Error('legacy_bi_key_collision');
        }
        if (existing) {
            await tx.apiKey.update({
                where: { id: existing.id },
                data: { scopes: withAnalyticsScope(existing.scopes), isActive: true },
            });
        } else {
            await tx.apiKey.create({
                data: {
                    tenantId: tenant.id,
                    keyPrefix: rawKey.slice(0, 12),
                    keyHash,
                    name: 'Legacy BI API (migrated)',
                    scopes: ['read:analytics'],
                    rateLimitRpm: 60,
                    createdBy: null,
                    isActive: true,
                },
            });
        }

        const affected = await tx.$executeRawUnsafe(
            `UPDATE public.tenants
                SET settings = COALESCE(settings, '{}'::jsonb) - 'biApiKey',
                    updated_at = NOW()
              WHERE id = $1::uuid
                AND settings ->> 'biApiKey' = $2`,
            tenant.id,
            rawKey,
        );
        if (Number(affected) !== 1) throw new Error('legacy_bi_key_cas_lost');
        return existing ? 'linked_existing' : 'created';
    });
}

async function scan(client = prisma) {
    const tenants = await client.tenant.findMany({ select: { id: true, name: true, settings: true } });
    return {
        total: tenants.length,
        pending: tenants.filter((tenant) => legacyBiKey(tenant.settings)),
    };
}

async function main() {
    if (!mode) {
        console.error(`Missing mode: ${MODES.join(' | ')}`);
        process.exitCode = 2;
        return;
    }
    const { total, pending } = await scan();
    console.log(`[migrate-bi-api-keys] ${mode}`);
    console.log(`Tenants scanned: ${total}. Legacy plaintext BI keys: ${pending.length}.`);
    for (const tenant of pending) console.log(`  ${tenant.id}  ${tenant.name}`);

    if (mode === '--dry-run') return;
    if (mode === '--cutover') {
        if (pending.length) {
            console.error('Cutover blocked: run --apply until the pending count is zero.');
            process.exitCode = 1;
        }
        return;
    }

    let migrated = 0;
    let failed = 0;
    for (const tenant of pending) {
        try {
            await migrateTenant(prisma, tenant);
            migrated += 1;
        } catch (error) {
            failed += 1;
            console.error(`  ! ${tenant.id}: ${error && error.message ? error.message : 'migration_failed'}`);
        }
    }
    console.log(`Migrated: ${migrated}. Failed: ${failed}.`);
    if (failed) process.exitCode = 1;
}

module.exports = { hashKey, legacyBiKey, migrateTenant, scan, withAnalyticsScope };

if (require.main === module) {
    main()
        .catch((error) => {
            console.error(error && error.message ? error.message : 'migration_failed');
            process.exitCode = 1;
        })
        .finally(() => prisma.$disconnect());
}
