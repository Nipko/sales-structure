#!/usr/bin/env node
'use strict';

/**
 * Reconcile active, fully-onboarded tenants with the current vertical
 * provisioning contract. Safe by default: without --apply this is a dry-run.
 *
 * Production examples (inside the API container):
 *   node scripts/reconcile-vertical-provisioning.js --dry-run
 *   node scripts/reconcile-vertical-provisioning.js --tenant=<uuid> --apply
 *   node scripts/reconcile-vertical-provisioning.js --limit=25 --apply
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUPPORTED_LANGUAGES = new Set(['es', 'en', 'pt', 'fr']);
const TENANT_SCAN_PAGE_SIZE = 500;

function valueArg(argv, name) {
    const inline = argv.find((arg) => arg.startsWith(`${name}=`));
    if (inline) return inline.slice(name.length + 1);
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
}

function parseArgs(argv) {
    const apply = argv.includes('--apply');
    const explicitDryRun = argv.includes('--dry-run');
    if (apply && explicitDryRun) throw new Error('Choose either --apply or --dry-run, not both');

    const tenantId = valueArg(argv, '--tenant');
    if (tenantId && !UUID_PATTERN.test(tenantId)) throw new Error('--tenant must be a valid UUID');

    const rawLimit = valueArg(argv, '--limit');
    const limit = rawLimit === undefined ? 1000 : Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) {
        throw new Error('--limit must be an integer from 1 to 10000');
    }

    return { apply, dryRun: !apply, tenantId: tenantId || null, limit };
}

function normalizedLanguage(value) {
    const language = String(value || 'es').split('-')[0].toLowerCase();
    return SUPPORTED_LANGUAGES.has(language) ? language : 'es';
}

function verticalIdentity(tenant) {
    const settings = tenant && typeof tenant.settings === 'object' && tenant.settings
        ? tenant.settings
        : {};
    const config = settings.verticalConfig && typeof settings.verticalConfig === 'object'
        ? settings.verticalConfig
        : {};
    return {
        industry: String(config.industry || tenant.industry || '').trim().toLowerCase(),
        subType: config.subType ?? settings.subType ?? null,
        language: normalizedLanguage(tenant.language),
    };
}

function needsReconciliation(tenant, targetVersion) {
    if (!tenant?.isActive || !tenant?.onboardingCompletedAt) return false;
    const settings = tenant.settings && typeof tenant.settings === 'object' ? tenant.settings : {};
    const state = settings.verticalProvisioning;
    if (!state || typeof state !== 'object') return true;
    return state.version !== targetVersion || state.status !== 'complete';
}

function selectCandidates(tenants, targetVersion, limit) {
    const allCandidates = tenants.filter((tenant) => needsReconciliation(tenant, targetVersion));
    return {
        candidates: allCandidates.slice(0, limit),
        deferred: Math.max(0, allCandidates.length - limit),
        skipped: tenants.length - allCandidates.length,
    };
}

async function run(argv = process.argv.slice(2), dependencies = {}) {
    const options = parseArgs(argv);
    // Runtime imports stay lazy so unit tests can exercise selection/CLI logic
    // without booting Nest, Redis, schedules or Prisma hooks. A dry-run uses a
    // plain Prisma client on purpose: Nest onModuleInit contains legitimate
    // repair jobs, so booting the whole app would violate the no-write promise.
    const verticalModule = dependencies.VerticalModule || require('../dist/modules/verticals/verticals.service');
    const targetVersion = verticalModule.VERTICAL_PROVISIONING_VERSION;
    let app = dependencies.app || null;
    let prisma = dependencies.prisma || null;
    let verticals = dependencies.verticals || null;
    let ownsPrisma = false;
    let resolveManifest = dependencies.resolveManifest || null;

    if (options.dryRun) {
        if (!prisma) {
            const { PrismaClient } = require('@prisma/client');
            prisma = new PrismaClient();
            ownsPrisma = true;
        }
        if (!resolveManifest) {
            resolveManifest = require('@parallext/shared').resolveVerticalCapabilityManifest;
        }
    } else if (!prisma || !verticals) {
        const { PrismaService } = require('../dist/modules/prisma/prisma.service');
        if (!app) {
            const { NestFactory } = require('@nestjs/core');
            const { AppModule } = require('../dist/app.module');
            app = await NestFactory.createApplicationContext(AppModule, {
                logger: ['error', 'warn', 'log'],
            });
        }
        prisma = prisma || app.get(PrismaService);
        verticals = verticals || app.get(verticalModule.VerticalsService);
    }
    if (!prisma) throw new Error('Prisma is unavailable');
    if (!options.dryRun && !verticals) throw new Error('VerticalsService is unavailable');

    const summary = {
        mode: options.dryRun ? 'dry-run' : 'apply',
        targetVersion,
        scanned: 0,
        candidates: 0,
        deferred: 0,
        reconciled: 0,
        needsReview: 0,
        skipped: 0,
    };

    try {
        console.log(JSON.stringify({ event: 'vertical_provisioning_reconcile_start', ...summary }));
        let cursorId = null;
        let pageNumber = 0;
        let dryRunReported = 0;
        let reachedEnd = false;

        while (!reachedEnd) {
            const tenants = await prisma.tenant.findMany({
                where: {
                    ...(options.tenantId ? { id: options.tenantId } : {}),
                    isActive: true,
                    onboardingCompletedAt: { not: null },
                },
                select: {
                    id: true,
                    industry: true,
                    language: true,
                    settings: true,
                    isActive: true,
                    onboardingCompletedAt: true,
                    createdAt: true,
                },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                take: options.tenantId ? 1 : TENANT_SCAN_PAGE_SIZE,
                ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
            });
            pageNumber++;
            summary.scanned += tenants.length;
            reachedEnd = options.tenantId
                || tenants.length < TENANT_SCAN_PAGE_SIZE;
            cursorId = tenants.at(-1)?.id || cursorId;

            for (const tenant of tenants) {
                if (!needsReconciliation(tenant, targetVersion)) {
                    summary.skipped++;
                    continue;
                }
                summary.candidates++;

                // In dry-run, --limit bounds the number of candidate records
                // printed, while the paginated scan still counts every stale
                // tenant so `deferred` can never falsely report zero.
                if (options.dryRun && dryRunReported >= options.limit) {
                    summary.deferred++;
                    continue;
                }
                // In apply mode the limit is a success budget, not an attempt
                // budget. A tenant that fails closed must not permanently starve
                // every later tenant on the next repeated bounded batch.
                if (!options.dryRun && summary.reconciled >= options.limit) {
                    summary.deferred++;
                    continue;
                }

                const identity = verticalIdentity(tenant);
                const descriptor = {
                    tenantId: tenant.id,
                    industry: identity.industry,
                    subType: identity.subType,
                    targetVersion,
                };
                try {
                    if (!identity.industry) throw new Error('missing_vertical_industry');
                    // Validate the identity before either reporting it as actionable
                    // or acquiring mutation locks during --apply.
                    if (options.dryRun) resolveManifest(identity.industry, identity.subType);
                    else verticals.resolveCapabilityManifest(identity.industry, identity.subType);
                    if (options.dryRun) {
                        console.log(JSON.stringify({ event: 'vertical_provisioning_candidate', ...descriptor }));
                        dryRunReported++;
                        continue;
                    }

                    await verticals.bootstrapVertical(
                        tenant.id,
                        identity.industry,
                        identity.subType,
                        identity.language,
                    );
                    const refreshed = await prisma.tenant.findUnique({
                        where: { id: tenant.id },
                        select: { settings: true },
                    });
                    const state = refreshed?.settings?.verticalProvisioning;
                    if (state?.version !== targetVersion || state?.status !== 'complete') {
                        throw new Error('vertical_provisioning_did_not_reach_current_complete');
                    }
                    summary.reconciled++;
                    console.log(JSON.stringify({ event: 'vertical_provisioning_reconciled', ...descriptor }));
                } catch (error) {
                    summary.needsReview++;
                    console.error(JSON.stringify({
                        event: 'vertical_provisioning_needs_review',
                        ...descriptor,
                        error: error?.response?.error || error?.message || String(error),
                    }));
                }
            }

            console.log(JSON.stringify({
                event: 'vertical_provisioning_reconcile_page',
                page: pageNumber,
                cursor: cursorId,
                scanned: summary.scanned,
                candidates: summary.candidates,
                reconciled: summary.reconciled,
                needsReview: summary.needsReview,
                deferred: summary.deferred,
            }));
        }

        console.log(JSON.stringify({ event: 'vertical_provisioning_reconcile_complete', ...summary }));
        if (!options.dryRun && summary.needsReview > 0) process.exitCode = 2;
        return summary;
    } finally {
        if (app && !dependencies.app) await app.close();
        else if (ownsPrisma) await prisma.$disconnect();
    }
}

if (require.main === module) {
    run().catch((error) => {
        console.error(JSON.stringify({
            event: 'vertical_provisioning_reconcile_fatal',
            error: error?.message || String(error),
        }));
        process.exitCode = 1;
    });
}

module.exports = {
    needsReconciliation,
    normalizedLanguage,
    parseArgs,
    run,
    selectCandidates,
    TENANT_SCAN_PAGE_SIZE,
    verticalIdentity,
};
