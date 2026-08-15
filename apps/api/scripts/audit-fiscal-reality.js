/**
 * Auditoría de realidad fiscal — SOLO LECTURA, no modifica nada.
 *
 *   docker exec parallext-api node scripts/audit-fiscal-reality.js
 *
 * Responde tres preguntas antes de tocar la base:
 *   1. Qué facturas DIAN se emitieron y contra qué pago.
 *   2. Cuáles de esas corresponden a plata que probablemente no entró
 *      (tenant propio, cobro de sandbox, monto cero, proveedor retirado).
 *   3. Qué tenants siguen con el motor armado, o sea qué se va a cobrar
 *      —y facturar— si no se hace nada.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const money = (cents, cur) => `${(cents / 100).toLocaleString('es-CO')} ${cur}`;

async function main() {
    const issued = await prisma.fiscalInvoice.findMany({
        where: { status: { in: ['issued', 'pending', 'failed'] } },
        orderBy: { createdAt: 'asc' },
    });

    console.log(`\n=== FACTURAS FISCALES (${issued.length}) ===`);
    if (!issued.length) console.log('  (ninguna — todavía no se consumió ningún consecutivo)');

    const tenants = new Map(
        (await prisma.tenant.findMany({
            select: { id: true, name: true, slug: true, isInternal: true, billingCountry: true },
        })).map((t) => [t.id, t]),
    );

    const suspicious = [];
    for (const inv of issued) {
        const tenant = tenants.get(inv.tenantId);
        const payment = inv.paymentId
            ? await prisma.billingPayment.findUnique({ where: { id: inv.paymentId } })
            : null;

        const reasons = [];
        if (tenant?.isInternal) reasons.push('tenant propio');
        if (payment?.metadata?.railEnvironment === 'sandbox') reasons.push('cobro en sandbox');
        if (payment && payment.amountCents <= 0) reasons.push('monto cero');
        if (payment?.provider === 'mercadopago') reasons.push('MercadoPago (retirado; era modo prueba)');
        if (!payment) reasons.push('sin pago vinculado');

        const label = `${tenant?.name ?? inv.tenantId} [${tenant?.slug ?? '?'}]`;
        console.log(
            `  ${inv.status.padEnd(8)} ${(inv.invoiceNumber || '(sin número)').padEnd(18)} `
            + `${money(inv.amountCents, inv.currency).padStart(16)}  ${label}`
            + (reasons.length ? `\n           ⚠ ${reasons.join(' · ')}` : ''),
        );
        if (reasons.length) suspicious.push({ inv, tenant, reasons });
    }

    console.log(`\n=== A REVISAR: ${suspicious.length} de ${issued.length} ===`);
    if (suspicious.length) {
        console.log('  Una factura de venta afirma que hubo una venta. Anular una ya');
        console.log('  entregada a la DIAN es una NOTA CRÉDITO, no un DELETE.');
    }

    // Lo que va a pasar si no se hace nada.
    const armed = await prisma.billingSubscription.findMany({
        where: { engine: 'internal', nextChargeAt: { not: null }, cancelAtPeriodEnd: false },
        select: {
            tenantId: true, status: true, nextChargeAt: true,
            chargeAmountCents: true, chargeCurrency: true, provider: true,
        },
        orderBy: { nextChargeAt: 'asc' },
    });
    console.log(`\n=== MOTOR ARMADO: ${armed.length} suscripciones con próximo cobro ===`);
    for (const s of armed) {
        const t = tenants.get(s.tenantId);
        const flag = t?.isInternal ? '  ← tenant propio, NO se facturará' : '';
        console.log(
            `  ${String(s.nextChargeAt?.toISOString().slice(0, 10))}  `
            + `${(t?.name ?? s.tenantId).padEnd(28)} ${s.status.padEnd(9)} `
            + `${s.chargeAmountCents ? money(s.chargeAmountCents, s.chargeCurrency || '') : '(sin precio)'}${flag}`,
        );
    }

    const internal = [...tenants.values()].filter((t) => t.isInternal);
    console.log(`\n=== MARCADOS COMO PROPIOS: ${internal.length} ===`);
    for (const t of internal) console.log(`  ${t.name} [${t.slug}]`);
    if (!internal.length) {
        console.log('  (ninguno todavía — marcalos desde el panel del tenant)');
    }
    console.log();
}

main()
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
