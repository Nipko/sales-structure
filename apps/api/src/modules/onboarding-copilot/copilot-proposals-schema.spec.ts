import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Las columnas del copiloto en `agent_content_proposals` y el invariante de `requirement_values` (R6, ADR 0012) nacen en
 * dos sitios: `tenant-schema.sql` (tenant nuevo, y la reparación en caliente de `ensureContentProposalSchema`) y la
 * migración que los agrega en los tenants que ya existen. Esta prueba exige la misma definición y que la migración sea
 * aditiva: columnas nuevas, un CHECK de estado más ancho y un CHECK nuevo; ni una fila escrita ni una columna borrada.
 */
const PRISMA = resolve(__dirname, '../../../prisma');
const MIGRATION_DIR = readdirSync(resolve(PRISMA, 'migrations')).find(d => d.endsWith('_extend_agent_content_proposals_copilot'));

const columns = (sql: string) => [...sql.matchAll(/"agent_content_proposals" ADD COLUMN IF NOT EXISTS ("\w+" [A-Z]+)/g)].map(m => m[1]);
const checkOf = (sql: string, name: string) => sql.match(new RegExp(`ADD CONSTRAINT "${name}" (CHECK \\(.*?\\)\\)(?: NOT VALID)?)`))?.[1];
const indexOf = (sql: string) => sql.match(/CREATE INDEX IF NOT EXISTS "idx_agent_content_proposals_requirement"\s+ON [^\n]*"agent_content_proposals" \(([^)]*)\)/)?.[1];

describe('agent_content_proposals del copiloto: tenant nuevo = tenant migrado', () => {
    const template = readFileSync(resolve(PRISMA, 'tenant-schema.sql'), 'utf8');
    const migration = readFileSync(resolve(PRISMA, 'migrations', String(MIGRATION_DIR), 'migration.sql'), 'utf8');
    const code = migration.replace(/--.*$/gm, '');

    it('la migración existe y es aditiva: no escribe filas ni borra columnas; solo reemplaza el CHECK de estado', () => {
        expect(MIGRATION_DIR).toBeDefined();
        expect(code).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE|RENAME|INSERT)\b/i);
        expect(code).not.toMatch(/DROP (COLUMN|TABLE)/i);
        expect([...code.matchAll(/DROP CONSTRAINT IF EXISTS "(\w+)"/g)].map(m => m[1])).toEqual(['agent_content_proposals_status_check']);
    });

    it('las mismas columnas, el mismo CHECK de estado, el mismo índice y el mismo invariante en las dos definiciones', () => {
        expect(columns(migration)).toEqual(columns(template));
        expect(columns(template)).toEqual([
            '"requirement_id" TEXT', '"target_ref" TEXT', '"evidence" JSONB', '"extraction_run_id" UUID',
            '"decided_by" UUID', '"decided_at" TIMESTAMPTZ', '"decision_note" TEXT',
        ]);
        expect(checkOf(migration, 'agent_content_proposals_status_r6')).toBe(checkOf(template, 'agent_content_proposals_status_r6'));
        expect(checkOf(template, 'agent_content_proposals_status_r6')).toBe(`CHECK ("status" IN ('proposed','applied','expired','rejected','superseded'))`);
        expect(indexOf(migration)).toBe(indexOf(template));
        expect(checkOf(migration, 'requirement_values_copilot_confirmed')).toBe(checkOf(template, 'requirement_values_copilot_confirmed'));
        expect(checkOf(template, 'requirement_values_copilot_confirmed'))
            .toBe(`CHECK ("origin" <> 'copilot' OR ("status" = 'confirmed' AND "confirmed_by" IS NOT NULL)) NOT VALID`);
    });

    it('la reparación en caliente las alcanza: cada sentencia del bloque nombra la tabla', () => {
        const block = template.slice(template.indexOf('-- BEGIN COPILOT PROPOSALS'), template.indexOf('-- END COPILOT PROPOSALS'));
        const code = block.replace(/--.*$/gm, '');
        // un bloque DO es una sola sentencia (el separador de PrismaService respeta las comillas $tag$)
        const doBlocks = [...code.matchAll(/DO \$(\w+)\$[\s\S]*?\$\1\$;/g)].map(m => m[0]);
        const rest = doBlocks.reduce((acc, b) => acc.replace(b, ''), code);
        const statements = [...doBlocks, ...rest.split(/;\s*\n/).map(s => s.trim()).filter(Boolean)];
        expect(doBlocks).toHaveLength(1);
        expect(statements.length).toBe(9);
        for (const st of statements) expect(st).toContain('."agent_content_proposals"');
    });

    it('el motor no lee propuestas: ni la foto (API) ni el paquete consultan agent_content_proposals', () => {
        const dirs = [resolve(__dirname, '../readiness'), resolve(__dirname, '../../../../../packages/business-spec/src')];
        const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
            .flatMap(e => (e.isDirectory() ? walk(resolve(dir, e.name)) : /\.ts$/.test(e.name) && !/\.spec\.ts$/.test(e.name) ? [resolve(dir, e.name)] : []));
        const files = dirs.flatMap(walk);
        expect(files.some(f => f.endsWith('snapshot-reader.ts'))).toBe(true);
        expect(files.filter(f => readFileSync(f, 'utf8').includes('agent_content_proposals'))).toEqual([]);
    });
});
