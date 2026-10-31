import * as fs from 'node:fs';
import * as path from 'node:path';
import { checkExternal, compile, type SpecError } from '../src/compile';
import { generateRequirementsDoc } from '../src/docs';
import { evaluate } from '../src/engine/evaluate';
import { fromLegacyRows, type LegacyTenantRows } from '../src/legacy-status';
import { readSpecDocs } from '../src/load';
import { qaTruth, requirementsForIntent } from '../src/qa/truth';
import { renderReportMarkdown } from '../src/report';
import { generateRehearsal } from '../src/rehearsal/generate';
import { agreementReport, regradeMeasurement, renderAgreement, type HumanLabel, type RegradeReport, type StoredMeasurement, type StoredToolCalls } from '../src/rehearsal/regrade';
import type { CompiledSpec, TenantSnapshot } from '../src/types';

const REPO = path.resolve(__dirname, '..', '..', '..');
export const DOCS_FILE = path.join(REPO, 'docs', 'domain', 'business-requirements.md');

const arg = (argv: string[], name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

/** Datos de fuera del paquete para el check: subtipos canónicos y páginas del panel (packages/shared). */
function externalChecks(spec: CompiledSpec): SpecError[] {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const subtypes = require(path.join(REPO, 'packages/shared/src/subtype-experience-profile.ts'));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pages = require(path.join(REPO, 'packages/shared/src/dashboard-page-access.ts'));
    return checkExternal(spec, {
        canonicalSubtypes: subtypes.listCanonicalSubtypeExperienceProfileIds(),
        // El panel enlaza cada hueco a su pantalla: tiene que existir y el dueño tiene que poder abrirla (R2).
        uiTargetExists: (p: string) => pages.dashboardRoleCanOpen(p.replace(/\[[^\]]+\]/g, 'x'), 'tenant_admin'),
    });
}

export function runCheck(opts: { currentDoc?: string } = {}): SpecError[] {
    const { spec, errors } = compile(readSpecDocs());
    if (errors.length) return errors;
    const all = [...externalChecks(spec)];
    const expected = generateRequirementsDoc(spec);
    const current = opts.currentDoc ?? (fs.existsSync(DOCS_FILE) ? fs.readFileSync(DOCS_FILE, 'utf8') : '');
    // core.autocrlf=true en Windows: se compara con LF, como queda en el repositorio
    if (current.replace(/\r\n/g, '\n') !== expected) all.push({ code: 'DOCS_STALE', message: `${path.relative(REPO, DOCS_FILE)} está desfasado: node packages/business-spec/bin/business-spec.cjs docs --write` });
    return all;
}

function loadSnapshot(file: string): TenantSnapshot {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw?.schema === 'business-spec/legacy-rows@1') return fromLegacyRows(raw as LegacyTenantRows);
    if (raw?.schema === 'business-spec/tenant-snapshot@1') return raw as TenantSnapshot;
    throw new Error(`${file}: no es una foto ni filas heredadas (campo schema)`);
}

function compiled(): CompiledSpec {
    const { spec, errors } = compile(readSpecDocs());
    if (errors.length) throw new Error(errors.map(e => `[${e.code}] ${e.message}`).join('\n'));
    return spec;
}

export function main(argv: string[]): number {
    const cmd = argv.includes('--check') ? 'check' : argv[0] ?? 'check';
    try {
        if (cmd === 'check') {
            const errors = runCheck();
            if (errors.length) {
                for (const e of errors) console.error(`[${e.code}] ${e.message}`);
                console.error(`business-spec: ${errors.length} defecto(s)`);
                return 1;
            }
            console.log('business-spec: especificación válida y docs/domain/business-requirements.md al día');
            return 0;
        }
        if (cmd === 'docs') {
            const doc = generateRequirementsDoc(compiled());
            if (argv.includes('--write')) { fs.mkdirSync(path.dirname(DOCS_FILE), { recursive: true }); fs.writeFileSync(DOCS_FILE, doc); console.log(`escrito ${path.relative(REPO, DOCS_FILE)}`); }
            else process.stdout.write(doc);
            return 0;
        }
        if (cmd === 'compile') {
            const out = arg(argv, '--out') ?? 'dist/spec.json';
            fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
            fs.writeFileSync(out, `${JSON.stringify(compiled())}\n`);
            console.log(`escrito ${out}`);
            return 0;
        }
        if (cmd === 'rehearsal-regrade') {
            // E1.1 (ADR 0014): recalifica una medición guardada con el generador y el calificador actuales; sin LLM
            const runs = arg(argv, '--runs');
            const dir = arg(argv, '--snapshots');
            const out = arg(argv, '--out');
            if (!runs || !dir || !out) throw new Error('uso: rehearsal-regrade --runs <medición.json> --snapshots <dir> --out <archivo> [--tool-calls <archivo>]');
            const snapshots: Record<string, TenantSnapshot> = {};
            for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.snapshot.json')).sort()) snapshots[f.replace(/.snapshot.json$/, '')] = loadSnapshot(path.join(dir, f));
            const toolCallsFile = arg(argv, '--tool-calls');
            const toolCalls: StoredToolCalls[] = toolCallsFile ? JSON.parse(fs.readFileSync(toolCallsFile, 'utf8')) : [];
            const report = regradeMeasurement(compiled(), JSON.parse(fs.readFileSync(runs, 'utf8')) as StoredMeasurement, snapshots, toolCalls);
            fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}
`);
            const s = report.summary;
            console.log(`intentos: ${s.attempts} · ${Object.entries(s.byStatus).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
            console.log(`antes: determinista ${s.before.deterministic}, juez ${s.before.judge}, error ${s.before.error}`);
            console.log(`después: determinista ${s.after.deterministic} (aprueba ${s.after.pass}, falla ${s.after.wrong}), necesita juez ${s.after.needsJudge}, sin caso ${s.after.skipped}`);
            for (const c of s.requirementChanges) console.log(`  ${c.intentId}: ${c.from} → ${c.to} (${c.attempts})`);
            for (const c of s.expectationChanges) console.log(`  ${c.intentId} ${c.requirementId}: ${c.from} → ${c.to} (${c.attempts})`);
            console.log(`escrito ${out}`);
            return 0;
        }
        if (cmd === 'rehearsal-agreement') {
            // E1.1: acuerdo del calificador (determinista + «necesita juez») con la revisión humana
            const regraded = arg(argv, '--regraded');
            const labels = arg(argv, '--labels');
            if (!regraded || !labels) throw new Error('uso: rehearsal-agreement --regraded <archivo> --labels <etiquetas.json> [--json]');
            const report = agreementReport(JSON.parse(fs.readFileSync(regraded, 'utf8')) as RegradeReport, JSON.parse(fs.readFileSync(labels, 'utf8')) as HumanLabel[]);
            process.stdout.write(argv.includes('--json') ? `${JSON.stringify(report, null, 2)}
` : renderAgreement(report));
            return 0;
        }
        const snapFile = arg(argv, '--snapshot');
        if (!snapFile) throw new Error('falta --snapshot <archivo>');
        const now = arg(argv, '--now') ? new Date(String(arg(argv, '--now'))) : undefined;
        const spec = compiled();
        const snap = loadSnapshot(snapFile);
        if (cmd === 'report') {
            const result = evaluate(spec, snap, now);
            const format = arg(argv, '--format') ?? 'md';
            process.stdout.write(format === 'json' ? `${JSON.stringify(result, null, 2)}\n` : renderReportMarkdown([result]));
            return 0;
        }
        if (cmd === 'qa-truth') {
            const query = { intent: arg(argv, '--intent'), requirementId: arg(argv, '--requirement'), itemId: arg(argv, '--item') };
            if (!query.intent && !query.requirementId) throw new Error('indica --requirement <ID> [--item <ID>] (o --intent <ID> para listar sus requisitos)');
            // R1.1 F10: la verdad se consulta por requisito (+ ítem); una intención sola lista los requisitos candidatos
            if (!query.requirementId && query.intent && !spec.intents[query.intent]?.conversational) {
                process.stdout.write(`${JSON.stringify({ intent: query.intent, requirements: requirementsForIntent(spec, snap, query.intent, now) }, null, 2)}\n`);
                return 0;
            }
            process.stdout.write(`${JSON.stringify(qaTruth(spec, snap, query, now), null, 2)}\n`);
            return 0;
        }
        if (cmd === 'rehearsal') {
            // R7 (ADR 0013): el banco del ensayo de un tenant; el arnés QA (fase E) lo consume en lugar de generar casos propios
            const langs = arg(argv, '--languages');
            const bank = generateRehearsal(spec, snap, {
                seed: arg(argv, '--seed'), maxCases: arg(argv, '--max') ? Number(arg(argv, '--max')) : undefined,
                languages: langs ? langs.split(',').map(l => l.trim()).filter(Boolean) : undefined, now,
            });
            process.stdout.write(`${JSON.stringify(bank, null, 2)}
`);
            return 0;
        }
        throw new Error(`comando desconocido: ${cmd}`);
    } catch (e) {
        console.error((e as Error).message);
        return 2;
    }
}
