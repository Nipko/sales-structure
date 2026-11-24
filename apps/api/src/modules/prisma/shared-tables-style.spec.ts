import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { LAZY_CREATE_TABLE_FILE_BASELINE, SHARED_TABLE_NAMES } from './shared-tables';

/**
 * ADR 0034: a shared table is reached by its unqualified name, through the tenant helpers of PrismaService.
 *
 * Two ways of writing SQL break that without any error at runtime, so they are rejected here:
 *
 * - a hand-written tenant qualifier (`"${schema}".table`) reads the tenant's private copy, or fails once the
 *   copy is gone;
 * - a lazy `CREATE TABLE IF NOT EXISTS table` runs with the tenant schema first in `search_path`, so it
 *   creates the table INSIDE the tenant schema, where it shadows the shared one from then on.
 *
 * And one ratchet: the number of files that create tables at runtime can only go down.
 *
 * What this does not see: SQL assembled by concatenating the table name at runtime.
 */
const REPO = resolve(__dirname, '..', '..', '..', '..', '..');
const ROOTS = [join(REPO, 'apps', 'api', 'src'), join(REPO, 'apps', 'whatsapp', 'src')];
const TEMPLATE = join(REPO, 'apps', 'api', 'prisma', 'tenant-schema.sql');

function sources(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist' || name === '__fixtures__') continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) out.push(...sources(full));
        else if (/\.ts$/.test(name) && !/\.(spec|d)\.ts$/.test(name)) out.push(full);
    }
    return out;
}

const escape = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `"${schema}".table`, `"{{SCHEMA_NAME}}"."table"`, `${schema}.table`. */
const qualifiedBySchema = (table: string) =>
    new RegExp(`"?(?:\\$\\{[^}]+\\}|\\{\\{SCHEMA_NAME\\}\\})"?\\s*\\.\\s*"?${escape(table)}"?(?![\\w])`, 'i');

/** `CREATE TABLE [IF NOT EXISTS] [<qualifier>.]table`, except when the qualifier is `shared`. */
const createsTable = (table: string) =>
    new RegExp(`CREATE\\s+(?:UNLOGGED\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?!shared\\s*\\.)(?:"?[\\w${'$'}{}]+"?\\s*\\.\\s*)?"?${escape(table)}"?(?![\\w])`, 'i');

const LAZY_CREATE = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i;

describe('shared tables: how the code may name them (ADR 0034)', () => {
    const files = ROOTS.flatMap(sources).map((file) => ({
        rel: relative(REPO, file).split('\\').join('/'),
        text: readFileSync(file, 'utf8'),
    }));

    it('the sweep sees the code', () => {
        expect(files.length).toBeGreaterThan(500);
        expect(files.some((file) => file.rel === 'apps/api/src/modules/prisma/prisma.service.ts')).toBe(true);
    });

    it('no hand-written tenant qualifier in front of a shared table', () => {
        const offenders = files.flatMap((file) => SHARED_TABLE_NAMES
            .filter((table) => qualifiedBySchema(table).test(file.text))
            .map((table) => `${file.rel}: ${table}`));
        expect(offenders).toEqual([]);
    });

    it('no runtime CREATE TABLE for a shared table', () => {
        const offenders = files.flatMap((file) => SHARED_TABLE_NAMES
            .filter((table) => createsTable(table).test(file.text))
            .map((table) => `${file.rel}: ${table}`));
        expect(offenders).toEqual([]);
    });

    it('the tenant template no longer defines a shared table', () => {
        const template = readFileSync(TEMPLATE, 'utf8');
        expect(SHARED_TABLE_NAMES.filter((table) => createsTable(table).test(template))).toEqual([]);
    });

    it('the files that create tables at runtime only go down', () => {
        const lazy = files.filter((file) => LAZY_CREATE.test(file.text)).map((file) => file.rel).sort();
        // Grew: a new lazy creation site was added. Define the table in a migration (shared) instead.
        // Shrank: lower LAZY_CREATE_TABLE_FILE_BASELINE in shared-tables.ts so the gain is kept.
        expect({ count: lazy.length, files: lazy.length === LAZY_CREATE_TABLE_FILE_BASELINE ? [] : lazy })
            .toEqual({ count: LAZY_CREATE_TABLE_FILE_BASELINE, files: [] });
    });

    it('the patterns recognise the usual forms', () => {
        const q = qualifiedBySchema('turn_traces');
        expect(q.test('SELECT * FROM "${schemaName}".turn_traces WHERE id = $1')).toBe(true);
        expect(q.test('INSERT INTO "${schema}"."turn_traces" (id)')).toBe(true);
        expect(q.test('CREATE TABLE "{{SCHEMA_NAME}}"."turn_traces" (')).toBe(true);
        expect(q.test('SELECT * FROM turn_traces')).toBe(false);
        expect(q.test('SELECT * FROM "${schemaName}".turn_traces_archive')).toBe(false);
        expect(q.test('SELECT * FROM shared.turn_traces')).toBe(false);

        const c = createsTable('turn_traces');
        expect(c.test('CREATE TABLE IF NOT EXISTS turn_traces (id UUID)')).toBe(true);
        expect(c.test('create table if not exists "${schema}"."turn_traces" (')).toBe(true);
        expect(c.test('CREATE TABLE turn_traces (')).toBe(true);
        expect(c.test('CREATE TABLE IF NOT EXISTS shared.turn_traces (')).toBe(false);
        expect(c.test('CREATE TABLE IF NOT EXISTS turn_traces_archive (')).toBe(false);
        expect(c.test('CREATE INDEX IF NOT EXISTS idx ON turn_traces (id)')).toBe(false);
    });
});
