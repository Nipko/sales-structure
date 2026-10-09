import { EffectiveCapabilityService } from './effective-capability.service';
import { TOOL_FAMILIES } from './agent-tool-registry';
import { isNonCommittalTool } from './tool-policy-registry';
import { projectVerticalIntentAvailability } from './vertical-turn-context.service';
import { CATALOG_EMPTY_PROBES } from './catalog-empty.util';
import { READINESS } from '../verticals/vertical-readiness.service';
import {
    CATALOG_READ_TOOLS_WHEN_EMPTY,
    TOOL_GROUP_READINESS,
    buildDomainContractDraft,
} from '@parallext/shared';

/**
 * Inmobiliaria QA / Agencia QA Viajes, 2026-10-09: with no listings and no packages loaded the readiness gate
 * withdrew `search_listings` / `search_packages` from the turn. The flow guidance still said «call search_listings»
 * and the domain contract said `runtime="unavailable"`, so the model answered «no puedo realizar la búsqueda» to a
 * perfectly valid question. Readiness gates what the agent can COMPLETE; the catalogue READERS stay published so the
 * agent can find out, and say, that the catalogue is empty. The writers stay hidden.
 */
const tenantId = '11111111-1111-4111-8111-111111111111';
const schemaName = 'tenant_cap';

function build(unmet: string[] = []) {
    const throttle = {
        getPlanFeatures: jest.fn().mockResolvedValue({ plan: 'pro' }),
        getTenantPlan: jest.fn().mockResolvedValue('pro'),
    };
    const readiness = {
        evaluate: jest.fn().mockResolvedValue({
            checks: unmet.map(key => ({
                key, satisfied: false, count: 0, required: 1,
                repair: `Cargá datos para ${key}.`, repairRoute: '/admin/x',
            })),
            unmet,
            evaluatedAt: new Date().toISOString(),
            degraded: false,
        }),
    };
    const regionalProfile = {
        resolve: jest.fn().mockResolvedValue({ countryPackId: 'es-CO', operatingCountry: { value: 'CO' } }),
    };
    const service = new EffectiveCapabilityService(throttle as any, readiness as any, regionalProfile as any);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    return service;
}

describe('catalogue readers stay published when the catalogue is empty', () => {
    it('real estate with no listings: the three readers are published, the group is still reported unmet', async () => {
        const contract = await build(['listings']).resolve({
            tenantId, schemaName, industry: 'inmobiliaria', subType: 'venta',
            toolsConfig: { realEstate: { enabled: true }, appointments: { enabled: true } },
        });

        expect(contract.publishedTools).toEqual(expect.arrayContaining(['search_listings', 'get_listing_details', 'send_listing_image']));
        expect(contract.catalogReadGroups).toEqual(['realEstate']);
        // The owner still sees what to load: the family is reported as unmet, not silently «ready».
        expect(contract.publishedGroups).not.toContain('realEstate');
        expect(contract.unmetReadiness).toContain('listings');
        expect(contract.excluded.find(e => e.subject === 'realEstate')).toMatchObject({ reason: 'readiness_unmet' });
    });

    it('tours with no packages: readers are published, writers and the customer bookings reader are not', async () => {
        const contract = await build(['tour_packages']).resolve({
            tenantId, schemaName, industry: 'turismo', subType: 'agencia_viajes',
            toolsConfig: { tours: { enabled: true } },
        });

        expect(contract.publishedTools).toEqual(expect.arrayContaining(['search_packages', 'get_package_details', 'check_package_availability']));
        expect(contract.publishedTools).not.toContain('create_tour_booking');
        expect(contract.publishedTools).not.toContain('cancel_tour_booking');
        expect(contract.publishedTools).not.toContain('list_my_tour_bookings');
        expect(contract.catalogReadGroups).toEqual(['tours']);
        expect(contract.excluded.find(e => e.subject === 'tours')).toMatchObject({ reason: 'readiness_unmet' });
    });

    it('with inventory loaded nothing changes: the full family is published and no group is read-only', async () => {
        const contract = await build([]).resolve({
            tenantId, schemaName, industry: 'turismo', subType: 'agencia_viajes',
            toolsConfig: { tours: { enabled: true } },
        });

        expect(contract.publishedTools).toEqual(expect.arrayContaining(['search_packages', 'create_tour_booking', 'cancel_tour_booking']));
        expect(contract.catalogReadGroups).toEqual([]);
        expect(contract.publishedGroups).toContain('tours');
    });

    it('a family the agent switched off or the subtype does not grant never gets readers', async () => {
        const off = await build(['tour_packages']).resolve({
            tenantId, schemaName, industry: 'turismo', subType: 'agencia_viajes',
            toolsConfig: { tours: { enabled: false } },
        });
        expect(off.publishedTools).not.toContain('search_packages');
        expect(off.catalogReadGroups).toEqual([]);

        const outside = await build(['listings']).resolve({
            tenantId, schemaName, industry: 'turismo', subType: 'agencia_viajes',
            toolsConfig: { realEstate: { enabled: true }, tours: { enabled: true } },
        });
        expect(outside.publishedTools).not.toContain('search_listings');
        expect(outside.excluded.find(e => e.subject === 'realEstate')).toMatchObject({ reason: 'not_in_subtype' });
    });

    it('the owner subpermissions still narrow a reader published for an empty catalogue', async () => {
        const contract = await build(['catalog_items']).resolve({
            tenantId, schemaName, industry: 'retail', subType: 'moda',
            toolsConfig: { catalog: { enabled: true, canCheckStock: false } },
        });

        expect(contract.publishedTools).toEqual(expect.arrayContaining(['search_products', 'get_product']));
        expect(contract.publishedTools).not.toContain('check_stock');
        expect(contract.publishedTools).not.toContain('place_catalog_order');
    });

    it('families whose readiness is not «has rows» stay fully gated', async () => {
        // education: an open cohort in the next 180 days; faqs: published FAQ; appointments: a bookable service + staff hours.
        const education = await build(['courses']).resolve({
            tenantId, schemaName, industry: 'education', subType: 'idiomas',
            toolsConfig: { education: { enabled: true } },
        });
        expect(education.publishedTools).not.toContain('get_courses');
        expect(education.catalogReadGroups).toEqual([]);

        const appointments = await build(['appointment_services']).resolve({
            tenantId, schemaName, industry: 'salud', subType: 'medica_general',
            toolsConfig: { appointments: { enabled: true } },
        });
        expect(appointments.publishedTools).not.toContain('check_availability');
        expect(appointments.publishedTools).not.toContain('create_appointment');
    });

    it('the domain contract no longer says «unavailable» for the search the guidance asks for', async () => {
        const contract = await build(['listings']).resolve({
            tenantId, schemaName, industry: 'inmobiliaria', subType: 'venta',
            toolsConfig: { realEstate: { enabled: true } },
        });
        const draft = buildDomainContractDraft('inmobiliaria', 'venta');
        const context = projectVerticalIntentAvailability({
            industry: 'inmobiliaria', subType: 'venta',
            domainContract: {
                contractVersion: draft.contractVersion, profileId: draft.profileId, status: draft.status,
                scope: draft.prompt.scope, claims: [], unresolved: [],
                intents: draft.intents.map(intent => ({
                    key: intent.key, commits: intent.commits, toolPlan: [...intent.toolPlan],
                })),
            },
        } as any, contract.publishedTools);

        const findListing = (context!.domainContract as any).intents.find((i: any) => i.toolPlan.includes('search_listings'));
        expect(findListing).toBeDefined();
        expect(findListing.runtimeStatus).not.toBe('unavailable');
        expect(findListing.runtimeToolPlan).toContain('search_listings');
    });
});

describe('CATALOG_READ_TOOLS_WHEN_EMPTY is held against the registries', () => {
    const familyTools = (group: string) =>
        TOOL_FAMILIES.find(family => family.key === group)?.tools.map(tool => String(tool.name)) ?? [];

    it.each(Object.entries(CATALOG_READ_TOOLS_WHEN_EMPTY))('%s: every reader belongs to the family, is non-committal and the family is readiness-gated', (group, tools) => {
        expect(TOOL_GROUP_READINESS[group as keyof typeof TOOL_GROUP_READINESS]).toBeDefined();
        for (const tool of tools!) {
            expect(familyTools(group)).toContain(tool);
            // A reader that commits the business would be dropped by a blocked profile; a writer must never be listed.
            expect(isNonCommittalTool(tool)).toBe(true);
        }
    });

    it('never lists a writer or a customer-owned reader', () => {
        const forbidden = /^(create_|cancel_|place_|book_|enroll_|schedule_|reschedule_|request_|file_|calculate_|register_|update_|apply_|list_my_|get_my_|check_.*_status)/;
        for (const tools of Object.values(CATALOG_READ_TOOLS_WHEN_EMPTY)) {
            for (const tool of tools!) expect(tool).not.toMatch(forbidden);
        }
    });

    it('every tool that answers catalog_empty is a published-when-empty reader, and its readiness has a plain predicate', () => {
        const published = new Set(Object.values(CATALOG_READ_TOOLS_WHEN_EMPTY).flatMap(tools => [...tools!]));
        for (const [tool, probe] of Object.entries(CATALOG_EMPTY_PROBES)) {
            expect(published.has(tool)).toBe(true);
            const definition = READINESS[probe.key]!;
            expect(definition).toBeDefined();
            expect(typeof definition.from).not.toBe('function');
            expect(definition.actorScoped).toBeFalsy();
            expect(definition.params).toBeUndefined();
        }
        // search_listings and search_packages are the two the diagnosis names.
        expect(Object.keys(CATALOG_EMPTY_PROBES)).toEqual(expect.arrayContaining(['search_listings', 'search_packages']));
    });
});
