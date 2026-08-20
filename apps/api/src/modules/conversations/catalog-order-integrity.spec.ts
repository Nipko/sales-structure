import { AIToolExecutorService } from './ai-tool-executor.service';

/**
 * El catálogo ofrecía lo que no vendía y no podía cerrar nada.
 *
 * Dos defectos convivían en el mismo flujo. `search_products` armaba el
 * predicado `is_available = true` y después lo tiraba con un `conds.slice(0,-1)`,
 * así que el agente ofrecía productos que el negocio había apagado; y cuando la
 * tabla venía vacía caía a buscar `courses`, de modo que una farmacia recibía
 * una lista de cursos. `place_catalog_order` consultaba `products.is_active`,
 * una columna que no existe: la excepción ocurría antes de llegar a
 * OrdersService, de modo que ocho perfiles podían buscar y cotizar un producto
 * y jamás registrar un pedido.
 *
 * Lo que fijan estos tests: la búsqueda filtra de verdad, no cambia de dominio,
 * distingue "no hay" de "falló", y el pedido llega al writer.
 */

const schemaName = 'tenant_catalog';
const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';
const PRODUCT_ID = 'a36c1e0c-c71b-4837-8f30-048e94bba421';

function createExecutor(queryRawUnsafe: jest.Mock, ordersService?: any) {
    const control = {
        preflight: jest.fn().mockResolvedValue({ allowed: true }),
        complete: jest.fn(),
        fail: jest.fn(),
    };
    // El constructor toma 26 dependencias; los stubs van por posición hasta el
    // control y el resto se inyecta por nombre, como en las demás specs.
    const stub = () => ({}) as any;
    const executor = new AIToolExecutorService(
        { $queryRawUnsafe: queryRawUnsafe } as any,
        stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(),
        stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(),
        control as any,
        { preparePaymentLink: jest.fn(), confirmationRequiredResult: jest.fn() } as any,
        stub(),
        ordersService as any,
    );
    jest.spyOn((executor as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((executor as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((executor as any).logger, 'error').mockImplementation(() => undefined);
    return { executor, control };
}

describe('search_products respeta la disponibilidad y su propio dominio', () => {
    it('mantiene el filtro de disponibilidad en el SQL', async () => {
        const query = jest.fn().mockResolvedValue([]);
        const { executor } = createExecutor(query);

        await executor.execute(schemaName, tenantId, contactId, 'search_products', { query: 'ibuprofeno' }, conversationId);

        const [sql] = query.mock.calls[0];
        expect(sql).toContain('is_available = true');
    });

    it('conserva el filtro de disponibilidad también con categoría', async () => {
        const query = jest.fn().mockResolvedValue([]);
        const { executor } = createExecutor(query);

        await executor.execute(
            schemaName, tenantId, contactId, 'search_products',
            { query: 'ibuprofeno', category: 'analgesicos' }, conversationId,
        );

        const [sql, ...params] = query.mock.calls[0];
        expect(sql).toContain('is_available = true');
        expect(sql).toContain('category = $2');
        // El último parámetro sigue siendo el LIMIT, no la categoría.
        expect(params[params.length - 1]).toBe(5);
    });

    it('no cae a cursos cuando el catálogo está vacío', async () => {
        const query = jest.fn().mockResolvedValue([]);
        const { executor } = createExecutor(query);

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'search_products', { query: 'ibuprofeno' }, conversationId,
        );

        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0][0]).not.toContain('courses');
        expect(result.products).toEqual([]);
        expect(result.status).toBe('empty');
    });

    it('un fallo de lectura no se presenta como cero resultados', async () => {
        const query = jest.fn().mockRejectedValue(new Error('relation "tenant_x.products" does not exist'));
        const { executor } = createExecutor(query);

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'search_products', { query: 'ibuprofeno' }, conversationId,
        );

        expect(result.status).toBe('error');
        expect(result.error).toBe('read_failed');
        // El outcome guard del pipeline lee `error`: sin él, el agente diría
        // "no tenemos ese producto" cuando en realidad la consulta reventó.
        expect(result.products).toBeUndefined();
        expect(result.message).not.toMatch(/relation|tenant_x|SELECT/i);
    });

    it('declara fuente y frescura de lo que devuelve', async () => {
        const query = jest.fn().mockResolvedValue([
            { id: PRODUCT_ID, name: 'Ibuprofeno 400mg', price: '12000', currency: 'COP', stock: 10, is_available: true },
        ]);
        const { executor } = createExecutor(query);

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'search_products', { query: 'ibuprofeno' }, conversationId,
        );

        expect(result.status).toBe('ok');
        expect(result.source).toBe('tenant_db');
        expect(Date.parse(result.asOf)).not.toBeNaN();
        expect(result.products[0]).toMatchObject({ id: PRODUCT_ID, price: 12000, isAvailable: true });
    });
});

describe('place_catalog_order llega al writer', () => {
    const availableProduct = [{
        id: PRODUCT_ID, name: 'Ibuprofeno 400mg', price: '12000', currency: 'COP', stock: 10, is_available: true,
    }];

    it('consulta is_available y no la columna inexistente is_active', async () => {
        const query = jest.fn().mockResolvedValue(availableProduct);
        const createOrder = jest.fn().mockResolvedValue({ id: 'order-1' });
        const { executor } = createExecutor(query, { createOrder });

        await executor.execute(
            schemaName, tenantId, contactId, 'place_catalog_order',
            { items: [{ productId: PRODUCT_ID, quantity: 2 }] }, conversationId,
        );

        const [sql] = query.mock.calls[0];
        expect(sql).not.toContain('is_active');
        expect(sql).toContain('is_available');
    });

    it('crea el pedido con el precio del catálogo, no el del modelo', async () => {
        const query = jest.fn().mockResolvedValue(availableProduct);
        const createOrder = jest.fn().mockResolvedValue({ id: 'order-1' });
        const { executor } = createExecutor(query, { createOrder });

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'place_catalog_order',
            { items: [{ productId: PRODUCT_ID, quantity: 2, unitPrice: 1 }] }, conversationId,
        );

        expect(createOrder).toHaveBeenCalledWith(tenantId, expect.objectContaining({
            items: [expect.objectContaining({ productId: PRODUCT_ID, quantity: 2, unitPrice: 12000 })],
        }));
        expect(result.success).toBe(true);
        expect(result.order).toMatchObject({ id: 'order-1', total: 24000, currency: 'COP' });
    });

    it('un producto apagado se rechaza antes de escribir', async () => {
        const query = jest.fn().mockResolvedValue([{ ...availableProduct[0], is_available: false }]);
        const createOrder = jest.fn();
        const { executor } = createExecutor(query, { createOrder });

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'place_catalog_order',
            { items: [{ productId: PRODUCT_ID, quantity: 1 }] }, conversationId,
        );

        expect(result.error).toBe('product_unavailable');
        expect(createOrder).not.toHaveBeenCalled();
    });

    it('stock insuficiente se explica con las cantidades reales', async () => {
        const query = jest.fn().mockResolvedValue([{ ...availableProduct[0], stock: 1 }]);
        const createOrder = jest.fn();
        const { executor } = createExecutor(query, { createOrder });

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'place_catalog_order',
            { items: [{ productId: PRODUCT_ID, quantity: 4 }] }, conversationId,
        );

        expect(result).toMatchObject({ error: 'insufficient_stock', available: 1, requested: 4 });
        expect(createOrder).not.toHaveBeenCalled();
    });

    it('un producto sin control de unidades (stock NULL) sí se puede pedir', async () => {
        const query = jest.fn().mockResolvedValue([{ ...availableProduct[0], stock: null }]);
        const createOrder = jest.fn().mockResolvedValue({ id: 'order-2' });
        const { executor } = createExecutor(query, { createOrder });

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'place_catalog_order',
            { items: [{ productId: PRODUCT_ID, quantity: 3 }] }, conversationId,
        );

        expect(result.success).toBe(true);
        expect(createOrder).toHaveBeenCalled();
    });

    it('si el writer falla, no se anuncia un pedido', async () => {
        const query = jest.fn().mockResolvedValue(availableProduct);
        const createOrder = jest.fn().mockRejectedValue(new Error('Insufficient stock for Ibuprofeno 400mg'));
        const { executor } = createExecutor(query, { createOrder });

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'place_catalog_order',
            { items: [{ productId: PRODUCT_ID, quantity: 2 }] }, conversationId,
        );

        expect(result.error).toBe('order_failed');
        expect(result.success).toBeUndefined();
    });

    it('sin OrdersService no promete tomar pedidos', async () => {
        const query = jest.fn().mockResolvedValue(availableProduct);
        const { executor } = createExecutor(query);
        (executor as any).ordersService = undefined;

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'place_catalog_order',
            { items: [{ productId: PRODUCT_ID, quantity: 1 }] }, conversationId,
        );

        expect(result.error).toBe('orders_unavailable');
    });
});
