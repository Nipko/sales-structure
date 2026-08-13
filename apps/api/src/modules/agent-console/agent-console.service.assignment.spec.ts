import { AgentConsoleService } from './agent-console.service';

describe('AgentConsoleService canonical manual-assignment event', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const conversationId = '22222222-2222-4222-8222-222222222222';
    const agentId = '33333333-3333-4333-8333-333333333333';
    const contactId = '44444444-4444-4444-8444-444444444444';
    const schemaName = 'tenant_acme_11111111111141118111111111111111';

    function makeHarness(transactionFails = false) {
        const order: string[] = [];
        const query = jest.fn().mockImplementation(async (sql: string) => {
            if (sql.includes('RETURNING contact_id')) return [{ contact_id: contactId }];
            if (sql.includes('SELECT phone FROM contacts')) return [{ phone: '+573001234567' }];
            return [];
        });
        const prisma: any = {
            user: {
                findFirst: jest.fn().mockResolvedValue({ id: agentId }),
            },
            transactionInTenantSchema: jest.fn().mockImplementation(async (_schema: string, callback: any) => {
                if (transactionFails) throw new Error('manual assignment transaction failed');
                const result = await callback(query);
                order.push('commit');
                return result;
            }),
        };
        const redis = { get: jest.fn().mockResolvedValue(schemaName) };
        const events = {
            emit: jest.fn().mockImplementation(() => {
                order.push('event');
                return true;
            }),
        };
        const service = new AgentConsoleService(
            prisma,
            redis as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            events as any,
            {} as any,
        );
        return { service, prisma, redis, events, query, order };
    }

    it('emits conversation.assigned only after the assignment transaction commits', async () => {
        const h = makeHarness();

        await h.service.assignConversation(tenantId, conversationId, agentId);

        expect(h.order).toEqual(['commit', 'event']);
        expect(h.prisma.transactionInTenantSchema).toHaveBeenCalledWith(schemaName, expect.any(Function));
        expect(h.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO conversation_assignments'),
            [conversationId, agentId, expect.any(String)],
        );
        expect(h.events.emit).toHaveBeenCalledWith('conversation.assigned', expect.objectContaining({
            tenantId,
            schemaName,
            conversationId,
            agentId,
            contactId,
            phone: '+573001234567',
            assignmentSource: 'manual',
            assignedAt: expect.any(String),
        }));
    });

    it('does not emit conversation.assigned when the assignment transaction rolls back', async () => {
        const h = makeHarness(true);

        await expect(h.service.assignConversation(tenantId, conversationId, agentId))
            .rejects.toThrow('manual assignment transaction failed');

        expect(h.events.emit).not.toHaveBeenCalled();
        expect(h.order).toEqual([]);
    });

    it('omits optional contact fields instead of fabricating identifiers', async () => {
        const h = makeHarness();
        h.query.mockImplementation(async (sql: string) => {
            if (sql.includes('RETURNING contact_id')) return [{ contact_id: null }];
            return [];
        });

        await h.service.assignConversation(tenantId, conversationId, agentId);

        const event = h.events.emit.mock.calls[0][1];
        expect(event).not.toHaveProperty('contactId');
        expect(event).not.toHaveProperty('phone');
    });

    it('claims only when the conversation is still unassigned', async () => {
        const h = makeHarness();

        await h.service.claimConversation(tenantId, conversationId, agentId);

        const assignmentUpdate = h.query.mock.calls.find(([sql]) =>
            String(sql).includes('UPDATE conversations'),
        );
        expect(assignmentUpdate?.[0]).toContain('AND assigned_to IS NULL');
        expect(assignmentUpdate?.[0]).toContain('was_handed_off = true');
        expect(assignmentUpdate?.[0]).not.toContain('agent_attribution_conflicted');
        expect(assignmentUpdate?.[1]).toEqual([conversationId, agentId]);
        expect(h.events.emit).toHaveBeenCalledWith(
            'conversation.assigned',
            expect.objectContaining({ tenantId, conversationId, agentId }),
        );
    });

    it('fails atomically when another agent already claimed the conversation', async () => {
        const h = makeHarness();
        h.query.mockImplementation(async (sql: string) => {
            if (sql.includes('UPDATE conversations')) return [];
            return [];
        });

        await expect(h.service.claimConversation(tenantId, conversationId, agentId))
            .rejects.toMatchObject({ status: 409 });

        expect(h.query).not.toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO conversation_assignments'),
            expect.any(Array),
        );
        expect(h.events.emit).not.toHaveBeenCalled();
    });

    it('rejects an inactive or cross-tenant assignment target before opening a transaction', async () => {
        const h = makeHarness();
        h.prisma.user.findFirst.mockResolvedValue(null);

        await expect(h.service.assignConversation(tenantId, conversationId, agentId))
            .rejects.toMatchObject({ status: 400 });

        expect(h.prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                id: agentId,
                tenantId,
                isActive: true,
            }),
        }));
        expect(h.prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });
});
