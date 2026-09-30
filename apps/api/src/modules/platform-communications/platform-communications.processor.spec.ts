import { randomUUID } from 'crypto';
import { PlatformCommunicationsProcessor } from './platform-communications.processor';

function setup() {
    const recipient: any = {
        id: randomUUID(), userId: randomUUID(), tenantId: randomUUID(), email: 'user@example.com', language: 'es', status: 'processing', claimToken: randomUUID(),
        campaign: { id: randomUUID(), audience: 'all', recipientRole: 'all', tenantIds: [], content: { es: { subject: 'Notice', body: 'Body' } } },
    };
    const db: any = {
        $queryRawUnsafe: jest.fn().mockResolvedValue([]),
        platformCommunicationRecipient: { findUnique: jest.fn(async () => recipient), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        platformCommunication: { updateMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
        user: { findFirst: jest.fn().mockResolvedValue({ email: recipient.email }) },
    };
    const email: any = { sendWithOutcome: jest.fn().mockResolvedValue({ status: 'accepted' }) };
    return { recipient, db, email, processor: new PlatformCommunicationsProcessor(db, email) };
}

describe('PlatformCommunicationsProcessor', () => {
    it('claims atomically with SKIP LOCKED and a unique ownership token', async () => {
        const { db, processor } = setup();
        const id = randomUUID();
        db.$queryRawUnsafe.mockImplementation(async (_sql: string, token: string) => [{ id, claimToken: token }]);
        const result = await processor.claimNext();
        expect(result).toMatchObject({ id, claimToken: expect.any(String) });
        const [sql, token] = db.$queryRawUnsafe.mock.calls[0];
        expect(sql).toContain('LIMIT 1 FOR UPDATE OF r SKIP LOCKED');
        expect(sql).toContain("r.status = 'pending'");
        expect(sql).toContain("c.status IN ('queued', 'sending')");
        expect(sql).toContain('claim_token = $1::uuid');
        expect(result!.claimToken).toBe(token);
    });

    it.each([null, { email: 'changed@example.com' }])('skips removed eligibility or a changed address without SMTP', async (eligible) => {
        const { db, email, processor, recipient } = setup();
        db.user.findFirst.mockResolvedValue(eligible);
        await processor.processRecipient(recipient.id, recipient.claimToken);
        expect(email.sendWithOutcome).not.toHaveBeenCalled();
        expect(db.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: recipient.userId, tenantId: recipient.tenantId, isActive: true }) }));
        expect(db.platformCommunicationRecipient.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'skipped', errorCode: 'RECIPIENT_NO_LONGER_ELIGIBLE' } }));
    });

    it.each(['accepted', 'failed', 'unknown'])('persists %s without automatic retry', async (status) => {
        const { db, email, processor, recipient } = setup();
        email.sendWithOutcome.mockResolvedValue({ status });
        await processor.processRecipient(recipient.id, recipient.claimToken);
        expect(email.sendWithOutcome).toHaveBeenCalledTimes(1);
        expect(db.platformCommunicationRecipient.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: recipient.id, claimToken: recipient.claimToken, status: 'processing' }, data: expect.objectContaining({ status }) }));
    });

    it('a stale processing record becomes unknown and is never reclaimed', async () => {
        const { db, processor, email } = setup();
        await processor.processBatch();
        expect(db.platformCommunicationRecipient.updateMany).toHaveBeenCalledWith({
            where: { status: 'processing', claimedAt: { lt: expect.any(Date) } }, data: { status: 'unknown', errorCode: 'SMTP_OUTCOME_UNKNOWN' },
        });
        expect(email.sendWithOutcome).not.toHaveBeenCalled();
    });

    it('rejects a worker with an old claim token', async () => {
        const { processor, recipient, email } = setup();
        await processor.processRecipient(recipient.id, randomUUID());
        expect(email.sendWithOutcome).not.toHaveBeenCalled();
    });
});
