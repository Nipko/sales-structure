import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * C0 §2.1 y riesgo de R3: «toda escritura pasa por BusinessFactsService.write(); escribir por SQL directo está
 * prohibido». Este barrido lista cada INSERT y UPDATE sobre `requirement_values` en el código de la API (src y
 * scripts) y falla si alguno vive fuera de business-facts.service.ts. `requirement_value_versions` es append-only:
 * su único INSERT es el de ese mismo archivo, y no puede haber UPDATE ni DELETE en ningún lado.
 *
 * Lo que no ve, dicho en voz alta: SQL armado concatenando el nombre de la tabla en tiempo de ejecución. Nadie lo
 * hace hoy; si alguien lo hiciera para esquivar esta prueba, la revisión es la que lo tiene que parar.
 */
const API = resolve(__dirname, '..', '..', '..');
const ROOTS = [join(API, 'src'), join(API, 'scripts'), join(API, 'prisma')];
const OWNER = join('src', 'modules', 'readiness', 'business-facts.service.ts');
const SELF = join('src', 'modules', 'readiness', 'business-facts-writes.spec.ts');

function files(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist') continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) out.push(...files(full));
        else if (/\.(ts|js|cjs|mjs|sql)$/.test(name)) out.push(full);
    }
    return out;
}

const WRITE_VALUES = /\b(INSERT\s+INTO|UPDATE)\s+(?:"?[\w{}]+"?\.)?"?requirement_values"?(?=[\s(]|$)/gi;
const INSERT_VERSIONS = /\bINSERT\s+INTO\s+(?:"?[\w{}]+"?\.)?"?requirement_value_versions"?/gi;
const MUTATE_VERSIONS = /\b(UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+(?:"?[\w{}]+"?\.)?"?requirement_value_versions"?/gi;

describe('requirement_values: solo escribe BusinessFactsService', () => {
    const all = ROOTS.flatMap(files).map(f => ({ rel: relative(API, f).split('/').join(sep), text: readFileSync(f, 'utf8') }));

    it('el barrido ve el código (y la sentencia de escritura del servicio)', () => {
        expect(all.length).toBeGreaterThan(500);
        const owner = all.find(f => f.rel === OWNER);
        expect(owner?.text.match(WRITE_VALUES)?.length).toBeGreaterThan(0);
        expect(owner?.text.match(INSERT_VERSIONS)?.length).toBe(1);
    });

    it('ningún INSERT ni UPDATE sobre requirement_values fuera de business-facts.service.ts', () => {
        const offenders = all.filter(f => f.rel !== OWNER && f.rel !== SELF && (f.text.match(WRITE_VALUES)?.length ?? 0) > 0)
            .map(f => `${f.rel}: ${f.text.match(WRITE_VALUES)?.join(' | ')}`);
        expect(offenders).toEqual([]);
    });

    it('requirement_value_versions es append-only: un solo INSERT (el del servicio) y ningún UPDATE, DELETE ni TRUNCATE', () => {
        const inserts = all.filter(f => f.rel !== OWNER && f.rel !== SELF && (f.text.match(INSERT_VERSIONS)?.length ?? 0) > 0).map(f => f.rel);
        const mutations = all.filter(f => f.rel !== SELF && (f.text.match(MUTATE_VERSIONS)?.length ?? 0) > 0).map(f => f.rel);
        expect(inserts).toEqual([]);
        expect(mutations).toEqual([]);
    });

    it('el patrón reconoce las formas habituales', () => {
        const hits = (s: string) => (s.match(WRITE_VALUES) ?? []).length;
        expect(hits('INSERT INTO requirement_values (a) VALUES (1)')).toBe(1);
        expect(hits('update "tenant_x"."requirement_values" set a = 1')).toBe(1);
        expect(hits('UPDATE requirement_values\n SET value = $1')).toBe(1);
        expect(hits('SELECT * FROM requirement_values')).toBe(0);
        expect(hits('INSERT INTO requirement_value_versions (a)')).toBe(0);
    });
});
