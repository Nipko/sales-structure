import { ConflictException, NotFoundException } from '@nestjs/common';
import { rollUpOperationalState } from '@parallext/shared';
import { AgentAssessmentService } from './agent-assessment.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
function harness(options: { missing?: boolean; drift?: boolean; unknown?: boolean; mission?: any; runs?: any[];
    teamNotApplicable?: boolean;
    /**
     * The tenant's readiness tables, as the catalogue would report them.
     * `undefined` keeps the provisioned shape; `null` makes the catalogue read
     * fail, which is a different answer from a table that is not there.
     */
    readinessColumns?: Record<string, string[]> | null;
} = {}) {
    const catalogue = options.readinessColumns === undefined
        ? { menu_items: ['id', 'name', 'price', 'is_available', 'is_active'], faqs: ['id', 'question', 'is_published'] }
        : options.readinessColumns;
    const query = jest.fn(async (_schema, sql, params) =>
        sql.includes('FROM information_schema.columns')
            ? (catalogue === null ? Promise.reject(new Error('catalogue unreadable'))
                : Object.entries(catalogue).flatMap(([table, columns]) =>
                    columns.map(column => ({ table_name: table, column_name: column }))))
            : sql.startsWith('SELECT version') ? [{ version: options.drift ? 3 : 2 }] : options.missing ? [] : [{
        id: AGENT, version: 2, template_id: 'restaurant', channels: ['whatsapp', 'telegram'], channel_bindings: [],
        config_json: { persona: { role: 'Atender pedidos', name: 'Luna', secret: 'NEVER EXPOSE',
                personality: { tone: 'cálido', formality: 'casual', emojiUsage: 'minimal', humor: 'ligero' } },
            behavior: { mainInstructions: 'Ayuda a elegir', requiredFields: { quote: [{ field: 'email', question: '¿Cuál es tu correo?', validation: 'email', secret: 'NEVER EXPOSE' }] } },
            language: 'es-CO', skillset: 'both', upsell: { enabled: true, intensity: 'subtle', maxDiscountPercent: 5 },
            llm: { temperature: 0.7, maxTokens: 800, providerKey: 'SECRET' }, rag: { enabled: true, topK: 5, similarityThreshold: 0.75, namespace: 'SECRET' },
            hours: { aiOutsideHours: false, afterHoursMessageOverride: 'Volvemos mañana', secret: 'NEVER EXPOSE' },
            tools: { restaurants: { enabled: true, token: 'SECRET TOKEN' } }, mission: options.mission },
    }]);
    const evalRows = options.runs ?? [];
    const prisma = { getTenantSchemaName: jest.fn().mockResolvedValue('tenant_test'), executeInTenantSchema: query,
        transactionInTenantSchema: jest.fn(async (_schema: string, work: any) => work(async (sql: string) =>
            sql.includes('to_regclass') ? [{ name: options.runs ? 'tenant_test.eval_runs' : null }]
                : sql.includes('FROM eval_runs') ? evalRows : [])),
        tenant: { findUnique: jest.fn().mockResolvedValue({ industry: 'restaurantes', settings: { verticalConfig: { subType: 'casual_dining' } } }) } };
    const check = (code: string, status = 'pass') => ({ code, status, evidence: status === 'unknown' ? { sourceAvailability: 'unavailable' } : {}, dimension: 'business_scope', critical: true, weight: 1 });
    const overview = { agent: { id: AGENT, version: 2, name: 'Luna' }, preparation: { dimensions: [{ checks: [check('persona_identity'), check('knowledge_coverage', options.unknown ? 'unknown' : 'pass'), check('tool_appointments', 'not_applicable'),
        ...(options.teamNotApplicable ? [check('human_handoff_route', 'not_applicable')] : [])] }] }, tested: { status: 'ready', stale: false } };
    const quality = { getOverview: jest.fn().mockResolvedValue(overview) };
    const capabilities = { resolve: jest.fn().mockResolvedValue({ contract: { publishedTools: ['search_menu'], resolvedAt: '2026-09-06T00:00:00Z' } }) };
    return { service: new AgentAssessmentService(prisma as any, quality as any, capabilities as any), prisma, quality, capabilities, overview };
}

describe('shared agent assessment', () => {
    it('resolves a default agent server-side and reuses the runtime composer on each assigned channel', async () => {
        const { service, capabilities, prisma } = harness();
        const assessment = await service.getAssessment(TENANT);
        expect(prisma.executeInTenantSchema.mock.calls[0][2]).toEqual([null]);
        expect(capabilities.resolve).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT, agentId: AGENT, channelType: 'whatsapp', role: 'tenant_agent' }));
        expect(capabilities.resolve).toHaveBeenCalledWith(expect.objectContaining({ refreshReadiness: true }));
        expect(capabilities.resolve).toHaveBeenCalledWith(expect.objectContaining({ channelType: 'telegram' }));
        expect(assessment.mission.source).toBe('template_derived');
        // Nothing has been run, so nothing is verified — but it is now the
        // answer to a question rather than a constant.
        expect(assessment.requiredTests.every(test => test.evidence === 'not_verified')).toBe(true);
        expect(assessment.requiredTests.every(test => test.state === 'pending')).toBe(true);
        expect(assessment.configuration).toMatchObject({
            persona: { personality: { emojiUsage: 'minimal', humor: 'ligero' } },
            behavior: { mainInstructions: 'Ayuda a elegir', requiredFields: { quote: [{ field: 'email', question: '¿Cuál es tu correo?', validation: 'email' }] } },
            language: 'es-CO', skillset: 'both', upsell: { enabled: true, maxDiscountPercent: 5 },
            llm: { temperature: 0.7, maxTokens: 800 }, rag: { enabled: true, topK: 5, similarityThreshold: 0.75 },
            hours: { aiOutsideHours: false, afterHoursMessageOverride: 'Volvemos mañana' },
        });
        expect(JSON.stringify(assessment.configuration)).not.toMatch(/SECRET|NEVER EXPOSE/);
    });
    it('keeps unavailable knowledge unknown even when other preparation checks pass', async () => {
        const { service } = harness({ unknown: true });
        const result = await service.getAssessment(TENANT, AGENT);
        expect(result.tasks.find(task => task.key === 'knowledge')?.status).toBe('unknown');
    });

    it('keeps a blocked second channel visible in the tool summary', async () => {
        const { service, capabilities } = harness();
        capabilities.resolve.mockImplementation(async (input: any) => ({ contract: input.channelType === 'whatsapp'
            ? { publishedTools: ['search_menu'], excluded: [], degraded: false }
            : { publishedTools: [], excluded: [{ subject: 'search_menu', reason: 'provider_unavailable',
                detail: { es: 'Revisá la conexión.', en: 'x', pt: 'x', fr: 'x' }, repairRoute: '/admin/channels/telegram' }], degraded: false } }) as any);
        const result = await service.getAssessment(TENANT, AGENT);
        expect(result.tools.find(tool => tool.tool === 'search_menu')).toMatchObject({ state: 'degraded',
            missing: { reason: 'provider_unavailable', repairRoute: '/admin/channels/telegram' } });
    });

    it('does not hide a tool that only the second channel published', async () => {
        const { service, capabilities } = harness();
        capabilities.resolve.mockImplementation(async (input: any) => ({ contract: {
            publishedTools: input.channelType === 'whatsapp' ? [] : ['search_products'], excluded: [], degraded: false,
        } }) as any);
        const result = await service.getAssessment(TENANT, AGENT);
        expect(result.tools.find(tool => tool.tool === 'search_products')?.state).toBe('pending');
    });

    it('does not call a tool prepared if another assigned channel could not be read', async () => {
        const { service, capabilities } = harness();
        capabilities.resolve.mockImplementation(async (input: any) => {
            if (input.channelType === 'telegram') throw new Error('unreadable');
            return { contract: { publishedTools: ['search_menu'], excluded: [], degraded: false } } as any;
        });
        const result = await service.getAssessment(TENANT, AGENT);
        expect(result.tools.find(tool => tool.tool === 'search_menu')?.state).toBe('unknown');
    });
    it('says every task in the one vocabulary the surfaces share', async () => {
        const { service } = harness();
        const assessment = await service.getAssessment(TENANT, AGENT);
        // Three screens reading one status and inventing three labels is what
        // this replaces, so the word has to arrive with the task.
        for (const task of assessment.tasks) {
            expect(['unknown', 'pending', 'prepared', 'tested', 'operating', 'degraded', null])
                .toContain(task.state);
        }
        // Running on the template's mission is pending, not broken and not done.
        expect(assessment.tasks.find(task => task.key === 'mission')?.state).toBe('pending');
    });

    it('gives a task that does not apply no state, instead of calling it unreadable', async () => {
        // "Does not apply" is not one of the six, and it was being squeezed into
        // `unknown`. That is not a label problem: `unknown` dominates the
        // roll-up, so one inapplicable task made the whole agent permanently
        // unreadable — a business without that capability could never be
        // reported as operating, however much of it worked.
        const { service } = harness({ teamNotApplicable: true });
        const assessment = await service.getAssessment(TENANT, AGENT);
        const team = assessment.tasks.find(task => task.key === 'team')!;
        expect(team.status).toBe('not_applicable');
        expect(team.state).toBeNull();
        // `status` still carries the answer, so nothing was hidden by removing
        // the state — only the wrong word was.
        // What the absence buys, stated against the roll-up itself rather than
        // against this fixture's other tasks: a task that does not apply drags
        // nothing down, while the `unknown` it used to become dominates every
        // healthy part around it.
        expect(rollUpOperationalState(['operating', team.state])).toBe('operating');
        expect(rollUpOperationalState(['operating', 'unknown'])).toBe('unknown');
    });

    it('never rolls a whole agent up to operating while a part could not be read', async () => {
        const { service } = harness({ unknown: true });
        const assessment = await service.getAssessment(TENANT, AGENT);
        expect(assessment.tasks.find(task => task.key === 'knowledge')?.state).toBe('unknown');
        // An unreadable table is not an empty table, and it is not a pass either.
        expect(assessment.state).toBe('unknown');
    });

    it('marks a channel whose projection could not be read as unknown, not as ready', async () => {
        const { service, capabilities } = harness();
        capabilities.resolve.mockRejectedValue(new Error('composer unavailable'));
        const assessment = await service.getAssessment(TENANT, AGENT);
        expect(assessment.channels.every(channel => channel.state === 'unknown')).toBe(true);
        expect(assessment.state).toBe('unknown');
    });

    it('does not widen the template when a saved mission requests an unsupported intent', async () => {
        const { service } = harness({ mission: { version: 1, objective: 'Sell everything', intentKeys: ['unregistered_wire_transfer'], successCriteria: [], handoffConditions: [] } });
        const result = await service.getAssessment(TENANT, AGENT);
        expect(result.mission.unsupportedIntents).toEqual(['unregistered_wire_transfer']);
        expect(result.tasks.find(task => task.key === 'mission')?.status).toBe('fail');
        expect(result.requiredTests).toEqual([]);
    });
    it('rejects mixed agent revisions instead of publishing contradictory evidence', async () => {
        const { service, quality } = harness({ drift: true });
        await expect(service.getAssessment(TENANT, AGENT)).rejects.toBeInstanceOf(ConflictException);
        expect(quality.getOverview).toHaveBeenCalledTimes(2);
    });
    it('distinguishes a new tenant with no agent from an invalid requested agent', async () => {
        const { service, capabilities } = harness({ missing: true });
        await expect(service.getAssessment(TENANT)).resolves.toMatchObject({ agent: null, nextTask: 'agent' });
        await expect(service.getAssessment(TENANT, AGENT)).rejects.toBeInstanceOf(NotFoundException);
        expect(capabilities.resolve).not.toHaveBeenCalled();
    });

    describe('why a readiness answer says what it says', () => {
        // The readiness evaluator reports a failed lookup as `satisfied: true,
        // count: 0` plus a report-wide degraded flag — except when the failure
        // message looks like a table this tenant never provisioned, the branch
        // that also catches an absent COLUMN, because PostgreSQL says "does not
        // exist" for both. So a predicate that cannot run came back as a
        // confident zero and the owner was told to load data they had loaded.
        const blockedMenu = (capabilities: any) => capabilities.resolve.mockResolvedValue({
            contract: {
                publishedTools: [], unmetReadiness: ['menu_items'], degraded: false,
                excluded: [{ subject: 'restaurants', reason: 'readiness_unmet',
                    detail: { es: 'Cargá el menú.', en: 'x', pt: 'x', fr: 'x' }, repairRoute: '/admin/menu' }],
                resolvedAt: '2026-09-06T00:00:00Z',
            },
        } as any);

        it('reads the tenant catalogue once per assessment', async () => {
            const { service, prisma } = harness();
            await service.getAssessment(TENANT, AGENT);
            const reads = prisma.executeInTenantSchema.mock.calls
                .filter((call: any[]) => String(call[1]).includes('FROM information_schema.columns'));
            expect(reads).toHaveLength(1);
            // Bounded to the readiness tables, not the whole schema.
            expect(reads[0][2][1]).toContain('menu_items');
        });

        it('calls an unmet key over a readable table missing data', async () => {
            const { service, capabilities } = harness();
            blockedMenu(capabilities);
            const result = await service.getAssessment(TENANT, AGENT);
            const menu = (result.tools as any[]).find(tool => tool.tool === 'get_menu')!;
            expect(menu.readinessAudit[0]).toMatchObject({ key: 'menu_items', verdict: 'missing_data' });
            expect(menu.state).toBe('pending');
        });

        it('calls it a read error when the predicate names a column the table lacks', async () => {
            const { service, capabilities } = harness({
                readinessColumns: { menu_items: ['id', 'name', 'price', 'is_active'] },
            });
            blockedMenu(capabilities);
            const result = await service.getAssessment(TENANT, AGENT);
            const menu = (result.tools as any[]).find(tool => tool.tool === 'get_menu')!;
            expect(menu.readinessAudit[0]).toMatchObject({ key: 'menu_items', verdict: 'read_error' });
            // Not `pending`: `pending` says there is something here for the
            // owner to do, and there is not.
            expect(menu.state).toBe('unknown');
        });

        it('does not invent a read error for a vertical this tenant never provisioned', async () => {
            // Most of these tables are created on first use, so absent from the
            // catalogue means untouched — and zero rows is the honest answer,
            // exactly as the readiness lookup already treats it. Recording an
            // absent table as a column-less one turns every unprovisioned
            // vertical into an unreadable source: the same lie, reversed.
            const { service, capabilities } = harness({ readinessColumns: {} });
            blockedMenu(capabilities);
            const result = await service.getAssessment(TENANT, AGENT);
            const menu = (result.tools as any[]).find(tool => tool.tool === 'get_menu')!;
            expect(menu.readinessAudit[0]).toMatchObject({ verdict: 'missing_data' });
            expect(menu.state).toBe('pending');
        });

        it('does not turn an unreadable catalogue into a verdict of its own', async () => {
            const { service, capabilities } = harness({ readinessColumns: null });
            blockedMenu(capabilities);
            const result = await service.getAssessment(TENANT, AGENT);
            const menu = (result.tools as any[]).find(tool => tool.tool === 'get_menu')!;
            // Nothing was proven about the columns, so the readiness report's
            // own answer stands rather than being overridden either way.
            expect(menu.readinessAudit[0]).toMatchObject({ verdict: 'missing_data' });
        });

        it('cites the predicate the tool runs on a published tool too', async () => {
            const { service, capabilities } = harness();
            capabilities.resolve.mockResolvedValue({
                contract: { publishedTools: ['get_menu'], excluded: [], unmetReadiness: [], degraded: false,
                    resolvedAt: '2026-09-06T00:00:00Z' },
            } as any);
            const result = await service.getAssessment(TENANT, AGENT);
            const menu = (result.tools as any[]).find(tool => tool.tool === 'get_menu')!;
            expect(menu.readinessAudit[0]).toMatchObject({
                key: 'menu_items', table: 'menu_items',
                predicate: 'is_active = true AND is_available = true', verdict: 'satisfied',
                writePath: '/admin/menu',
            });
            // The shipped check and the tool now read the same sellable menu.
            // A leftover divergence would make the assessment accuse a closed gap.
            expect(menu.readinessAudit[0].auditedDivergence).toBeNull();
        });
    });
});
