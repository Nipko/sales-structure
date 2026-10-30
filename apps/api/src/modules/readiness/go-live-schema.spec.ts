import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * El control de salida (R4, ADR 0010) nace en dos sitios: `tenant-schema.sql` (tenant nuevo) y la migración que crea
 * `go_live_decisions` en los tenants que ya existen y las columnas `go_live_*` de `public.tenants`. Si divergen, un
 * tenant viejo y uno nuevo registran decisiones distintas. Esta prueba exige la misma definición, que la migración sea
 * aditiva y que GoLiveService escriba exactamente esas columnas.
 */
const PRISMA = resolve(__dirname, '../../../prisma');
const MIGRATION_DIR = readdirSync(resolve(PRISMA, 'migrations')).find(d => d.endsWith('_add_go_live_gate'));

const tableBody = (sql: string) => {
    const m = sql.match(/CREATE TABLE IF NOT EXISTS [^\n]*"go_live_decisions" \(([\s\S]*?)\n\s*\)/);
    if (!m) throw new Error('sin CREATE TABLE go_live_decisions');
    return m[1].split('\n').map(l => l.trim().replace(/,$/, '')).filter(Boolean);
};
const indexOf = (sql: string) => (sql.match(/CREATE INDEX IF NOT EXISTS (idx_go_live_decisions_\w+)\s+ON [^\n]*"go_live_decisions" \(([^)]*)\)/) ?? []).slice(1);

describe('go_live: tenant nuevo = tenant migrado', () => {
    const template = readFileSync(resolve(PRISMA, 'tenant-schema.sql'), 'utf8');
    const migration = readFileSync(resolve(PRISMA, 'migrations', String(MIGRATION_DIR), 'migration.sql'), 'utf8');
    const code = migration.replace(/--.*$/gm, '');

    it('la migración existe y es aditiva (solo ADD COLUMN / ADD CONSTRAINT / CREATE; sin DROP, UPDATE ni DELETE)', () => {
        expect(MIGRATION_DIR).toBeDefined();
        expect(code).not.toMatch(/\b(DROP|UPDATE|DELETE|TRUNCATE|RENAME)\b/i);
        for (const alter of code.match(/ALTER TABLE[^;]*;/g) ?? []) expect(alter).toMatch(/ADD (COLUMN IF NOT EXISTS|CONSTRAINT)/);
        // todos los tenants arrancan sin publicar
        expect(code).toMatch(/"go_live_state" VARCHAR\(8\) NOT NULL DEFAULT 'off'/);
    });

    it('las dos definiciones de go_live_decisions coinciden columna por columna y en el índice', () => {
        expect(tableBody(migration)).toEqual(tableBody(template));
        expect(indexOf(migration)).toEqual(indexOf(template));
        expect(indexOf(template)).toEqual(['idx_go_live_decisions_created', 'created_at DESC']);
    });

    it('GoLiveService escribe exactamente las columnas que la tabla declara y lee las de tenants que la migración agrega', () => {
        const service = readFileSync(resolve(__dirname, 'go-live.service.ts'), 'utf8');
        const insert = service.match(/INSERT INTO go_live_decisions \(([^)]*)\)/)?.[1].split(',').map(c => c.trim());
        const declared = tableBody(template).filter(l => !l.startsWith('CONSTRAINT')).map(l => l.split(/\s+/)[0]);
        expect(declared.filter(c => !['id', 'created_at'].includes(c)).sort()).toEqual([...(insert ?? [])].sort());
        for (const col of ['go_live_state', 'go_live_at', 'go_live_by', 'go_live_spec_version', 'go_live_ack']) {
            expect(code).toContain(`"${col}"`);
            expect(service).toContain(col);
        }
        const prisma = readFileSync(resolve(PRISMA, 'schema.prisma'), 'utf8');
        for (const col of ['go_live_state', 'go_live_at', 'go_live_by', 'go_live_spec_version', 'go_live_ack']) expect(prisma).toContain(`@map("${col}")`);
    });
});
