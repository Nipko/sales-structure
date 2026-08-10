#!/usr/bin/env node
/**
 * Audita los casts `::uuid` del SQL crudo contra el tipo REAL de cada columna.
 *
 * Existe porque esta clase de error llegó a producción tres veces, y ninguna se
 * ve desde la app:
 *
 *   42883  operator does not exist: character varying = uuid
 *          -> `WHERE col = $1::uuid` sobre una columna VARCHAR. Postgres no tiene
 *             ese operador y tumba la consulta entera. Paso con el filtro "Mias"
 *             del inbox (conversations.assigned_to), con las alertas de analytics
 *             y con los reportes programados (tenant_id VARCHAR en esas tablas).
 *
 *   22P02  invalid input syntax for type uuid: "860048121"
 *          -> se caseó un valor que no es UUID (un id externo de canal).
 *
 * Matiz que el auditor respeta a propósito: `UPDATE t SET col = $1::uuid` sobre
 * una columna de texto SI funciona — Postgres aplica un cast de ASIGNACION hacia
 * tipos texto. Lo que no existe es el operador de COMPARACION. Aun así conviene
 * no escribirlo, porque invita a replicar el patrón en un WHERE.
 *
 * Los tipos se leen de tres fuentes, porque el esquema vive repartido:
 *   1. prisma/tenant-schema.sql        — tablas por tenant
 *   2. prisma/migrations/../*.sql      — tablas globales (schema.prisma declara
 *                                        los ids como String sin @db.Uuid, así que
 *                                        NO sirve para esto: el DDL real es UUID)
 *   3. CREATE TABLE dentro de los .ts  — tablas creadas en runtime (widget_*,
 *                                        push_subscriptions, email_channel_configs…)
 *
 * Uso:  node scripts/audit-uuid-casts.js
 * Sale con código 1 si encuentra desajustes, para poder colgarlo de CI.
 */
const fs = require('fs');
const path = require('path');

const API = path.resolve(__dirname, '..');
const colType = new Map(); // "tabla.columna" -> 'UUID' | 'TEXT'

const setType = (table, col, rawType, { overwrite = true } = {}) => {
    const key = `${table}.${col}`;
    if (!overwrite && colType.has(key)) return;
    colType.set(key, /^UUID$/i.test(rawType) ? 'UUID' : 'TEXT');
};

const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else out.push(p);
    }
    return out;
};

// ---- 1. schema por tenant ----
{
    const sql = fs.readFileSync(path.join(API, 'prisma/tenant-schema.sql'), 'utf8');
    let table = null;
    for (const line of sql.split('\n')) {
        let m = line.match(/CREATE TABLE IF NOT EXISTS "\{\{SCHEMA_NAME\}\}"\."(\w+)"/);
        if (m) { table = m[1]; continue; }
        if (table && /^\s*\)\s*;/.test(line)) { table = null; continue; }
        if (table && (m = line.match(/^\s*"?(\w+)"?\s+(UUID|VARCHAR|TEXT|CHAR)/i))) setType(table, m[1], m[2]);
        if ((m = line.match(/ALTER TABLE "\{\{SCHEMA_NAME\}\}"\."(\w+)"\s+ADD COLUMN IF NOT EXISTS "(\w+)"\s+(UUID|VARCHAR|TEXT)/i))) {
            setType(m[1], m[2], m[3]);
        }
    }
}

// ---- 2. migraciones (tablas globales) ----
{
    const migDir = path.join(API, 'prisma/migrations');
    if (fs.existsSync(migDir)) {
        for (const f of walk(migDir).filter((f) => f.endsWith('.sql'))) {
            let table = null;
            for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
                let m = line.match(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?(?:public"?\."?)?(\w+)"?\s*\(/i);
                if (m) { table = m[1]; continue; }
                if (table && /^\s*\)/.test(line)) { table = null; continue; }
                if (table && (m = line.match(/^\s*"(\w+)"\s+(UUID|TEXT|VARCHAR|CHAR)/i))) setType(table, m[1], m[2]);
                if ((m = line.match(/ALTER TABLE\s+"?(?:public"?\."?)?(\w+)"?\s+ADD COLUMN(?:\s+IF NOT EXISTS)?\s+"(\w+)"\s+(UUID|TEXT|VARCHAR)/i))) {
                    setType(m[1], m[2], m[3]);
                }
            }
        }
    }
}

// ---- 3. tablas creadas en runtime dentro del código ----
const tsFiles = walk(path.join(API, 'src')).filter((f) => f.endsWith('.ts'));
for (const f of tsFiles) {
    const txt = fs.readFileSync(f, 'utf8');
    const createRe = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(?:"?\$\{\w+\}"?\.)?(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\)\s*`/g;
    let m;
    while ((m = createRe.exec(txt))) {
        const table = m[1];
        for (const c of m[2].matchAll(/^\s*"?(\w+)"?\s+(UUID|TEXT|VARCHAR|CHAR)/gim)) {
            setType(table, c[1], c[2], { overwrite: false });
        }
    }
    for (const a of txt.matchAll(/ALTER TABLE\s+(?:"?\$\{\w+\}"?\.)?(?:public\.)?"?(\w+)"?\s+ADD COLUMN(?:\s+IF NOT EXISTS)?\s+"?(\w+)"?\s+(UUID|TEXT|VARCHAR)/gi)) {
        setType(a[1], a[2], a[3], { overwrite: false });
    }
}

// ---- recorrido del código ----
const mismatches = [];
const unresolved = [];
let okCount = 0;

for (const f of tsFiles.filter((f) => !f.endsWith('.spec.ts'))) {
    const txt = fs.readFileSync(f, 'utf8');
    for (const m of txt.matchAll(/(?:(\w+)\.)?(\w+)\s*=\s*\$\d+::uuid/g)) {
        const [alias, col] = [m[1], m[2]];
        const win = txt.slice(Math.max(0, m.index - 1600), m.index);

        const aliases = new Map();
        let lastTable = null;
        for (const t of win.matchAll(/(?:FROM|JOIN|UPDATE|INSERT\s+INTO)\s+(?:public\.)?(?:"[^"]*"\.)?"?(\w+)"?(?:\s+(?:AS\s+)?(\w+))?/gi)) {
            const [tb, al] = [t[1], t[2]];
            if (/^(SELECT|WHERE|SET|VALUES)$/i.test(tb)) continue;
            lastTable = tb;
            if (al && !/^(ON|SET|WHERE|VALUES|AS|LEFT|INNER|RIGHT|JOIN|USING|RETURNING|ORDER|GROUP|LIMIT)$/i.test(al)) {
                aliases.set(al, tb);
            }
        }
        const table = (alias && aliases.get(alias)) || lastTable;
        if (!table) continue;

        const rel = path.relative(API, f).replace(/\\/g, '/');
        const line = txt.slice(0, m.index).split('\n').length;
        const key = `${table}.${col}`;
        if (!colType.has(key)) unresolved.push({ rel, line, table, col });
        else if (colType.get(key) === 'UUID') okCount++;
        else mismatches.push({ rel, line, table, col });
    }
}

console.log(`Columnas indexadas : ${colType.size}`);
console.log(`Casts correctos    : ${okCount}`);
console.log(`Sin resolver       : ${unresolved.length} (tabla o columna no indexada)`);
console.log(`DESAJUSTES         : ${mismatches.length}`);
if (mismatches.length) {
    console.log('\nColumnas de TEXTO comparadas contra ::uuid:\n');
    for (const b of mismatches) console.log(`  ${b.rel}:${b.line}  ${b.table}.${b.col}`);
    console.log('\nQuitar el ::uuid del parámetro: esa columna no es UUID.');
    process.exit(1);
}
console.log('\nSin desajustes.');
