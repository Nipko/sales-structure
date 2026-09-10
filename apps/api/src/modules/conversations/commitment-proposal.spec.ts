import { COMMITMENT_FAMILIES, commitmentFamilyForTool, declaredWriterFamilies } from './commitment-families';
import {
    COMMITMENT_ACTIONS, commitmentAgreedAmountSql, commitmentAgreedCurrencySql,
    commitmentOrphansSql, commitmentProposalHash, commitmentReviewResult,
    type CommitmentProposal,
} from './commitment-proposal';
import { EVAL_WRITER_SANDBOX_FAMILIES } from './agent-test-tool-policy';

/**
 * One contract for every family, checked as one contract.
 *
 * Eleven families were about to be closed one at a time, each with its own terms
 * module, its own hash and its own idea of what "changed" means — which is how
 * the four that already existed ended up different from each other. These tests
 * exist to keep that from happening again: the universe is the writer registry,
 * so a vertical added next month either declares how to rebuild its proposal or
 * fails here.
 */

const base = (over: Partial<CommitmentProposal> = {}): CommitmentProposal => ({
    version: 1, family: 'property_bookings', action: 'create',
    resources: [{ kind: 'property', id: 'p-1', name: 'Casa del lago', quantity: 2 }],
    window: { startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-10-04T00:00:00.000Z' },
    price: { amountCents: '450000', currency: 'COP' },
    conditions: ['nights_3', 'payment_deposit', 'deposit_percent_30'],
    contactId: '11111111-1111-4111-8111-111111111111',
    authority: { agentId: 'a-1', agentRevision: 'rev-1', inboundMessageId: 'm-1' },
    ...over,
});

describe('the proposal a customer agreed to', () => {
    it('hashes the same proposal the same way whatever order it was built in', () => {
        const one = base();
        const other = base({
            conditions: ['deposit_percent_30', 'payment_deposit', 'nights_3'],
            resources: [{ kind: 'property', id: 'p-1', name: 'Casa del lago', quantity: 2 }],
        });
        expect(commitmentProposalHash(one)).toBe(commitmentProposalHash(other));
    });

    it('changes when anything the customer was told changes', () => {
        const original = commitmentProposalHash(base());
        const moved: Array<[string, CommitmentProposal]> = [
            ['price', base({ price: { amountCents: '460000', currency: 'COP' } })],
            ['currency', base({ price: { amountCents: '450000', currency: 'USD' } })],
            ['dates', base({ window: { startAt: '2026-10-02T00:00:00.000Z', endAt: '2026-10-04T00:00:00.000Z' } })],
            ['resource', base({ resources: [{ kind: 'property', id: 'p-2', name: 'Casa del lago', quantity: 2 }] })],
            // A rename is a change: the guest agreed to a name, not to an id.
            ['name', base({ resources: [{ kind: 'property', id: 'p-1', name: 'Otra casa', quantity: 2 }] })],
            ['quantity', base({ resources: [{ kind: 'property', id: 'p-1', name: 'Casa del lago', quantity: 3 }] })],
            // "Free cancellation until Friday" is part of the agreement.
            ['conditions', base({ conditions: ['nights_3', 'payment_full'] })],
            ['customer', base({ contactId: '22222222-2222-4222-8222-222222222222' })],
            ['agent revision', base({ authority: { agentId: 'a-1', agentRevision: 'rev-2', inboundMessageId: 'm-1' } })],
            ['inbound message', base({ authority: { agentId: 'a-1', agentRevision: 'rev-1', inboundMessageId: 'm-2' } })],
        ];
        for (const [what, proposal] of moved) {
            expect(`${what}:${commitmentProposalHash(proposal)}`).not.toBe(`${what}:${original}`);
        }
    });

    it('refuses to hash something that is not a proposal', () => {
        // An invalid proposal must not be comparable to anything, or two
        // malformed ones would match each other and authorise a write.
        expect(commitmentProposalHash(null)).toBeNull();
        expect(commitmentProposalHash({})).toBeNull();
        expect(commitmentProposalHash(base({ version: 2 as any }))).toBeNull();
        expect(commitmentProposalHash(base({ action: 'sell' as any }))).toBeNull();
        expect(commitmentProposalHash(base({ price: { amountCents: '45.00', currency: 'COP' } }))).toBeNull();
        expect(commitmentProposalHash(base({ price: { amountCents: '4500', currency: 'pesos' } }))).toBeNull();
        expect(commitmentProposalHash(base({ contactId: '' }))).toBeNull();
        expect(commitmentProposalHash(base({ resources: [{ kind: 'p', id: 'x', name: 'y', quantity: 0 }] }))).toBeNull();
    });

    it('tells the customer what the new terms are, not that something changed', () => {
        const result = commitmentReviewResult('property_bookings', base());
        expect(result).toMatchObject({ error: 'commitment_terms_changed', persisted: false, requiresConfirmation: true });
        // The useful next sentence is "it went up to X, do you still want it?",
        // which needs the current proposal in hand.
        expect((result as any).proposal).toEqual(base());
    });
});

describe('every family that commits the business says how to rebuild its terms', () => {
    it('covers each committing family in the writer registry, exactly once', () => {
        const covered = COMMITMENT_FAMILIES.map(family => family.family).sort();
        expect(new Set(covered).size).toBe(covered.length);
        // Four families were already bound by their own contract before this one
        // existed, and two commit nothing. Naming them here is what stops the
        // list quietly shrinking: a family that stops being covered has to be
        // moved into this set on purpose.
        const boundElsewhere = ['appointments', 'enrollments', 'catalog_orders'];
        const commitsNothing = ['pets', 'insurance_claims'];
        const expected = declaredWriterFamilies()
            .filter(family => !boundElsewhere.includes(family) && !commitsNothing.includes(family))
            .sort();
        expect(covered).toEqual(expected);
    });

    it('routes every declared tool to exactly one family', () => {
        for (const family of COMMITMENT_FAMILIES) {
            expect(family.tools.length).toBeGreaterThan(0);
            for (const tool of family.tools) {
                expect(commitmentFamilyForTool(tool)?.family).toBe(family.family);
                // And the registry the sandbox uses agrees that this tool
                // belongs to this family, so the two cannot drift.
                expect(EVAL_WRITER_SANDBOX_FAMILIES[family.family].tools).toContain(tool);
            }
        }
        expect(commitmentFamilyForTool('list_properties')).toBeNull();
    });

    it('gives every family a legible action, a table and settled states', () => {
        for (const family of COMMITMENT_FAMILIES) {
            expect(COMMITMENT_ACTIONS).toContain(family.action);
            expect(family.table).toBe(EVAL_WRITER_SANDBOX_FAMILIES[family.family].table);
            expect(family.settledStates.length).toBeGreaterThan(0);
            expect(typeof family.build).toBe('function');
        }
    });

    it('names exactly the three families where money can move', () => {
        // `payable: false` is a statement, not an omission: a service request
        // commits the business to showing up, not to a number, and freezing a
        // zero would put a zero in a till.
        expect(COMMITMENT_FAMILIES.filter(family => family.payable).map(family => family.family).sort())
            .toEqual(['property_bookings', 'restaurant_orders', 'tour_bookings']);
    });

    it('builds nothing for arguments that name nothing', async () => {
        const empty = (async () => []) as any;
        for (const family of COMMITMENT_FAMILIES) {
            await expect(family.build(empty, {}, 'contact')).resolves.toBeNull();
        }
    });
});

describe('the SQL a charge reads', () => {
    it('reads the accepted proposal and nothing else', () => {
        expect(commitmentAgreedAmountSql()).toContain('commitment_proposals');
        expect(commitmentAgreedAmountSql()).toContain('accepted_at IS NOT NULL');
        expect(commitmentAgreedAmountSql()).toContain('consumed_entity_id = target.id');
        expect(commitmentAgreedCurrencySql()).toContain('accepted_at IS NOT NULL');
        // No fallback to a live column: a row nobody agreed to is unpayable, and
        // a COALESCE here would quietly restore exactly the defect this closes.
        expect(commitmentAgreedAmountSql()).not.toMatch(/COALESCE|total_price|total_amount/);
    });

    it('refuses an alias or a table it did not sanitise', () => {
        expect(() => commitmentAgreedAmountSql('target; DROP TABLE x')).toThrow('invalid_sql_alias');
        expect(() => commitmentOrphansSql('food_orders; DROP', ['cancelled'])).toThrow('invalid_sql_table');
        expect(() => commitmentOrphansSql('food_orders', ["cancelled'"])).toThrow('invalid_sql_state');
    });

    it('counts only live rows with no acceptance behind them', () => {
        const sql = commitmentOrphansSql('property_bookings', ['cancelled', 'expired']);
        expect(sql).toContain('NOT EXISTS');
        expect(sql).toContain("status NOT IN ('cancelled', 'expired')");
    });
});
