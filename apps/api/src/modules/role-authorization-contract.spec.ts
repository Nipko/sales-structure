import 'reflect-metadata';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { AgentConsoleController } from './agent-console/agent-console.controller';
import { BroadcastController } from './broadcast/broadcast.controller';
import { ChannelManagementController } from './channels/channel-management.controller';
import { CrmController } from './crm/crm.controller';
import { WhatsappController } from './whatsapp/whatsapp.controller';
import { WidgetController } from './widget/widget.controller';

type ControllerPrototype = Record<string, (...args: any[]) => unknown>;

function rolesFor(controller: { prototype: object }, method: string): string[] {
    const handler = (controller.prototype as ControllerPrototype)[method];
    return Reflect.getMetadata(ROLES_KEY, handler) ?? [];
}

describe('high-risk tenant role authorization contract', () => {
    it('keeps every conversational-channel connect/disconnect mutation tenant-admin-only', () => {
        const channelManagementMethods = [
            'connectTelegram',
            'disconnectTelegram',
            'messengerOAuthConnect',
            'disconnectMessenger',
            'instagramOAuthConnect',
            'disconnectInstagram',
            'connectSms',
            'disconnectSms',
            'connect',
            'disconnectAccount',
        ];
        const whatsappMethods = ['startConnection', 'completeConnection', 'disconnect'];

        for (const method of channelManagementMethods) {
            expect(rolesFor(ChannelManagementController, method)).toEqual(['tenant_admin']);
        }
        for (const method of whatsappMethods) {
            expect(rolesFor(WhatsappController, method)).toEqual(['tenant_admin']);
        }
    });

    it('keeps CRM bulk updates and contact archiving at supervisor level or above', () => {
        for (const method of ['bulkUpdateLeads', 'archiveLead', 'restoreLead']) {
            expect(rolesFor(CrmController, method)).toEqual([
                'tenant_admin',
                'tenant_supervisor',
            ]);
        }
    });

    it('keeps destructive Inbox deletes tenant-admin-only', () => {
        for (const method of ['deleteConversation', 'deleteMessage', 'bulkDelete']) {
            expect(rolesFor(AgentConsoleController, method)).toEqual(['tenant_admin']);
        }
    });

    it('keeps the deprecated assign alias safe while clients migrate to claim', () => {
        expect(rolesFor(AgentConsoleController, 'assignConversation')).toEqual([
            'tenant_admin',
            'tenant_supervisor',
            'tenant_agent',
        ]);
        expect(rolesFor(AgentConsoleController, 'claimConversation')).toEqual([
            'tenant_admin',
            'tenant_supervisor',
            'tenant_agent',
        ]);
    });

    it('keeps campaign data and widget configuration scoped to their documented roles', () => {
        for (const method of ['getCampaigns', 'getCampaignStats', 'getAbVariants']) {
            expect(rolesFor(BroadcastController, method)).toEqual([
                'tenant_admin',
                'tenant_supervisor',
            ]);
        }

        for (const method of ['list', 'getSnippet']) {
            expect(rolesFor(WidgetController, method)).toEqual([
                'tenant_admin',
                'super_admin',
            ]);
        }
    });

    it('derives the claim target from the authenticated request user', async () => {
        const agentConsoleService = {
            claimConversation: jest.fn().mockResolvedValue(undefined),
        };
        const controller = new AgentConsoleController(
            agentConsoleService as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
        );

        await controller.claimConversation(
            '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222',
            { user: { id: '33333333-3333-4333-8333-333333333333' } },
        );

        expect(agentConsoleService.claimConversation).toHaveBeenCalledWith(
            '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222',
            '33333333-3333-4333-8333-333333333333',
        );
    });
});
