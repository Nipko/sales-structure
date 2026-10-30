/**
 * readiness:report (R1). Lanza con scripts/readiness-report.cjs. Lee las fotos (base de datos de solo lectura o
 * fixtures exportados), corre el motor puro de @parallext/business-spec y escribe JSON + Markdown.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { evaluate, fromLegacyRows, renderReportMarkdown, type LegacyTenantRows, type ReadinessResult } from '@parallext/business-spec';
import { loadSpec } from '@parallext/business-spec/src/load';
import { SnapshotReader, type LegacyTenantRowsDto, type SqlJsonRunner } from '../src/modules/readiness/snapshot-reader';

/** Los 7 tenants QA de la campaña 4300 (C0 §5). */
export const QA_TENANT_SCHEMAS: readonly string[] = [
    'tenant_agencia_qa_viajes_3ec0bcc5462f4a4f9ebf56ea4198b1c8',
    'tenant_inmobiliaria_qa_2b6ded6495084cb198695637a346e974',
    'tenant_salon_qa_citas_e56ec3fef9074970951572191c64d154',
    'tenant_spark_qa_comida_04_bc88cb6777514ef19b308201221b1c38',
    'tenant_spark_qa_dental_03_5f7883f07f09490698006a07dfe82dc7',
    'tenant_spark_qa_hotel_09_22140a6ff60844809574a62c5f53d37f',
    'tenant_tienda_qa_electronica_523dea39d9104d91acd4f31a2aa76d23',
];

/** Ejecuta SQL de solo lectura con un comando psql externo (stdin → una línea JSON). */
export function psqlRunner(command: string): SqlJsonRunner {
    return {
        async queryJson<T>(sql: string): Promise<T> {
            // jsonb::text deja el valor en una sola línea aunque json_agg meta saltos de línea.
            const input = `SET default_transaction_read_only = on;\nSELECT q.v::jsonb::text FROM (${sql.trim().replace(/;\s*$/, '')}) AS q(v);\n`;
            const res = spawnSync(command, { input, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
            if (res.status !== 0) throw new Error(`psql falló (${res.status}): ${res.stderr?.trim()}`);
            const line = res.stdout.split(/\r?\n/).reverse().find(l => /^[[{]/.test(l.trim()));
            if (!line) throw new Error(`psql no devolvió JSON: ${res.stdout.slice(0, 200)}`);
            return JSON.parse(line) as T;
        },
    };
}

/** Anonimiza los contactos y deja de la configuración solo lo que lee el motor (C0 §5, riesgos de R1). */
export function anonymiseRows(rows: LegacyTenantRowsDto): LegacyTenantRowsDto {
    const copy = JSON.parse(JSON.stringify(rows)) as LegacyTenantRowsDto;
    const ids = new Map<string, string>();
    const anonId = (id: unknown) => {
        const k = String(id);
        if (!ids.has(k)) ids.set(k, `user-${ids.size + 1}`);
        return ids.get(k) as string;
    };
    const s = copy.tenant.settings ?? {};
    const draft = s.businessInfoDraft ?? {};
    copy.tenant.settings = {
        subType: s.subType, customerTypes: s.customerTypes, businessHours: s.businessHours, bookingEnabled: s.bookingEnabled,
        verticalProvisioning: s.verticalProvisioning ? { completedAt: s.verticalProvisioning.completedAt } : undefined,
        businessInfoDraft: { about: draft.about, description: draft.description },
    };
    copy.tenant.ref = copy.tenant.slug;
    for (const c of copy.companies) {
        if (c.phone) c.phone = '+57 300 000 0000';
        if (c.email) c.email = 'contacto@example.test';
        if (c.website) c.website = 'https://example.test';
        if (c.social_links && typeof c.social_links === 'object') for (const k of Object.keys(c.social_links)) if (c.social_links[k]) c.social_links[k] = `https://example.test/${k}`;
        if (c.address) c.address = 'Calle 1 # 2-3';
    }
    copy.users = copy.users.map(u => ({ ...u, id: anonId(u.id) }));
    for (const s2 of copy.availability_slots) s2.user_id = anonId(s2.user_id);
    for (const s3 of copy.service_staff) s3.user_id = anonId(s3.user_id);
    return copy;
}

function arg(argv: string[], name: string): string | undefined {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
}

export async function main(argv: string[]): Promise<void> {
    const spec = loadSpec();
    const fixtures = arg(argv, '--fixtures');
    const exportDir = arg(argv, '--export-fixtures');
    const outMd = arg(argv, '--out-md');
    const outJson = arg(argv, '--out-json');
    const format = arg(argv, '--format') ?? 'both';
    const rowsList: LegacyTenantRowsDto[] = [];

    if (fixtures) {
        for (const f of fs.readdirSync(fixtures).filter(x => x.endsWith('.snapshot.json')).sort()) {
            rowsList.push(JSON.parse(fs.readFileSync(path.join(fixtures, f), 'utf8')));
        }
    } else {
        const psql = arg(argv, '--psql') ?? process.env.READINESS_PSQL;
        if (!psql) throw new Error('falta --psql "<comando>" (o READINESS_PSQL) o --fixtures <dir>');
        const schemas = argv.includes('--all-qa') ? QA_TENANT_SCHEMAS : [arg(argv, '--tenant')].filter((x): x is string => Boolean(x));
        if (!schemas.length) throw new Error('indica --tenant <schema> o --all-qa');
        const reader = new SnapshotReader(psqlRunner(psql));
        for (const schema of schemas) rowsList.push(anonymiseRows(await reader.readRows(schema)));
    }

    const results: ReadinessResult[] = [];
    const timings: string[] = [];
    for (const rows of rowsList) {
        const t0 = Date.now();
        const snap = fromLegacyRows(rows as unknown as LegacyTenantRows);
        const result = evaluate(spec, snap);
        timings.push(`${rows.tenant.slug}: ${Date.now() - t0} ms`);
        results.push(result);
        if (exportDir) {
            fs.mkdirSync(exportDir, { recursive: true });
            fs.writeFileSync(path.join(exportDir, `${rows.tenant.slug}.snapshot.json`), `${JSON.stringify(rows, null, 2)}\n`);
        }
    }

    const md = renderReportMarkdown(results);
    if (outMd) fs.writeFileSync(outMd, md);
    if (outJson) fs.writeFileSync(outJson, `${JSON.stringify(results, null, 2)}\n`);
    if (!outMd && format !== 'json') process.stdout.write(md);
    if (!outJson && format !== 'md') process.stdout.write(`${JSON.stringify(results.map(r => ({ tenant: r.tenant, verdict: r.verdict, counts: r.counts, blockingGaps: r.blockingGaps, resultHash: r.resultHash })), null, 2)}\n`);
    process.stderr.write(`tiempos: ${timings.join(' · ')}\n`);
}
