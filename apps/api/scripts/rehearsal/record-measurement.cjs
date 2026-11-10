#!/usr/bin/env node
/**
 * Registra una medición QA de un modelo en `llm_model_measurements` (ADR-0030 fase 4), para los bancos que no corre
 * `measure.cjs`: la confirmación firmada (`signed_confirmation`) y el verificador de `classify` (`classify_verifier`).
 * También sirve para cargar una medición `rehearsal_7t` ya hecha. Se corre dentro del contenedor `api`:
 *
 *   node scripts/rehearsal/record-measurement.cjs --model gpt-6-luna --bench signed_confirmation --n 28 --pass 28 \
 *        --run-ref /root/catalog-measure/out/confirmbench.json --measured-at 2026-11-09T11:00:00Z [--catalog-version 1] \
 *        [--cost-per-case 0.0012] [--notes "..."]
 *
 * Usa el mismo `LlmMeasurementService` que el API (mismas validaciones); no levanta la aplicación.
 */
'use strict';

function arg(name, fallback) {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
    const { PrismaClient } = require('@prisma/client');
    const { LlmMeasurementService } = require('../../dist/modules/ai/catalog/llm-measurement.service');
    const prisma = new PrismaClient();
    try {
        const svc = new LlmMeasurementService(prisma);
        const row = await svc.record({
            modelId: arg('--model'),
            bench: arg('--bench'),
            n: Number(arg('--n')),
            pass: Number(arg('--pass')),
            costPerCaseUsd: arg('--cost-per-case') != null ? Number(arg('--cost-per-case')) : null,
            catalogVersion: arg('--catalog-version') != null ? Number(arg('--catalog-version')) : null,
            apiCommit: arg('--api-commit', process.env.GIT_SHA || null),
            runRef: arg('--run-ref', null),
            notes: arg('--notes', null),
            measuredAt: arg('--measured-at'),
        });
        console.log(JSON.stringify({ id: row.id, model: row.model_id, bench: row.bench, n: row.n, pass: row.pass, passRate: Number(row.pass_rate) }));
    } finally {
        await prisma.$disconnect();
    }
}

main().catch(e => { console.error(e?.response ?? e?.message ?? e); process.exit(1); });
