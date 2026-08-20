import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';

/**
 * Cada consulta lleva tantos parámetros como marcadores tiene.
 *
 * Esta guarda nació de un corte real: la exportación iCal por OTA elegía el SQL
 * con un ternario y dejaba los parámetros fijos en `[propertyId]`. La rama con
 * exclusión usa `$2`, así que Postgres rechazaba cada pedido de Airbnb con un
 * 500 y el calendario no se podía conectar.
 *
 * Nada lo veía: `tsc` no mira dentro de un template string, el linter tampoco, y
 * los tests comparaban el TEXTO del SQL sin ejecutarlo. Fue la segunda vez en
 * dos días que un SQL editado por script se rompía en silencio.
 *
 * Sólo se juzgan las consultas con SQL literal Y array literal: lo interpolado o
 * pasado por variable no se puede contar sin ejecutar, y un falso positivo acá
 * enseñaría a ignorar el test.
 */

const SRC = resolve(__dirname, '../..');

function archivosTs(dir: string, acc: string[] = []): string[] {
    for (const nombre of readdirSync(dir)) {
        const p = join(dir, nombre);
        if (statSync(p).isDirectory()) {
            if (nombre !== 'node_modules') archivosTs(p, acc);
        } else if (nombre.endsWith('.ts') && !nombre.endsWith('.spec.ts')) {
            acc.push(p);
        }
    }
    return acc;
}

/** Lee un literal balanceado desde `abre`, respetando comillas. */
function leerBalanceado(s: string, i: number): string | null {
    let depth = 0, enStr = false, q = '';
    for (let j = i; j < s.length; j++) {
        const ch = s[j];
        if (enStr) {
            if (ch === '\\') { j++; continue; }
            if (ch === q) enStr = false;
            continue;
        }
        if (ch === "'" || ch === '"' || ch === '`') { enStr = true; q = ch; continue; }
        if ('([{'.includes(ch)) depth++;
        else if (')]}'.includes(ch)) {
            depth--;
            if (depth === 0) return s.slice(i + 1, j);
        }
    }
    return null;
}

/** Parte por comas de primer nivel, ignorando comentarios de línea. */
function partirArgs(txt: string): string[] {
    const sinComentarios = txt.replace(/\/\/[^\n]*/g, '');
    let depth = 0, cur = '', enStr = false, q = '';
    const items: string[] = [];
    for (const ch of sinComentarios) {
        if (enStr) {
            cur += ch;
            if (ch === q) enStr = false;
            continue;
        }
        if (ch === "'" || ch === '"' || ch === '`') { enStr = true; q = ch; }
        if ('([{'.includes(ch)) depth++;
        if (')]}'.includes(ch)) depth--;
        if (ch === ',' && depth === 0) { items.push(cur.trim()); cur = ''; }
        else cur += ch;
    }
    if (cur.trim()) items.push(cur.trim());
    return items.filter(Boolean);
}

interface Hallazgo { archivo: string; linea: number; marcadores: number; params: number; sql: string }

function auditar(): { comparadas: number; hallazgos: Hallazgo[] } {
    const hallazgos: Hallazgo[] = [];
    let comparadas = 0;
    const inicio = /executeInTenantSchema(?:<[^>]*>)?\(\s*[A-Za-z_.]+,\s*`/g;

    for (const archivo of archivosTs(SRC)) {
        const s = readFileSync(archivo, 'utf8');
        inicio.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = inicio.exec(s)) !== null) {
            const finSql = s.indexOf('`', m.index + m[0].length);
            if (finSql < 0) continue;
            const sql = s.slice(m.index + m[0].length, finSql);
            if (sql.includes('${')) continue; // interpolado: no comparable

            // El array tiene que venir inmediatamente después del SQL.
            const entre = s.slice(finSql + 1, finSql + 60);
            const rel = entre.search(/\[/);
            if (rel < 0 || !/^\s*,\s*$/.test(entre.slice(0, rel))) continue;

            const cuerpo = leerBalanceado(s, finSql + 1 + rel);
            if (cuerpo === null) continue;

            const marcadores = new Set(sql.match(/\$\d+/g) || []);
            if (marcadores.size === 0) continue;
            const params = partirArgs(cuerpo);
            comparadas++;
            if (params.length !== marcadores.size) {
                hallazgos.push({
                    archivo: archivo.slice(SRC.length + 1),
                    linea: s.slice(0, m.index).split('\n').length,
                    marcadores: marcadores.size,
                    params: params.length,
                    sql: sql.trim().split('\n')[0].slice(0, 70),
                });
            }
        }
    }
    return { comparadas, hallazgos };
}

/**
 * El caso que provocó el corte: el SQL se elige con un ternario y los
 * parámetros son un array fijo.
 *
 * Si las dos ramas piden distinta cantidad de marcadores, un array fijo sólo
 * puede satisfacer a una — la otra revienta en Postgres. Los parámetros tienen
 * que elegirse con el mismo ternario que el SQL.
 *
 * Esta es la comprobación que de verdad habría atajado el 500 de Airbnb: la
 * primera versión de este archivo NO lo detectaba, porque su patrón exigía que
 * la comilla viniera pegada al schema y el ternario no tiene esa forma.
 */
function auditarTernarios(): Hallazgo[] {
    const hallazgos: Hallazgo[] = [];
    const inicio = /executeInTenantSchema(?:<[^>]*>)?\(/g;

    for (const archivo of archivosTs(SRC)) {
        const s = readFileSync(archivo, 'utf8');
        inicio.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = inicio.exec(s)) !== null) {
            const abre = m.index + m[0].length - 1;
            const args = leerBalanceado(s, abre);
            if (args === null) continue;
            const partes = partirArgs(args);
            if (partes.length < 3) continue;

            const [, sqlArg, paramsArg] = partes;
            if (!sqlArg.includes('?') || !sqlArg.includes('`')) continue;
            if (sqlArg.includes('${')) continue;

            // Cuántos marcadores pide cada rama del ternario.
            const conteos = new Set(
                (sqlArg.match(/`[^`]*`/g) || [])
                    .map(lit => new Set(lit.match(/\$\d+/g) || []).size),
            );
            if (conteos.size < 2) continue; // las ramas coinciden: nada que exigir

            // Los parámetros tienen que ser condicionales igual que el SQL.
            const paramsFijos = paramsArg.trim().startsWith('[');
            if (paramsFijos) {
                hallazgos.push({
                    archivo: archivo.slice(SRC.length + 1),
                    linea: s.slice(0, m.index).split('\n').length,
                    marcadores: Math.max(...conteos),
                    params: 0,
                    sql: 'SQL condicional con parámetros fijos',
                });
            }
        }
    }
    return hallazgos;
}

describe('aridad de parámetros en SQL crudo', () => {
    const { comparadas, hallazgos } = auditar();

    it('ninguna consulta pide más o menos parámetros de los que recibe', () => {
        const detalle = hallazgos
            .map(h => `${h.archivo}:${h.linea} — ${h.marcadores} marcadores / ${h.params} params\n    ${h.sql}`)
            .join('\n');
        expect(hallazgos.length === 0 ? '' : detalle).toBe('');
    });

    it('un SQL elegido por ternario no puede llevar parámetros fijos', () => {
        // El defecto exacto del 20-ago: la rama con exclusión pedía `$2` y el
        // array fijo mandaba uno solo. Airbnb no pudo conectar el calendario.
        const detalle = auditarTernarios()
            .map(h => `${h.archivo}:${h.linea} — ${h.sql}`)
            .join('\n');
        expect(detalle).toBe('');
    });

    it('el barrido de verdad recorre el código', () => {
        // Si un refactor rompe el reconocimiento, este test dejaría de mirar
        // nada y seguiría en verde. Esto lo delata.
        expect(comparadas).toBeGreaterThan(400);
    });
});
