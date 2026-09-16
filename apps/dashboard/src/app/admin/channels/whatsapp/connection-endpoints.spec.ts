import * as fs from 'fs';
import * as path from 'path';

/**
 * ═══ LA PANTALLA DE WHATSAPP LE PEGA A RUTAS QUE LA API REALMENTE EXPONE ═══
 *
 * `billing-readiness` y `check-funding` viven en el controlador de la CONEXIÓN
 * (`channels/whatsapp`), no en el de gasto (`whatsapp/spend`). La pantalla las
 * pedía sin el prefijo `channels/` y la API contestaba 404 — un 404 que el
 * `.catch(() => null)` del cargador convertía en una lista vacía, así que la
 * pantalla no mostraba ningún aviso sobre números que Meta no puede tarifar y
 * se veía igual que una cuenta sana. Un panel vacío es indistinguible de un
 * panel sin novedades: por eso esto se prueba contra la fuente de los DOS
 * lados y no contra un fixture, que habría estado de acuerdo con el error.
 */

const DASHBOARD_SRC = path.join(__dirname, '..', '..', '..', '..');
const API_SRC = path.join(DASHBOARD_SRC, '..', '..', 'api', 'src');

// `core.autocrlf` deja el árbol en CRLF y el blob en LF.
const read = (file: string): string => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const CONTROLLERS = [
    path.join(API_SRC, 'modules', 'whatsapp', 'whatsapp.controller.ts'),
    path.join(API_SRC, 'modules', 'billing', 'whatsapp-spend', 'whatsapp-spend.controller.ts'),
];

/** Cada ruta que la API expone hoy, como la vería un cliente: base + método. */
function declaredRoutes(): Set<string> {
    const routes = new Set<string>();
    for (const file of CONTROLLERS) {
        const source = read(file);
        const base = source.match(/@Controller\(\s*['"]([^'"]*)['"]\s*\)/)?.[1];
        expect(typeof base).toBe('string');
        for (const match of source.matchAll(/@(?:Get|Post|Put|Patch|Delete)\(\s*(?:['"]([^'"]*)['"])?\s*\)/g)) {
            const suffix = (match[1] ?? '').replace(/^\/+/, '');
            routes.add(`/${[base, suffix].filter(Boolean).join('/')}`);
        }
    }
    return routes;
}

/** Cada ruta que la pantalla pide, con los interpolados normalizados a `:param`. */
function requestedPaths(source: string): string[] {
    const paths: string[] = [];
    for (const match of source.matchAll(/api\.fetch\(\s*(["'`])([^"'`]*)\1/g)) {
        const raw = match[2];
        if (!raw.startsWith('/')) continue;
        paths.push(raw.split('?')[0]);
    }
    // Plantillas con interpolación: `/whatsapp/spend/pauses/${id}/resume`.
    for (const match of source.matchAll(/api\.fetch\(\s*`([^`]*)`/g)) {
        const raw = match[1];
        if (!raw.startsWith('/')) continue;
        paths.push(raw.replace(/\$\{[^}]*\}/g, ':param').split('?')[0]);
    }
    return [...new Set(paths)];
}

/**
 * `/a/b/:id/c` de la API contra `/a/b/:param/c` de la pantalla.
 *
 * Un segmento sólo cuadra si es idéntico, o si la API declaró un parámetro ahí
 * — que acepta cualquier valor. Comparar "ninguno de los dos es parámetro" daba
 * por buena cualquier ruta del mismo largo, y la prueba se aprobaba sola.
 */
function matches(requested: string, declared: string): boolean {
    const a = requested.split('/');
    const b = declared.split('/');
    if (a.length !== b.length) return false;
    return a.every((segment, index) => b[index].startsWith(':') || segment === b[index]);
}

/**
 * Cada ruta de WhatsApp que declara el cliente HTTP compartido.
 *
 * Una plantilla con interpolación anidada (una dentro de otra) no se puede
 * normalizar con una expresión regular, así que de esas se verifica sólo el
 * prefijo estático — `exact: false`. Se dice en voz alta para que nadie lea
 * esto como cobertura total: el prefijo es justamente donde vive el error de
 * controlador equivocado que esta prueba existe para atrapar, pero la cola de
 * la ruta queda sin comprobar.
 */
function apiClientWhatsappPaths(source: string): Array<{ path: string; exact: boolean }> {
    const found = new Map<string, boolean>();
    const add = (raw: string) => {
        if (!/whatsapp/i.test(raw)) return;
        const normalized = raw.replace(/\$\{[^${}]*\}/g, ':param').split('?')[0];
        const residue = normalized.search(/[$`]/);
        const exact = residue < 0;
        // Sin la cola interpolada; el segmento parcial que quede se descarta.
        const path = exact
            ? normalized
            : normalized.slice(0, residue).replace(/\/$/, '');
        found.set(path, (found.get(path) ?? true) && exact);
    };

    for (const match of source.matchAll(
        /api(?:Get|Post|Put|Patch|Delete)(?:<[^>]*>)?\(\s*(["'])(\/[^"']*)\1/g,
    )) add(match[2]);
    // El backtick de cierre es el que va seguido de `,` o `)`: los de una
    // plantilla anidada no lo están.
    for (const match of source.matchAll(
        /api(?:Get|Post|Put|Patch|Delete)(?:<[^>]*>)?\(\s*`(\/[\s\S]*?)`\s*[,)]/g,
    )) add(match[1]);

    return [...found].map(([path, exact]) => ({ path, exact }));
}

/** El prefijo estático de una ruta interpolada contra una ruta declarada. */
function matchesPrefix(prefix: string, declared: string): boolean {
    const a = prefix.split('/');
    const b = declared.split('/');
    if (a.length > b.length) return false;
    return a.every((segment, index) => b[index].startsWith(':') || segment === b[index]);
}

describe('la pantalla de canales → WhatsApp', () => {
    const page = read(path.join(__dirname, 'page.tsx'));
    const routes = declaredRoutes();

    it('pide la disponibilidad de cobro al controlador que la expone', () => {
        // El caso exacto que se fue a producción.
        expect(page).toContain('/channels/whatsapp/connection/billing-readiness');
        expect(routes).toContain('/channels/whatsapp/connection/billing-readiness');
    });

    it('no le pega a ninguna ruta que la API no tenga', () => {
        const requested = requestedPaths(page);
        // Si esto queda vacío, la prueba dejó de mirar lo que cree mirar.
        expect(requested.length).toBeGreaterThan(5);

        const missing = requested.filter(candidate =>
            ![...routes].some(declared => matches(candidate, declared)));

        expect(missing).toEqual([]);
    });
});

describe('el cliente HTTP compartido', () => {
    const routes = declaredRoutes();

    it('no declara ningún método de WhatsApp contra una ruta que la API no tenga', () => {
        // La misma equivocación de prefijo entró dos veces: una por la pantalla
        // y otra por acá, donde el nombre del método (`checkWhatsappFunding`)
        // no deja ver a qué controlador le pega.
        const requested = apiClientWhatsappPaths(
            read(path.join(DASHBOARD_SRC, 'lib', 'api.ts')),
        );
        expect(requested.length).toBeGreaterThan(2);

        const missing = requested
            .filter(candidate => ![...routes].some(declared => (candidate.exact
                ? matches(candidate.path, declared)
                : matchesPrefix(candidate.path, declared))))
            .map(candidate => candidate.path);

        expect(missing).toEqual([]);
    });
});
