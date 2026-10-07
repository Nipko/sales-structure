import { projectAvailableServices, SERVICE_DESCRIPTION_BUDGET } from '../appointments/service-price-status';

/** The prompt carries service descriptions in a fixed budget: a long catalog must not grow every turn's prompt. */
describe('projectAvailableServices keeps descriptions inside a budget', () => {
    const catalog = Array.from({ length: 30 }, (_, i) => ({
        id: `s${i}`, name: `Servicio ${i} especial`, description: `${'d'.repeat(279)}${i % 10}`, durationMinutes: 30, price: 1000, currency: 'COP', priceStatus: 'confirmed' as const,
    }));
    const total = (list: Array<{ description?: string }>) => list.reduce((sum, s) => sum + (s.description?.length ?? 0), 0);

    it('never exceeds the budget, and every service keeps its name, duration and price', () => {
        const out = projectAvailableServices(catalog);
        expect(total(out)).toBeLessThanOrEqual(SERVICE_DESCRIPTION_BUDGET);
        expect(out).toHaveLength(30);
        expect(out.every((s, i) => s.name === catalog[i].name && s.durationMinutes === 30 && s.price === 1000)).toBe(true);
        expect(out.filter(s => s.description).length).toBe(Math.floor(SERVICE_DESCRIPTION_BUDGET / 280));
    });

    it('prefers the services the message names, wherever they are in the catalog', () => {
        const out = projectAvailableServices(catalog, '¿Qué incluye el servicio 27 especial y el Servicio 29 especial?');
        expect(out[27].description).toBeTruthy();
        expect(out[29].description).toBeTruthy();
        expect(total(out)).toBeLessThanOrEqual(SERVICE_DESCRIPTION_BUDGET);
    });

    it('a small catalog keeps every description', () => {
        const out = projectAvailableServices(catalog.slice(0, 3));
        expect(out.every(s => !!s.description)).toBe(true);
    });
});
