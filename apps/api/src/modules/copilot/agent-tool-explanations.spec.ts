import { buildAgentToolExplanations, rollUpToolExplanations } from './agent-tool-explanations';
import { buildDomainContractDraft, composeSubtypeEvalPack, listCanonicalSubtypeExperienceProfileIds } from '@parallext/shared';
import { TOOL_FAMILIES } from '../conversations/agent-tool-registry';
import { READINESS } from '../verticals/vertical-readiness.service';

/**
 * What a tenant is told about one tool.
 *
 * A switched-off tool rendered as a title, a one-line description and a toggle,
 * and the assessment panel reduced the whole capability contract to two counts.
 * So "your plan does not include this", "you have no products loaded" and "this
 * does not apply to your business" all looked identical — three completely
 * different things to do next, shown as the same grey switch. None of the data
 * needed to tell them apart was missing; it was being thrown away.
 */
describe('what a tenant is told about one tool', () => {
    const domain = buildDomainContractDraft('salud', 'dental');
    const intent = domain.intents.find(entry => entry.toolPlan.includes('create_appointment'))!;

    const contract = (over: Partial<any> = {}): any => ({
        version: 1, tenantId: 't', agentId: 'a', subtypeProfileId: 'salud/dental',
        planSnapshot: 'pro', countryPackId: 'co', domainContract: domain,
        certification: {}, operations: {},
        publishedTools: ['create_appointment', 'check_availability'],
        publishedGroups: [], excluded: [], unmetReadiness: [], degraded: false,
        writersBlocked: false, resolvedAt: new Date().toISOString(), ...over,
    });

    const build = (over: Partial<Parameters<typeof buildAgentToolExplanations>[0]> = {}) =>
        buildAgentToolExplanations({
            contract: contract(), domain, missionIntentKeys: [intent.key],
            evidenceByIntent: {}, agentId: 'agent-1', language: 'es',
            safeToolNames: new Set(['check_availability']), ...over,
        });

    const find = (rows: ReturnType<typeof build>, tool: string) => rows.find(row => row.tool === tool)!;

    it('says which task of the mission each tool serves', () => {
        expect(find(build(), 'create_appointment').missionIntents).toContain(intent.key);
    });

    it('preserves a resolved example from the canonical business pack', () => {
        const question = domain.intents.find(entry => entry.key === 'ask_question')!;
        const example = find(build({ missionIntentKeys: [question.key] }), 'search_faqs').example;
        expect(typeof example).toBe('string');
        expect(example!.length).toBeGreaterThan(10);
    });

    it('does not display an unbound simulation fixture as a customer example', () => {
        const pack = composeSubtypeEvalPack({ industry: 'salud', subtype: 'dental', language: 'es' });
        const canonical = pack.find(scenario => scenario.key.startsWith(`intent_${intent.key}_canonical_`))!;
        expect(canonical.messages[0]).toContain('{{fixture.');
        expect(find(build(), 'create_appointment').example).toBeNull();
    });

    it.each(listCanonicalSubtypeExperienceProfileIds())('%s never displays unresolved markers in any supported language', profileId => {
        const [industry, subtype] = profileId.split('/');
        const ownDomain = buildDomainContractDraft(industry, subtype);
        for (const language of ['es', 'en', 'pt', 'fr']) {
            const rows = build({ domain: ownDomain, missionIntentKeys: ownDomain.intents.map(entry => entry.key), language,
                contract: contract({ subtypeProfileId: profileId, publishedTools: ownDomain.intents.flatMap(entry => entry.toolPlan) }) });
            for (const row of rows) {
                expect(row.example ?? '').not.toMatch(/\{\{|\}\}|\[EVAL\]/i);
            }
        }
    });

    it('reports only readiness owned by the tool and its prerequisites', () => {
        const rows = build({ toolNames: ['search_products', 'get_courses', 'schedule_test_drive'],
            contract: contract({ publishedTools: [], unmetReadiness: ['catalog_items', 'courses', 'vehicle_inventory'],
                excluded: [{ subject: 'catalog', reason: 'readiness_unmet', detail: { es: 'Cargue productos.', en: 'x', pt: 'x', fr: 'x' } }] }) });
        expect(find(rows, 'search_products').requires.readiness).toEqual(['catalog_items']);
        expect(find(rows, 'search_products').missing.readiness).toEqual(['catalog_items']);
        expect(find(rows, 'get_courses').missing.readiness).toEqual(['courses']);
        expect(find(rows, 'create_appointment').requires.readiness).toEqual(['appointment_services']);
        expect(find(rows, 'create_appointment').missing.readiness).toEqual([]);
        expect(find(rows, 'schedule_test_drive').requires.readiness).toEqual(expect.arrayContaining(['vehicle_inventory', 'appointment_services']));
        expect(find(rows, 'schedule_test_drive').missing.readiness).toEqual(['vehicle_inventory']);
    });

    it.each([
        ['toast', 'restaurants', 'get_restaurant_menu'],
        ['mindbody', 'gyms', 'get_fitness_schedule'],
        ['cliniko', 'appointments', 'list_clinic_services'],
        ['cliniko', 'appointments', 'check_clinic_availability'],
    ])('maps %s provider and %s owner exclusions to %s without inventing native prerequisites', (provider, family, tool) => {
        for (const subject of [provider, family]) {
            const rows = build({ toolNames: [tool, 'search_faqs'], contract: contract({ publishedTools: [],
                unmetReadiness: ['menu_items', 'membership_plans', 'appointment_services'],
                excluded: [{ subject, reason: 'provider_unavailable', detail: { es: 'Revise el proveedor.', en: 'x', pt: 'x', fr: 'x' } }] }) });
            expect(find(rows, tool).missing.reason).toBe('provider_unavailable');
            expect(find(rows, tool).missing.readiness).toEqual([]);
            expect(find(rows, tool).requires.readiness).toEqual([]);
            expect(find(rows, 'search_faqs').missing.reason).toBeNull();
        }
    });

    it('says WHY a tool is not published, in the words of the gate that refused it', () => {
        const rows = build({
            contract: contract({
                publishedTools: ['check_availability'],
                excluded: [{
                    subject: 'create_appointment', reason: 'plan_missing_feature',
                    detail: { es: 'El plan actual no incluye esta capacidad.', en: 'x', pt: 'x', fr: 'x' },
                    repairRoute: '/admin/settings/billing',
                }],
            }),
        });
        const cell = find(rows, 'create_appointment');
        // Three different things to do next, and now three different answers.
        expect(cell.missing).toMatchObject({
            reason: 'plan_missing_feature', repairRoute: '/admin/settings/billing',
        });
        expect(cell.missing.detail).toContain('plan');
        expect(cell.state).toBe('pending');
    });

    it('separates a provider that broke from a plan that never included it', () => {
        const broken = build({
            contract: contract({
                publishedTools: [],
                excluded: [{ subject: 'create_appointment', reason: 'provider_unavailable',
                    detail: { es: 'x', en: 'x', pt: 'x', fr: 'x' } }],
            }),
        });
        expect(find(broken, 'create_appointment').state).toBe('degraded');
    });

    it.each(TOOL_FAMILIES.flatMap(family =>
        family.tools.map(tool => [family.key, String(tool.name)])))(
        'links the exact %s family exclusion to %s', (family, tool) => {
            const rows = build({
                domain: { ...domain, intents: [{ ...intent, toolPlan: [tool] }] },
                contract: contract({ publishedTools: [], excluded: [{ subject: family,
                    reason: 'readiness_unmet', detail: { es: 'Faltan datos.', en: 'x', pt: 'x', fr: 'x' },
                    repairRoute: '/admin/knowledge' }] }),
            });
            expect(find(rows, tool).missing).toMatchObject({ reason: 'readiness_unmet',
                detail: 'Faltan datos.', repairRoute: '/admin/knowledge' });
        });

    it.each([
        ['payments', 'create_payment_link'], ['payments', 'get_payment_status'],
        ['payments', 'refund_payment'], ['ecommerce', 'apply_discount'], ['mcp', 'mcp__shop__lookup'],
    ])('uses the runtime family contract for %s / %s', (family, tool) => {
        const rows = build({
            domain: { ...domain, intents: [{ ...intent, toolPlan: [tool] }] },
            contract: contract({ publishedTools: [], excluded: [{ subject: family,
                reason: 'provider_unavailable', detail: { es: 'Proveedor no disponible.', en: 'x', pt: 'x', fr: 'x' },
                repairRoute: '/admin/settings/integrations/vertical' }] }),
        });
        expect(find(rows, tool).missing.reason).toBe('provider_unavailable');
        expect(find(rows, tool).state).toBe('degraded');
    });

    it('matches a comma-separated tool exclusion exactly before the family', () => {
        const rows = build({ contract: contract({ publishedTools: [], excluded: [
            { subject: 'appointments', reason: 'agent_disabled', detail: { es: 'Familia apagada.', en: 'x', pt: 'x', fr: 'x' } },
            { subject: 'create_appointment, cancel_appointment', reason: 'external_system_of_record',
                detail: { es: 'Lo administra el proveedor.', en: 'x', pt: 'x', fr: 'x' } },
        ] }) });
        expect(find(rows, 'create_appointment').missing.reason).toBe('external_system_of_record');
    });

    it('never invents a relation from a partial name', () => {
        const rows = build({ contract: contract({ publishedTools: [], excluded: [{
            subject: 'appointment', reason: 'provider_unavailable',
            detail: { es: 'No corresponde.', en: 'x', pt: 'x', fr: 'x' },
        }] }) });
        expect(find(rows, 'create_appointment').missing.reason).toBeNull();
    });

    it('answers unknown for every tool when the contract could not be resolved', () => {
        const rows = build({ contract: null });
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every(row => row.state === 'unknown')).toBe(true);
        expect(rollUpToolExplanations(rows)).toBe('unknown');
    });

    it('keeps a degraded contract from certifying anything it published', () => {
        const rows = build({ contract: contract({ degraded: true }) });
        expect(rows.every(row => row.state === 'unknown')).toBe(true);
    });

    it('says whether a tool can be exercised without touching a customer', () => {
        const rows = build();
        expect(find(rows, 'check_availability').safeTest)
            .toEqual({ available: true, href: '/admin/agent/agent-1/test' });
        expect(find(rows, 'create_appointment').safeTest).toEqual({ available: false, href: null });
    });

    it('carries what the stored runs proved, rather than assuming', () => {
        expect(find(build(), 'create_appointment').result).toBe('not_verified');
        const verified = build({ evidenceByIntent: { [intent.key]: 'verified' } });
        expect(find(verified, 'create_appointment')).toMatchObject({ result: 'verified', state: 'operating' });
        const stale = build({ evidenceByIntent: { [intent.key]: 'stale' } });
        // Proven under a configuration that is not the one on screen.
        expect(find(stale, 'create_appointment')).toMatchObject({ result: 'stale', state: 'degraded' });
    });

    it('states what a tool achieves rather than leaving it to a description', () => {
        const cell = find(build(), 'create_appointment');
        expect(cell.achieves.effect).toBe('write');
        expect(cell.achieves.commitsBusiness).toBe(true);
    });

    it('includes a published tool no task uses, instead of hiding it', () => {
        const rows = build();
        // It is still something the model can be shown; a tenant seeing it in the
        // agent has a right to see it here too.
        expect(rows.map(row => row.tool)).toContain('check_availability');
    });

    describe('what each readiness requirement is actually about', () => {
        // `requires.readiness: ['faq_content']` is a key name, and a key name is
        // not an audit: it does not say what was asked, on which table, about
        // which dimension, or whether the source answered. So a check that
        // filters a column its table does not have looked exactly like a tenant
        // who loaded nothing, and the owner was sent to do the one thing that
        // could not possibly help.
        const faqColumns = { faqs: new Set(['id', 'question', 'answer', 'is_published']) };

        it('cites the predicate the tool runs, not the one the check runs', () => {
            const rows = build({
                missionIntentKeys: [domain.intents.find(entry => entry.key === 'ask_question')!.key],
                contract: contract({ publishedTools: ['search_faqs'] }),
                readinessDefinitions: READINESS as any,
                readinessColumns: faqColumns,
            });
            const citation = find(rows, 'search_faqs').readinessAudit
                .find(entry => entry.key === 'faq_content')!;
            expect(citation).toMatchObject({
                table: 'faqs', predicate: 'is_published = true', verdict: 'read_error',
                writePath: '/admin/knowledge/faqs',
            });
            expect(citation.dimensions).toEqual(['active']);
            // And the shipped check does not read that column at all.
            expect(READINESS.faq_content?.where).not.toContain('is_published');
        });

        it('refuses to call a tool prepared when its readiness source could not be read', () => {
            const rows = build({
                missionIntentKeys: [domain.intents.find(entry => entry.key === 'ask_question')!.key],
                contract: contract({ publishedTools: ['search_faqs'] }),
                readinessDefinitions: READINESS as any,
                readinessColumns: faqColumns,
            });
            // Published, nothing disproved it, and still not `prepared`: nobody
            // could check the requirement, which is the honest word for it.
            expect(find(rows, 'search_faqs').state).toBe('unknown');
        });

        it('does not call it pending either when the gate refused it over an unreadable check', () => {
            const rows = build({
                missionIntentKeys: [domain.intents.find(entry => entry.key === 'ask_question')!.key],
                contract: contract({
                    publishedTools: [], unmetReadiness: ['faq_content'],
                    excluded: [{ subject: 'faqs', reason: 'readiness_unmet',
                        detail: { es: 'Cargá una FAQ.', en: 'x', pt: 'x', fr: 'x' },
                        repairRoute: '/admin/knowledge' }],
                }),
                readinessDefinitions: READINESS as any,
                readinessColumns: faqColumns,
            });
            // `pending` means "there is something here for you to do". There is
            // not: the answer did not come from this tenant's data.
            expect(find(rows, 'search_faqs').state).toBe('unknown');
            expect(find(rows, 'search_faqs').readinessAudit[0].verdict).toBe('read_error');
        });

        it('still calls a genuinely empty catalogue missing data, and pending', () => {
            const rows = build({
                toolNames: ['search_products'],
                contract: contract({
                    publishedTools: [], unmetReadiness: ['catalog_items'],
                    excluded: [{ subject: 'catalog', reason: 'readiness_unmet',
                        detail: { es: 'Cargá productos.', en: 'x', pt: 'x', fr: 'x' } }],
                }),
                readinessDefinitions: READINESS as any,
                readinessColumns: { products: new Set(['id', 'name', 'is_available']) },
            });
            const row = find(rows, 'search_products');
            expect(row.readinessAudit[0]).toMatchObject({ key: 'catalog_items', verdict: 'missing_data' });
            expect(row.state).toBe('pending');
        });

        it('does not invent a read error for a vertical this tenant never provisioned', () => {
            // Most of these tables are created on first use. Absent from the
            // catalogue means the tenant never touched that vertical, and zero
            // rows is the honest answer — not an unreadable source.
            const rows = build({
                toolNames: ['search_products'],
                contract: contract({
                    publishedTools: [], unmetReadiness: ['catalog_items'],
                    excluded: [{ subject: 'catalog', reason: 'readiness_unmet',
                        detail: { es: 'Cargá productos.', en: 'x', pt: 'x', fr: 'x' } }],
                }),
                readinessDefinitions: READINESS as any,
                readinessColumns: {},
            });
            expect(find(rows, 'search_products').readinessAudit[0].verdict).toBe('missing_data');
        });

        it('reports a read error when the whole contract could not be evaluated', () => {
            const rows = build({
                toolNames: ['search_products'],
                contract: contract({ publishedTools: ['search_products'], degraded: true }),
                readinessDefinitions: READINESS as any,
                readinessColumns: { products: new Set(['is_available']) },
            });
            expect(find(rows, 'search_products').readinessAudit[0].verdict).toBe('read_error');
        });

        it('does not report a readiness answer as satisfied when there is no contract to read', () => {
            const rows = build({
                toolNames: ['search_products'], contract: null,
                readinessDefinitions: READINESS as any,
                readinessColumns: { products: new Set(['is_available']) },
            });
            const row = find(rows, 'search_products');
            expect(row.state).toBe('unknown');
            // The channel projection could not be read, so its readiness
            // answers were not read either. `satisfied` here would be the same
            // lie, told about a whole channel.
            expect(row.readinessAudit[0].verdict).toBe('read_error');
        });

        it('carries the audited divergence so the surface can say the check is weaker than its tool', () => {
            const rows = build({
                toolNames: ['search_listings'],
                contract: contract({ publishedTools: ['search_listings'] }),
                readinessDefinitions: READINESS as any,
                readinessColumns: { real_estate_listings: new Set(['status', 'is_active']) },
            });
            const citation = find(rows, 'search_listings').readinessAudit
                .find(entry => entry.key === 'listings')!;
            expect(citation.verdict).toBe('satisfied');
            expect(citation.auditedDivergence).toMatchObject({ kind: 'weaker_predicate' });
            expect(citation.auditedDivergence!.missingDimensions).toEqual(['active']);
        });
    });
});
