import * as fs from 'fs';
import * as path from 'path';

/**
 * Una tabla, una definición.
 *
 * Veintisiete tablas tenían su DDL escrito **dos veces**: en
 * `prisma/tenant-schema.sql` y otra vez, a mano, en el `ensureTables` perezoso
 * del módulo que las usa. Dos copias no se mantienen iguales solas, y estas ya
 * habían divergido **en las dos direcciones**:
 *
 * - `orders` en código no tenía la columna `items` que el canónico declara
 *   `JSONB NOT NULL`, y ponía `currency` como `VARCHAR(3)` contra `VARCHAR(10)`.
 * - `campaign_recipients` en código tenía `provider_message_id`, que el
 *   canónico **no** tenía — y el envío de campañas la escribe en cada mensaje.
 *   Para un tenant provisto por el camino canónico (todos los nuevos), el
 *   `CREATE TABLE IF NOT EXISTS` perezoso era un no-op, la columna nunca se
 *   creaba y el primer envío fallaba con "column does not exist".
 *
 * Ése es el modo de falla que hace cara la duplicación: aparece meses después,
 * en un tenant, y no se reproduce en ninguno de los otros.
 */

const API_ROOT = path.join(__dirname, '../../..');
const SQL_PATH = path.join(API_ROOT, 'prisma', 'tenant-schema.sql');

/** Quita comentarios `--` sin tocar lo que vive dentro de comillas. */
function stripLineComments(sql: string): string {
    return sql.split('\n').map((line) => {
        let quoted = false;
        for (let i = 0; i < line.length - 1; i += 1) {
            if (line[i] === '"' || line[i] === "'") quoted = !quoted;
            if (!quoted && line[i] === '-' && line[i + 1] === '-') return line.slice(0, i);
        }
        return line;
    }).join('\n');
}

/** Nombres de columna de un cuerpo `CREATE TABLE`, sin las restricciones. */
function columnsOf(block: string): Set<string> {
    const open = block.indexOf('(');
    let depth = 1;
    let end = block.length;
    for (let i = open + 1; i < block.length; i += 1) {
        if (block[i] === '(') depth += 1;
        else if (block[i] === ')') {
            depth -= 1;
            if (depth === 0) { end = i; break; }
        }
    }
    const body = block.slice(open + 1, end);

    const parts: string[] = [];
    let current = '';
    depth = 0;
    for (const ch of body) {
        if (ch === '(') depth += 1;
        else if (ch === ')') depth -= 1;
        if (ch === ',' && depth === 0) { parts.push(current); current = ''; }
        else current += ch;
    }
    parts.push(current);

    const columns = new Set<string>();
    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const first = trimmed.split(/\s+/)[0].replace(/"/g, '').toLowerCase();
        // Restricciones a nivel de tabla, no columnas.
        if (['primary', 'unique', 'foreign', 'constraint', 'check', 'exclude'].includes(first)) {
            continue;
        }
        columns.add(first);
    }
    return columns;
}

function canonicalTables(): Map<string, Set<string>> {
    const sql = stripLineComments(fs.readFileSync(SQL_PATH, 'utf8'));
    const tables = new Map<string, Set<string>>();

    const createRe = /CREATE TABLE IF NOT EXISTS "\{\{SCHEMA_NAME\}\}"\."([a-z_]+)"\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = createRe.exec(sql)) !== null) {
        tables.set(match[1], columnsOf(sql.slice(match.index)));
    }
    // Un `ADD COLUMN IF NOT EXISTS` posterior es igual de canónico.
    const alterRe = /ALTER TABLE "\{\{SCHEMA_NAME\}\}"\."([a-z_]+)"\s*(?:\n\s*)?ADD COLUMN IF NOT EXISTS "?([a-z_]+)"?/g;
    while ((match = alterRe.exec(sql)) !== null) {
        const existing = tables.get(match[1]) ?? new Set<string>();
        existing.add(match[2]);
        tables.set(match[1], existing);
    }
    return tables;
}

function sourceFiles(dir: string, found: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { sourceFiles(full, found); continue; }
        if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) found.push(full);
    }
    return found;
}

interface Duplicate { table: string; file: string; columns: Set<string> }

function duplicatesInCode(canonical: Map<string, Set<string>>): Duplicate[] {
    const found: Duplicate[] = [];
    for (const file of sourceFiles(path.join(API_ROOT, 'src'))) {
        const source = stripLineComments(fs.readFileSync(file, 'utf8'));
        const re = /CREATE TABLE IF NOT EXISTS\s+"?\$\{[^}]+\}"?\.\s*"?([a-z_]+)"?\s*\(/g;
        let match: RegExpExecArray | null;
        while ((match = re.exec(source)) !== null) {
            const table = match[1];
            if (!canonical.has(table)) continue;
            found.push({
                table,
                file: path.relative(API_ROOT, file).split(path.sep).join('/'),
                columns: columnsOf(source.slice(match.index)),
            });
        }
    }
    return found;
}

describe('una tabla, una definición', () => {
    const canonical = canonicalTables();
    const duplicates = duplicatesInCode(canonical);

    it('el canónico se pudo leer y tiene tablas', () => {
        // Si el parseo falla, todo lo de abajo pasaría sin verificar nada.
        expect(canonical.size).toBeGreaterThan(50);
        expect(canonical.get('orders')).toContain('items');
    });

    it('ninguna copia perezosa le falta una columna del canónico', () => {
        const drift: string[] = [];
        for (const duplicate of duplicates) {
            const missing = [...canonical.get(duplicate.table)!]
                .filter(column => !duplicate.columns.has(column));
            if (missing.length) {
                drift.push(`${duplicate.file} · ${duplicate.table}: falta ${missing.join(', ')}`);
            }
        }
        expect(drift).toEqual([]);
    });

    it('ninguna copia perezosa inventa una columna que el canónico no tiene', () => {
        // Ésta es la dirección que rompe a los tenants NUEVOS: el canónico crea
        // la tabla, el `IF NOT EXISTS` perezoso no hace nada, y la columna que
        // sólo existe en la copia nunca aparece.
        const drift: string[] = [];
        for (const duplicate of duplicates) {
            const extra = [...duplicate.columns]
                .filter(column => !canonical.get(duplicate.table)!.has(column));
            if (extra.length) {
                drift.push(`${duplicate.file} · ${duplicate.table}: sobra ${extra.join(', ')}`);
            }
        }
        expect(drift).toEqual([]);
    });

    it('las tablas que ya se unificaron no vuelven a duplicarse', () => {
        // Estas cuatro se migraron a `ensureCanonicalTables`. Que reaparezca un
        // `CREATE TABLE` propio significa que alguien volvió al patrón viejo.
        const unified = ['products', 'product_categories', 'stock_movements', 'orders', 'order_items', 'campaign_recipients'];
        const regressed = duplicates
            .filter(d => unified.includes(d.table))
            .map(d => `${d.file} · ${d.table}`);
        expect(regressed).toEqual([]);
    });
});
