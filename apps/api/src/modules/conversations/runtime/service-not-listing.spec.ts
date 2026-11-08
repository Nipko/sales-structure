import { LISTING_READ_OPERATIONS, LISTING_SUBJECT_NOTE, namedCatalogService } from './service-not-listing';

/** E2z P07-4: una pregunta por un servicio con palabras de inmueble no es una pregunta por un inmueble. */
describe('namedCatalogService', () => {
    const services = [{ name: 'Visita guiada' }, { name: 'Asesoría hipotecaria' }, { name: 'Avalúo comercial' }];

    it('reconoce el servicio nombrado, con o sin tildes', () => {
        expect(namedCatalogService('¿Cuántos metros y habitaciones tiene Avalúo comercial?', services)).toBe('Avalúo comercial');
        expect(namedCatalogService('cuanto cuesta la asesoria hipotecaria', services)).toBe('Asesoría hipotecaria');
    });

    it('una pregunta por un inmueble no nombra ningún servicio', () => {
        expect(namedCatalogService('¿Cuántas habitaciones tiene el apartamento de Chapinero?', services)).toBeNull();
        expect(namedCatalogService('quiero una visita', services)).toBeNull();
        expect(namedCatalogService('hola', undefined)).toBeNull();
        expect(namedCatalogService('', services)).toBeNull();
    });

    it('solo acota las lecturas de inmueble y el resultado lo advierte', () => {
        expect([...LISTING_READ_OPERATIONS].sort()).toEqual(['find_listing', 'listing_info']);
        expect(LISTING_SUBJECT_NOTE).toMatch(/never attribute a listing's area/);
    });
});
