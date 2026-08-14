#!/usr/bin/env node
/**
 * Verifica NUESTRO ciclo de cobro con Wompi, no el protocolo de Wompi.
 *
 * `verify-wompi-sandbox.js` prueba el contrato con el proveedor (firmas,
 * tokens, estados). Este prueba lo que va encima: que el catálogo venda, que
 * el alta arme el motor, que el intento de cobro nazca y que el barrido lo
 * ejecute. Son los eslabones donde estuvo el problema — el motor existía
 * entero y no lo encendía nadie, así que un trial vencía sin un solo cobro.
 *
 * Lee de la base y de la API pública; NO mueve plata por su cuenta.
 *
 * Uso, dentro del contenedor desplegado:
 *   docker exec parallext-api node scripts/verify-wompi-flow.js
 *   docker exec parallext-api node scripts/verify-wompi-flow.js --tenant <uuid>
 *
 * Con `--tenant` audita además ese tenant concreto: si su suscripción quedó
 * bien armada y qué intentos de cobro tiene.
 */

const { PrismaClient } = require('@prisma/client');

const API = (process.env.PUBLIC_API_URL || 'https://api.parallly-chat.cloud').replace(/\/+$/, '');
const COUNTRY = process.env.VERIFY_COUNTRY || 'CO';
const tenantArg = (() => {
    const i = process.argv.indexOf('--tenant');
    return i > -1 ? process.argv[i + 1] : null;
})();

let failures = 0;
let warnings = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => { failures++; console.log(`  \x1b[31m✗\x1b[0m ${m}`); };
const warn = (m) => { warnings++; console.log(`  \x1b[33m!\x1b[0m ${m}`); };
const info = (m) => console.log(`    ${m}`);
const step = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`);

const money = (cents, currency) =>
    `${(Number(cents) / 100).toLocaleString('es-CO')} ${currency || ''}`.trim();

async function getJson(url) {
    const res = await fetch(url);
    const text = await res.text();
    try {
        return { status: res.status, body: JSON.parse(text) };
    } catch {
        return { status: res.status, body: text };
    }
}

async function main() {
    const prisma = new PrismaClient();
    console.log(`\n\x1b[1mCiclo de cobro Wompi — ${API} (${COUNTRY})\x1b[0m`);

    // ---------------------------------------------------------------------
    step('1. Operador que cobra el país');
    const cfg = await getJson(`${API}/api/v1/billing/public/config?country=${COUNTRY}`);
    const provider = cfg.body?.data?.provider;
    const environment = cfg.body?.data?.environment;
    const methods = cfg.body?.data?.methods || [];

    if (provider === 'wompi') ok(`el checkout de ${COUNTRY} habla con Wompi`);
    else bad(`${COUNTRY} está ruteado a '${provider}', no a Wompi`);

    if (!cfg.body?.data?.publicKey) bad('sin llave pública: el formulario no puede tokenizar');
    else ok(`llave pública presente (${environment})`);

    if (environment === 'production') {
        warn('AMBIENTE DE PRODUCCIÓN: cualquier prueba mueve plata real');
    } else {
        ok('ambiente sandbox — se puede probar sin mover plata');
    }

    // Sólo tarjeta está probada punta a punta. Nequi además exige que el
    // comercio habilite recurrencia en su portal, y la transferencia no tiene
    // flujo de autorización implementado: ofrecerlos deja checkouts colgados.
    const risky = methods.filter((m) => m !== 'card');
    if (risky.length) {
        warn(`métodos ofrecidos sin verificar: ${risky.join(', ')} — dejá sólo 'card' para probar`);
    } else {
        ok('sólo tarjeta habilitada');
    }

    // ---------------------------------------------------------------------
    step('2. Qué se puede comprar hoy');
    const cat = await getJson(`${API}/api/v1/billing/public/plans?country=${COUNTRY}`);
    const plans = cat.body?.data?.plans || cat.body?.data || [];
    if (!Array.isArray(plans) || !plans.length) {
        bad('el catálogo público no devolvió planes');
    }

    // Mensual y alta cerrados SÍ son un problema: no se puede vender. El anual
    // sin precio cargado es una tarea de configuración, no una falla — mezclarlos
    // hacía que un catálogo sano reportara "4 problemas" y el reporte se volviera
    // ruido.
    let annualPending = 0;
    for (const p of plans) {
        if (p.slug === 'custom') continue; // sales-led por diseño
        const bits = [];
        bits.push(p.monthlyAvailable ? 'mensual ✓' : `mensual ✗ (${p.monthlyUnavailableReason})`);
        bits.push(p.annualAvailable ? 'anual ✓' : `anual ✗ (${p.annualUnavailableReason})`);
        bits.push(p.signupAvailable ? 'alta ✓' : `alta ✗ (${p.signupUnavailableReason})`);
        const line = `${p.slug.padEnd(13)} ${money(p.displayPriceCents, p.displayCurrency).padEnd(18)} ${bits.join('  ')}`;

        if (!p.monthlyAvailable || !p.signupAvailable) bad(line);
        else if (!p.annualAvailable) { annualPending++; console.log(`  \x1b[36m·\x1b[0m ${line}`); }
        else ok(line);
    }
    if (annualPending) {
        warn(`${annualPending} plan(es) sin precio anual cargado — se venden mensual, no anual`);
        info('cargalo en /admin/plans (fila "precio local anual") o con scripts/backfill-annual-prices.js');
    }

    // ---------------------------------------------------------------------
    step('3. Suscripciones que el motor tiene que cobrar');
    const engineSubs = await prisma.billingSubscription.findMany({
        where: { provider: 'wompi' },
        select: {
            id: true, tenantId: true, status: true, engine: true,
            nextChargeAt: true, chargeAmountCents: true, chargeCurrency: true,
            defaultPaymentSourceId: true, trialEndsAt: true,
        },
        take: 100,
    });

    if (!engineSubs.length) {
        info('todavía no hay ninguna suscripción en Wompi — nada que auditar');
    }

    for (const s of engineSubs) {
        // El defecto que cerró este ciclo: suscripción viva, con método de pago
        // guardado, y el motor apagado. Nadie la cobra jamás.
        if (s.engine !== 'internal') {
            const sources = await prisma.billingPaymentSource.count({
                where: { tenantId: s.tenantId, status: 'available' },
            });
            if (sources > 0) {
                bad(`${s.id} (${s.status}) tiene método de pago y el motor APAGADO — no se cobrará nunca`);
            } else {
                info(`${s.id} (${s.status}) sin método de pago todavía — normal en un trial libre`);
            }
            continue;
        }
        if (!s.nextChargeAt) bad(`${s.id} con motor interno y sin nextChargeAt — el barrido no la ve`);
        else if (!s.chargeAmountCents || !s.chargeCurrency) bad(`${s.id} sin precio congelado — el motor no inventa precios`);
        else if (!s.defaultPaymentSourceId) bad(`${s.id} sin fuente de pago por defecto`);
        else ok(`${s.id} (${s.status}) cobra ${money(s.chargeAmountCents, s.chargeCurrency)} el ${s.nextChargeAt.toISOString()}`);
    }

    // ---------------------------------------------------------------------
    step('4. Intentos de cobro');
    const attempts = await prisma.billingChargeAttempt.findMany({
        where: { provider: 'wompi' },
        orderBy: { createdAt: 'desc' },
        take: 20,
    });

    if (!attempts.length) {
        info('sin intentos todavía');
    }
    for (const a of attempts) {
        const line = `${a.status.padEnd(16)} ${a.purpose.padEnd(8)} ${money(a.amountCents, a.currency).padEnd(16)} ${a.reference}`;
        if (a.status === 'succeeded') ok(line);
        else if (['scheduled', 'in_flight', 'pending_provider'].includes(a.status)) info(`${line}  (en vuelo)`);
        else if (a.failureClass === 'indeterminate') bad(`${line}  INDETERMINADO — nunca se reintenta solo, revisar a mano`);
        else warn(`${line}  ${a.failureCode || ''}`);
    }

    // Un intento colgado hace horas es señal de que el webhook no llega.
    const stuck = attempts.filter((a) =>
        ['in_flight', 'pending_provider'].includes(a.status)
        && a.sentAt && Date.now() - a.sentAt.getTime() > 6 * 3_600_000);
    if (stuck.length) {
        bad(`${stuck.length} intento(s) llevan +6h sin resolverse — revisá la URL de eventos en el panel de Wompi`);
    }

    // ---------------------------------------------------------------------
    if (tenantArg) {
        step(`5. Tenant ${tenantArg}`);
        const t = await prisma.tenant.findUnique({
            where: { id: tenantArg },
            select: {
                name: true, billingCountry: true,
                paymentProvider: true, paymentProviderOverride: true,
            },
        });
        if (!t) {
            bad('ese tenant no existe');
        } else {
            info(`${t.name} · país ${t.billingCountry || '(sin país)'}`);
            info(`último cobro por: ${t.paymentProvider || '—'}`);
            info(`pin explícito: ${t.paymentProviderOverride || 'ninguno (sigue al país)'}`);
            if (t.paymentProviderOverride && t.paymentProviderOverride !== 'wompi') {
                warn(`el pin lo manda a '${t.paymentProviderOverride}' y no seguirá el operador del país`);
            }

            const sources = await prisma.billingPaymentSource.findMany({
                where: { tenantId: tenantArg },
                select: { kind: true, status: true, isDefault: true, brand: true, last4: true, supportsUnattended: true },
            });
            if (!sources.length) info('sin métodos de pago guardados');
            for (const s of sources) {
                const label = `${s.kind} ${s.brand || ''} ${s.last4 ? `••${s.last4}` : ''} — ${s.status}${s.isDefault ? ' (por defecto)' : ''}`;
                if (s.status === 'available' && s.supportsUnattended) ok(label);
                else if (s.status === 'available') warn(`${label} — no cobrable sin el cliente presente`);
                else info(label);
            }
        }
    }

    await prisma.$disconnect();

    console.log('');
    if (failures) {
        console.log(`\x1b[31m${failures} problema(s)\x1b[0m${warnings ? ` · ${warnings} aviso(s)` : ''}\n`);
        process.exit(1);
    }
    console.log(`\x1b[32mCiclo sano\x1b[0m${warnings ? ` · ${warnings} aviso(s)` : ''}\n`);
}

main().catch((err) => {
    console.error(`\n\x1b[31m${err?.stack || err}\x1b[0m\n`);
    process.exit(1);
});
