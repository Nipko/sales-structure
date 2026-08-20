import { AIToolExecutorService } from './ai-tool-executor.service';
import {
    isFailedRead,
    readEmpty,
    readFailed,
    readOk,
    readProviderDown,
    readUnauthorized,
} from '../../common/contracts/tool-read-result.util';
import { sanitizeToolResultForModel } from '../../common/utils/tool-error-sanitizer.util';

/**
 * "No pude leer" no puede sonar igual que "no hay nada".
 *
 * Varias lecturas atrapaban la excepción y devolvían la colección vacía sin
 * campo `error`: `{orders: []}`, `{offers: []}`, `{chunks: []}`. El guard de
 * outcome define éxito como "el objeto no trae `error`", así que una consulta
 * que reventó se clasificaba como exitosa y el agente le decía al cliente
 * "no tenés pedidos". `check_stock` era peor: convertía un fallo en un
 * definitivo "ese producto no existe".
 */

const schemaName = 'tenant_reads';
const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';

function createExecutor(queryRawUnsafe: jest.Mock, extras: Record<string, any> = {}) {
    const control = {
        preflight: jest.fn().mockResolvedValue({ allowed: true }),
        complete: jest.fn(),
        fail: jest.fn(),
    };
    const stub = () => ({}) as any;
    const executor = new AIToolExecutorService(
        { $queryRawUnsafe: queryRawUnsafe, executeInTenantSchema: jest.fn().mockResolvedValue([]) } as any,
        stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(),
        stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(),
        control as any,
        { preparePaymentLink: jest.fn(), confirmationRequiredResult: jest.fn() } as any,
        stub(),
    );
    for (const [key, value] of Object.entries(extras)) (executor as any)[key] = value;
    jest.spyOn((executor as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((executor as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((executor as any).logger, 'error').mockImplementation(() => undefined);
    return executor;
}

const DB_DOWN = new Error('relation "tenant_reads.orders" does not exist');

describe('un fallo de lectura nunca se presenta como cero resultados', () => {
    it('list_customer_orders distingue vacío real de consulta rota', async () => {
        const empty = createExecutor(jest.fn().mockResolvedValue([]));
        const emptyResult: any = await empty.execute(
            schemaName, tenantId, contactId, 'list_customer_orders', {}, conversationId,
        );
        expect(emptyResult.status).toBe('empty');
        expect(emptyResult.orders).toEqual([]);
        expect(emptyResult.error).toBeUndefined();

        const broken = createExecutor(jest.fn().mockRejectedValue(DB_DOWN));
        const brokenResult: any = await broken.execute(
            schemaName, tenantId, contactId, 'list_customer_orders', {}, conversationId,
        );
        expect(brokenResult.status).toBe('error');
        expect(brokenResult.error).toBe('read_failed');
        expect(brokenResult.orders).toBeUndefined();
    });

    it('sin contacto identificado el resultado es unauthorized, no vacío', async () => {
        const executor = createExecutor(jest.fn().mockResolvedValue([]));
        const result: any = await executor.execute(
            schemaName, tenantId, '', 'list_customer_orders', {}, conversationId,
        );
        expect(result.status).toBe('unauthorized');
        expect(result.orders).toBeUndefined();
    });

    it('list_active_offers no inventa "no hay promociones" cuando la consulta falla', async () => {
        const executor = createExecutor(jest.fn().mockRejectedValue(DB_DOWN));
        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'list_active_offers', {}, conversationId,
        );
        expect(result.status).toBe('error');
        expect(result.offers).toBeUndefined();
    });

    it('check_stock no convierte un fallo en "el producto no existe"', async () => {
        const broken = createExecutor(jest.fn().mockRejectedValue(DB_DOWN));
        const brokenResult: any = await broken.execute(
            schemaName, tenantId, contactId, 'check_stock', { productId: 'Ibuprofeno' }, conversationId,
        );
        expect(brokenResult.status).toBe('error');
        expect(brokenResult.error).toBe('read_failed');

        const missing = createExecutor(jest.fn().mockResolvedValue([]));
        const missingResult: any = await missing.execute(
            schemaName, tenantId, contactId, 'check_stock', { productId: 'Ibuprofeno' }, conversationId,
        );
        expect(missingResult.status).toBe('empty');
        expect(missingResult.product).toBeNull();
    });

    it('get_customer_context no degrada una base caída a "cliente nuevo"', async () => {
        const executor = createExecutor(jest.fn().mockRejectedValue(new Error('connection terminated')));
        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'get_customer_context', {}, conversationId,
        );
        expect(result.status).toBe('error');
        // Lo importante: no devuelve `{contact: null, lead: null,
        // opportunitiesCount: 0}`, que el agente leería como cliente nuevo.
        expect(result.contact).toBeUndefined();
    });

    it('get_customer_context reporta lectura parcial en vez de fingir CRM vacío', async () => {
        const query = jest.fn()
            .mockResolvedValueOnce([{ id: contactId, name: 'Nir', tags: [], first_contact_at: null, last_contact_at: null }])
            .mockRejectedValueOnce(new Error('leads missing'))
            .mockRejectedValueOnce(new Error('opportunities missing'));
        const executor = createExecutor(query);

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'get_customer_context', {}, conversationId,
        );

        expect(result.status).toBe('ok');
        expect(result.health).toBe('degraded');
        expect(result.unreadable).toEqual(['lead', 'opportunities']);
        expect(result.opportunitiesCount).toBeNull();
    });

    it('search_knowledge_base distingue "sin KB", "sin resultados" y "falló"', async () => {
        const noKb = createExecutor(jest.fn(), {
            knowledgeService: { tenantHasKnowledge: jest.fn().mockResolvedValue(false), searchRelevant: jest.fn() },
        });
        const noKbResult: any = await noKb.execute(
            schemaName, tenantId, contactId, 'search_knowledge_base', { query: 'devoluciones' }, conversationId,
        );
        expect(noKbResult.status).toBe('empty');
        expect(noKbResult.chunks).toEqual([]);

        const noHits = createExecutor(jest.fn(), {
            knowledgeService: {
                tenantHasKnowledge: jest.fn().mockResolvedValue(true),
                searchRelevant: jest.fn().mockResolvedValue([]),
            },
        });
        const noHitsResult: any = await noHits.execute(
            schemaName, tenantId, contactId, 'search_knowledge_base', { query: 'devoluciones' }, conversationId,
        );
        expect(noHitsResult.status).toBe('empty');

        const broken = createExecutor(jest.fn(), {
            knowledgeService: {
                tenantHasKnowledge: jest.fn().mockResolvedValue(true),
                searchRelevant: jest.fn().mockRejectedValue(new Error('pgvector down')),
            },
        });
        const brokenResult: any = await broken.execute(
            schemaName, tenantId, contactId, 'search_knowledge_base', { query: 'devoluciones' }, conversationId,
        );
        expect(brokenResult.status).toBe('error');
        expect(brokenResult.chunks).toBeUndefined();
    });
});

describe('el contrato de lectura', () => {
    it('detecta vacío desde el payload en vez de confiar en el llamador', () => {
        expect(readOk({ items: [] }).status).toBe('empty');
        expect(readOk({ items: [1] }).status).toBe('ok');
        expect(readOk({ contact: null }).status).toBe('empty');
    });

    it('declara siempre fuente y frescura', () => {
        const result = readOk({ items: [1] });
        expect(result.source).toBe('tenant_db');
        expect(Date.parse(result.asOf)).not.toBeNaN();
    });

    it('marca stale cuando el espejo superó su presupuesto de frescura', () => {
        const old = new Date(Date.now() - 8 * 86_400_000).toISOString();
        const result = readOk({ items: [1] }, { source: 'hostaway', asOf: old });
        expect(result.stale).toBe(true);
        expect(result.status).toBe('stale');
    });

    it('tenant_db se lee en vivo: no se marca stale por antigüedad', () => {
        const old = new Date(Date.now() - 8 * 86_400_000).toISOString();
        expect(readOk({ items: [1] }, { asOf: old }).stale).toBeUndefined();
    });

    it('todo fallo lleva `error` para que el guard de outcome lo repruebe', () => {
        for (const failure of [
            readFailed(),
            readProviderDown('hostaway'),
            readUnauthorized(),
        ]) {
            expect(failure.error).toEqual(expect.any(String));
            expect(isFailedRead(failure)).toBe(true);
        }
        expect(isFailedRead(readOk({ items: [1] }))).toBe(false);
        expect(isFailedRead(readEmpty({ items: [] }))).toBe(false);
    });

    it('un mensaje de fallo no expone detalle técnico por defecto', () => {
        expect(readFailed().message).not.toMatch(/SELECT|relation|uuid|Error:/i);
    });
});

describe('el saneo también limpia el campo `error`', () => {
    it('reemplaza prosa técnica que viajaba en `error`, no solo en `message`', () => {
        const raw = { error: 'relation "tenant_x.orders" does not exist' };
        const clean = sanitizeToolResultForModel(raw, 'es');
        expect(clean.error).toBe('tool_failed');
        expect(clean.message).not.toMatch(/relation|tenant_x/);
    });

    it('conserva los códigos estables sobre los que el modelo razona', () => {
        const raw = { error: 'slot_taken', message: 'Ese horario ya está tomado.' };
        expect(sanitizeToolResultForModel(raw, 'es')).toEqual(raw);
    });

    it('no toca un resultado exitoso', () => {
        const ok = { orders: [{ id: 'a' }], status: 'ok' };
        expect(sanitizeToolResultForModel(ok, 'es')).toBe(ok);
    });

    it('neutraliza en el idioma del turno', () => {
        const raw = { error: 'column "x" does not exist' };
        expect(sanitizeToolResultForModel(raw, 'pt').message).toMatch(/operação/i);
        expect(sanitizeToolResultForModel(raw, 'fr').message).toMatch(/opération/i);
    });
});
