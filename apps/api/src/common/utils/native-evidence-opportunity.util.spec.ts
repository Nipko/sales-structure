import { BadRequestException } from '@nestjs/common';
import { resolveNativeEvidenceOpportunity } from './native-evidence-opportunity.util';

const CONTACT_ID = '11111111-1111-4111-8111-111111111111';
const OPPORTUNITY_A = '22222222-2222-4222-8222-222222222222';
const OPPORTUNITY_B = '33333333-3333-4333-8333-333333333333';
const CONVERSATION_ID = '44444444-4444-4444-8444-444444444444';

describe('resolveNativeEvidenceOpportunity', () => {
    it('accepts an exact trusted active opportunity for the same contact', async () => {
        const query = jest.fn().mockResolvedValue([{ id: OPPORTUNITY_A }]);

        await expect(resolveNativeEvidenceOpportunity(query, {
            contactId: CONTACT_ID,
            trustedOpportunityId: OPPORTUNITY_A,
        })).resolves.toBe(OPPORTUNITY_A);

        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0][0]).toContain('o.id = $1::uuid');
        expect(query.mock.calls[0][0]).toContain('l.contact_id = $2::uuid');
        expect(query.mock.calls[0][0]).toContain('FROM contact_identities evidence_identity');
        expect(query.mock.calls[0][0]).toContain(
            'lead_identity.customer_profile_id = evidence_identity.customer_profile_id',
        );
        expect(query.mock.calls[0][0]).toContain('FOR SHARE OF o');
        expect(query.mock.calls[0][1]).toEqual([OPPORTUNITY_A, CONTACT_ID]);
    });

    it('rejects an explicit opportunity owned by another contact or already closed', async () => {
        const query = jest.fn().mockResolvedValue([]);

        await expect(resolveNativeEvidenceOpportunity(query, {
            contactId: CONTACT_ID,
            trustedOpportunityId: OPPORTUNITY_A,
        })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('uses a unique server conversation match before contact-wide candidates', async () => {
        const query = jest.fn().mockResolvedValueOnce([{ id: OPPORTUNITY_A }]);

        await expect(resolveNativeEvidenceOpportunity(query, {
            contactId: CONTACT_ID,
            conversationId: CONVERSATION_ID,
        })).resolves.toBe(OPPORTUNITY_A);

        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0][0]).toContain('o.conversation_id = $2::uuid');
        expect(query.mock.calls[0][1]).toEqual([CONTACT_ID, CONVERSATION_ID]);
    });

    it('fails closed when one conversation has two active opportunities', async () => {
        const query = jest.fn().mockResolvedValueOnce([
            { id: OPPORTUNITY_A },
            { id: OPPORTUNITY_B },
        ]);

        await expect(resolveNativeEvidenceOpportunity(query, {
            contactId: CONTACT_ID,
            conversationId: CONVERSATION_ID,
        })).resolves.toBeNull();

        expect(query).toHaveBeenCalledTimes(1);
    });

    it('falls back to the sole active opportunity for the contact', async () => {
        const query = jest.fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ id: OPPORTUNITY_A }]);

        await expect(resolveNativeEvidenceOpportunity(query, {
            contactId: CONTACT_ID,
            conversationId: CONVERSATION_ID,
        })).resolves.toBe(OPPORTUNITY_A);

        expect(query).toHaveBeenCalledTimes(2);
        expect(query.mock.calls[1][0]).not.toContain('conversation_id');
    });

    it('leaves evidence unowned when the contact has concurrent active opportunities', async () => {
        const query = jest.fn().mockResolvedValueOnce([
            { id: OPPORTUNITY_A },
            { id: OPPORTUNITY_B },
        ]);

        await expect(resolveNativeEvidenceOpportunity(query, {
            contactId: CONTACT_ID,
        })).resolves.toBeNull();
    });

    it('resolves candidates across contacts only through their unified customer profile', async () => {
        const query = jest.fn().mockResolvedValueOnce([{ id: OPPORTUNITY_A }]);

        await expect(resolveNativeEvidenceOpportunity(query, {
            contactId: CONTACT_ID,
        })).resolves.toBe(OPPORTUNITY_A);

        const sql = query.mock.calls[0][0];
        expect(sql).toContain('evidence_identity.contact_id = $1::uuid');
        expect(sql).toContain('lead_identity.contact_id = l.contact_id');
    });

    it('does not allow an opportunity owner without a contact', async () => {
        await expect(resolveNativeEvidenceOpportunity(jest.fn(), {
            contactId: null,
            trustedOpportunityId: OPPORTUNITY_A,
        })).rejects.toBeInstanceOf(BadRequestException);
    });
});
