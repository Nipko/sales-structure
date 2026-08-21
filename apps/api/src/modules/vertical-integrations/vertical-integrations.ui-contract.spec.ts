import * as fs from 'fs';
import * as path from 'path';
import { resolveVerticalCapabilityManifest } from '@parallext/shared';

/**
 * La pantalla de integraciones era un callejón sin salida.
 *
 * El botón "Probar" sólo aparecía cuando el proveedor estaba `connected`, y
 * `connected` exige `credentialValidated`, que se enciende **probando**: había
 * que probar para poder probar. Guardar la credencial reseteaba la salud a
 * "sin validar", así que después de guardar la única acción disponible era
 * volver a guardar.
 *
 * Y listaba los tres proveedores a todo el mundo: una peluquería veía "Toast
 * (POS de restaurante)" como algo que podría conectar.
 *
 * Estas pruebas leen el fuente de la página, igual que
 * `vertical-catalog-consumers.spec.ts`, porque lo que hay que fijar es que la
 * pantalla NO vuelva a decidir con `connected` lo que se decide con
 * `configured`.
 */

const PAGE = path.join(
    __dirname, '../../../../dashboard/src/app/admin/settings/integrations/vertical/page.tsx',
);
const PANEL = path.join(
    __dirname,
    '../../../../dashboard/src/app/admin/settings/integrations/vertical/_components/IntegrationHealthPanel.tsx',
);

const page = fs.readFileSync(PAGE, 'utf8');
const panel = fs.readFileSync(PANEL, 'utf8');

describe('se puede probar la conexión después de guardarla', () => {
    it('la fila de acciones depende de haber guardado, no de haber validado', () => {
        expect(page).toContain('const configured = !!configs[key]?.configured');
        expect(page).toContain('{configured && (');
        // El gate viejo era `{connected && (` sobre toda la fila.
        expect(page).not.toContain('{connected && (\n                                        <>');
    });

    it('sincronizar sí espera a que la credencial esté validada', () => {
        // Sincronizar antes de validar sólo produce un error del proveedor: el
        // camino es Guardar → Probar → Sincronizar, y la pantalla lo dice.
        expect(page).toContain('disabled={busy === `sync:${key}` || !connected}');
        expect(page).toContain('t("testFirst")');
    });

    it('probar recarga la salud: el panel no puede quedar en el estado anterior', () => {
        const testFn = page.slice(page.indexOf('const test = async'), page.indexOf('const sync = async'));
        expect(testFn).toContain('await load()');
    });
});

describe('la salud que el backend calculaba llega a la pantalla', () => {
    it.each([
        ['estado', 'status_'],
        ['credencial validada', 'credentialValidated'],
        ['frescura', 'lastSync'],
        ['permisos faltantes', 'scopesMissing'],
        ['último error', 'lastError'],
        ['circuito', 'circuit_'],
    ])('muestra %s', (_case, key) => {
        expect(panel).toContain(key);
    });

    it('el panel se pinta cuando hay credencial guardada', () => {
        expect(page).toContain('{configured && <IntegrationHealthPanel health={configs[key]?.health} />}');
    });
});

describe('sólo se ofrece lo que el rubro usa', () => {
    it('el filtro sale del manifiesto, no de una lista a mano', () => {
        expect(page).toContain('resolveVerticalCapabilityManifest');
        expect(page).toContain('PROVIDER_TOOL_GROUP');
    });

    it('lo ya configurado se muestra siempre, aunque el rubro haya cambiado', () => {
        // Si no, un tenant que migró de vertical pierde el botón de
        // desconectar y la credencial queda viva sin pantalla que la administre.
        expect(page).toContain('if (configs[key]?.configured) return true;');
    });

    it('sin config resuelta no se filtra nada', () => {
        expect(page).toContain('if (!tenantToolGroups) return true;');
    });

    it('los grupos que la pantalla nombra existen en el manifiesto', () => {
        // Un grupo mal escrito escondería la integración para siempre y en
        // silencio: nadie ve una tarjeta que no se pinta.
        const groups = ['restaurants', 'gyms', 'treatments'];
        const known = new Set<string>();
        for (const [industry, subtype] of [
            ['restaurantes', 'comida_rapida'],
            ['gimnasios', 'gimnasio_general'],
            ['salud', 'dental'],
        ] as const) {
            for (const group of resolveVerticalCapabilityManifest(industry, subtype).toolGroups) {
                known.add(group);
            }
        }
        for (const group of groups) {
            expect(page).toContain(`"${group}"`);
            expect(known.has(group)).toBe(true);
        }
    });
});
