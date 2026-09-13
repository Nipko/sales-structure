import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { APPOINTMENT_LIVE_STATES, appointmentAgreedCurrencySql, appointmentAgreedPriceSql, appointmentAgreedTermsSql, appointmentsWithoutAgreedTermsDetailSql, appointmentsWithoutAgreedTermsSql } from '../appointments/appointment-service-terms';
import { CATALOG_ORDER_LIVE_STATES, catalogAgreedAmountSql, catalogAgreedCurrencySql, catalogAgreedTermsSql, ordersWithoutAgreedTermsDetailSql, ordersWithoutAgreedTermsSql } from '../orders/catalog-order-contract';
import { commitmentAgreedAmountSql, commitmentAgreedCurrencySql, commitmentAgreedTermsSql, commitmentOrphanDetailSql, commitmentOrphansSql, notAgreedSql } from '../conversations/commitment-proposal';
import { PREFLIGHT_FAMILIES } from './agreed-terms-preflight';

/**
 * ═══ ONE DEFINITION OF "PAYABLE", HELD IN PLACE ═══
 *
 * The pre-deploy gate promises that its number is the number of customers about
 * to meet a payment link that will not work. That promise is only true while the
 * gate and the till decide payability with the SAME expression — and they had
 * drifted into four:
 *
 *   the till   `NULLIF(metadata->'serviceTerms'->>'price','')::numeric`
 *   the count  `NOT (metadata ? 'serviceTerms')`
 *   the list   a third copy, in the operator report
 *   the gate   a fourth, in the pre-flight family table
 *
 * Every legacy shape in between — `metadata` SQL NULL, `{"serviceTerms": null}`,
 * an empty or non-numeric price, a missing currency — was refused by the till
 * and reported as zero by the gate. Three families had the same gap around
 * `amount_cents`.
 *
 * The behaviour is proven against real PostgreSQL in
 * `agreed-terms-eligibility.postgres.spec.ts`. What is proven HERE is the thing
 * that keeps it true: that there is still only one expression, and that nobody
 * has quietly written a fifth.
 */
describe('the agreed-terms predicate has exactly one definition per family', () => {
    const agreedFor: Record<string, () => string> = {
        catalog_orders: () => catalogAgreedTermsSql(),
        appointments: () => appointmentAgreedTermsSql(),
        property_bookings: () => commitmentAgreedTermsSql('target', '"tenant_x".'),
        tour_bookings: () => commitmentAgreedTermsSql('target', '"tenant_x".'),
        restaurant_orders: () => commitmentAgreedTermsSql('target', '"tenant_x".'),
    };

    it('gives the gate the negation of the family contract, character for character', () => {
        // A string comparison on purpose. An equivalent-looking rewrite is
        // exactly how the previous four copies came to disagree, and "looks the
        // same" is not a property a deploy gate can rest on.
        for (const [family, spec] of Object.entries(PREFLIGHT_FAMILIES)) {
            expect({ family, predicate: spec.orphanPredicate('tenant_x') })
                .toEqual({ family, predicate: notAgreedSql(agreedFor[family]()) });
        }
    });

    it('gives the counter and the operator listing the same negation', () => {
        for (const [sql, agreed] of [
            [appointmentsWithoutAgreedTermsSql(), appointmentAgreedTermsSql()],
            [appointmentsWithoutAgreedTermsDetailSql(), appointmentAgreedTermsSql()],
            [ordersWithoutAgreedTermsSql(), catalogAgreedTermsSql()],
            [ordersWithoutAgreedTermsDetailSql(), catalogAgreedTermsSql()],
            [commitmentOrphansSql('property_bookings', ['cancelled']), commitmentAgreedTermsSql()],
            [commitmentOrphanDetailSql('property_bookings', ['cancelled']), commitmentAgreedTermsSql()],
        ] as Array<[string, string]>) {
            expect(sql).toContain(notAgreedSql(agreed));
        }
    });

    it('builds the money the till reads out of the same predicate', () => {
        // The till and the gate cannot diverge while the till's CASE is guarded
        // by the very predicate the gate negates.
        expect(appointmentAgreedPriceSql()).toContain(appointmentAgreedTermsSql());
        expect(appointmentAgreedCurrencySql()).toContain(appointmentAgreedTermsSql());
        expect(catalogAgreedAmountSql()).toContain(catalogAgreedTermsSql());
        expect(catalogAgreedCurrencySql()).toContain(catalogAgreedTermsSql());
        // The commitment amount is a subselect rather than a CASE, so it carries
        // the same three conditions instead of embedding the predicate.
        for (const sql of [commitmentAgreedAmountSql(), commitmentAgreedCurrencySql()]) {
            expect(sql).toContain('p.accepted_at IS NOT NULL');
            expect(sql).toContain('p.amount_cents IS NOT NULL');
            expect(sql).toContain(`NULLIF(btrim(p.currency), '') IS NOT NULL`);
        }
    });

    it('never casts a price it has not first checked is a number', () => {
        // `'a convenir'::numeric` throws. In the till that is a 500 instead of a
        // refusal; in the gate it aborts the sweep and every tenant after it goes
        // unreported. Both casts sit behind their predicate.
        for (const sql of [appointmentAgreedPriceSql(), catalogAgreedAmountSql()]) {
            const cast = sql.indexOf('::numeric');
            expect(cast).toBeGreaterThan(-1);
            expect(sql.slice(0, cast)).toContain('~ ');
            expect(sql.slice(0, cast)).toContain('CASE WHEN');
        }
    });

    it('is total, so `WHERE <agreed>` and `WHERE NOT <agreed>` partition the table', () => {
        // Every predicate ends up wrapped so it can never answer NULL. A NULL
        // answer means a row appears in neither half, which is how a row can be
        // unpayable and uncounted at the same time.
        for (const build of Object.values(agreedFor)) {
            expect(build()).toMatch(/^COALESCE\(/);
            expect(build()).toMatch(/, false\)$/);
        }
    });

    it('keeps the live states in one place too', () => {
        expect(PREFLIGHT_FAMILIES.appointments.liveStates).toEqual([...APPOINTMENT_LIVE_STATES]);
        expect(PREFLIGHT_FAMILIES.catalog_orders.liveStates).toEqual([...CATALOG_ORDER_LIVE_STATES]);
        expect(appointmentsWithoutAgreedTermsSql()).toContain(`'no_show'`);
        expect(ordersWithoutAgreedTermsSql()).toContain(`'refunded'`);
    });

    it('has no fifth copy of the predicate anywhere in the source tree', () => {
        // The shapes the four copies were written in. Finding one again means
        // somebody rebuilt the drift rather than reusing the contract.
        const root = resolve(__dirname, '../..');
        const files = [
            'modules/tenant-payments/agreed-terms-orphans.ts',
            'modules/tenant-payments/agreed-terms-preflight.ts',
            'modules/appointments/appointment-service-terms.ts',
            'modules/orders/catalog-order-contract.ts',
            'modules/conversations/commitment-proposal.ts',
        ];
        for (const file of files) {
            // Code only: these shapes are quoted in the comments that explain
            // why they were wrong, and a check that cannot tell prose from a
            // decision teaches people to delete the explanation.
            const code = readFileSync(resolve(root, file), 'utf8')
                .split(/\r?\n/).filter(line => !/^\s*(\*|\/\/|\/\*)/.test(line)).join('\n');
            expect({ file, keyOnlyDecision: /\?\s*'serviceTerms'/.test(code) })
                .toEqual({ file, keyOnlyDecision: false });
            expect({ file, actionOnlyDecision: /COALESCE\([^)]*->>'action','?'?\)\s*<>\s*'create'/.test(code) })
                .toEqual({ file, actionOnlyDecision: false });
        }
    });
});
