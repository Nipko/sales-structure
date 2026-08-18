import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { TenantPaymentsService } from './tenant-payments.service';

const TENANT = '3e8ad32e-a16b-42e6-9634-b8e8cc29292d';
const INTENT = '131aec15-2726-4467-90ac-0251e4c64cb7';

function parked(over: Record<string, unknown> = {}) {
    return {
        id: INTENT,
        provider: 'wompi',
        status: 'requires_review',
        canonicalReference: 'property:11111111-1111-4111-8111-111111111111',
        amountCents: 250_000,
        currency: 'COP',
        description: 'Pago de reserva de alojamiento 11111111',
        providerLinkId: 'link-1',
        ...over,
    } as any;
}

function harness(options: { intent?: any; recovery?: any; discarded?: any } = {}) {
    const store = {
        findById: jest.fn().mockResolvedValue(options.intent ?? parked()),
        discardUnresolvedIntent: jest.fn().mockResolvedValue(
            options.discarded === undefined ? parked({ status: 'expired' }) : options.discarded,
        ),
        listUnresolvedIntents: jest.fn().mockResolvedValue([parked()]),
    };
    const service = Object.create(TenantPaymentsService.prototype) as TenantPaymentsService;
    (service as any).store = store;
    (service as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    (service as any).requireStore = () => store;
    (service as any).recoverWompiIntentFromProvider = jest.fn()
        .mockResolvedValue(options.recovery ?? { outcome: 'no_transaction', intent: null });
    return { service, store };
}

describe('resolveUnresolvedIntent', () => {
    it('settles as paid ONLY from provider evidence, never from the operator', async () => {
        const h = harness({ recovery: { outcome: 'settled', intent: parked({ status: 'paid' }) } });

        const result = await h.service.resolveUnresolvedIntent(TENANT, INTENT, 'cliente mostró el comprobante');

        expect(result).toEqual({ outcome: 'settled', status: 'paid' });
        // The operator path must not be able to write a paid state itself.
        expect(h.store.discardUnresolvedIntent).not.toHaveBeenCalled();
    });

    it('releases the reference when the provider proves nobody paid', async () => {
        const h = harness({ recovery: { outcome: 'no_transaction', intent: null } });

        const result = await h.service.resolveUnresolvedIntent(TENANT, INTENT, 'nunca completó el pago');

        expect(result).toEqual({ outcome: 'released', status: 'expired' });
        const [, , reason] = h.store.discardUnresolvedIntent.mock.calls[0];
        expect(reason).toContain('operator_released');
        expect(reason).toContain('nunca completó el pago');
    });

    it('refuses to guess when the provider cannot be reached', async () => {
        // Closing a parked payment on a network failure could write off money
        // that actually arrived. Staying unresolved is the safe answer.
        const h = harness({ recovery: { outcome: 'unavailable', intent: null } });

        await expect(h.service.resolveUnresolvedIntent(TENANT, INTENT, 'revisión manual'))
            .rejects.toBeInstanceOf(ServiceUnavailableException);
        expect(h.store.discardUnresolvedIntent).not.toHaveBeenCalled();
    });

    it('lets a concurrent settlement win over the operator', async () => {
        // A webhook landed between the operator's read and this write; the
        // guarded UPDATE matches nothing and the settlement must stand.
        const h = harness({ recovery: { outcome: 'no_transaction', intent: null }, discarded: null });
        h.store.findById
            .mockResolvedValueOnce(parked())
            .mockResolvedValueOnce(parked({ status: 'paid' }));

        const result = await h.service.resolveUnresolvedIntent(TENANT, INTENT, 'cierre manual');

        expect(result).toEqual({ outcome: 'still_unresolved', status: 'paid' });
    });

    it('demands a usable reason so the audit row means something', async () => {
        const h = harness();
        for (const reason of ['', '  ', 'ok']) {
            await expect(h.service.resolveUnresolvedIntent(TENANT, INTENT, reason))
                .rejects.toBeInstanceOf(BadRequestException);
        }
        expect(h.store.findById).not.toHaveBeenCalled();
    });

    it('refuses to touch an intent that is not parked', async () => {
        const h = harness({ intent: parked({ status: 'paid' }) });

        await expect(h.service.resolveUnresolvedIntent(TENANT, INTENT, 'quiero reabrirlo'))
            .rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses an intent that does not exist', async () => {
        const h = harness();
        h.store.findById.mockResolvedValue(null);

        await expect(h.service.resolveUnresolvedIntent(TENANT, INTENT, 'no existe'))
            .rejects.toBeInstanceOf(BadRequestException);
    });

    it('lists parked payments without leaking the contact or the snapshot', async () => {
        const h = harness();

        const rows = await h.service.listUnresolvedIntents(TENANT);

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ id: INTENT, status: 'requires_review', amountCents: 250_000 });
        expect(rows[0]).not.toHaveProperty('contactId');
        expect(rows[0]).not.toHaveProperty('resourceSnapshot');
    });
});
