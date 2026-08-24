import { IntegrationWebhookWorker } from './integration-webhook.worker';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const SCHEMA = 'tenant_webhook';

const entry = (over: Record<string, any> = {}) => ({
    id: '22222222-2222-4222-8222-222222222222',
    provider: 'hostaway',
    externalEventId: 'event-1',
    eventType: 'reservation.updated',
    payload: { reservationId: 'remote-1' },
    status: 'processing',
    receivedAt: new Date().toISOString(),
    attempts: 0,
    claim: {
        token: '55555555-5555-4555-8555-555555555555',
        generation: 1,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
    },
    ...over,
});

function build(entries: any[] = []) {
    const inbox: any = {
        trackedTenants: jest.fn().mockResolvedValue([
            { id: TENANT_ID, schemaName: SCHEMA, name: 'Tenant' },
        ]),
        claimWebhooks: jest.fn().mockResolvedValue(entries),
        markWebhookProcessed: jest.fn().mockResolvedValue(true),
        markWebhookFailed: jest.fn().mockResolvedValue('received'),
    };
    const worker = new IntegrationWebhookWorker(inbox, { runExclusive: jest.fn() } as any);
    jest.spyOn((worker as any).logger, 'warn').mockImplementation(() => undefined);
    return { worker, inbox };
}

describe('worker provider-neutral del webhook inbox', () => {
    it('consulta sólo el registro de tenants con webhooks', async () => {
        const { worker, inbox } = build();

        await worker.drainAll();

        expect(inbox.trackedTenants).toHaveBeenCalledWith('webhook');
    });

    it('sin handler certificado no toma eventos ni requiere credenciales', async () => {
        const { worker, inbox } = build([entry()]);
        await expect(worker.drainAll()).resolves.toEqual({ processed: 0, failed: 0 });
        expect(worker.registeredProviders()).toEqual([]);
        expect(inbox.claimWebhooks).not.toHaveBeenCalled();
    });

    it('arrienda, procesa y confirma una vez mediante un handler explícito', async () => {
        const item = entry();
        const { worker, inbox } = build([item]);
        const handler = {
            provider: 'hostaway',
            eventTypes: ['reservation.updated'],
            handle: jest.fn().mockResolvedValue({ ok: true }),
        };
        worker.register(handler);

        await expect(worker.drainAll()).resolves.toEqual({ processed: 1, failed: 0 });

        expect(inbox.claimWebhooks).toHaveBeenCalledWith(SCHEMA, 'hostaway', 50);
        expect(handler.handle).toHaveBeenCalledWith(item, { tenantId: TENANT_ID, schemaName: SCHEMA });
        expect(inbox.markWebhookProcessed).toHaveBeenCalledWith(SCHEMA, item);
        expect(inbox.markWebhookFailed).not.toHaveBeenCalled();
    });

    it('un evento no soportado falla terminalmente y no llega al handler', async () => {
        const item = entry({ eventType: 'unknown.event' });
        const { worker, inbox } = build([item]);
        const handler = {
            provider: 'hostaway',
            eventTypes: ['reservation.updated'],
            handle: jest.fn(),
        };
        worker.register(handler);

        await expect(worker.drainAll()).resolves.toEqual({ processed: 0, failed: 1 });
        expect(handler.handle).not.toHaveBeenCalled();
        expect(inbox.markWebhookFailed).toHaveBeenCalledWith(
            SCHEMA, item, 'event_type_not_supported:unknown.event', false,
        );
    });

    it('una caída del handler vuelve al backoff durable sin perder el evento', async () => {
        const item = entry();
        const { worker, inbox } = build([item]);
        worker.register({
            provider: 'hostaway',
            handle: jest.fn().mockRejectedValue(new Error('temporary outage')),
        });

        await expect(worker.drainAll()).resolves.toEqual({ processed: 0, failed: 1 });
        expect(inbox.markWebhookFailed).toHaveBeenCalledWith(
            SCHEMA, item, 'temporary outage', true,
        );
    });

    it('un handler tardío no marca procesada una generación reclamada por otro worker', async () => {
        const item = entry();
        const { worker, inbox } = build([item]);
        inbox.markWebhookProcessed.mockResolvedValue(false);
        worker.register({
            provider: 'hostaway',
            handle: jest.fn().mockResolvedValue({ ok: true }),
        });

        await expect(worker.drainAll()).resolves.toEqual({ processed: 0, failed: 1 });
        expect(inbox.markWebhookProcessed).toHaveBeenCalledWith(SCHEMA, item);
    });

    it('rechaza dos handlers para el mismo proveedor', () => {
        const { worker } = build();
        const handler = { provider: 'hostaway', handle: jest.fn() };
        worker.register(handler as any);
        expect(() => worker.register(handler as any)).toThrow('Ya hay un webhook handler');
    });
});
