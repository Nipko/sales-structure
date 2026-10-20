import { groundMissingPropertyPhotoReply as ground, propertyPhotoCatalogue, requiresPropertyPhotoLookup } from './property-photo-grounding';
const id = 'a04493f8-5b74-4f94-921e-9d73d1b189d7';
const row = { id, name: 'Spark QA Habitacion', images: [] };
const read = (result: unknown) => [{ name: 'list_properties', result }];
const ask = '¿Puedes enviarme la foto del alojamiento "Spark QA Habitacion"?';
describe('Current property photo grounding', () => {
    it('distinguishes a known property without images from a nonexistent property', () => {
        expect(ground(ask, read({ properties: [row] }), 'es-CO')).toContain('no tiene fotos disponibles');
        expect(propertyPhotoCatalogue({ properties: [row] })).toEqual([{ id, title: row.name, category: 'property' }]);
    });
    it.each(['Envía la foto del alojamiento', 'Show a photo of the property', 'Envie uma imagem da hospedagem', 'Une photo du logement'])('recognizes the photo request: %s', text => {
        expect(requiresPropertyPhotoLookup(text)).toBe(true);
    });
    it.each(['No me envies fotos del alojamiento', 'Do not send a photo of the property', 'No quiero fotos de la habitacion', 'Envía una foto del producto', '¿Cuánto cuesta el alojamiento?'])('does not apply to a different or negated request: %s', text => {
        expect(requiresPropertyPhotoLookup(text)).toBe(false);
    });
    it.each([{ error: 'denied', properties: [row] }, { stale: true, properties: [row] }, { status: 'failed', properties: [row] }, { properties: [] }, { properties: [{ ...row, images: null }] }])('never invents a negative from an unavailable or malformed read', result => {
        expect(ground(ask, read(result))).toBeNull();
    });
    it('does not claim missing images when images exist or when no property reader ran', () => {
        expect(ground(ask, read({ properties: [{ ...row, images: ['https://example.test/a.png'] }] }))).toBeNull();
        expect(ground(ask, [{ name: 'search_faqs', result: { faqs: [] } }])).toBeNull();
    });
    it('does not substitute a real property when the customer names a different UUID', () => {
        expect(ground(ask + ' 00000000-0000-4000-8000-000000000099', read({ properties: [row] }))).toBeNull();
        expect(ground('Foto del alojamiento ' + id, read({ properties: [row] }))).not.toBeNull();
    });
    it('rejects ambiguous names and honors a newer failed read', () => {
        expect(ground(ask, read({ properties: [row, { ...row, id: 'b04493f8-5b74-4f94-921e-9d73d1b189d7' }] }))).toBeNull();
        expect(ground(ask, [...read({ properties: [row] }), ...read({ error: 'unavailable' })])).toBeNull();
    });
    it.each(['en', 'pt', 'fr'])('keeps the configured response language %s', language => {
        expect(ground(ask, read({ properties: [row] }), language)).not.toContain('El alojamiento');
    });
});
