import { buildAgentToolExplanations, rollUpToolExplanations } from './agent-tool-explanations';
import { buildDomainContractDraft } from '@parallext/shared';

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

    it('gives a sentence a customer of THIS business would actually say', () => {
        const example = find(build(), 'create_appointment').example;
        expect(typeof example).toBe('string');
        expect(example!.length).toBeGreaterThan(10);
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
});
