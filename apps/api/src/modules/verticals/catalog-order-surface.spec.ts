import {
    VERTICAL_CAPABILITY_MANIFEST,
    VERTICAL_MANIFEST_INDUSTRIES,
    listVerticalCapabilityConfigurations,
    resolveVerticalCapabilityManifest,
} from '@parallext/shared';

/**
 * Quien puede tomar un pedido tiene que poder verlo.
 *
 * `place_catalog_order` es un writer: crea una fila en `orders` que el dueño
 * atiende, cobra y despacha. Publicar el catálogo sin publicar Pedidos deja el
 * pedido viviendo sólo dentro de la conversación — el mismo defecto que
 * farmacia tenía y que la auditoría contó en ocho perfiles.
 */
describe('catalog profiles publish their orders register', () => {
    const catalogProfiles = listVerticalCapabilityConfigurations()
        .filter((manifest) => manifest.capabilities.includes('catalog_search'));

    it('finds the catalog profiles at all', () => {
        expect(catalogProfiles.length).toBeGreaterThan(0);
        expect(VERTICAL_MANIFEST_INDUSTRIES.length).toBe(20);
        expect(Object.keys(VERTICAL_CAPABILITY_MANIFEST).length).toBe(20);
    });

    it.each(
        listVerticalCapabilityConfigurations()
            .filter((manifest) => manifest.capabilities.includes('catalog_search'))
            .map((manifest) => [manifest.industry, manifest.subtype] as const),
    )('publishes /admin/orders for %s/%s', (industry, subtype) => {
        const manifest = resolveVerticalCapabilityManifest(industry, subtype);
        expect(manifest.routes).toContain('/admin/inventory');
        expect(manifest.routes).toContain('/admin/orders');
    });
});
