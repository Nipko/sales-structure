import { getVerticalCatalog } from './vertical-catalog.util';

describe('getVerticalCatalog', () => {
    it('resolves tourism catalog and route by subtype', () => {
        expect(getVerticalCatalog('turismo', 'hotel')).toMatchObject({
            table: 'properties',
            missingKey: 'properties',
            route: '/admin/properties',
        });
        expect(getVerticalCatalog('turismo', 'alquiler_vacacional')).toMatchObject({
            table: 'properties',
            route: '/admin/properties',
        });
        expect(getVerticalCatalog('turismo', 'tours')).toMatchObject({
            table: 'tour_packages',
            missingKey: 'tour_packages',
            route: '/admin/tours',
        });
        expect(getVerticalCatalog('turismo', 'agencia_viajes')).toMatchObject({
            table: 'tour_packages',
            route: '/admin/tours',
        });
    });

    it('routes catalog-only subtype compatibility without enabling it for the whole industry', () => {
        expect(getVerticalCatalog('salud', 'farmacia')).toMatchObject({
            table: 'products',
            route: '/admin/inventory',
        });
        expect(getVerticalCatalog('salud', 'dental')).toBeNull();
        expect(getVerticalCatalog('moda_belleza', 'boutique')).toMatchObject({
            table: 'products',
            route: '/admin/inventory',
        });
        expect(getVerticalCatalog('moda_belleza', 'spa')).toBeNull();
    });

    it('keeps stable industry-level catalogs for non-polymorphic verticals', () => {
        expect(getVerticalCatalog('restaurantes', 'dark_kitchen')).toMatchObject({
            table: 'menu_items',
            route: '/admin/menu',
        });
        expect(getVerticalCatalog('automotriz', 'concesionario')).toMatchObject({
            table: 'vehicles',
            route: '/admin/vehicles',
        });
        expect(getVerticalCatalog('automotriz', 'taller')).toBeNull();
        expect(getVerticalCatalog('automotriz', 'repuestos')).toMatchObject({
            table: 'products',
            route: '/admin/inventory',
        });
        expect(getVerticalCatalog('otro', null)).toMatchObject({
            table: 'products',
            route: '/admin/inventory',
        });
    });
});
