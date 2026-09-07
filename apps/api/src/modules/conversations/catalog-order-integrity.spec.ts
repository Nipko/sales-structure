import { catalogHash, catalogItems, catalogTerms } from '../orders/catalog-order-contract';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

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
        preflight: jest.fn().mockResolvedValue({ allowed: true, idempotencyKey:'catalog-call' }),
        complete: jest.fn().mockResolvedValue(undefined),
        fail: jest.fn().mockResolvedValue(undefined),
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

        await executor.execute(schemaName, tenantId, contactId, 'search_products', { query: 'ibuprofeno' }, conversationId, { authority: authorityFor('search_products') });

        const [sql] = query.mock.calls[0];
        expect(sql).toContain('is_available = true');
    });

    it('conserva el filtro de disponibilidad también con categoría', async () => {
        const query = jest.fn().mockResolvedValue([]);
        const { executor } = createExecutor(query);

        await executor.execute(
            schemaName, tenantId, contactId, 'search_products',
            { query: 'ibuprofeno', category: 'analgesicos' }, conversationId,
            { authority: authorityFor('search_products') },
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
            { authority: authorityFor('search_products') },
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
            { authority: authorityFor('search_products') },
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
            { authority: authorityFor('search_products') },
        );

        expect(result.status).toBe('ok');
        expect(result.source).toBe('tenant_db');
        expect(Date.parse(result.asOf)).not.toBeNaN();
        expect(result.products[0]).toMatchObject({ id: PRODUCT_ID, price: 12000, isAvailable: true });
    });
});

describe('place_catalog_order delegates the reviewed canonical command', () => {
    const product={id:PRODUCT_ID,name:'Ibuprofeno 400mg',price:'12000',currency:'COP',stock:10,is_available:true};
    function writer(rows:any[]=[product]) {
        const quote=jest.fn(async(_schema:string,data:any)=>catalogTerms(rows,catalogItems(data.items),'','agent'));
        const create=jest.fn().mockResolvedValue({id:'44444444-4444-4444-8444-444444444444',totalAmount:24000,currency:'COP',items:[{}],status:'pending',paymentStatus:'pending'});
        return {quote,create,...createExecutor(jest.fn(),{catalogCommands:()=>({quote,create})})};
    }
    const args={items:[{productId:PRODUCT_ID,quantity:2}]};
    const run=(executor:AIToolExecutorService,input:any=args)=>executor.execute(schemaName,tenantId,contactId,'place_catalog_order',input,conversationId,{authority:authorityFor('place_catalog_order')});
    it('binds the owned schema, identity, canonical prices and execution key; discards model prices',async()=>{
        const {executor,quote,create}=writer();
        const result:any=await run(executor,{items:[{...args.items[0],unitPrice:1}],catalogTermsHash:'forged'});
        expect(quote).toHaveBeenCalledWith(schemaName,expect.objectContaining({contactId,conversationId}));
        const terms=await quote.mock.results[0].value;
        expect(create).toHaveBeenCalledWith(schemaName,expect.objectContaining({contactId,conversationId,idempotencyKey:'catalog-call'}),{source:'agent',expectedTermsHash:catalogHash(terms)});
        expect(result.order).toMatchObject({total:24000,currency:'COP',status:'pending',paymentStatus:'pending'});
    });
    it('returns availability facts for a rejected product without writing',async()=>{
        const {executor,create}=writer([{...product,is_available:false}]);
        expect(await run(executor)).toMatchObject({error:'catalog_product_unavailable',productId:PRODUCT_ID,persisted:false});
        expect(create).not.toHaveBeenCalled();
    });
    it('explains insufficient stock using canonical quantities',async()=>{
        const {executor,create}=writer([{...product,stock:1}]);
        expect(await run(executor)).toMatchObject({error:'catalog_stock_insufficient',available:1,requested:2});
        expect(create).not.toHaveBeenCalled();
    });
    it('preserves an untracked product as a valid order input',async()=>{
        const {executor,quote}=writer([{...product,stock:null}]);
        expect(await run(executor)).toMatchObject({success:true});
        expect((await quote.mock.results[0].value).items[0].tracksStock).toBe(false);
    });
    it('hides internal writer failures and never reports a successful order',async()=>{
        const {executor,create}=writer();create.mockRejectedValue(new Error('SELECT secret FROM tenant_x.orders'));
        const result=await run(executor);
        expect(result).toMatchObject({error:'catalog_operation_unavailable',outcome:'unverified'});
        expect(result.persisted).toBeUndefined();
        expect(JSON.stringify(result)).not.toContain('tenant_x');
    });
    it('reports uncertain acknowledgement as persisted and requires reconciliation',async()=>{
        const {executor,control}=writer();control.complete.mockRejectedValue(new Error('ledger unavailable'));
        const result=await run(executor);
        expect(result).toMatchObject({error:'reconciliation_required',persisted:true,retryable:false});
        expect(result.order).toBeUndefined();
    });
    it('fails closed if the canonical service is unavailable',async()=>{
        const {executor}=createExecutor(jest.fn());
        expect(await run(executor)).toMatchObject({error:'catalog_operation_unavailable',outcome:'unverified'});
    });
});
