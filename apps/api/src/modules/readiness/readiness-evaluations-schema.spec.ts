import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * `readiness_evaluations` nace en dos sitios: `tenant-schema.sql` (tenant nuevo) y la migración que la crea en
 * los tenants que ya existen. Si divergen, un tenant viejo y uno nuevo guardan historiales distintos. Esta prueba
 * exige la misma definición (columnas, tipos, restricción e índice) y que ReadinessService escriba esas columnas.
 */
const PRISMA = resolve(__dirname, '../../../prisma');
const MIGRATION_DIR = readdirSync(resolve(PRISMA, 'migrations')).find(d => d.endsWith('_add_readiness_evaluations'));

const tableBody = (sql: string) => {
    const m = sql.match(/CREATE TABLE IF NOT EXISTS [^\n]*"readiness_evaluations" \(([\s\S]*?)\n\s*\)/);
    if (!m) throw new Error('sin CREATE TABLE readiness_evaluations');
    return m[1].split('\n').map(l => l.trim().replace(/,$/, '')).filter(Boolean);
};
const indexOf = (sql: string) => (sql.match(/CREATE INDEX IF NOT EXISTS (idx_readiness_evaluations_\w+)\s+ON [^\n]*"readiness_evaluations" \(([^)]*)\)/) ?? []).slice(1);

describe('readiness_evaluations: tenant nuevo = tenant migrado', () => {
    const template = readFileSync(resolve(PRISMA, 'tenant-schema.sql'), 'utf8');
    const migration = readFileSync(resolve(PRISMA, 'migrations', String(MIGRATION_DIR), 'migration.sql'), 'utf8');

    it('la migración existe y es aditiva (sin DROP, ALTER, UPDATE ni DELETE)', () => {
        expect(MIGRATION_DIR).toBeDefined();
        expect(migration.replace(/--.*$/gm, '')).not.toMatch(/\b(DROP|ALTER|UPDATE|DELETE|TRUNCATE|RENAME)\b/i);
    });

    it('las dos definiciones coinciden columna por columna y en el índice', () => {
        expect(tableBody(migration)).toEqual(tableBody(template));
        expect(indexOf(migration)).toEqual(indexOf(template));
        expect(indexOf(template)).toEqual(['idx_readiness_evaluations_created', 'created_at DESC']);
    });

    it('ReadinessService escribe exactamente las columnas que la tabla declara', () => {
        const service = readFileSync(resolve(__dirname, 'readiness.service.ts'), 'utf8');
        const insert = service.match(/INSERT INTO readiness_evaluations \(([^)]*)\)/)?.[1].split(',').map(c => c.trim().replace(/"/g, ''));
        const declared = tableBody(template).filter(l => !l.startsWith('CONSTRAINT')).map(l => l.split(/\s+/)[0].replace(/"/g, ''));
        expect(insert).toBeDefined();
        for (const col of insert ?? []) expect(declared).toContain(col);
        expect(declared.filter(c => !['id', 'created_at'].includes(c)).sort()).toEqual([...(insert ?? [])].sort());
    });
});
