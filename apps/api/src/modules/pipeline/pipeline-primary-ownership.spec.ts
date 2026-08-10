import { BadRequestException } from '@nestjs/common';
import { PipelineService } from './pipeline.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const DEFAULT_PIPELINE_ID = '22222222-2222-4222-8222-222222222222';
const FOREIGN_PIPELINE_ID = '33333333-3333-4333-8333-333333333333';
const STAGE_ID = '44444444-4444-4444-8444-444444444444';
const CONTACT_ID = '55555555-5555-4555-8555-555555555555';
const DEAL_ID = '66666666-6666-4666-8666-666666666666';
const OPPORTUNITY_ID = '77777777-7777-4777-8777-777777777777';
const LEAD_ID = '88888888-8888-4888-8888-888888888888';
const SCHEMA = 'tenant_pipeline_contract';

type SqlCall = { sql: string; params: unknown[] };

function normalizeSql(sql: string): string {
    return sql.replace(/\s+/g, ' ').trim();
}

function buildHarness() {
    const prisma = {
        executeInTenantSchema: jest.fn(),
        transactionInTenantSchema: jest.fn(),
    };
    const throttle = { enforcePlanLimit: jest.fn().mockResolvedValue(undefined) };
    const service = new PipelineService(
        prisma as any,
        { get: jest.fn(), set: jest.fn() } as any,
        { emit: jest.fn() } as any,
        throttle as any,
        {} as any,
    );
    const ensureMultiPipeline = jest.fn().mockResolvedValue({
        schema: SCHEMA,
        defaultPipelineId: DEFAULT_PIPELINE_ID,
    });

    // Keep this suite focused on the public ownership boundary. Bootstrap and
    // legacy adoption have their own tests; here they provide the canonical ID.
    (service as any).ensureMultiPipeline = ensureMultiPipeline;

    return { service, prisma, throttle, ensureMultiPipeline };
}

describe('PipelineService primary-pipeline ownership', () => {
    it('lists stages from the default pipeline when a legacy caller omits pipelineId', async () => {
        const { service, prisma, ensureMultiPipeline } = buildHarness();
        prisma.executeInTenantSchema.mockResolvedValue([{
            id: STAGE_ID,
            name: 'Nuevo',
            slug: 'nuevo',
            color: '#999999',
            position: 0,
            sla_hours: 4,
            is_terminal: false,
            terminal_outcome: null,
            default_probability: 10,
            deal_count: 2,
            total_value: 125000,
        }]);

        const stages = await service.getStages(TENANT_ID);

        expect(ensureMultiPipeline).toHaveBeenCalledWith(TENANT_ID);
        expect(prisma.executeInTenantSchema).toHaveBeenCalledTimes(1);
        const [schema, sql, params] = prisma.executeInTenantSchema.mock.calls[0];
        expect(schema).toBe(SCHEMA);
        expect(normalizeSql(sql)).toContain('WHERE ps.pipeline_id = $1::uuid');
        expect(params).toEqual([DEFAULT_PIPELINE_ID]);
        expect(stages).toEqual([
            expect.objectContaining({ id: STAGE_ID, slug: 'nuevo', dealCount: 2 }),
        ]);
    });

    it('serializes pipeline quota and creation in one transaction', async () => {
        const { service, prisma, throttle } = buildHarness();
        const txCalls: SqlCall[] = [];
        const created = { id: FOREIGN_PIPELINE_ID, name: 'Renovaciones' };
        const query = jest.fn(async (sql: string, params: unknown[] = []) => {
            txCalls.push({ sql: normalizeSql(sql), params });
            if (sql.includes('COUNT(*)::int AS c')) return [{ c: 2 }];
            if (sql.includes('INSERT INTO pipelines')) return [created];
            return [];
        });
        prisma.transactionInTenantSchema.mockImplementation(
            async (_schema: string, callback: (txQuery: any) => Promise<unknown>) => callback(query),
        );

        await expect(service.createPipeline(TENANT_ID, { name: 'Renovaciones' }))
            .resolves.toEqual(created);

        expect(txCalls).toHaveLength(3);
        expect(txCalls[0].sql).toContain('pg_advisory_xact_lock');
        expect(txCalls[1].sql).toContain('FROM pipelines');
        expect(txCalls[1].params).toEqual([TENANT_ID]);
        expect(throttle.enforcePlanLimit).toHaveBeenCalledWith(
            TENANT_ID,
            'maxPipelines',
            2,
            'Pipelines',
        );
        expect(txCalls[2].sql).toContain('INSERT INTO pipelines');
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });

    it('refuses to delete a non-empty pipeline without partially reassigning its contents', async () => {
        const { service, prisma } = buildHarness();
        const txCalls: SqlCall[] = [];
        const query = jest.fn(async (sql: string, params: unknown[] = []) => {
            txCalls.push({ sql: normalizeSql(sql), params });
            if (sql.includes('SELECT id, is_default')) {
                return [{ id: FOREIGN_PIPELINE_ID, is_default: false }];
            }
            if (sql.includes('FROM pipeline_stages WHERE pipeline_id')) {
                return [{ stages: 3, deals: 1 }];
            }
            return [];
        });
        prisma.transactionInTenantSchema.mockImplementation(
            async (_schema: string, callback: (txQuery: any) => Promise<unknown>) => callback(query),
        );

        await expect(service.deletePipeline(TENANT_ID, FOREIGN_PIPELINE_ID))
            .rejects.toMatchObject({
                response: expect.objectContaining({
                    error: 'pipeline_not_empty',
                    stages: 3,
                    deals: 1,
                }),
            });

        expect(txCalls.some((call) => call.sql.startsWith('UPDATE pipeline_stages'))).toBe(false);
        expect(txCalls.some((call) => call.sql.startsWith('UPDATE deals'))).toBe(false);
        expect(txCalls.some((call) => call.sql.startsWith('UPDATE pipelines'))).toBe(false);
    });

    it('deactivates an empty non-default pipeline atomically', async () => {
        const { service, prisma } = buildHarness();
        const txCalls: SqlCall[] = [];
        const query = jest.fn(async (sql: string, params: unknown[] = []) => {
            txCalls.push({ sql: normalizeSql(sql), params });
            if (sql.includes('SELECT id, is_default')) {
                return [{ id: FOREIGN_PIPELINE_ID, is_default: false }];
            }
            if (sql.includes('FROM pipeline_stages WHERE pipeline_id')) {
                return [{ stages: 0, deals: 0 }];
            }
            return [];
        });
        prisma.transactionInTenantSchema.mockImplementation(
            async (_schema: string, callback: (txQuery: any) => Promise<unknown>) => callback(query),
        );

        await expect(service.deletePipeline(TENANT_ID, FOREIGN_PIPELINE_ID))
            .resolves.toEqual({ success: true });

        expect(txCalls.at(-1)?.sql).toContain('UPDATE pipelines');
        expect(txCalls.at(-1)?.params).toEqual([FOREIGN_PIPELINE_ID, TENANT_ID]);
    });

    it('creates a legacy stage in the default pipeline and serializes quota, position, and insert', async () => {
        const { service, prisma, throttle } = buildHarness();
        const txCalls: SqlCall[] = [];
        const query = jest.fn(async (sql: string, params: unknown[] = []) => {
            txCalls.push({ sql: normalizeSql(sql), params });
            if (sql.includes('COUNT(*)')) return [{ c: 6 }];
            if (sql.includes('MAX(position)')) return [{ next_pos: 7 }];
            return [];
        });
        prisma.transactionInTenantSchema.mockImplementation(
            async (schema: string, callback: (txQuery: any) => Promise<unknown>) => {
                expect(schema).toBe(SCHEMA);
                return callback(query);
            },
        );

        await service.createStage(TENANT_ID, {
            name: 'Propuesta',
            slug: 'propuesta',
            color: '#123456',
            defaultProbability: 70,
        });

        expect(prisma.transactionInTenantSchema).toHaveBeenCalledTimes(1);
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
        expect(txCalls).toHaveLength(4);
        expect(txCalls[0].sql).toContain('pg_advisory_xact_lock');
        expect(txCalls[0].params).toEqual([TENANT_ID]);
        expect(txCalls[1].sql).toContain('COUNT(*)::int AS c FROM pipeline_stages WHERE pipeline_id = $1::uuid');
        expect(txCalls[1].params).toEqual([DEFAULT_PIPELINE_ID]);
        expect(throttle.enforcePlanLimit).toHaveBeenCalledWith(
            TENANT_ID,
            'pipelineStages',
            6,
            'etapas de pipeline',
        );
        expect(txCalls[2].sql).toContain('MAX(position)');
        expect(txCalls[2].sql).toContain('WHERE pipeline_id = $1::uuid');
        expect(txCalls[2].params).toEqual([DEFAULT_PIPELINE_ID]);
        expect(txCalls[3].sql).toContain('INSERT INTO pipeline_stages');
        expect(txCalls[3].sql).toContain('pipeline_id');
        expect(txCalls[3].sql).toContain('$10::uuid');
        expect(txCalls[3].params[4]).toBe(7);
        expect(txCalls[3].params[9]).toBe(DEFAULT_PIPELINE_ID);
        expect(txCalls[3].params[9]).not.toBeNull();

        const countOrder = query.mock.invocationCallOrder[1];
        const quotaOrder = throttle.enforcePlanLimit.mock.invocationCallOrder[0];
        const positionOrder = query.mock.invocationCallOrder[2];
        expect(countOrder).toBeLessThan(quotaOrder);
        expect(quotaOrder).toBeLessThan(positionOrder);
    });

    it('creates a legacy deal only against a stage in the default pipeline and persists that pipeline', async () => {
        const { service, prisma } = buildHarness();
        const outsideCalls: SqlCall[] = [];
        prisma.executeInTenantSchema.mockImplementation(
            async (_schema: string, sql: string, params: unknown[] = []) => {
                outsideCalls.push({ sql: normalizeSql(sql), params });
                if (sql.includes('SELECT id FROM pipeline_stages')) return [{ id: STAGE_ID }];
                if (sql.includes('SELECT sla_hours')) {
                    return [{
                        sla_hours: 24,
                        default_probability: 60,
                        name: 'Propuesta',
                        is_terminal: false,
                        terminal_outcome: null,
                    }];
                }
                return [];
            },
        );
        const txCalls: SqlCall[] = [];
        const query = jest.fn(async (sql: string, params: unknown[] = []) => {
            txCalls.push({ sql: normalizeSql(sql), params });
            if (sql.includes('INSERT INTO deals')) {
                return [{
                    id: DEAL_ID,
                    contact_id: CONTACT_ID,
                    title: 'Renovación anual',
                    value: 900000,
                    currency: 'COP',
                    stage_id: STAGE_ID,
                    probability: 60,
                    expected_close_date: null,
                    assigned_agent_id: null,
                    notes: '',
                    tags: [],
                    created_at: '2026-08-09T10:00:00.000Z',
                    updated_at: '2026-08-09T10:00:00.000Z',
                    stage_entered_at: '2026-08-09T10:00:00.000Z',
                    sla_deadline: null,
                }];
            }
            return [];
        });
        prisma.transactionInTenantSchema.mockImplementation(
            async (schema: string, callback: (txQuery: any) => Promise<unknown>) => {
                expect(schema).toBe(SCHEMA);
                return callback(query);
            },
        );

        const deal = await service.createDeal(TENANT_ID, {
            contactId: CONTACT_ID,
            title: 'Renovación anual',
            value: 900000,
            stageId: STAGE_ID,
        });

        expect(outsideCalls[0].sql).toContain('WHERE id = $1::uuid AND tenant_id = $2::uuid AND pipeline_id = $3::uuid');
        expect(outsideCalls[0].params).toEqual([STAGE_ID, TENANT_ID, DEFAULT_PIPELINE_ID]);
        expect(outsideCalls[1].sql).toContain('WHERE id = $1::uuid AND pipeline_id = $2::uuid');
        expect(outsideCalls[1].params).toEqual([STAGE_ID, DEFAULT_PIPELINE_ID]);
        expect(prisma.transactionInTenantSchema).toHaveBeenCalledTimes(1);
        expect(txCalls).toHaveLength(2);
        expect(txCalls[0].sql).toContain('INSERT INTO deals');
        expect(txCalls[0].sql).toContain('$11::uuid');
        expect(txCalls[0].params[10]).toBe(DEFAULT_PIPELINE_ID);
        expect(txCalls[0].params[10]).not.toBeNull();
        expect(txCalls[1].sql).toContain('INSERT INTO stage_transitions');
        expect(deal).toEqual(expect.objectContaining({ id: DEAL_ID, stageId: STAGE_ID }));
    });

    it('rejects an invalid explicit pipelineId before a stage write', async () => {
        const { service, prisma, throttle } = buildHarness();

        await expect(service.createStage(TENANT_ID, {
            name: 'Propuesta',
            color: '#123456',
            pipelineId: 'not-a-uuid',
        })).rejects.toThrow(BadRequestException);

        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
        expect(throttle.enforcePlanLimit).not.toHaveBeenCalled();
    });

    it('rejects a foreign explicit pipelineId before resolving a stage or creating a deal', async () => {
        const { service, prisma } = buildHarness();
        prisma.executeInTenantSchema.mockResolvedValue([]);

        await expect(service.createDeal(TENANT_ID, {
            contactId: CONTACT_ID,
            title: 'Intento ajeno',
            value: 1,
            stageId: STAGE_ID,
            pipelineId: FOREIGN_PIPELINE_ID,
        })).rejects.toThrow(BadRequestException);

        expect(prisma.executeInTenantSchema).toHaveBeenCalledTimes(1);
        const [schema, sql, params] = prisma.executeInTenantSchema.mock.calls[0];
        expect(schema).toBe(SCHEMA);
        expect(normalizeSql(sql)).toContain(
            'WHERE id = $1::uuid AND tenant_id = $2::uuid AND is_active = true',
        );
        expect(params).toEqual([FOREIGN_PIPELINE_ID, TENANT_ID]);
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });
});

describe('PipelineService vertical transition evidence', () => {
    const ctx = {
        email: '',
        phone: '',
        name: '',
        score: 0,
        assignedAgentId: null,
        contactId: CONTACT_ID,
        leadId: null,
        opportunityId: OPPORTUNITY_ID,
        opportunityCreatedAt: '2026-08-10T12:00:00.000Z',
    };

    it('requires a live tour booking without accepting an unrelated appointment', async () => {
        const { service, prisma } = buildHarness();
        prisma.executeInTenantSchema.mockResolvedValueOnce([]);

        await expect((service as any).runRuleChecks(
            SCHEMA,
            [{ type: 'tour_booking_required' }],
            ctx,
        )).rejects.toThrow('TRANSITION_RULE_FAILED:tour_booking_required');

        expect(normalizeSql(prisma.executeInTenantSchema.mock.calls[0][1]))
            .toContain('FROM tour_bookings');
        expect(prisma.executeInTenantSchema).toHaveBeenCalledTimes(1);
    });

    it('accepts a live tour booking for the same contact', async () => {
        const { service, prisma } = buildHarness();
        prisma.executeInTenantSchema.mockResolvedValueOnce([{ '?column?': 1 }]);

        await expect((service as any).runRuleChecks(
            SCHEMA,
            [{ type: 'tour_booking_required' }],
            ctx,
        )).resolves.toBeUndefined();
        expect(prisma.executeInTenantSchema.mock.calls[0][2]).toEqual([
            CONTACT_ID,
            ctx.opportunityCreatedAt,
            OPPORTUNITY_ID,
        ]);
    });

    it('requires a live property booking for lodging stages', async () => {
        const { service, prisma } = buildHarness();
        prisma.executeInTenantSchema.mockResolvedValueOnce([]);

        await expect((service as any).runRuleChecks(
            SCHEMA,
            [{ type: 'property_booking_required' }],
            ctx,
        )).rejects.toThrow('TRANSITION_RULE_FAILED:property_booking_required');

        expect(normalizeSql(prisma.executeInTenantSchema.mock.calls[0][1]))
            .toContain('FROM property_bookings');
    });

    it('requires a scheduled, live service request for home-service dispatch', async () => {
        const { service, prisma } = buildHarness();
        prisma.executeInTenantSchema.mockResolvedValueOnce([]);

        await expect((service as any).runRuleChecks(
            SCHEMA,
            [{ type: 'service_request_scheduled_required' }],
            ctx,
        )).rejects.toThrow('TRANSITION_RULE_FAILED:service_request_scheduled_required');

        const sql = normalizeSql(prisma.executeInTenantSchema.mock.calls[0][1]);
        expect(sql).toContain('FROM service_requests');
        expect(sql).toContain('scheduled_at IS NOT NULL');
        expect(sql).toContain("status IN ('scheduled','dispatched','in_progress','completed')");
    });

    it.each([
        {
            rule: 'food_order_required',
            table: 'food_orders',
            clauses: ["status <> 'cancelled'"],
        },
        {
            rule: 'photo_session_scheduled_required',
            table: 'photo_sessions',
            clauses: [
                'scheduled_at IS NOT NULL',
                "status IN ('scheduled','in_progress','delivered')",
            ],
        },
        {
            rule: 'pet_boarding_required',
            table: 'resource_rentals',
            clauses: ["rental_type = 'pet_boarding'", "status <> 'cancelled'"],
        },
        {
            rule: 'vehicle_rental_required',
            table: 'resource_rentals',
            clauses: ["rental_type = 'vehicle_rental'", "status <> 'cancelled'"],
        },
    ])('requires same-contact native evidence for $rule', async ({ rule, table, clauses }) => {
        const { service, prisma } = buildHarness();
        prisma.executeInTenantSchema.mockResolvedValueOnce([]);

        await expect((service as any).runRuleChecks(
            SCHEMA,
            [{ type: rule }],
            ctx,
        )).rejects.toThrow(`TRANSITION_RULE_FAILED:${rule}`);

        expect(prisma.executeInTenantSchema).toHaveBeenCalledTimes(1);
        const sql = normalizeSql(prisma.executeInTenantSchema.mock.calls[0][1]);
        expect(sql).toContain(`FROM ${table}`);
        expect(sql).toContain('contact_id = $1::uuid');
        for (const clause of clauses) expect(sql).toContain(clause);
        if (rule === 'photo_session_scheduled_required') {
            expect(sql).not.toContain("status IN ('requested'");
            expect(sql).not.toContain("'requested','scheduled'");
        }
        expect(prisma.executeInTenantSchema.mock.calls[0][2]).toEqual([
            CONTACT_ID,
            ctx.opportunityCreatedAt,
            OPPORTUNITY_ID,
        ]);
    });

    it.each([
        'food_order_required',
        'photo_session_scheduled_required',
        'pet_boarding_required',
        'vehicle_rental_required',
    ])('accepts valid native evidence for the same contact: %s', async (rule) => {
        const { service, prisma } = buildHarness();
        prisma.executeInTenantSchema.mockResolvedValueOnce([{ '?column?': 1 }]);

        await expect((service as any).runRuleChecks(
            SCHEMA,
            [{ type: rule }],
            ctx,
        )).resolves.toBeUndefined();

        expect(prisma.executeInTenantSchema.mock.calls[0][2]).toEqual([
            CONTACT_ID,
            ctx.opportunityCreatedAt,
            OPPORTUNITY_ID,
        ]);
    });

    it('uses exact ownership first and applies temporal uniqueness only to legacy NULL owners', async () => {
        const { service, prisma } = buildHarness();
        prisma.executeInTenantSchema.mockResolvedValueOnce([]);

        await expect((service as any).runRuleChecks(
            SCHEMA,
            [{ type: 'appointment_required' }],
            ctx,
        )).rejects.toThrow('TRANSITION_RULE_FAILED:appointment_required');

        const [, sql, params] = prisma.executeInTenantSchema.mock.calls[0];
        const normalized = normalizeSql(sql);
        expect(normalized).not.toContain('WHERE e.contact_id = $1::uuid');
        expect(normalized).toContain('e.opportunity_id = $3::uuid');
        expect(normalized).toContain('e.opportunity_id IS NULL');
        expect(normalized).toContain('e.opportunity_id IS NULL AND ( e.contact_id = $1::uuid OR EXISTS');
        expect(normalized).toContain('evidence_identity.customer_profile_id = requested_identity.customer_profile_id');
        expect(normalized).toContain('current_lead_identity.contact_id = current_l.contact_id');
        expect(normalized).toContain('other_now_identity.contact_id = other_now_l.contact_id');
        expect(normalized).toContain('current_o.id = $3::uuid');
        expect(normalized).toContain('other_now.id <> $3::uuid');
        expect(normalized).toContain('other_at_evidence.id <> $3::uuid');
        expect(normalized).toContain('other_at_evidence.won_at >= e.created_at');
        expect(normalized).toContain('other_at_evidence.lost_at >= e.created_at');
        expect(params).toEqual([CONTACT_ID, ctx.opportunityCreatedAt, OPPORTUNITY_ID]);
    });

    it('uses the fail-closed legacy scope only when opportunity_id is the missing column', async () => {
        const { service, prisma } = buildHarness();
        prisma.executeInTenantSchema
            .mockRejectedValueOnce(Object.assign(
                new Error('column e.opportunity_id does not exist'),
                { code: '42703' },
            ))
            .mockResolvedValueOnce([]);

        await expect((service as any).runRuleChecks(
            SCHEMA,
            [{ type: 'appointment_required' }],
            ctx,
        )).rejects.toThrow('TRANSITION_RULE_FAILED:appointment_required');

        expect(prisma.executeInTenantSchema).toHaveBeenCalledTimes(2);
        const modern = normalizeSql(prisma.executeInTenantSchema.mock.calls[0][1]);
        const legacy = normalizeSql(prisma.executeInTenantSchema.mock.calls[1][1]);
        expect(modern).toContain('e.opportunity_id = $3::uuid');
        expect(legacy).not.toContain('e.opportunity_id');
        expect(legacy).toContain('e.contact_id = $1::uuid');
        expect(legacy).toContain('evidence_identity.customer_profile_id = requested_identity.customer_profile_id');
        expect(legacy).toContain('current_lead_identity.contact_id = current_l.contact_id');
        expect(legacy).toContain('current_o.id = $3::uuid');
        expect(legacy).toContain('other_at_evidence.id <> $3::uuid');
    });

    it('scopes a NULL-owned cross-channel row to a unified customer profile', async () => {
        const { service, prisma } = buildHarness();
        prisma.executeInTenantSchema.mockImplementationOnce(async (_schema: string, sql: string) => {
            const normalized = normalizeSql(sql);
            const hasUnifiedEvidenceOwner = normalized.includes(
                'evidence_identity.customer_profile_id = requested_identity.customer_profile_id',
            ) && normalized.includes('evidence_identity.contact_id = e.contact_id');
            const checksUnifiedOpportunityAmbiguity = normalized.includes(
                'other_now_identity.contact_id = other_now_l.contact_id',
            ) && normalized.includes('other_at_identity.contact_id = other_at_l.contact_id');
            return hasUnifiedEvidenceOwner && checksUnifiedOpportunityAmbiguity
                ? [{ '?column?': 1 }]
                : [];
        });

        await expect((service as any).runRuleChecks(
            SCHEMA,
            [{ type: 'appointment_required' }],
            ctx,
        )).resolves.toBeUndefined();

        const sql = normalizeSql(prisma.executeInTenantSchema.mock.calls[0][1]);
        expect(sql).toContain('e.opportunity_id IS NULL');
        expect(sql).toContain('requested_identity.contact_id = $1::uuid');
        expect(sql).toContain('e.created_at >= $2::timestamp');
    });

    it('scopes native evidence to records created after the exact opportunity', async () => {
        const { service, prisma } = buildHarness();
        prisma.executeInTenantSchema.mockResolvedValueOnce([{ '?column?': 1 }]);

        await expect((service as any).runRuleChecks(
            SCHEMA,
            [{ type: 'property_booking_required' }],
            ctx,
        )).resolves.toBeUndefined();

        const [, sql, params] = prisma.executeInTenantSchema.mock.calls[0];
        expect(normalizeSql(sql)).toContain('created_at >= $2::timestamp');
        expect(params).toEqual([CONTACT_ID, ctx.opportunityCreatedAt, OPPORTUNITY_ID]);
    });

    it('carries the exact opportunity boundary through lead rule evaluation', async () => {
        const { service, prisma } = buildHarness();
        (service as any).resolveTenantStage = jest.fn().mockResolvedValue({
            slug: 'reservado',
            transition_rules: [{ type: 'tour_booking_required' }],
        });
        prisma.executeInTenantSchema
            .mockResolvedValueOnce([{
                lead_id: LEAD_ID,
                contact_id: CONTACT_ID,
                opportunity_id: OPPORTUNITY_ID,
                opportunity_created_at: ctx.opportunityCreatedAt,
                active_opportunity_count: 1,
            }])
            .mockResolvedValueOnce([{ '?column?': 1 }]);

        await service.evaluateRulesForLead(
            SCHEMA,
            TENANT_ID,
            LEAD_ID,
            'reservado',
            DEFAULT_PIPELINE_ID,
            OPPORTUNITY_ID,
        );

        const leadLookup = prisma.executeInTenantSchema.mock.calls[0];
        expect(normalizeSql(leadLookup[1])).toContain('o.id = $2::uuid');
        expect(normalizeSql(leadLookup[1])).toContain('o.lead_id = l.id');
        expect(leadLookup[2]).toEqual([LEAD_ID, OPPORTUNITY_ID]);
        expect(prisma.executeInTenantSchema.mock.calls[1][2]).toEqual([
            CONTACT_ID,
            ctx.opportunityCreatedAt,
            OPPORTUNITY_ID,
        ]);
    });

    it('keeps generic commerce and restaurant orders isolated', async () => {
        const generic = buildHarness();
        generic.prisma.executeInTenantSchema.mockResolvedValueOnce([]);

        await expect((generic.service as any).runRuleChecks(
            SCHEMA,
            [{ type: 'order_required' }],
            ctx,
        )).rejects.toThrow('TRANSITION_RULE_FAILED:order_required');

        const genericSql = normalizeSql(generic.prisma.executeInTenantSchema.mock.calls[0][1]);
        expect(genericSql).toContain('FROM orders');
        expect(genericSql).not.toContain('FROM food_orders');

        const food = buildHarness();
        food.prisma.executeInTenantSchema.mockResolvedValueOnce([]);
        await expect((food.service as any).runRuleChecks(
            SCHEMA,
            [{ type: 'food_order_required' }],
            ctx,
        )).rejects.toThrow('TRANSITION_RULE_FAILED:food_order_required');

        const foodSql = normalizeSql(food.prisma.executeInTenantSchema.mock.calls[0][1]);
        expect(foodSql).toContain('FROM food_orders');
        expect(foodSql).not.toContain('FROM orders');
    });

    it('turns only an absent specialized table into a native rule failure', async () => {
        const { service, prisma } = buildHarness();
        prisma.executeInTenantSchema.mockRejectedValueOnce(
            Object.assign(new Error('relation photo_sessions does not exist'), { code: '42P01' }),
        );

        await expect((service as any).runRuleChecks(
            SCHEMA,
            [{ type: 'photo_session_scheduled_required' }],
            ctx,
        )).rejects.toThrow('TRANSITION_RULE_FAILED:photo_session_scheduled_required');
    });

    it('does not hide SQL contract failures as a missing optional vertical table', async () => {
        const { service, prisma } = buildHarness();
        prisma.executeInTenantSchema.mockRejectedValueOnce(
            Object.assign(new Error('column contact_id does not exist'), { code: '42703' }),
        );

        await expect((service as any).runRuleChecks(
            SCHEMA,
            [{ type: 'appointment_required' }],
            ctx,
        )).rejects.toMatchObject({ code: '42703' });
    });
});
