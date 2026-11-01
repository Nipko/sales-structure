#!/usr/bin/env node
/**
 * Fase E: reúne desde la base las corridas de ensayo ya guardadas (no depende de la memoria de `measure.cjs`). Para cada
 * tenant toma las corridas iniciadas desde `--since`, agrupadas por `bank_hash`, y escribe el mismo JSON que
 * `measure.cjs`. Se corre dentro del contenedor `api`:
 *
 *   node scripts/rehearsal/collect.cjs --schemas tenant_a,tenant_b --since 2026-10-31T06:29:00Z --out /tmp/e1.json
 *
 * Por tenant se queda con el banco que tenga más corridas terminadas (completed o stopped).
 */
'use strict';
const fs = require('node:fs');

function arg(name, fallback) {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
    const schemas = String(arg('--schemas', '')).split(',').map(s => s.trim()).filter(Boolean);
    const since = arg('--since');
    const out = arg('--out', '/tmp/rehearsal-collect.json');
    if (!schemas.length || !since) throw new Error('faltan --schemas o --since');

    // Sin esto el proceso es un worker más: procesa colas de producción y corre los cron (isolate.cjs).
    const isolate = require('./isolate.cjs');
    isolate.beforeBoot();
    const { NestFactory } = require('@nestjs/core');
    const { AppModule } = require('../../dist/app.module');
    const { RehearsalService } = require('../../dist/modules/rehearsal/rehearsal.service');
    const { PrismaService } = require('../../dist/modules/prisma/prisma.service');
    const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
    isolate.afterBoot(app);
    const svc = app.get(RehearsalService);
    const prisma = app.get(PrismaService);

    const results = [];
    for (const schema of schemas) {
        const [t] = await prisma.$queryRawUnsafe('SELECT id FROM tenants WHERE schema_name = $1', schema);
        if (!t) { results.push({ schema, error: 'tenant_not_found' }); continue; }
        if (!/^tenant_[a-z0-9_]+$/.test(schema)) throw new Error(`esquema inválido: ${schema}`);
        const rows = await prisma.$queryRawUnsafe(
            `SELECT id, bank_hash FROM "${schema}".rehearsal_runs
              WHERE started_at >= $1::timestamptz AND status IN ('completed', 'stopped') ORDER BY started_at`, since);
        const byBank = new Map();
        for (const r of rows) byBank.set(r.bank_hash, [...(byBank.get(r.bank_hash) ?? []), r.id]);
        const best = [...byBank.values()].sort((a, b) => b.length - a.length)[0] ?? [];
        const runs = [];
        for (const id of best) runs.push(await svc.get(t.id, id));
        results.push({ schema, tenantId: t.id, runs });
        console.log(`${schema}: ${runs.length} corridas del banco ${runs[0]?.bankHash ?? '—'}`);
    }
    const k = Math.max(0, ...results.map(r => (r.runs ?? []).length));
    fs.writeFileSync(out, JSON.stringify({ startedAt: since, finishedAt: new Date().toISOString(), k, seed: 'e1', results }, null, 1));
    console.log(`listo: ${out}`);
    await app.close();
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
