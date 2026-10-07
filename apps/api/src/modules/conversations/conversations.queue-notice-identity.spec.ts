import { ConversationsService } from './conversations.service';

/**
 * The queue notice answers a waiting message but is not THE answer to it. After
 * the unattended return that very message is processed again, and the outbox
 * identifies a batch by its origin: a notice that took the inbound as its origin
 * made the real answer look "already sent" (`findBatchForInbound`) and the
 * customer stayed in silence. So the notice carries its own identity (the
 * handoff episode) and keeps the reactive, service-reply treatment.
 */
describe('the queue notice does not occupy the identity of the message it answers', () => {
    const INBOUND = '88888888-8888-4888-8888-888888888888';
    const CONTACT = '22222222-2222-4222-8222-222222222222';

    function build() {
        const send = jest.fn().mockResolvedValue({ kind: 'prepared', originId: 'x' });
        const service: any = Object.create(ConversationsService.prototype);
        Object.assign(service, {
            proactiveDispatch: { send },
            channelGateway: { getStrictTransport: jest.fn().mockReturnValue({}) },
        });
        const input = (extra: Record<string, unknown> = {}) => ({
            tenantId: 't', conversation: { id: 'c1', contact_id: CONTACT },
            msg: { channelType: 'telegram', channelAccountId: 'bot', contactId: '12345' },
            operationalScope: { kind: 'agent' },
            item: { kind: 'text', payload: { text: 'hola' } },
            inboundMessageId: INBOUND, originKey: 'handoff-queue-notice:c1:2026-10-05T20:00:00Z',
            ...extra,
        });
        return { service, send, input };
    }

    it('with its own identity: proactive origin, reactive treatment, replying to the inbound', async () => {
        const { service, send, input } = build();
        await service.replyOnceThroughOutbox(input({ ownIdentity: true }));
        const arg = send.mock.calls[0][1];
        expect(arg).toMatchObject({ originKind: 'proactive', disposition: 'reactive', replyToMessageId: INBOUND });
        expect(arg.inboundMessageId).toBeUndefined();
    });

    it('every other deterministic reply still names the inbound as its origin', async () => {
        const { service, send, input } = build();
        await service.replyOnceThroughOutbox(input());
        expect(send.mock.calls[0][1]).toMatchObject({ originKind: 'inbound_reply', inboundMessageId: INBOUND });
        expect(send.mock.calls[0][1].disposition).toBeUndefined();
    });

    it('sendQueueNoticeOnce asks for the notice to have its own identity', async () => {
        const service: any = Object.create(ConversationsService.prototype);
        const replyOnce = jest.fn().mockResolvedValue(true);
        Object.assign(service, {
            logger: { warn: jest.fn(), log: jest.fn() },
            prisma: {
                executeInTenantSchema: jest.fn(async (_s: string, sql: string) => {
                    if (sql.includes('to_regclass')) return [{ t: 'agent_dispatch_outbox' }];
                    if (sql.startsWith('SELECT 1 FROM conversations c')) return [];
                    if (sql.includes('queueNoticeSent')) return [{ id: 'c1' }];
                    return [];
                }),
            },
            languageDetector: { detect: jest.fn().mockReturnValue('es') },
            replyOnceThroughOutbox: replyOnce,
        });
        await service.sendQueueNoticeOnce('t', 'tenant_x', { id: 'c1', metadata: { handoff: { startedAt: '2026-10-05T20:00:00Z' } } },
            { channelType: 'telegram' }, INBOUND, { kind: 'agent' }, 'hola', 'es');
        expect(replyOnce).toHaveBeenCalledTimes(1);
        expect(replyOnce.mock.calls[0][0]).toMatchObject({ ownIdentity: true, inboundMessageId: INBOUND });
    });
});
