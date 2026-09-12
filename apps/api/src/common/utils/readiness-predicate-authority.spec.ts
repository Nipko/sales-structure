import { readFileSync } from 'fs';
import { resolve } from 'path';
import { READINESS } from '../../modules/verticals/vertical-readiness.service';
import {
    READINESS_PREDICATE_AUTHORITY, citeReadiness, classifyReadinessSource, readinessPredicateColumns,
    readinessPredicateDivergences, readinessPredicateRegisterDefects, readinessTablesToInspect,
} from './readiness-predicate-authority.util';

/**
 * The audit the closure condition asks for, as a test rather than a paragraph.
 *
 * "Readiness is audited against the real predicate of each tool" was a sentence
 * somebody had to believe. These cases make it a thing that fails: a readiness
 * key nobody compared to its tool's query, or a divergence that was fixed and
 * left standing here, both turn this suite red.
 */
describe('readiness predicates, audited against the predicate each tool runs', () => {
    it('audits every readiness key the service implements', () => {
        const unaudited = (Object.keys(READINESS) as Array<keyof typeof READINESS>)
            .filter(key => !READINESS_PREDICATE_AUTHORITY[key]);
        expect(unaudited).toEqual([]);
    });

    it('describes no key the service does not implement', () => {
        const orphans = Object.keys(READINESS_PREDICATE_AUTHORITY)
            .filter(key => !(READINESS as Record<string, unknown>)[key]);
        expect(orphans).toEqual([]);
    });

    it('keeps the register free of stale and unactionable entries', () => {
        expect(readinessPredicateRegisterDefects(READINESS)).toEqual([]);
    });

    /**
     * The census itself. Frozen so a fix cannot land silently: correcting one of
     * these predicates makes `readinessPredicateRegisterDefects` report the
     * divergence as stale AND drops it from this list, so the register must be
     * updated in the same change as the predicate.
     */
    it('names exactly the keys whose shipped predicate disagrees with its tool', () => {
        expect(readinessPredicateDivergences(READINESS)).toEqual([
            'appointment_services',
            'boarding_capacity',
            'courses',
            'insurance_plans',
            'properties',
        ]);
    });

    it('agrees with the shipped predicates that match their tool', () => {
        for (const key of ['business_identity', 'faq_content', 'catalog_items', 'listings',
            'menu_items', 'tour_packages', 'pets', 'membership_plans', 'service_catalog', 'photo_sessions',
            'vehicle_inventory'] as const) {
            expect(READINESS_PREDICATE_AUTHORITY[key]?.divergence).toBeNull();
            // A matching entry still has to be about the same table the tool
            // reads, or "matches" would only mean "nobody declared otherwise".
            expect(READINESS_PREDICATE_AUTHORITY[key]?.toolTable).toBe(READINESS[key]?.table);
        }
    });

    it('states, for every divergence, what it costs a tenant and who fixes it', () => {
        for (const key of readinessPredicateDivergences(READINESS)) {
            const divergence = READINESS_PREDICATE_AUTHORITY[key]!.divergence!;
            expect(divergence.consequence.length).toBeGreaterThan(40);
            expect(divergence.correction.length).toBeGreaterThan(20);
            expect(divergence.owner).toMatch(/^apps\/api\//);
        }
    });

    describe('the columns a predicate reads, derived from the predicate', () => {
        // Derived rather than declared beside it: a hand-written copy of a WHERE
        // clause is a second thing to go stale, and two predicates nobody
        // compared is the whole defect.
        it('reads a column once, whatever the shape of the comparison', () => {
            expect(readinessPredicateColumns(`name IS NOT NULL AND name <> ''`)).toEqual(['name']);
        });

        it('does not mistake a string literal for a column', () => {
            expect(readinessPredicateColumns(`status = 'available'`)).toEqual(['status']);
        });

        it('sees through a function call and a list', () => {
            expect(readinessPredicateColumns(
                `is_active = true AND category IN ('guarderia', 'hotel') AND COALESCE(max_concurrent, 0) >= 1`,
            )).toEqual(['category', 'is_active', 'max_concurrent']);
        });

        it('reads nothing from a key with no predicate', () => {
            expect(readinessPredicateColumns(undefined)).toEqual([]);
            expect(readinessPredicateColumns(undefined)).toEqual([]);
        });
    });

    describe('missing data is not a read error', () => {
        const faqs = new Set(['id', 'question', 'answer', 'is_published', 'order_index']);

        it('calls an unmet key with a readable source missing data', () => {
            expect(classifyReadinessSource('catalog_items', {
                unmet: true,
                availableColumns: new Set(['id', 'name', 'is_available']),
                contractDegraded: false,
                readinessWhere: READINESS.catalog_items?.where,
            })).toBe('missing_data');
        });

        it('calls an empty but readable FAQ source missing data', () => {
            expect(classifyReadinessSource('faq_content', {
                unmet: true,
                availableColumns: faqs,
                contractDegraded: false,
                readinessWhere: READINESS.faq_content?.where,
            })).toBe('missing_data');
        });

        it('calls a published FAQ source satisfied', () => {
            expect(classifyReadinessSource('faq_content', {
                unmet: false,
                availableColumns: faqs,
                contractDegraded: false,
                readinessWhere: READINESS.faq_content?.where,
            })).toBe('satisfied');
        });

        it('does not invent a read error when the schema could not be inspected', () => {
            // `null` is not an empty set. An uninspectable schema proves nothing
            // about the columns, so the contract's own degraded flag decides.
            expect(classifyReadinessSource('faq_content', {
                unmet: true, availableColumns: null, contractDegraded: false,
                readinessWhere: READINESS.faq_content?.where,
            })).toBe('missing_data');
            expect(classifyReadinessSource('faq_content', {
                unmet: true, availableColumns: null, contractDegraded: true,
                readinessWhere: READINESS.faq_content?.where,
            })).toBe('read_error');
        });

        it('calls a satisfied key with a readable source satisfied', () => {
            expect(classifyReadinessSource('catalog_items', {
                unmet: false,
                availableColumns: new Set(['is_available']),
                contractDegraded: false,
                readinessWhere: READINESS.catalog_items?.where,
            })).toBe('satisfied');
        });
    });

    describe('the citation a surface renders instead of a key name', () => {
        it('cites the predicate shared by readiness and the tool', () => {
            const citation = citeReadiness('faq_content', {
                unmet: true,
                availableColumns: new Set(['is_published']),
                contractDegraded: false,
                readinessWhere: READINESS.faq_content?.where,
            });
            expect(citation).toMatchObject({
                key: 'faq_content',
                table: 'faqs',
                predicate: 'is_published = true',
                dimensions: ['active'],
                verdict: 'missing_data',
                writePath: '/admin/knowledge/faqs',
            });
            expect(citation!.auditedDivergence).toBeNull();
            expect(READINESS.faq_content?.repairRoute).toBe(citation!.writePath);
        });

        it('cites the availability source for a key whose tool never reads its table', () => {
            const citation = citeReadiness('appointment_services', {
                unmet: false, availableColumns: new Set(['is_active']), contractDegraded: false,
                readinessWhere: READINESS.appointment_services?.where,
            });
            expect(citation).toMatchObject({ table: 'availability_slots', verdict: 'satisfied' });
            expect(citation!.dimensions).toContain('availability');
            expect(citation!.auditedDivergence?.missingDimensions).toContain('availability');
        });

        it('returns nothing for a key it has not audited, rather than a blank citation', () => {
            expect(citeReadiness('pipeline', {
                unmet: true, availableColumns: null, contractDegraded: false,
            })).toBeNull();
        });
    });

    it('agrees with the quality surface that counts published FAQs', () => {
        const qualitySource = readFileSync(
            resolve(__dirname, '../../modules/quality/agent-quality.service.ts'), 'utf8');
        const faqFact = qualitySource.slice(qualitySource.indexOf('FROM faqs'));
        const factPredicate = faqFact.slice(faqFact.indexOf('WHERE') + 6, faqFact.indexOf('\n', faqFact.indexOf('WHERE')));
        expect(factPredicate).toContain('is_published = true');
        expect(factPredicate).not.toContain('is_active');
        expect(READINESS_PREDICATE_AUTHORITY.faq_content!.toolPredicate).toBe('is_published = true');
        expect(READINESS.faq_content!.where).toBe('is_published = true');
    });

    it('inspects one table per readiness table, and no invented identifier', () => {
        const tables = readinessTablesToInspect(
            ['faq_content', 'catalog_items', 'pets', 'photo_sessions', 'pipeline'],
            READINESS,
        );
        // `pets` and `photo_sessions` share `services`, and `pipeline` has no
        // definition at all: one inspection each, nothing guessed.
        expect(tables).toEqual(['faqs', 'products', 'services']);
    });
});
