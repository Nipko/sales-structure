import { projectedCatalogFacts } from './fact-renderer';

/** E2y C01 (opción B): la duración de un servicio de plantilla no es un hecho citable. */
describe('projectedCatalogFacts con servicios de plantilla', () => {
    it('omite los servicios sembrados y conserva los confirmados', () => {
        const facts = projectedCatalogFacts({
            availableServices: [
                { id: 'a', name: 'Consulta general', durationMinutes: 30, contentStatus: 'seeded', priceStatus: 'example' },
                { id: 'b', name: 'Corte y estilo', durationMinutes: 45, price: 40000, currency: 'COP' },
            ],
        } as any, new Date('2026-11-07T00:00:00Z'));
        expect(facts.map(f => f.subject?.id)).toEqual(['b', 'b']);
    });
});
