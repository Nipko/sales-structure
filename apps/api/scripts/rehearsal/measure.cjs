#!/usr/bin/env node
/**
 * Fase E: corre el ensayo de R7 (RehearsalService) k veces sobre el mismo banco congelado, para cada tenant indicado,
 * y escribe un JSON con el detalle de cada corrida. Levanta el contexto de la aplicación igual que el worker y
 * `reconcile-vertical-provisioning.js`; no usa HTTP ni credenciales. Se corre dentro del contenedor `api`:
 *
 *   node scripts/rehearsal/measure.cjs --schemas tenant_a,tenant_b --k 3 --seed e1 --out /tmp/e1.json
 *
 * Cada tenant corre en paralelo; sus repeticiones, en serie (el servicio admite una corrida activa por tenant).
 */
'use strict';
const fs = require('node:fs');

function arg(name, fallback) {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : fallback;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitRun(svc, tenantId, runId) {
    for (;;) {
        const d = await svc.get(tenantId, runId);
        if (d.status !== 'running') return d;
        await sleep(10_000);
    }
}

async function measureTenant(svc, prisma, schema, k, seed, log) {
    const [t] = await prisma.$queryRawUnsafe('SELECT id FROM tenants WHERE schema_name = $1', schema);
    if (!t) return { schema, error: 'tenant_not_found' };
    const tenantId = t.id;
    const runs = [];
    let first = null;
    for (let i = 0; i < k; i++) {
        let view;
        try {
            view = await svc.start(tenantId, i === 0 ? { seed } : { repeatOf: first });
        } catch (e) {
            runs.push({ attempt: i + 1, error: String(e?.message ?? e) });
            log(`${schema} intento ${i + 1}: no arrancó (${e?.message ?? e})`);
            break;
        }
        if (i === 0) first = view.id;
        log(`${schema} intento ${i + 1}: corrida ${view.id} (${view.caseCount ?? '?'} casos)`);
        const detail = await waitRun(svc, tenantId, view.id);
        log(`${schema} intento ${i + 1}: ${detail.status}, aciertos ${detail.passRate ?? '—'}`);
        runs.push(detail);
    }
    return { schema, tenantId, runs };
}

async function main() {
    const schemas = String(arg('--schemas', '')).split(',').map(s => s.trim()).filter(Boolean);
    const k = Number(arg('--k', '3'));
    const seed = arg('--seed', 'e1');
    const out = arg('--out', '/tmp/rehearsal-measure.json');
    if (!schemas.length) throw new Error('falta --schemas');

    const { NestFactory } = require('@nestjs/core');
    const { AppModule } = require('../../dist/app.module');
    const { RehearsalService } = require('../../dist/modules/rehearsal/rehearsal.service');
    const { PrismaService } = require('../../dist/modules/prisma/prisma.service');
    const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
    const svc = app.get(RehearsalService);
    const prisma = app.get(PrismaService);
    const log = m => console.log(`[${new Date().toISOString()}] ${m}`);

    const startedAt = new Date().toISOString();
    const results = await Promise.all(schemas.map(s => measureTenant(svc, prisma, s, k, seed, log)
        .catch(e => ({ schema: s, error: String(e?.message ?? e) }))));
    fs.writeFileSync(out, JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), k, seed, results }, null, 1));
    log(`listo: ${out}`);
    await app.close();
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
