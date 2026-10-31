#!/usr/bin/env node
/**
 * Fase E (E1.1): corre el juez de paráfrasis con datos sobre una medición recalificada (`business-spec
 * rehearsal-regrade`), solo en los intentos que quedaron con `needsJudge`, y vuelve a calificar con `gradeCase`. No
 * corre el agente. Levanta un módulo mínimo (configuración, eventos, Prisma, Redis e IA): sin cron ni colas, para que
 * la medición no dispare trabajos programados.
 *
 *   node scripts/rehearsal/judge-regraded.cjs --in /in/e1-regraded.json --out /out/e1-judged.json [--concurrency 4] [--model gpt-4o-mini]
 */
'use strict';
const fs = require('node:fs');

function arg(name, fallback) {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
    const input = arg('--in');
    const out = arg('--out');
    if (!input || !out) throw new Error('uso: --in <recalificado.json> --out <archivo>');
    const model = arg('--model');
    if (model) process.env.REHEARSAL_JUDGE_MODEL = model;
    const concurrency = Math.max(1, Number(arg('--concurrency', '4')));

    const { NestFactory } = require('@nestjs/core');
    const { Module } = require('@nestjs/common');
    const { ConfigModule } = require('@nestjs/config');
    const { EventEmitterModule } = require('@nestjs/event-emitter');
    const { PrismaModule } = require('../../dist/modules/prisma/prisma.module');
    const { PrismaService } = require('../../dist/modules/prisma/prisma.service');
    const { RedisModule } = require('../../dist/modules/redis/redis.module');
    const { AIModule } = require('../../dist/modules/ai/ai.module');
    const { RehearsalJudge } = require('../../dist/modules/rehearsal/rehearsal-judge');
    const { gradeCase } = require('@parallext/business-spec');

    class JudgeOnlyModule {}
    Module({
        imports: [ConfigModule.forRoot({ isGlobal: true }), EventEmitterModule.forRoot(), PrismaModule, RedisModule, AIModule],
        providers: [RehearsalJudge],
    })(JudgeOnlyModule);

    const app = await NestFactory.createApplicationContext(JudgeOnlyModule, { logger: ['error', 'warn'] });
    const judge = app.get(RehearsalJudge);
    const prisma = app.get(PrismaService);
    if (!judge.available) throw new Error('el juez no está disponible (sin router de IA)');

    const report = JSON.parse(fs.readFileSync(input, 'utf8'));
    const tenantOf = new Map();
    for (const schema of new Set(report.attempts.map(a => a.schema))) {
        const [t] = await prisma.$queryRawUnsafe('SELECT id FROM tenants WHERE schema_name = $1', schema);
        if (t) tenantOf.set(schema, t.id);
    }
    const queue = report.attempts.filter(a => a.after && a.after.needsJudge && a.after.judgeInput);
    let done = 0, tokens = 0, failed = 0;
    const log = m => console.log(`[${new Date().toISOString()}] ${m}`);
    log(`juez ${judge.model}: ${queue.length} intentos`);
    await Promise.all(Array.from({ length: concurrency }, async () => {
        while (queue.length) {
            const a = queue.shift();
            const { case: c, replies, toolCalls } = a.after.judgeInput;
            let call = null;
            try { call = await judge.judge(tenantOf.get(a.schema), c, replies); } catch (e) { failed++; }
            const g = gradeCase(c, { replies, toolCalls }, call ? call.verdict : null);
            a.after = { ...a.after, outcome: g.outcome, decidedBy: g.decidedBy, needsJudge: false, missClass: g.missClass, reason: g.reason,
                checks: g.checks, judge: call ? { model: call.verdict.model, pass: call.verdict.pass, reason: call.verdict.reason, tokens: call.tokens } : null };
            delete a.after.judgeInput;
            tokens += call ? call.tokens : 0;
            if (++done % 50 === 0) log(`${done} calificados`);
        }
    }));
    for (const a of report.attempts) if (a.after) delete a.after.judgeInput;
    report.judged = { model: judge.model, attempts: done, failed, tokens, at: new Date().toISOString() };
    fs.writeFileSync(out, JSON.stringify(report, null, 1));
    log(`listo: ${out} (${done} intentos, ${failed} fallas del juez, ${tokens} tokens)`);
    await app.close();
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
