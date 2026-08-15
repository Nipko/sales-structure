/**
 * Divergencia entre el plan que el tenant PUEDE usar y el que se le COBRA.
 *
 *   docker exec parallext-api node scripts/audit-plan-drift.js           # lista
 *   docker exec parallext-api node scripts/audit-plan-drift.js --apply   # repara
 *
 * Son dos campos distintos y ambos existen a propósito:
 *
 *   tenants.plan              → LÍMITES. De acá leen el rate limiter y las
 *                               features. Es lo que el tenant puede usar hoy.
 *   billing_subscriptions.plan_id → COBRO. Lo que se le factura.
 *
 * Divergir no es siempre un error: `PUT /billing-admin/tenants/:id/plan` es un
 * override deliberado de permisos que no toca la suscripción. Por eso este
 * script NO repara solo: lista, y con --apply alinea los límites al plan que se
 * cobra. Antes de aplicar hay que mirar la lista, porque un override legítimo
 * se vería igual que una desincronización.
 */
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
// Sólo se conecta cuando de verdad se va a escribir.
const redis = APPLY && process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;

async function main() {
    const subs = await prisma.billingSubscription.findMany({
        where: { status: { in: ['pending_auth', 'trialing', 'active', 'past_due'] } },
        include: {
            plan: { select: { slug: true } },
            tenant: { select: { id: true, name: true, slug: true, plan: true, isInternal: true } },
        },
    });

    const drifted = subs.filter((s) => s.tenant && s.plan && s.tenant.plan !== s.plan.slug);

    console.log(`\n=== SUSCRIPCIONES VIVAS: ${subs.length} · DIVERGENTES: ${drifted.length} ===\n`);
    if (!drifted.length) {
        console.log('  Los límites coinciden con lo que se cobra en todos los casos.\n');
        return;
    }

    for (const s of drifted) {
        console.log(`  ${s.tenant.name} [${s.tenant.slug}]${s.tenant.isInternal ? ' (propio)' : ''}`);
        console.log(`      límites hoy : ${s.tenant.plan}`);
        console.log(`      se le cobra : ${s.plan.slug}   (${s.status})`);
        if (APPLY) {
            await prisma.tenant.update({ where: { id: s.tenant.id }, data: { plan: s.plan.slug } });
            // Los límites se sirven de Redis. Escribir la columna sin limpiar
            // estas llaves alinea la base y deja al tenant capado igual — que es
            // justo el síntoma que veníamos a resolver.
            if (redis) {
                await redis.del(`plan_features:${s.tenant.id}`);
                await redis.del(`tenant_plan:${s.tenant.id}`);
                await redis.del(`tenant:${s.tenant.id}:detail-safe:v2`);
            }
            console.log(`      → alineado a ${s.plan.slug}${redis ? ' (caché limpiada)' : ''}`);
        }
    }

    if (APPLY) {
        if (!redis) {
            console.log('\n⚠ Sin REDIS_URL no se pudieron limpiar las cachés de plan, así que');
            console.log('  los límites viejos siguen sirviéndose. Reiniciá el API.');
        }
        console.log(`\n✓ ${drifted.length} tenants alineados.\n`);
    } else {
        console.log('\n(LISTADO — no se escribió nada.)');
        console.log('Revisá caso por caso: un override deliberado de permisos se ve igual');
        console.log('que una desincronización. Con --apply, los límites pasan a ser los del');
        console.log('plan que se cobra.\n');
    }
}

main()
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(async () => {
        await prisma.$disconnect();
        if (redis) redis.disconnect();
    });
