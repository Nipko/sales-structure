import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROVENANCE_ORIGINS, PROVENANCE_TABLES } from '@parallext/business-spec';

/**
 * `requirement_values`, `requirement_value_versions` y las columnas de procedencia nacen en dos sitios:
 * `tenant-schema.sql` (tenant nuevo) y la migración que los agrega en los tenants que ya existen. Si divergen, un
 * tenant viejo y uno nuevo guardan la procedencia distinto. Esta prueba exige la misma definición, que la lista de
 * tablas con procedencia sea la del paquete (PROVENANCE_TABLES, que usan la lectura y la migración de datos) y que la
 * migración sea aditiva (expand).
 */
const PRISMA = resolve(__dirname, '../../../prisma');
const MIGRATION_DIR = readdirSync(resolve(PRISMA, 'migrations')).find(d => d.endsWith('_add_business_facts_provenance'));

const tableBody = (sql: string, table: string) => {
    const m = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS [^\\n]*"${table}" \\(([\\s\\S]*?)\\n\\s*\\)`));
    if (!m) throw new Error(`sin CREATE TABLE ${table}`);
    return m[1].split('\n').map(l => l.trim().replace(/,$/, '')).filter(Boolean);
};
const indexOf = (sql: string) => (sql.match(/CREATE INDEX IF NOT EXISTS (idx_requirement_value_versions_\w+)\s+ON [^\n]*"requirement_value_versions" \(([^)]*)\)/) ?? []).slice(1);

/** tabla → definiciones de columna de procedencia en tenant-schema.sql. */
function templateColumns(sql: string): Record<string, string[]> {
    const block = sql.slice(sql.indexOf('-- BEGIN PROVENANCE COLUMNS'), sql.indexOf('-- END PROVENANCE COLUMNS'));
    const out: Record<string, string[]> = {};
    for (const m of block.matchAll(/ALTER TABLE "\{\{SCHEMA_NAME\}\}"\."(\w+)" ADD COLUMN IF NOT EXISTS (.+);/g)) (out[m[1]] ??= []).push(m[2].trim());
    return out;
}

/** Lo mismo, como lo aplica la migración (bucle sobre un arreglo de tablas con excepciones por tipo). */
function migrationColumns(sql: string): Record<string, string[]> {
    const tables = (sql.match(/FOREACH tbl IN ARRAY ARRAY\[([^\]]*)\]/)?.[1] ?? '').split(',').map(s => s.trim().replace(/'/g, ''));
    const lines = [...sql.matchAll(/(?:(IF tbl NOT IN \(([^)]*)\) THEN)\s*)?EXECUTE format\(\$ddl\$ ALTER TABLE %s\.%I ADD COLUMN IF NOT EXISTS (.+?) \$ddl\$, target, tbl\);/g)]
        .map(m => ({ except: (m[2] ?? '').split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean), def: m[3].trim() }));
    const out: Record<string, string[]> = {};
    for (const t of tables) out[t] = lines.filter(l => !l.except.includes(t)).map(l => l.def);
    return out;
}

describe('requirement_values y columnas de procedencia: tenant nuevo = tenant migrado', () => {
    const template = readFileSync(resolve(PRISMA, 'tenant-schema.sql'), 'utf8');
    const migration = readFileSync(resolve(PRISMA, 'migrations', String(MIGRATION_DIR), 'migration.sql'), 'utf8');

    it('la migración existe y es aditiva: crea y agrega columnas, nunca borra, renombra ni escribe filas', () => {
        expect(MIGRATION_DIR).toBeDefined();
        const code = migration.replace(/--.*$/gm, '');
        expect(code).not.toMatch(/\b(DROP|UPDATE|DELETE|TRUNCATE|RENAME|INSERT)\b/i);
        for (const alter of code.match(/ALTER TABLE[^$]*/g) ?? []) expect(alter).toMatch(/^ALTER TABLE %s\.%I ADD COLUMN IF NOT EXISTS /);
    });

    it.each(['requirement_values', 'requirement_value_versions'])('%s: las dos definiciones coinciden columna por columna', table => {
        expect(tableBody(migration, table)).toEqual(tableBody(template, table));
    });

    it('el índice del historial coincide', () => {
        expect(indexOf(migration)).toEqual(indexOf(template));
        expect(indexOf(template)).toEqual(['idx_requirement_value_versions_requirement', 'requirement_id, scope_key, created_at DESC']);
    });

    it('los orígenes permitidos por la tabla son los del paquete', () => {
        const check = template.match(/CONSTRAINT requirement_values_origin CHECK \(origin IN \(([^)]*)\)\)/)?.[1];
        expect(check?.split(',').map(s => s.trim().replace(/'/g, '')).sort()).toEqual([...PROVENANCE_ORIGINS].sort());
    });

    it('las columnas de procedencia son las mismas en las dos definiciones y en PROVENANCE_TABLES', () => {
        const tpl = templateColumns(template);
        expect(migrationColumns(migration)).toEqual(tpl);
        expect(Object.keys(tpl).sort()).toEqual(Object.keys(PROVENANCE_TABLES).sort());
        for (const [table, cfg] of Object.entries(PROVENANCE_TABLES)) {
            const names = tpl[table].map(d => d.match(/^"(\w+)"/)?.[1]);
            const expected = ['content_status', 'origin', 'confirmed_by', 'confirmed_at', 'source_ref',
                ...(cfg.kind === 'item' ? ['price_type'] : []), ...(cfg.kind === 'item' && !cfg.legacyPriceStatus ? ['price_status'] : [])];
            expect(names).toEqual(expected);
        }
    });

    it('cada tabla con procedencia existe en tenant-schema.sql (nombres verificados, C0 §2.2)', () => {
        for (const table of Object.keys(PROVENANCE_TABLES)) expect(template).toContain(`CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."${table}" (`);
    });
});
