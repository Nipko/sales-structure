/**
 * Pasa a Wompi las suscripciones que quedaron ancladas a MercadoPago.
 *
 *   docker exec parallext-api node scripts/migrate-mercadopago-to-wompi.js           # simula
 *   docker exec parallext-api node scripts/migrate-mercadopago-to-wompi.js --apply   # escribe
 *
 * La migración del retiro (20260814120000) movió sólo las que NO tenían mandato
 * vivo — `provider_subscription_id IS NULL`. Las que sí lo tenían quedaron
 * aposta: cambiarles el nombre del proveedor habría escondido que MercadoPago
 * podía seguir cobrando del otro lado.
 *
 * Hoy ese mandato es inservible: no hay credenciales de MP ni adapter, así que
 * no se puede cancelar desde acá NUNCA. Dejarlas ancladas sólo impide operarlas.
 * Este script las mueve SIN perder el dato: el id del mandato se guarda en
 * `metadata.legacyMercadoPagoMandate` y en `audit_logs`, porque cancelarlo en el
 * panel de MercadoPago sigue siendo una tarea humana pendiente.
 *
 * Las terminales (cancelled/expired) NO se tocan: son historial, y reescribir
 * con qué proveedor se cobró algo que ya pasó es falsear el registro.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const LIVE_STATUSES = ['pending_auth', 'trialing', 'active', 'past_due'];

async function main() {
    const subs = await prisma.billingSubscription.findMany({
        where: { provider: 'mercadopago' },
        include: { tenant: { select: { name: true, slug: true, billingCountry: true, isInternal: true } } },
    });

    const movable = subs.filter((s) => LIVE_STATUSES.includes(s.status));
    const historical = subs.filter((s) => !LIVE_STATUSES.includes(s.status));

    console.log(`\n=== SUSCRIPCIONES EN MERCADOPAGO: ${subs.length} ===`);
    console.log(`  ${movable.length} movibles · ${historical.length} terminales (historial, no se tocan)\n`);

    if (!movable.length) {
        console.log('  Nada que mover.\n');
        return;
    }

    const stranded = [];
    for (const s of movable) {
        const mandate = s.providerSubscriptionId;
        const label = `${s.tenant?.name ?? s.tenantId} [${s.tenant?.slug ?? '?'}]`;
        console.log(`  ${s.status.padEnd(10)} ${label}${s.tenant?.isInternal ? ' (propio)' : ''}`);
        console.log(`             mandato: ${mandate ?? '(ninguno)'}`);
        if (mandate) stranded.push({ label, mandate });

        if (!APPLY) continue;

        await prisma.$transaction(async (tx) => {
            await tx.billingSubscription.update({
                where: { id: s.id },
                data: {
                    provider: 'wompi',
                    // Se libera la columna UNIQUE, pero el id NO se pierde: sin
                    // esto quedaría sólo en la memoria de quien corrió el script.
                    providerSubscriptionId: null,
                    metadata: {
                        ...(s.metadata ?? {}),
                        ...(mandate ? { legacyMercadoPagoMandate: mandate } : {}),
                    },
                },
            });
            if (mandate) {
                await tx.auditLog.create({
                    data: {
                        action: 'billing.stranded_provider_mandate',
                        resource: 'billing_subscriptions',
                        details: {
                            tenantId: s.tenantId,
                            provider: 'mercadopago',
                            mandateId: mandate,
                            reason: 'migración a Wompi; el adapter de MercadoPago fue retirado',
                        },
                    },
                });
            }
            await tx.tenant.updateMany({
                where: { id: s.tenantId, paymentProvider: 'mercadopago' },
                data: { paymentProvider: 'wompi' },
            });
        });
    }

    if (stranded.length) {
        console.log(`\n=== MANDATOS QUE SIGUEN VIVOS EN MERCADOPAGO: ${stranded.length} ===`);
        console.log('  No los podemos cancelar: no hay credenciales ni adapter. Si querés');
        console.log('  asegurar que no cobren, hay que anularlos en el panel de MercadoPago.');
        for (const s of stranded) console.log(`  ${s.mandate}  ${s.label}`);
    }

    console.log(APPLY
        ? `\n✓ ${movable.length} suscripciones movidas a Wompi.\n`
        : '\n(SIMULACIÓN — no se escribió nada. Repetí con --apply para aplicar.)\n');
}

main()
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
