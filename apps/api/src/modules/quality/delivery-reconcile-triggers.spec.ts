import { AGENT_QUALITY_DEPENDENCIES_UPDATED } from './agent-quality-events';
import { AccountPauseStore } from '../channels/account-pause-store';
import { WhatsappConnectionService } from '../whatsapp/services/whatsapp-connection.service';
import { WhatsappSpendController } from '../billing/whatsapp-spend/whatsapp-spend.controller';

/**
 * `whatsapp_delivery` is persisted as a signal, and signals are only rewritten
 * when something asks for a reconcile. Without these three triggers the red bar
 * would appear hours after a number stopped delivering — and, worse, stay for
 * hours after the owner fixed it. Each trigger is best effort: the change it
 * follows is already written, and an emitter that throws must not undo it.
 */
const TENANT = '11111111-1111-4111-8111-111111111111';
const reconcile = { tenantId: TENANT, source: 'channel_connection' };

describe('what re-evaluates whatsapp_delivery', () => {
    describe('the funding pause', () => {
        function store(emit = jest.fn()) {
            let metadata: Record<string, unknown> = {};
            const prisma = {
                channelAccount: {
                    findFirst: jest.fn(async () => ({ id: 'acct-1', metadata })),
                    update: jest.fn(async ({ data }: any) => { metadata = data.metadata; return {}; }),
                },
            };
            return { store: new AccountPauseStore(prisma as any, { emit } as any), emit };
        }

        it('asks once when a number is paused, not on every refused message', async () => {
            const { store: pauses, emit } = store();
            await pauses.observeFunding(TENANT, 'wa-1', { source: 'http_response', code: 131042, detail: 'payment' });
            await pauses.observeFunding(TENANT, 'wa-1', { source: 'status_webhook', code: 131042, detail: 'payment' });
            expect(emit).toHaveBeenCalledTimes(1);
            expect(emit).toHaveBeenCalledWith(AGENT_QUALITY_DEPENDENCIES_UPDATED, reconcile);
        });

        it('asks again when the pause is lifted, so the alert clears with it', async () => {
            const { store: pauses, emit } = store();
            await pauses.observeFunding(TENANT, 'wa-1', { source: 'http_response', code: 131042 });
            emit.mockClear();
            await pauses.clear(TENANT, 'wa-1', { by: 'operator', note: 'tarjeta agregada' });
            expect(emit).toHaveBeenCalledWith(AGENT_QUALITY_DEPENDENCIES_UPDATED, reconcile);
            // Clearing what is not paused is not a transition.
            emit.mockClear();
            await pauses.clear(TENANT, 'wa-1', { by: 'operator' });
            expect(emit).not.toHaveBeenCalled();
        });

        it('a failing emitter never turns into a second failure', async () => {
            const { store: pauses } = store(jest.fn(() => { throw new Error('bus down'); }));
            await expect(pauses.observeFunding(TENANT, 'wa-1', { source: 'http_response', code: 131042 }))
                .resolves.toMatchObject({ reason: 'funding_not_ready' });
            await expect(pauses.clear(TENANT, 'wa-1', { by: 'operator' })).resolves.toMatchObject({ clearedBy: 'operator' });
        });
    });

    describe('the billing time zone', () => {
        function service(emit: jest.Mock) {
            const prisma = {
                channelAccount: {
                    findFirst: jest.fn().mockResolvedValue({ id: 'acct-1', metadata: {} }),
                    findMany: jest.fn().mockResolvedValue([]),
                    update: jest.fn().mockResolvedValue({}),
                },
            };
            return new WhatsappConnectionService(
                prisma as any, {} as any, { get: () => undefined } as any, {} as any, undefined, { emit } as any,
            );
        }

        it('asks as soon as the owner sets it', async () => {
            const emit = jest.fn();
            await service(emit).setBillingTimeZone(TENANT, '15550001111', 'America/Bogota');
            expect(emit).toHaveBeenCalledWith(AGENT_QUALITY_DEPENDENCIES_UPDATED, reconcile);
        });

        it('does not ask for a zone it refused, and a failing emitter does not fail the save', async () => {
            const emit = jest.fn();
            await expect(service(emit).setBillingTimeZone(TENANT, '15550001111', '-5')).rejects.toBeDefined();
            expect(emit).not.toHaveBeenCalled();
            await expect(service(jest.fn(() => { throw new Error('bus down'); }))
                .setBillingTimeZone(TENANT, '15550001111', 'America/Bogota')).resolves.toMatchObject({ timeZone: 'America/Bogota' });
        });
    });

    it('asks when spend protection changes mode: `enforce` turns an unknown currency into a stop', async () => {
        const tx = {
            $queryRawUnsafe: jest.fn(async () => [{ value: { enforcement: 'observe' } }]),
            $executeRawUnsafe: jest.fn(async () => 1),
            auditLog: { create: jest.fn(async () => ({})) },
        };
        const prisma = { $transaction: jest.fn(async (work: any) => work(tx)) } as any;
        const admission = {
            invalidateEnforcement: jest.fn(async () => undefined),
            cacheEnforcement: jest.fn(async () => undefined),
        };
        const emit = jest.fn();
        const controller = new WhatsappSpendController(prisma, {} as any, {} as any, admission as any, { emit } as any);
        await controller.setPolicyEnforcement({ user: { tenantId: TENANT, id: 'owner-1' } }, { enforcement: 'enforce' });
        expect(emit).toHaveBeenCalledWith(AGENT_QUALITY_DEPENDENCIES_UPDATED, { tenantId: TENANT, source: 'tenant_settings' });
    });
});
