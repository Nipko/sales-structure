import { catalogItems, catalogTerms } from '../orders/catalog-order-contract';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { resolveVerticalCapabilityManifest } from '@parallext/shared';
import { authorityFor } from './__fixtures__/tool-authority.fixture';
import type { ServedAgentAuthority } from '../persona/served-agent-authority';

/**
 * Venta libre y venta bajo fórmula no son el mismo producto.
 *
 * El catálogo genérico trataba a todo por igual: si estaba disponible, el
 * agente lo buscaba, lo cotizaba y armaba el pedido. En una farmacia eso
 * significaba que un medicamento recetado se podía pedir por WhatsApp sin que
 * ningún farmacéutico viera la receta — y la conversación quedaba como si el
 * negocio lo hubiera aceptado.
 */
describe('pharmacy prescription boundary', () => {
    const schemaName = 'tenant_farmacia';
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const contactId = '22222222-2222-4222-8222-222222222222';
    const otc = '33333333-3333-4333-8333-333333333333';
    const rx = '44444444-4444-4444-8444-444444444444';
    const agentId = '66666666-6666-4666-8666-666666666666';
    // `place_catalog_order` escribe con versión guardada, así que el ejecutor
    // la rechaza sin la procedencia privada de la revisión que sirve el turno.
    // Las tres pruebas de pedido la traen: así el rechazo por fórmula se mide
    // contra un pedido que por lo demás estaba completamente autorizado, y no
    // gana por una puerta anterior.
    const operationalScope: ServedAgentAuthority = {
        kind: 'agent', tenantId, schemaName, agentId, version: 3, operationalHash: 'b'.repeat(64),
    };

    function createHarness() {
        const prisma = {
            $queryRawUnsafe: jest.fn().mockResolvedValue([]),
            $executeRawUnsafe: jest.fn(),
            executeInTenantSchema: jest.fn().mockResolvedValue([]),
        };
        const commands={quote:jest.fn(async(_schema:string,data:any)=>catalogTerms(await prisma.$queryRawUnsafe(),catalogItems(data.items),'','agent')),
            create:jest.fn().mockResolvedValue({id:'55555555-5555-4555-8555-555555555555',items:[{}],totalAmount:16000,paymentStatus:'pending',status:'pending'})};
        const ordersService = {catalogCommands:()=>commands,createOrder:commands.create};
        const toolExecutionControl = {
            preflight: jest.fn().mockResolvedValue({ allowed: true, idempotencyKey:'pharmacy-call', policy: { externalEffect: 'none' } }),
            complete: jest.fn().mockResolvedValue(undefined),
            fail: jest.fn().mockResolvedValue(undefined),
        };
        const stub = () => ({}) as any;
        const executor = new AIToolExecutorService(
            prisma as any, stub(), { emit: jest.fn() } as any, stub(), stub(), stub(),
            stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(),
            stub(), stub(), stub(), stub(), stub(), stub(),
            toolExecutionControl as any, stub(), stub(),
            ordersService as any, stub(), stub(),
        );
        return { executor, prisma, ordersService };
    }

    function productRow(overrides: Record<string, any> = {}) {
        return {
            id: otc, name: 'Acetaminofén 500mg', price: '8000', currency: 'COP',
            stock: 40, is_available: true, requires_prescription: false, ...overrides,
        };
    }

    it('takes an over-the-counter order exactly as before', async () => {
        const harness = createHarness();
        harness.prisma.$queryRawUnsafe.mockResolvedValue([productRow()]);

        const result = await harness.executor.execute(
            schemaName, tenantId, contactId, 'place_catalog_order',
            { items: [{ productId: otc, quantity: 2 }] }, undefined,
            { authority: authorityFor('place_catalog_order'), operationalScope },
        );

        expect(result.success).toBe(true);
        expect(harness.ordersService.createOrder).toHaveBeenCalledTimes(1);
    });

    it('refuses a prescription item and names it so the agent can say which one', async () => {
        const harness = createHarness();
        harness.prisma.$queryRawUnsafe.mockResolvedValue([
            productRow({ id: rx, name: 'Amoxicilina 500mg', requires_prescription: true }),
        ]);

        const result = await harness.executor.execute(
            schemaName, tenantId, contactId, 'place_catalog_order',
            { items: [{ productId: rx, quantity: 1 }] }, undefined,
            { authority: authorityFor('place_catalog_order'), operationalScope },
        );

        expect(result.error).toBe('catalog_prescription_review_required');
        expect(result.productName).toBe('Amoxicilina 500mg');
        expect(result.shouldHandoff).toBe(true);
        // Nada se escribió: el pedido no existe a medias.
        expect(harness.ordersService.createOrder).not.toHaveBeenCalled();
    });

    /**
     * El caso que de verdad importa: el carrito mezclado. Aceptar la parte de
     * venta libre y callar el resto le dice al cliente que su pedido está
     * completo cuando le falta justo el medicamento que fue a buscar.
     */
    it('refuses the whole order when one line needs a prescription', async () => {
        const harness = createHarness();
        harness.prisma.$queryRawUnsafe
            .mockResolvedValue([productRow(),productRow({ id: rx, name: 'Amoxicilina 500mg', requires_prescription: true })]);

        const result = await harness.executor.execute(
            schemaName, tenantId, contactId, 'place_catalog_order',
            { items: [{ productId: otc, quantity: 1 }, { productId: rx, quantity: 1 }] }, undefined,
            { authority: authorityFor('place_catalog_order'), operationalScope },
        );

        expect(result.error).toBe('catalog_prescription_review_required');
        expect(harness.ordersService.createOrder).not.toHaveBeenCalled();
    });

    /**
     * Ocultarlo del catálogo sería mentir por omisión: la farmacia SÍ lo tiene.
     * Lo que no puede es venderlo por chat.
     */
    it('still shows the prescription product in search, flagged', async () => {
        const harness = createHarness();
        harness.prisma.$queryRawUnsafe.mockResolvedValue([
            productRow({ id: rx, name: 'Amoxicilina 500mg', requires_prescription: true }),
        ]);

        const result = await harness.executor.execute(
            schemaName, tenantId, contactId, 'search_products', { query: 'amoxi' }, undefined,
            { authority: authorityFor('search_products') },
        );

        expect(result.products).toHaveLength(1);
        expect(result.products[0].requiresPrescription).toBe(true);
    });

    it('reports the flag on stock checks, so availability is not read as sellability', async () => {
        const harness = createHarness();
        harness.prisma.$queryRawUnsafe.mockResolvedValue([
            { id: rx, name: 'Amoxicilina 500mg', stock: 12, is_available: true, requires_prescription: true },
        ]);

        const result = await harness.executor.execute(
            schemaName, tenantId, contactId, 'check_stock', { product: 'Amoxicilina 500mg' }, undefined,
            { authority: authorityFor('check_stock') },
        );

        expect(result.inStock).toBe(true);
        expect(result.requiresPrescription).toBe(true);
    });
});

describe('pharmacy manifest', () => {
    const pharmacy = resolveVerticalCapabilityManifest('salud', 'farmacia');

    /** El writer existía y su superficie de lectura no. */
    it('publishes the orders register the agent writes into', () => {
        expect(pharmacy.routes).toContain('/admin/orders');
        expect(pharmacy.routes).toContain('/admin/inventory');
    });

    it('does not show a clinic dashboard to a business with no agenda', () => {
        expect(pharmacy.capabilities).not.toContain('appointment_booking');
        expect(pharmacy.kpiContract.dashboard).not.toContain('appointmentsToday');
        expect(pharmacy.kpiContract.dashboard).not.toContain('noShowsWeek');
        expect(pharmacy.kpiContract.verticalAnalytics.metrics).not.toContain('treatmentsActive');
        expect(pharmacy.kpiContract.verticalAnalytics.metrics).toContain('orders30d');
    });

    /** Assurance sobre tools que este perfil no publica no protege nada. */
    it('enforces assurance on the action it actually has', () => {
        expect(Object.keys(pharmacy.assurance.enforcedActions)).toEqual(['place_catalog_order']);
        expect(pharmacy.assurance.enforcedActions.place_catalog_order).toBe('A1');
    });

    it('leaves the clinical subtypes untouched', () => {
        const dental = resolveVerticalCapabilityManifest('salud', 'dental');
        expect(dental.kpiContract.dashboard).toContain('appointmentsToday');
        expect(dental.assurance.enforcedActions.get_treatment_plan).toBe('A2');
    });
});
