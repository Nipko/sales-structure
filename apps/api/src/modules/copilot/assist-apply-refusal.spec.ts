import { BadRequestException, ConflictException } from '@nestjs/common';
import { AgentConfigurationService } from './agent-configuration.service';
import { CONNECTION_OWNED_BY_OTHER_AGENT, assistApplyRefusal } from './assist-apply-refusal';

/**
 * An immediate save that would leave two active agents on one connection is
 * refused (`agent_connection_owned_by_other_agent`), because the runtime then
 * refuses every turn on that connection. Assist applies changes through that
 * same save, and relayed the refusal as an English sentence the panel replaced
 * with its generic "no se pudo confirmar este cambio" — nothing told the owner
 * the fix is a channel on another agent.
 */
const TENANT = '11111111-1111-4111-8111-111111111111';
const PROPOSAL = '44444444-4444-4444-8444-444444444444';
const ACTOR = { id: '33333333-3333-4333-8333-333333333333', role: 'tenant_admin' };
const BRUNO = '55555555-5555-4555-8555-555555555555';

const refusal = (connections: unknown[]) => new ConflictException({
    error: CONNECTION_OWNED_BY_OTHER_AGENT,
    message: 'Another active agent serves this connection. Move it explicitly or remove it from one of the agents.',
    connections,
});

describe('assistApplyRefusal', () => {
    it('names who holds which channel and what to do, keeping the code and the owners', () => {
        const connections = [{ connection: 'whatsapp:1098765', agentId: BRUNO, agentName: 'Bruno' }];
        const mapped = assistApplyRefusal(refusal(connections)) as ConflictException;

        expect(mapped).toBeInstanceOf(ConflictException);
        expect(mapped.getStatus()).toBe(409);
        const body = mapped.getResponse() as Record<string, any>;
        expect(body.error).toBe(CONNECTION_OWNED_BY_OTHER_AGENT);
        expect(body.connections).toEqual(connections);
        expect(body.message).toBe('No se aplicó el cambio: Bruno ya atiende WhatsApp, y este agente también tiene ese canal '
            + 'asignado. Con dos agentes activos en el mismo canal, ese canal se queda sin respuesta. Quita el canal de uno '
            + 'de los dos en el editor del agente y vuelve a pedir el cambio.');
        // An account id is routing detail, never copy.
        expect(body.message).not.toContain('1098765');
    });

    it('groups several owners and channels in one sentence', () => {
        const mapped = assistApplyRefusal(refusal([
            { connection: 'whatsapp', agentId: BRUNO, agentName: 'Bruno' },
            { connection: 'web_widget', agentId: BRUNO, agentName: 'Bruno' },
            { connection: 'telegram', agentId: 'x', agentName: 'Carla' },
        ])) as ConflictException;
        const message = (mapped.getResponse() as Record<string, any>).message as string;
        expect(message).toContain('Bruno ya atiende WhatsApp y el chat web; Carla ya atiende Telegram,');
        expect(message).toContain('esos canales asignados');
    });

    it('still says something true when the owners were not named', () => {
        const mapped = assistApplyRefusal(refusal([])) as ConflictException;
        expect((mapped.getResponse() as Record<string, any>).message)
            .toContain('otro agente activo ya atiende uno de sus canales');
    });

    it('leaves every other error exactly as it was', () => {
        const other = new ConflictException({ error: 'configuration_proposal_source_changed' });
        const invalid = new BadRequestException({ error: CONNECTION_OWNED_BY_OTHER_AGENT });
        const plain = new Error('boom');
        expect(assistApplyRefusal(other)).toBe(other);
        expect(assistApplyRefusal(invalid)).toBe(invalid);
        expect(assistApplyRefusal(plain)).toBe(plain);
    });
});

describe('AgentConfigurationService.apply relays the refusal in words the owner can act on', () => {
    function service(failure: unknown) {
        const prisma = {
            getTenantSchemaName: jest.fn().mockResolvedValue('tenant_scope'),
            ensureCanonicalTables: jest.fn().mockResolvedValue(undefined),
            executeInTenantSchema: jest.fn().mockResolvedValue([]),
            // The draft save inside the transaction refused the commit.
            transactionInTenantSchema: jest.fn(async () => { throw failure; }),
        };
        return new AgentConfigurationService(prisma as any, {} as any, {} as any, { emit: jest.fn() } as any,
            null as any, null as any, {} as any);
    }

    it('maps the connection refusal', async () => {
        const connections = [{ connection: 'telegram', agentId: BRUNO, agentName: 'Bruno' }];
        await expect(service(refusal(connections)).apply(TENANT, PROPOSAL, 'a'.repeat(64), ACTOR)).rejects.toMatchObject({
            status: 409,
            response: {
                error: CONNECTION_OWNED_BY_OTHER_AGENT,
                connections,
                message: expect.stringContaining('Bruno ya atiende Telegram'),
            },
        });
    });

    it('does not touch any other failure of the apply', async () => {
        const changed = new ConflictException({ error: 'configuration_proposal_source_changed' });
        await expect(service(changed).apply(TENANT, PROPOSAL, 'a'.repeat(64), ACTOR)).rejects.toBe(changed);
    });
});
