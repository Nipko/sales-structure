import { DripSequenceService } from './drip-sequence.service';

/**
 * AUT-17 follow-up: `enrollSegment` used to count EVERY thrown error as "no contact",
 * which hid a systematic failure (every enrolment failing) behind a plausible number.
 * A real error is reported as `failed`; `skippedNoContact` is only for leads without a
 * usable phone.
 */
describe('DripSequenceService.enrollSegment reports real failures as failed', () => {
    const build = (enrollOne: jest.Mock) => {
        const svc: any = Object.create(DripSequenceService.prototype);
        Object.assign(svc, {
            segmentsService: {
                getSegmentContacts: async () => [
                    { id: 'l1', contact_id: 'c1', phone: '+573001112233' },
                    { id: 'l2', contact_id: 'c2', phone: 'not-a-phone' },
                    { id: 'l3', contact_id: 'c3', phone: '+573001112244' },
                ],
            },
            compliance: { isBlocked: async () => false },
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
        svc.tenantSchema = async () => 'tenant_x';
        svc.ensureDripTables = async () => undefined;
        svc.getSequence = async () => ({ is_active: true, steps: [{ message_type: 'template', delay_seconds: 0 }] });
        svc.resolveChannelCredentials = async () => ({ accessToken: 't', accountId: 'a' });
        svc.resolveOrCreateConversation = async () => 'conv';
        svc.enrollOne = enrollOne;
        return svc;
    };

    it('counts an enrolment error as failed, not as skippedNoContact, and keeps going', async () => {
        const enrollOne = jest.fn()
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce({ id: 'e2' });
        const result = await build(enrollOne).enrollSegment('t1', 's1', 'seg1');
        expect(result).toMatchObject({ matched: 3, enrolled: 1, failed: 1, skippedNoContact: 1, skippedDuplicate: 0 });
    });
});
