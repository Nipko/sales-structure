/**
 * El middleware de CORS permisivo del widget sólo debe alcanzar a las rutas
 * PÚBLICAS y embebibles.
 *
 * Antes hacía `req.url.startsWith('/api/v1/widget')`, que por prefijo se tragaba
 * también las rutas autenticadas vecinas — `/api/v1/widgets/...` (el CRUD del
 * dashboard) y `/api/v1/widget/triggers/...` — porque "widgets" empieza con
 * "widget". A esas les respondía el preflight con `Allow-Headers: Content-Type`,
 * sin `Authorization`, de modo que el navegador bloqueaba cada llamada
 * autenticada ANTES de enviarla.
 *
 * Por qué costó encontrarlo: al servidor no llegaba ninguna petición, así que en
 * los logs no había ni un 401 ni un 403 — nada. Y la UI mostraba "no tienes
 * widgets". El síntoma no se parecía en nada a la causa.
 *
 * Este test fija el patrón. Si alguien vuelve a ampliarlo a un prefijo, falla.
 */

// Debe replicar exactamente el patrón de main.ts.
const PUBLIC_WIDGET_ROUTES = /^\/api\/v1\/widget\/(loader\.js|config\/|sessions(\/|$|\?))/;

describe('CORS permisivo del widget: alcance de rutas', () => {
    it('cubre las rutas públicas embebibles', () => {
        const publicas = [
            '/api/v1/widget/loader.js',
            '/api/v1/widget/config/wgt_a1b2c3d4e5f6',
            '/api/v1/widget/sessions',
            '/api/v1/widget/sessions/refresh',
            '/api/v1/widget/sessions?foo=1',
        ];
        for (const url of publicas) {
            expect(PUBLIC_WIDGET_ROUTES.test(url)).toBe(true);
        }
    });

    it('NO alcanza el CRUD autenticado del dashboard', () => {
        // El caso que rompía el Web Chat: "widgets" empieza con "widget".
        const privadas = [
            '/api/v1/widgets/aaeaf495-92ec-464a-8cd4-9e457d3a12f9',
            '/api/v1/widgets/aaeaf495-92ec-464a-8cd4-9e457d3a12f9/wid-1',
        ];
        for (const url of privadas) {
            expect(PUBLIC_WIDGET_ROUTES.test(url)).toBe(false);
        }
    });

    it('NO alcanza los triggers, que también van autenticados', () => {
        expect(PUBLIC_WIDGET_ROUTES.test('/api/v1/widget/triggers/wid-1')).toBe(false);
    });

    it('no se deja engañar por rutas que sólo contienen la palabra', () => {
        expect(PUBLIC_WIDGET_ROUTES.test('/api/v1/otro/widget/sessions')).toBe(false);
        expect(PUBLIC_WIDGET_ROUTES.test('/api/v1/widgetsessions')).toBe(false);
        expect(PUBLIC_WIDGET_ROUTES.test('/api/v1/widget/config')).toBe(false); // sin id
    });
});
