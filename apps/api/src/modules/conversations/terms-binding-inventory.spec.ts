import * as fs from 'fs';
import * as path from 'path';
import { EVAL_WRITER_SANDBOX_FAMILIES } from './agent-test-tool-policy';
import { FAMILY_TERMS_BINDINGS, TERMS_BINDING, declaredFamilies,
    familiesWithUnboundCharge, familiesWithUnboundCommand } from './terms-binding-inventory';
import { appointmentAgreedPriceSql, appointmentPriceSql } from '../appointments/appointment-service-terms';
import { enrollmentPriceSql } from '../education/enrollment-terms';
import { catalogAgreedAmountSql } from '../orders/catalog-order-contract';

/**
 * The inventory has to track the registry, or it becomes a document.
 *
 * The value of this table is that a family added next month cannot avoid saying
 * where it stands. So the universe is the registry itself, not a list somebody
 * keeps in step by hand — the same mechanism that keeps the external-effect and
 * agent-output inventories honest.
 */
describe('which families bind what the customer agreed to', () => {
    it('covers every family the registry declares, exactly once', () => {
        const listed = FAMILY_TERMS_BINDINGS.map(row => row.family).sort();
        expect(listed).toEqual(declaredFamilies());
        expect(new Set(listed).size).toBe(listed.length);
        expect(Object.keys(EVAL_WRITER_SANDBOX_FAMILIES).length).toBe(FAMILY_TERMS_BINDINGS.length);
    });

    it('gives every family a legible answer and a place to look', () => {
        for (const row of FAMILY_TERMS_BINDINGS) {
            expect(TERMS_BINDING).toContain(row.command);
            expect(TERMS_BINDING).toContain(row.charge);
            expect(['fails_closed', 'fails_open', 'not_applicable']).toContain(row.legacyRows);
            // Prose that says what is missing, not a tick.
            expect(row.evidence.length).toBeGreaterThan(60);
        }
    });

    it('never calls a charge bound while its legacy rows fail open', () => {
        // The two are one claim: a snapshot the till ignores for old rows is a
        // snapshot the till ignores. `catalog_orders` is exactly that case and
        // the table says so rather than counting it as bound.
        for (const row of FAMILY_TERMS_BINDINGS.filter(entry => entry.charge === 'bound')) {
            expect(row.legacyRows).not.toBe('fails_open');
        }
    });

    it('states the gap as a list, because that is the whole point', () => {
        const unboundCharge = familiesWithUnboundCharge().map(row => row.family).sort();
        const unboundCommand = familiesWithUnboundCommand().map(row => row.family).sort();
        expect(unboundCharge).toEqual(['property_bookings', 'restaurant_orders', 'tour_bookings']);
        expect(unboundCommand).toEqual(['appointment_transitions', 'class_bookings',
            'insurance_quotes', 'photo_sessions', 'property_bookings', 'repair_orders', 'resource_rentals',
            'restaurant_orders', 'service_requests', 'tour_bookings'].sort());
        // eslint-disable-next-line no-console
        console.log(`[terms-binding] ${FAMILY_TERMS_BINDINGS.length} families; `
            + `${unboundCommand.length} without a bound command, ${unboundCharge.length} without a bound charge`);
    });

    it('the families that do bind the charge refuse a price nobody agreed to', () => {
        // Not prose: the SQL itself. Both read the stored snapshot and yield
        // NULL when there is none, which is what makes the reference unpayable
        // rather than payable at today's catalogue price.
        expect(appointmentAgreedPriceSql()).toContain("metadata->'serviceTerms'->>'price'");
        expect(appointmentAgreedPriceSql()).toContain('NULLIF');
        expect(appointmentAgreedPriceSql()).not.toContain('service.price');
        expect(enrollmentPriceSql()).toContain('NULLIF');
        // The catalogue order reads the stored snapshot, refuses a cancellation
        // snapshot, and never mentions the live column it used to charge from.
        expect(catalogAgreedAmountSql()).toContain("catalog_terms->>'totalAmountCents'");
        expect(catalogAgreedAmountSql()).toContain("'create'");
        expect(catalogAgreedAmountSql()).not.toContain('total_amount');
    });

    it('proves the three unbound charges are at least frozen, not live catalogue reads', () => {
        // The distinction the evidence makes, checked instead of asserted. If a
        // writer ever starts updating one of these money columns after the row
        // exists, the amount would drift after the customer saw it and the
        // evidence above would quietly become false.
        const src = (file: string) =>
            fs.readFileSync(path.resolve(__dirname, '..', ...file.split('/')), 'utf8');
        const writers = [
            ['vacation-rental/properties.service.ts', /UPDATE property_bookings[\s\S]{0,200}?SET([\s\S]{0,200}?)WHERE/g,
                ['night_price', 'cleaning_fee', 'total_price', 'currency', 'amount_due']],
            ['tours/tours.service.ts', /UPDATE tour_bookings[\s\S]{0,200}?SET([\s\S]{0,200}?)WHERE/g,
                ['unit_price', 'total_price', 'currency', 'amount_due']],
            ['restaurants/restaurants.service.ts', /UPDATE food_orders[\s\S]{0,200}?SET([\s\S]{0,200}?)WHERE/g,
                ['total', 'currency']],
        ] as const;
        const drifting: string[] = [];
        for (const [file, pattern, columns] of writers) {
            const text = src(file);
            for (const match of text.matchAll(pattern)) {
                for (const column of columns) {
                    if (new RegExp(`\b${column}\s*=`).test(match[1])) drifting.push(`${file}: ${column}`);
                }
            }
        }
        expect({ drifting }).toEqual({ drifting: [] });
    });

    it('keeps the display price and the charged price as two different questions', () => {
        // A screen may say what the service costs today. The till may not.
        expect(appointmentPriceSql()).toContain('service.price');
        expect(appointmentAgreedPriceSql()).not.toContain('service.price');
    });
});
