import * as fs from 'fs';
import * as path from 'path';
import { OutboundQueueProcessor } from './outbound-queue.processor';
import { SpendMeterUnavailable } from '../billing/whatsapp-spend/spend-unavailable';
import { permissiveSpendGate, unavailableSpendGate } from './__fixtures__/spend-gate-double';

/**
 * ═══ AN UNAVAILABLE METER DEFERS. IT NEVER PERMITS. ═══
 *
 * The bug this fixes was not a missing feature — it was a `return null` that
 * thirteen call sites read as "no gate wired, carry on". Every one of those
 * paths could put a WhatsApp message on a customer's phone, and a charge on the
 * business's WABA, with nothing recording that either happened.
 *
 * These tests assert the two halves of the correction and nothing else:
 *
 *   1. A chargeable OUTBOUND with an unreachable meter sends NOTHING and hands
 *      the job back for retry.
 *   2. INBOUND is untouched by any of it. A platform that stopped listening
 *      because it could not count would turn a billing problem into a lost
 *      customer, which is strictly worse than the problem.
 */
describe('the spend meter fails closed on outbound and never gates inbound', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';

    function harness(spendGate: any, prismaOverrides: Record<string, unknown> = {}) {
        const channelGateway = { sendMessage: jest.fn(async () => 'wamid.SENT') };
        const throttle = {
            isOverLimit: jest.fn(async () => false),
            recordUsage: jest.fn(async () => undefined),
        };
        const channelToken = {
            getChannelToken: jest.fn(async () => ({ accessToken: 'token' })),
            // The real resolver's shape, not a convenient one: `fromSendContext`
            // reads `payer` and `credential`, and a double missing either would
            // silently fall back to the hand-made triple this lane stopped using.
            resolveSendContext: jest.fn(async () => ({ context: {
                tenantId, channelType: 'whatsapp', channelAccountId: 'phone-1',
                channelAddress: '+573000000000',
                payer: { kind: 'business_direct', wabaId: 'waba-1', businessId: 'biz-1' },
                credential: { id: 'cred-1', source: 'channel_account', accessToken: 'token' },
                recipient: { scope: 'customer', address: '+573001112233', contactId: null },
            } })),
        };
        const redis = { get: jest.fn(async () => null), set: jest.fn(async () => undefined) };
        const prisma = {
            tenant: { findUnique: jest.fn(async () => ({
                isInternal: false, subscriptionStatus: 'active',
                subscription: { status: 'active', trialEndsAt: null, cancelAtPeriodEnd: false,
                    currentPeriodEnd: null, cancellationReason: null, dunningStartedAt: null },
            })) },
            getTenantSchemaName: jest.fn(async () => 'tenant_acme'),
            ...prismaOverrides,
        };
        const processor = new OutboundQueueProcessor(
            channelGateway as any, throttle as any, channelToken as any,
            redis as any, { send: jest.fn() } as any, prisma as any, spendGate,
        );
        const job: any = { id: 'job-1', data: { outbound: {
            tenantId, channelType: 'whatsapp', channelAccountId: 'phone-1',
            to: '+573001112233', content: { type: 'text', text: 'hola' },
            metadata: { conversationId: 'conv-1' },
        } } };
        return { processor, job, channelGateway, prisma, spendGate };
    }

    it('sends nothing and defers when the meter cannot answer', async () => {
        const h = harness(unavailableSpendGate());

        await expect(h.processor.process(h.job)).rejects.toBeInstanceOf(SpendMeterUnavailable);

        // The whole point. Not "sent and unrecorded", not "refused": nothing
        // left the process, so a retry in thirty seconds costs the customer a
        // short wait and the business nothing at all.
        expect(h.channelGateway.sendMessage).not.toHaveBeenCalled();
    });

    it('sends nothing and defers when the tenant schema cannot be resolved', async () => {
        // The failure that actually happened in the audit: a schema lookup that
        // threw produced `return null`, and `null` meant "carry on".
        const h = harness(permissiveSpendGate(), {
            getTenantSchemaName: jest.fn(async () => { throw new Error('pool exhausted'); }),
        });

        await expect(h.processor.process(h.job)).rejects.toBeInstanceOf(SpendMeterUnavailable);
        expect(h.channelGateway.sendMessage).not.toHaveBeenCalled();
        expect(h.spendGate.admit).not.toHaveBeenCalled();
    });

    it('sends nothing when the transmission right belongs to someone else', async () => {
        // Distinct from an unavailable meter: the authority answered, and the
        // answer was "another worker already holds this send". That is not an
        // error, so the job completes — having sent nothing.
        const h = harness(permissiveSpendGate({ beginTransmission: jest.fn(async () => false) }));

        await expect(h.processor.process(h.job)).resolves.toBe('skipped:transmission_not_owned');
        expect(h.channelGateway.sendMessage).not.toHaveBeenCalled();
    });

    it('sends when the meter is reachable and grants the right', async () => {
        // The control. Without it the three tests above would pass against a
        // processor that had simply stopped sending.
        const h = harness(permissiveSpendGate());

        await expect(h.processor.process(h.job)).resolves.toBe('wamid.SENT');
        expect(h.channelGateway.sendMessage).toHaveBeenCalledTimes(1);
    });

    /**
     * The inbound half, proven structurally rather than by simulation.
     *
     * A test that ran one inbound message through a down meter would prove that
     * ONE path does not consult it. What has to be true is stronger: the
     * ingress has no way to consult it at all, so no future edit can quietly
     * make receiving a message depend on being able to bill for one.
     */
    it('gives the inbound ingress no way to reach the spend meter', () => {
        const root = path.join(__dirname, '..');
        const ingress = [
            'inbound/inbound-queue.service.ts',
            'inbound/inbound-queue.module.ts',
            'internal/internal.controller.ts',
            'whatsapp/services/whatsapp-webhook.service.ts',
        ];
        for (const relative of ingress) {
            const file = path.join(root, relative);
            expect(fs.existsSync(file)).toBe(true);
            const source = fs.readFileSync(file, 'utf8');
            expect(source).not.toMatch(/whatsapp-send-admission|WhatsappSendAdmissionService/);
            expect(source).not.toMatch(/SpendMeterUnavailable/);
        }
    });
});
