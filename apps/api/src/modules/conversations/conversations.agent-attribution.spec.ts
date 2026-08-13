import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ConversationsService } from './conversations.service';

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const AGENT_ID = '22222222-2222-4222-8222-222222222222';

describe('ConversationsService agent attribution', () => {
    function harness(execute = jest.fn(async () => [])) {
        const service: any = Object.create(ConversationsService.prototype);
        Object.assign(service, {
            prisma: { executeInTenantSchema: execute },
            logger: { warn: jest.fn() },
        });
        return { service, execute };
    }

    it('stamps the first durable resolution and flags any later agent/version change', async () => {
        const { service, execute } = harness();
        await service.persistConversationPersonaResolution(
            'tenant_attribution_test',
            CONVERSATION_ID,
            { config: {}, agentId: AGENT_ID, version: 4 },
        );

        expect(execute).toHaveBeenCalledWith(
            'tenant_attribution_test',
            expect.stringMatching(/agent_config_version = CASE[\s\S]*agent_persona_id = COALESCE\(agent_persona_id, \$2::uuid\)/),
            [CONVERSATION_ID, AGENT_ID, 4],
        );
        const sql = String((execute.mock.calls as any[][])[0][1]);
        expect(sql).toContain('agent_attribution_conflicted');
        expect(sql).toContain('agent_persona_id IS DISTINCT FROM $2::uuid');
        expect(sql).toContain('agent_config_version IS DISTINCT FROM $3::integer');
        expect(sql).toContain('agent_persona_id = COALESCE(agent_persona_id, $2::uuid)');
    });

    it('does not write for unattributed legacy fallback', async () => {
        const { service, execute } = harness();
        await service.persistConversationPersonaResolution(
            'tenant_attribution_test',
            CONVERSATION_ID,
            { config: {}, agentId: null, version: null },
        );
        expect(execute).not.toHaveBeenCalled();
    });

    it('keeps attribution observational when lazy DDL is unavailable', async () => {
        const execute = jest.fn(async () => { throw new Error('column unavailable'); });
        const { service } = harness(execute);
        await expect(service.persistConversationPersonaResolution(
            'tenant_attribution_test',
            CONVERSATION_ID,
            { config: {}, agentId: AGENT_ID, version: 1 },
        )).resolves.toBeUndefined();
        expect(service.logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('Could not stamp conversation'),
        );
    });

    it('keeps deterministic/human/redelivery early returns before attribution', () => {
        const source = readFileSync(resolve(__dirname, 'conversations.service.ts'), 'utf8');
        const liveSection = source.slice(
            source.indexOf('// 2. Load Persona & Check Business Hours'),
            source.indexOf('// 5b. Send typing indicator'),
        );
        const firstStamp = liveSection.indexOf('persistConversationPersonaResolution(');

        expect(firstStamp).toBeGreaterThan(liveSection.indexOf('sendAfterHoursMessage('));
        expect(firstStamp).toBeGreaterThan(liveSection.indexOf("conversation.status === 'waiting_human'"));
        expect(firstStamp).toBeGreaterThan(liveSection.indexOf('Redelivery of already-answered'));
        expect(firstStamp).toBeGreaterThan(liveSection.indexOf('attendance handled'));
    });
});
