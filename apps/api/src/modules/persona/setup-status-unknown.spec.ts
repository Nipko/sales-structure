import { PersonaController } from './persona.controller';
import { resolveOnboardingGuide } from '@parallext/shared';

/**
 * What this endpoint is allowed to claim when it could not look.
 *
 * `resolveOnboardingGuide` reads `hasAnyChannel === false` as "this account
 * cannot receive a single message" and sends the person to the setup card with
 * Agent Health hidden. The shared contract says so in writing — `undefined`
 * means NOT KNOWN HERE and must never be spelled `false`. This endpoint spelled
 * it `false` for every check: each query carried its own `.catch(() => [{c:0}])`
 * and the helper above turned a rejected promise into a zero, so one unreadable
 * count told a working tenant to connect its first channel.
 */
describe('what setup-status says when a count cannot be read', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';

    function harness(behaviour: (sql: string) => any) {
        const controller: any = Object.create(PersonaController.prototype);
        Object.assign(controller, {
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
            prisma: {
                tenant: { findUnique: jest.fn().mockResolvedValue({
                    id: tenantId, schemaName: 'tenant_demo', industry: 'salud',
                    settings: { setupWizardCompleted: true },
                }) },
                getTenantSchemaName: jest.fn().mockResolvedValue('tenant_demo'),
                $queryRawUnsafe: jest.fn(async (sql: string) => behaviour(sql)),
            },
        });
        return controller;
    }

    const rows = (count: number) => [{ c: count }];

    it('answers unknown for the check that failed, not "missing"', async () => {
        const controller = harness(sql => {
            if (sql.includes('FROM channel_accounts')) throw new Error('connection reset');
            if (sql.includes('agent_personas')) return rows(1);
            return rows(0);
        });
        const answer: any = await controller.getSetupStatus(tenantId);

        expect(answer.data.hasAnyChannel).toBeUndefined();
        // And the guide takes its own unknown branch instead of deciding.
        expect(resolveOnboardingGuide({
            stage: answer.data.onboardingStage,
            hasAnyChannel: answer.data.hasAnyChannel,
            setupWizardCompleted: true,
            setupWizardSkipped: false,
            hasAgent: answer.data.hasPersona,
            channelConnectSkippedAt: null,
        }).landing).toBe('unknown');
    });

    it('still answers false when the count really is zero', async () => {
        const controller = harness(() => rows(0));
        const answer: any = await controller.getSetupStatus(tenantId);
        expect(answer.data.hasAnyChannel).toBe(false);
        expect(answer.data.hasPersona).toBe(false);
    });

    it('still answers true when the row is there', async () => {
        const controller = harness(sql =>
            sql.includes('FROM channel_accounts') && sql.includes('COUNT') ? rows(2)
                : sql.includes('DISTINCT channel_type') ? [{ channel_type: 'whatsapp' }]
                    : rows(1));
        const answer: any = await controller.getSetupStatus(tenantId);
        expect(answer.data.hasAnyChannel).toBe(true);
        expect(answer.data.connectedChannelTypes).toEqual(['whatsapp']);
    });

    it('does not go looking for connected types on a channel count it never read', async () => {
        const seen: string[] = [];
        const controller = harness(sql => {
            seen.push(sql);
            if (sql.includes('FROM channel_accounts')) throw new Error('connection reset');
            return rows(0);
        });
        await controller.getSetupStatus(tenantId);
        expect(seen.some(sql => sql.includes('DISTINCT channel_type'))).toBe(false);
    });

    it('reports every flag as unknown when the whole block fails, never as a bare account', async () => {
        const controller = harness(() => { throw new Error('schema unavailable'); });
        const answer: any = await controller.getSetupStatus(tenantId);
        for (const key of ['hasPersona', 'hasConversations', 'hasKnowledge', 'hasTeam',
            'hasAutomation', 'hasTemplates', 'hasAnyChannel', 'hasBusinessAbout']) {
            expect(answer.data[key]).toBeUndefined();
        }
    });
});
