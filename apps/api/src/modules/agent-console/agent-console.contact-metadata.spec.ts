import 'reflect-metadata';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AgentConsoleController } from './agent-console.controller';
import { AgentConsoleService } from './agent-console.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';
const DEFINITION_ID = '99999999-9999-4999-8999-999999999999';
const SCHEMA = 'tenant_acme';

function buildService(options: { updated?: Array<{ metadata: Record<string, string> }> } = {}) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const prisma = {
        executeInTenantSchema: jest.fn(async (_schema: string, sql: string, params: unknown[] = []) => {
            calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
            if (/FROM custom_attribute_definitions/.test(sql)) {
                return [{ id: DEFINITION_ID, attribute_key: 'barrio' }];
            }
            if (/UPDATE contacts/.test(sql)) {
                return options.updated ?? [{ metadata: { empresa: 'Acme' } }];
            }
            return [];
        }),
    };
    const redis = { get: jest.fn().mockResolvedValue(SCHEMA), set: jest.fn() };
    const service = new AgentConsoleService(
        prisma as any, redis as any, {} as any, {} as any, {} as any, { emit: jest.fn() } as any, {} as any,
    );
    return { service, prisma, calls };
}

describe('inbox contact card persistence (replaces the missing PATCH /crm/contacts route)', () => {
    it('exposes PUT agent-console/conversation/:tenantId/:conversationId/contact-metadata', () => {
        const handler = (AgentConsoleController.prototype as any).updateContactMetadata;
        expect(Reflect.getMetadata(PATH_METADATA, handler))
            .toBe('conversation/:tenantId/:conversationId/contact-metadata');
        expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(2); // RequestMethod.PUT
    });

    it('merges the typed fields into the conversation\'s own contact and clears emptied ones', async () => {
        const { service, calls } = buildService();
        const result = await service.updateContactMetadata(TENANT_ID, CONVERSATION_ID, {
            empresa: '  Acme  ',
            ciudad: '',
            barrio: 'Centro',
            [DEFINITION_ID]: 'valor por id',
        });
        expect(result).toEqual({ empresa: 'Acme' });

        const update = calls.find((c) => /UPDATE contacts/.test(c.sql))!;
        // The contact is resolved from the conversation, never from a client-supplied id.
        expect(update.sql).toContain('SELECT contact_id FROM conversations WHERE id = $1::uuid');
        expect(update.params[0]).toBe(CONVERSATION_ID);
        expect(JSON.parse(update.params[1] as string)).toEqual({
            empresa: 'Acme',
            barrio: 'Centro',
            [DEFINITION_ID]: 'valor por id',
        });
        expect(update.params[2]).toEqual(['ciudad']);
    });

    it('rejects keys that are neither card fields nor contact custom attributes', async () => {
        const { service, calls } = buildService();
        await expect(service.updateContactMetadata(TENANT_ID, CONVERSATION_ID, {
            empresa: 'Acme',
            handoff: 'x',
        })).rejects.toBeInstanceOf(BadRequestException);
        expect(calls.some((c) => /UPDATE contacts/.test(c.sql))).toBe(false);
    });

    it('rejects non-object bodies, non-string values and oversized values', async () => {
        const { service } = buildService();
        for (const bad of [undefined, null, 'x', ['a'], {}, { empresa: 5 }, { empresa: 'x'.repeat(2001) }]) {
            await expect(service.updateContactMetadata(TENANT_ID, CONVERSATION_ID, bad))
                .rejects.toBeInstanceOf(BadRequestException);
        }
    });

    it('reports a conversation without a contact instead of pretending it saved', async () => {
        const { service } = buildService({ updated: [] });
        await expect(service.updateContactMetadata(TENANT_ID, CONVERSATION_ID, { empresa: 'Acme' }))
            .rejects.toBeInstanceOf(NotFoundException);
    });

    it('the route checks ownership first and a denial writes nothing', async () => {
        const service = {
            assertCanActOnConversation: jest.fn().mockRejectedValue(new ForbiddenException('not yours')),
            updateContactMetadata: jest.fn().mockResolvedValue({ empresa: 'Acme' }),
        };
        const controller = new AgentConsoleController(
            service as any, {} as any, {} as any, {} as any, {} as any, {} as any,
        );
        const req = { user: { id: ACTOR_ID, role: 'tenant_agent' } };

        await expect(controller.updateContactMetadata(TENANT_ID, CONVERSATION_ID, req, { metadata: { empresa: 'Acme' } }))
            .rejects.toBeInstanceOf(ForbiddenException);
        expect(service.assertCanActOnConversation)
            .toHaveBeenCalledWith(TENANT_ID, CONVERSATION_ID, ACTOR_ID, 'tenant_agent');
        expect(service.updateContactMetadata).not.toHaveBeenCalled();

        service.assertCanActOnConversation.mockResolvedValue(undefined);
        await expect(controller.updateContactMetadata(TENANT_ID, CONVERSATION_ID, req, { metadata: { empresa: 'Acme' } }))
            .resolves.toEqual({ success: true, data: { empresa: 'Acme' } });
    });
});
