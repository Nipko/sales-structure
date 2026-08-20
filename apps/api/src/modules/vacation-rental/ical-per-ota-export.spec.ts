import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Capa B: una URL de exportación por OTA.
 *
 * Con una sola URL para todas, a Airbnb se le devolvían sus propios bloqueos con
 * nuestra etiqueta — de ahí las reservas "Por Parallly" en su calendario, que en
 * realidad eran de Airbnb. Cada OTA tiene que ver sólo lo que no sabe.
 */

const SERVICE = readFileSync(resolve(__dirname, 'ical-sync.service.ts'), 'utf8');
const CONTROLLER = readFileSync(resolve(__dirname, 'ical-export-public.controller.ts'), 'utf8');

describe('el feed por consumidor', () => {
    it('excluye los bloqueos que vinieron de esa misma OTA', () => {
        expect(SERVICE).toContain('AND (feed_id IS NULL OR feed_id <> $2::uuid)');
    });

    it('los bloqueos sin feed conocido siguen saliendo', () => {
        // `feed_id IS NULL` son los cargados a mano o anteriores al feed_id: no
        // pertenecen a ninguna OTA, así que ocultarlos dejaría fechas libres que
        // no lo están.
        expect(SERVICE).toContain('feed_id IS NULL OR');
    });

    it('sin el parámetro se comporta como siempre', () => {
        // Las URLs que el dueño ya pegó en las extranets no se pueden romper:
        // hacerlo lo dejaría con el calendario ciego hasta que las cambie a mano.
        expect(SERVICE).toContain('excludeFeedId?: string');
        expect(SERVICE).toContain('excludeFeedId\n');
    });
});

describe('la ruta pública', () => {
    it('existe una por token de exportación', () => {
        expect(CONTROLLER).toContain("@Get(':tenantId/properties/:propertyId/ical/:exportToken')");
    });

    it('un token desconocido da 404, no el calendario completo', () => {
        // Si no sabemos quién pregunta, no podemos saber qué ocultarle: servir
        // el calendario entero sería exactamente el bug que esto arregla.
        const handler = CONTROLLER.slice(CONTROLLER.indexOf('getCalendarForConsumer'));
        expect(handler).toContain("throw new NotFoundException('Calendar not found')");
        const notFound = handler.indexOf("Calendar not found");
        const generate = handler.indexOf('generateFeed');
        expect(notFound).toBeLessThan(generate);
    });

    it('la ruta SIN token ya no existe', () => {
        // Eliminada por decisión del dueño. Mientras existiera, una URL vieja
        // pegada en una extranet seguía devolviéndole a esa OTA sus propios
        // bloqueos sin que nadie pudiera notarlo. Ahora una URL sin migrar
        // falla de frente en vez de mentir en silencio.
        expect(CONTROLLER).not.toContain("@Get(':tenantId/properties/:propertyId/ical')");
        expect((CONTROLLER.match(/@Get\(/g) || []).length).toBe(1);
    });
});
