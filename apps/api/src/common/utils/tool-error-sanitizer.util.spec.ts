import { looksInternal, sanitizeToolResultForModel } from './tool-error-sanitizer.util';

/**
 * El huésped leyó "necesito primero obtener el identificador único del
 * apartamento". Era un mensaje escrito para coachear al modelo: el handler lo
 * devolvió como `{ error: e.message }`, se serializó entero hacia el modelo y el
 * modelo se lo parafraseó.
 */
describe('lo que el modelo puede leer de una herramienta que falló', () => {
    it.each([
        ['propertyId must be a valid UUID'],
        ['Property not found'],
        ['relation "property_bookings" does not exist'],
        ['column b.payment_status does not exist'],
        ['connect ECONNREFUSED 10.0.0.5:5432'],
        ['Error: Cannot read properties of undefined'],
    ])('descarta la prosa técnica: %s', (message) => {
        const out = sanitizeToolResultForModel({ error: 'failed', message });

        expect(looksInternal(message)).toBe(true);
        expect(out.message).not.toBe(message);
        expect(out.message).toBe('La operación no se pudo completar.');
        // El CODIGO sigue viajando: es sobre lo que el modelo razona.
        expect(out.error).toBe('failed');
    });

    it('conserva un mensaje escrito para el cliente', () => {
        const message = 'No pude ubicar ese alojamiento. Verificá cuál es antes de continuar.';

        const out = sanitizeToolResultForModel({ error: 'unknown_property', message });

        expect(looksInternal(message)).toBe(false);
        expect(out.message).toBe(message);
    });

    it('no toca el resultado de una operación exitosa', () => {
        // Ahí el payload ES el dato de negocio que el modelo necesita, aunque
        // contenga ids: sin esto se rompería la respuesta al cliente.
        const ok = {
            success: true,
            booking: { id: 'a36c1e0c-c71b-4837-8f30-048e94bba421', propertyId: 'x', totalPrice: 1080000 },
        };

        expect(sanitizeToolResultForModel(ok)).toEqual(ok);
    });

    it('traduce el motivo neutro al idioma del turno', () => {
        const failed = { error: 'failed', message: 'Property not found' };

        expect(sanitizeToolResultForModel(failed, 'en').message).toBe('The operation could not be completed.');
        expect(sanitizeToolResultForModel(failed, 'pt').message).toBe('A operação não pôde ser concluída.');
        expect(sanitizeToolResultForModel(failed, 'fr').message).toBe("L'opération n'a pas pu être effectuée.");
    });

    it('aguanta payloads que no son objetos', () => {
        expect(sanitizeToolResultForModel(null)).toBeNull();
        expect(sanitizeToolResultForModel('texto')).toBe('texto');
        expect(sanitizeToolResultForModel([1, 2])).toEqual([1, 2]);
    });
});
