import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EVALUATION_OUTPUT_TABLES } from '../evaluation-revision/evaluation-revision';

/**
 * Las tablas del ensayo (R7, ADR 0013) nacen en dos sitios: `tenant-schema.sql` (tenant nuevo) y la migración que las
 * crea en los tenants que ya existen. Esta prueba exige la misma definición, que la migración sea aditiva, que no
 * toque las tablas de certificación de agentes (`eval_runs`, `eval_scenarios`) y que el ensayo no cuente como
 * dependencia de la evaluación (si contara, cada resultado guardado invalidaría la foto del agente con la que corre).
 */
const PRISMA = resolve(__dirname, '../../../prisma');
const MIGRATION_DIR = readdirSync(resolve(PRISMA, 'migrations')).find(d => d.endsWith('_add_rehearsal_runs'));

const tableBody = (sql: string, table: string) => {
    const m = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS [^\\n]*"${table}" \\(([\\s\\S]*?)\\n\\s*\\)`));
    if (!m) throw new Error(`sin CREATE TABLE ${table}`);
    return m[1].split('\n').map(l => l.trim().replace(/,$/, '')
        .replace(/REFERENCES \S+\."rehearsal_runs"/, 'REFERENCES "rehearsal_runs"')).filter(Boolean);
};
const indexes = (sql: string) => [...sql.matchAll(/CREATE (UNIQUE )?INDEX IF NOT EXISTS (\w+)\s+ON [^\n]*"(rehearsal_\w+)" \(([^)]*)\)/g)]
    .map(m => [m[1] ?? '', m[2], m[3], m[4]]);

describe('rehearsal_runs / rehearsal_results: tenant nuevo = tenant migrado', () => {
    const template = readFileSync(resolve(PRISMA, 'tenant-schema.sql'), 'utf8');
    const migration = readFileSync(resolve(PRISMA, 'migrations', String(MIGRATION_DIR), 'migration.sql'), 'utf8');
    const code = migration.replace(/--.*$/gm, '');

    it('la migración existe, es aditiva y no toca las tablas de certificación', () => {
        expect(MIGRATION_DIR).toBeDefined();
        expect(code.replace(/ON DELETE CASCADE/g, '')).not.toMatch(/\b(DROP|UPDATE|DELETE|TRUNCATE|RENAME|ALTER|INSERT)\b/i);
        expect(code).not.toMatch(/eval_runs|eval_scenarios/);
    });

    it('las dos definiciones coinciden columna por columna y en los índices', () => {
        for (const table of ['rehearsal_runs', 'rehearsal_results']) {
            expect(tableBody(migration, table)).toEqual(tableBody(template, table));
        }
        expect(indexes(migration)).toEqual(indexes(template));
        expect(indexes(template).length).toBe(3);
    });

    it('un resultado por caso y ejecución; resultados y estados cerrados', () => {
        const results = tableBody(template, 'rehearsal_results').join('\n');
        expect(results).toContain('CONSTRAINT rehearsal_results_once UNIQUE (run_id, case_key)');
        expect(results).toContain("CHECK (outcome IN ('answered','missing_data','wrong','inconclusive','error'))");
        expect(tableBody(template, 'rehearsal_runs').join('\n')).toContain("CHECK (status IN ('running','completed','stopped','failed','interrupted'))");
    });

    it('el ensayo es salida de la evaluación, no una dependencia del agente', () => {
        expect(EVALUATION_OUTPUT_TABLES.has('rehearsal_runs')).toBe(true);
        expect(EVALUATION_OUTPUT_TABLES.has('rehearsal_results')).toBe(true);
    });
});
