#!/usr/bin/env node
/**
 * Completa el precio ANUAL de los planes que sólo tienen el mensual.
 *
 * Por qué hace falta: el catálogo sólo vende el ciclo anual si el país tiene un
 * `annual.amountCents`. En producción nunca se escribió — el bootstrap del
 * deploy es create-only y salta los planes que ya existen, así que los precios
 * anuales del seed jamás llegaron a los planes creados antes. Resultado: el
 * anual figura como no disponible en los cuatro planes.
 *
 * Por qué no se corre el seed con --force: eso restauraría los valores de
 * FÁBRICA de todo —nombre, precio USD, features, límites— y pisaría lo que se
 * haya editado desde el panel, que es la fuente de verdad. Esto toca UNA sola
 * cosa.
 *
 * El anual se deriva del mensual REAL que tenga cada plan en la base, con el
 * descuento configurado. Así respeta los precios vigentes en vez de reimponer
 * los del seed. Los valores de fábrica cumplen exactamente esta regla, así que
 * un plan sin editar queda con el mismo número que traía el seed.
 *
 * Uso (dentro del contenedor):
 *   docker exec parallext-api node scripts/backfill-annual-prices.js           # simulacro
 *   docker exec parallext-api node scripts/backfill-annual-prices.js --apply   # escribe
 *   docker exec parallext-api node scripts/backfill-annual-prices.js --apply --discount 15
 *
 * Es idempotente: un plan que ya tiene precio anual NO se toca (ni siquiera con
 * --apply). Para cambiar un anual existente se usa el panel.
 */

const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');
const DISCOUNT_PCT = (() => {
    const i = process.argv.indexOf('--discount');
    const raw = i > -1 ? Number(process.argv[i + 1]) : 15;
    if (!Number.isFinite(raw) || raw < 0 || raw >= 100) {
        console.error(`Descuento inválido: ${process.argv[i + 1]}`);
        process.exit(1);
    }
    return raw;
})();

const money = (cents, currency) => `${(Number(cents) / 100).toLocaleString('es-CO')} ${currency}`;

async function main() {
    const prisma = new PrismaClient();
    const plans = await prisma.billingPlan.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
    });

    console.log(`\n\x1b[1mPrecio anual faltante — descuento ${DISCOUNT_PCT}%${APPLY ? '' : '  (SIMULACRO)'}\x1b[0m\n`);

    let written = 0;
    let skipped = 0;

    for (const plan of plans) {
        // Custom es sales-led: su precio se negocia, no se calcula.
        const features = plan.features && typeof plan.features === 'object' ? plan.features : {};
        if (plan.slug === 'custom' || features.salesLed === true) {
            console.log(`  ${plan.slug.padEnd(13)} sales-led, se omite`);
            continue;
        }

        const overrides = plan.priceLocalOverrides && typeof plan.priceLocalOverrides === 'object'
            ? plan.priceLocalOverrides
            : {};
        const next = { ...overrides };
        let changedCountries = [];

        for (const [country, entry] of Object.entries(overrides)) {
            if (!entry || typeof entry !== 'object') continue;

            const monthly = Number(entry.amountCents);
            const currency = String(entry.currency || '').trim().toUpperCase();
            if (!Number.isSafeInteger(monthly) || monthly <= 0 || !currency) {
                console.log(`  ${plan.slug.padEnd(13)} ${country}: sin mensual válido, se omite`);
                continue;
            }

            const annual = entry.annual && typeof entry.annual === 'object' ? entry.annual : null;
            if (annual && Number.isSafeInteger(Number(annual.amountCents)) && Number(annual.amountCents) > 0) {
                skipped++;
                console.log(`  ${plan.slug.padEnd(13)} ${country}: ya tiene anual ${money(annual.amountCents, currency)} — intacto`);
                continue;
            }

            // 12 mensualidades menos el descuento. Redondeo al peso para no
            // dejar fracciones que el proveedor no puede cobrar.
            const amountCents = Math.round((monthly * 12 * (100 - DISCOUNT_PCT)) / 100 / 100) * 100;

            next[country] = {
                ...entry,
                // La moneda se escribe explícita aunque el catálogo ya la herede
                // del país: deja el dato completo para cualquier lector futuro.
                annual: { ...(annual ?? {}), amountCents, currency },
            };
            changedCountries.push(`${country} ${money(amountCents, currency)}`);
        }

        if (!changedCountries.length) continue;

        console.log(`  \x1b[32m${plan.slug.padEnd(13)}\x1b[0m ${changedCountries.join(' · ')}`);
        if (APPLY) {
            await prisma.billingPlan.update({
                where: { id: plan.id },
                data: { priceLocalOverrides: next },
            });
            written++;
        }
    }

    await prisma.$disconnect();

    console.log('');
    if (!APPLY) {
        console.log('Simulacro: no se escribió nada. Repetir con \x1b[1m--apply\x1b[0m para aplicarlo.\n');
    } else {
        console.log(`\x1b[32m${written} plan(es) actualizados\x1b[0m${skipped ? ` · ${skipped} ya tenían anual` : ''}`);
        console.log('El catálogo cachea por país: verificá con');
        console.log('  curl -s "https://api.parallly-chat.cloud/api/v1/billing/public/plans?country=CO"\n');
    }
}

main().catch((err) => {
    console.error(`\n\x1b[31m${err?.stack || err}\x1b[0m\n`);
    process.exit(1);
});
