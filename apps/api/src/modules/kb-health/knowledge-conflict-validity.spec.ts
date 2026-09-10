import { KnowledgeConflictService } from './knowledge-conflict.service';
import { conflictSourceVisible } from './knowledge-conflict.contracts';

/**
 * A policy that is in force right now has to be visible to conflict review
 * right now.
 *
 * `policies.effective_from` is a naive TIMESTAMP written by the database's own
 * `NOW()`, so it carries no offset — and `new Date('2026-09-08T22:44:24')`
 * reads a string without one as LOCAL time. West of UTC that moves the date a
 * day forward, while `conflictSourceVisible` compares it against a date
 * computed in UTC. The two disagreed for the last hours of every day, and in
 * that window every conflict involving a policy silently disappeared from
 * review: the case row was there, the hashes matched, and the source was
 * simply judged not yet effective.
 */
describe('when a policy counts as being in force', () => {
    const service: any = Object.create(KnowledgeConflictService.prototype);
    const scope = { audience: 'customer' as const, agentId: null, jurisdiction: null };
    const policy = (effectiveFrom: string | null, effectiveTo: string | null = null) => service.source('policy', {
        id: '11111111-1111-4111-8111-111111111111', type: 'terms', title: 'Condiciones',
        content: 'Las consultas son los lunes.', version: 2, is_active: true,
        effective_from: effectiveFrom, effective_to: effectiveTo,
        updated_at: '2026-09-08T22:44:24.791',
    });

    it('reads the calendar date the database stored, not one shifted by the timezone', () => {
        // 22:44 UTC on the 8th. Read as local time west of UTC this becomes the
        // 9th, and a policy effective today reads as effective tomorrow.
        // Both ends of the day on purpose. Re-timezoning moves the late hour
        // forward west of UTC and the early hour back east of it, so the pair
        // fails on any machine whose clock is not UTC — which is the most a
        // test can claim here, since the defect genuinely cannot show on one
        // that is.
        expect(policy('2026-09-08T22:44:24.791').validFrom).toBe('2026-09-08');
        expect(policy('2026-09-08T01:30:00.000').validFrom).toBe('2026-09-08');
        expect(policy('2026-09-08T00:00:00.000').validFrom).toBe('2026-09-08');
        expect(policy('2026-09-08T23:59:59.999').validFrom).toBe('2026-09-08');
        expect(policy(null, '2026-09-08T23:59:59.999').validTo).toBe('2026-09-08');
    });

    it('keeps a policy stamped at any hour of today visible today', () => {
        for (const hour of ['00', '06', '12', '19', '22', '23']) {
            expect(conflictSourceVisible(policy(`2026-09-08T${hour}:30:00.000`), scope, '2026-09-08'))
                .toBe(true);
        }
    });

    it('still refuses one that genuinely has not started or has ended', () => {
        expect(conflictSourceVisible(policy('2026-09-09T00:00:00.000'), scope, '2026-09-08')).toBe(false);
        expect(conflictSourceVisible(policy(null, '2026-09-07T23:59:59.999'), scope, '2026-09-08')).toBe(false);
    });

    it('accepts the offset-bearing and Date forms the same way', () => {
        expect(policy('2026-09-08T22:44:24.791Z').validFrom).toBe('2026-09-08');
        expect(service.source('policy', {
            id: '11111111-1111-4111-8111-111111111111', type: 'terms', title: 'Condiciones',
            content: 'x', version: 1, is_active: true,
            effective_from: new Date('2026-09-08T22:44:24.791Z'), effective_to: null,
            updated_at: '2026-09-08T22:44:24.791',
        }).validFrom).toBe('2026-09-08');
        expect(policy('not a date').validFrom).toBeNull();
    });

    it('leaves a document date-only column alone', () => {
        const document = service.source('document', {
            id: '22222222-2222-4222-8222-222222222222', title: 'Doc', content_text: 'x', status: 'ready',
            version: 1, audience: 'customer', agent_ids: [], is_regulated: false,
            valid_from: '2026-09-08', valid_to: null, updated_at: '2026-09-08T22:44:24.791',
        });
        expect(document.validFrom).toBe('2026-09-08');
    });
});
