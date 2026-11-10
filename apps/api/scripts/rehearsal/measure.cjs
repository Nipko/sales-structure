#!/usr/bin/env node
/**
 * Fase E: corre el ensayo de R7 (RehearsalService) k veces sobre el mismo banco congelado, para cada tenant indicado,
 * y escribe un JSON con el detalle de cada corrida. Levanta el contexto de la aplicación igual que el worker y
 * `reconcile-vertical-provisioning.js`; no usa HTTP ni credenciales. Se corre dentro del contenedor `api`:
 *
 *   node scripts/rehearsal/measure.cjs --schemas tenant_a,tenant_b --k 3 --seed e1 --out /tmp/e1.json
 *
 * Corre `--concurrency` tenants a la vez (2 por defecto: con 7 a la vez, las lecturas de herramientas superaban su
 * límite de 3 s); las repeticiones de cada tenant van en serie (el servicio admite una corrida activa por tenant).
 * No consume el cupo diario del dueño (`internalMeasurement`).
 *
 * Medir un modelo para el catálogo (ADR-0030 fase 4):
 *
 *   node scripts/rehearsal/measure.cjs --schemas ... --k 1 --draft 5 --candidate gpt-6-luna-mini --record
 *
 * - `--draft <versión>`: este proceso usa esa versión del catálogo (un borrador sin publicar, por ejemplo). La API y
 *   el worker siguen con la publicada. Sin `--draft`, fija la activa para que no cambie a mitad de la medición.
 * - `--candidate <modelo>`: el modelo que responde primero en `conversation` y `tool_calling` (lo mismo que
 *   `LLM_MEASUREMENT_LEAD_MODEL`). Tiene que estar en esas cadenas de la versión medida.
 * - `--record`: al terminar guarda el resumen como medición `rehearsal_7t` del candidato (o de la cabeza de
 *   `conversation`) en `llm_model_measurements`. No registra con menos de `--min-n` casos válidos (150).
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
            view = await svc.start(tenantId, { ...(i === 0 ? { seed } : { repeatOf: first }), internalMeasurement: true });
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
    const candidate = arg('--candidate');
    // Lo lee el router al cargar el módulo: tiene que estar antes de requerir AppModule.
    if (candidate) process.env.LLM_MEASUREMENT_LEAD_MODEL = candidate;
    const draft = arg('--draft');
    const record = process.argv.includes('--record');
    const minN = Number(arg('--min-n', '150'));
    const schemas = String(arg('--schemas', '')).split(',').map(s => s.trim()).filter(Boolean);
    const k = Number(arg('--k', '3'));
    const seed = arg('--seed', 'e1');
    const out = arg('--out', '/tmp/rehearsal-measure.json');
    if (!schemas.length) throw new Error('falta --schemas');

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
    const log = m => console.log(`[${new Date().toISOString()}] ${m}`);

    const { LlmCatalogService } = require('../../dist/modules/ai/catalog/llm-catalog.service');
    const { LlmMeasurementService } = require('../../dist/modules/ai/catalog/llm-measurement.service');
    const { summarizeRehearsalRuns } = require('../../dist/modules/ai/catalog/promotion-rule');
    const { activeLlmCatalog } = require('../../dist/modules/ai/router/llm-catalog');
    const catalogSvc = app.get(LlmCatalogService);
    let catalog;
    if (draft) catalog = await catalogSvc.pinForMeasurement(Number(draft));
    else { catalogSvc.stopFollowing(); catalog = activeLlmCatalog(); }
    if (candidate && !['conversation', 'tool_calling'].every(task => catalog.chains[task].includes(candidate))) {
        throw new Error(`--candidate ${candidate} no está en conversation y tool_calling de la versión ${catalog.version}`);
    }
    const measuredModel = candidate || catalog.chains.conversation[0];
    log(`catálogo v${catalog.version}, modelo medido ${measuredModel}`);

    const startedAt = new Date().toISOString();
    const concurrency = Math.max(1, Number(arg('--concurrency', '2')));
    const queue = [...schemas];
    const results = [];
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (queue.length) {
            const s = queue.shift();
            results.push(await measureTenant(svc, prisma, s, k, seed, log).catch(e => ({ schema: s, error: String(e?.message ?? e) })));
        }
    }));
    const finishedAt = new Date().toISOString();
    fs.writeFileSync(out, JSON.stringify({ startedAt, finishedAt, k, seed, catalogVersion: catalog.version, model: measuredModel, results }, null, 1));
    log(`listo: ${out}`);
    const summary = summarizeRehearsalRuns(results);
    log(`resumen ${measuredModel}: ${summary.pass}/${summary.n} = ${summary.passRate} (errores ${summary.errors})`);
    if (record) {
        if (summary.n < minN) {
            log(`NO se registra: ${summary.n} casos válidos < --min-n ${minN}`);
        } else {
            const row = await app.get(LlmMeasurementService).record({
                modelId: measuredModel, bench: 'rehearsal_7t', n: summary.n, pass: summary.pass, costPerCaseUsd: summary.costPerCaseUsd,
                catalogVersion: Number(catalog.version) || null, apiCommit: process.env.GIT_SHA || null, runRef: out,
                notes: `schemas=${schemas.join(',')} k=${k} seed=${seed} errors=${summary.errors}`, measuredAt: finishedAt,
            });
            log(`medición registrada ${row.id}`);
        }
    }
    await app.close();
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
