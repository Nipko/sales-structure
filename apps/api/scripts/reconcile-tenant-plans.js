/**
 * One-time reconciliation script: syncs tenant.plan with the actual plan
 * from billing_subscriptions. Fixes the bug where upgradeSubscription()
 * updated billingSubscription.planId but forgot to update tenant.plan.
 *
 * Usage:
 *   docker exec parallext-api node scripts/reconcile-tenant-plans.js
 *   docker exec parallext-api node scripts/reconcile-tenant-plans.js --dry-run
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

async function main() {
    console.log(`[reconcile-tenant-plans] ${dryRun ? 'DRY RUN — no changes will be made' : 'LIVE RUN'}\n`);

    const mismatches = await prisma.$queryRaw`
        SELECT
            t.id AS "tenantId",
            t.name AS "tenantName",
            t.plan AS "currentPlan",
            bp.slug AS "actualPlan",
            bs.status AS "subStatus"
        FROM tenants t
        JOIN billing_subscriptions bs ON bs.tenant_id = t.id
        JOIN billing_plans bp ON bp.id = bs.plan_id
        WHERE t.plan != bp.slug
        ORDER BY t.name
    `;

    if (mismatches.length === 0) {
        console.log('All tenants are already in sync. Nothing to do.');
        return;
    }

    console.log(`Found ${mismatches.length} tenant(s) with mismatched plan:\n`);
    console.log('  Tenant                          | Current (wrong) | Actual (correct) | Sub Status');
    console.log('  ' + '-'.repeat(90));

    for (const m of mismatches) {
        const name = (m.tenantName || '').padEnd(30);
        console.log(`  ${name}  | ${m.currentPlan.padEnd(15)} | ${m.actualPlan.padEnd(16)} | ${m.subStatus}`);
    }

    if (dryRun) {
        console.log('\nDry run complete. Run without --dry-run to apply fixes.');
        return;
    }

    console.log('\nApplying fixes...\n');

    let fixed = 0;
    for (const m of mismatches) {
        await prisma.tenant.update({
            where: { id: m.tenantId },
            data: { plan: m.actualPlan },
        });
        console.log(`  ✓ ${m.tenantName}: ${m.currentPlan} → ${m.actualPlan}`);
        fixed++;
    }

    console.log(`\nDone. Fixed ${fixed} tenant(s).`);
    console.log('Redis cache will auto-invalidate within 5 minutes, or restart the API to clear immediately.');
}

main()
    .catch((e) => {
        console.error('Error:', e.message);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
