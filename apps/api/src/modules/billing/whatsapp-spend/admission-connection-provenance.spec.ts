import * as fs from 'fs';
import * as path from 'path';
import { of } from 'rxjs';
import { WhatsappMessagingService } from '../../whatsapp/services/whatsapp-messaging.service';
import { AgentConsoleService } from '../../agent-console/agent-console.service';
import {
    permissiveSpendGate, resolvingChannelToken,
} from '../../channels/__fixtures__/spend-gate-double';

/**
 * ═══ THERE IS ONE WAY TO SAY WHO PAYS ═══
 *
 * The authority decides against an `AdmissionConnection`: which tenant, which
 * channel, which account, which WABA Meta bills and on whose credential. Only
 * the connection resolver knows the last two.
 *
 * Two of the four sinks used to build that object themselves, out of the
 * arguments that happened to be in scope — `{tenantId, channelType,
 * channelAccountId}` and nothing else. So `payerKind` arrived undefined, the
 * authority answered `payer_unknown`, and under `enforce` the REST surface and
 * the agent console would have refused every send while the queue lane, which
 * asked the resolver, kept working. A silence that looked like a budget.
 *
 * These tests pin the correction from both sides: structurally, that no
 * production file can assemble a connection any other way; and functionally,
 * that each of the two repaired sinks carries a real payer and a real
 * credential into the verdict.
 */
describe('who pays is resolved, never assembled', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';

    it('leaves no production call site that builds a connection by hand', () => {
        const root = path.join(__dirname, '..', '..');
        const offenders: string[] = [];
        let resolved = 0;
        const walk = (dir: string) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name === '__fixtures__' || entry.name === 'node_modules') continue;
                    walk(full);
                    continue;
                }
                if (!entry.name.endsWith('.ts') || entry.name.includes('.spec.')) continue;
                const source = fs.readFileSync(full, 'utf8');
                // Only files that can reach the authority. A `connection:` in a
                // BullMQ registration is a Redis socket, not a payer, and
                // flagging it would teach the next reader to ignore this test.
                if (!source.includes('whatsapp-send-admission')) continue;
                // Every `connection:` handed to the authority, with whatever
                // follows it on that line. Anything but `fromSendContext(` is a
                // second way to name a payer, which is the bug.
                for (const match of source.matchAll(/^\s*connection:\s*(.+)$/gm)) {
                    if (match[1].startsWith('fromSendContext(')) resolved += 1;
                    else offenders.push(path.relative(root, full) + ': ' + match[1].trim());
                }
            }
        };
        walk(root);
        expect(offenders).toEqual([]);
        // An empty list is not proof on its own: a sink that stopped naming
        // `connection:` on one line would vanish from both counts. Three is
        // the number of sinks that ask the authority — queue, REST, console.
        expect(resolved).toBeGreaterThanOrEqual(3);
    });

    it('no longer offers a schema-only admission for a caller to reach for', () => {
        // `admitBySchema` was the affordance: it accepted a channel type and an
        // account id and quietly filled in the rest. Removing the method is
        // what makes the correction stick — a comment asking callers not to use
        // it would have lasted until the next sink.
        const source = fs.readFileSync(
            path.join(__dirname, 'whatsapp-send-admission.service.ts'), 'utf8');
        expect(source).not.toMatch(/^\s*async admitBySchema\b/m);
    });

    it('carries the resolved payer and credential from the REST sink', async () => {
        const spendGate = permissiveSpendGate();
        const service = new WhatsappMessagingService(
            { executeInTenantSchema: jest.fn(async () => []) } as any,
            { post: jest.fn(() => of({ data: { messages: [{ id: 'wamid.REST' }] } })) } as any,
            { getValidAccessToken: jest.fn(async () => ({
                accessToken: 'token', phoneNumberId: 'phone-1', channelId: 'ch-1', wabaId: 'waba-1',
            })) } as any,
            spendGate,
            resolvingChannelToken(),
        );

        await expect(service.sendTextMessage('tenant_acme', '+573001112233', 'hola'))
            .resolves.toMatchObject({ success: true, messageId: 'wamid.REST' });

        expect(spendGate.admit).toHaveBeenCalledTimes(1);
        expect(spendGate.admit.mock.calls[0][0].connection).toMatchObject({
            tenantId, channelType: 'whatsapp', channelAccountId: 'phone-1',
            payerKind: 'business_direct', payerWabaId: 'waba-1',
            credentialId: 'cred-1', credentialSource: 'channel_account',
        });
    });

    it('carries the resolved payer and credential from the agent console', async () => {
        const spendGate = permissiveSpendGate();
        const executeInTenantSchema = jest.fn(async (_schema: string, sql: string) => {
            if (sql.includes('INSERT INTO messages')) {
                return [{ id: '44444444-4444-4444-8444-444444444444', content_text: 'Ya lo reviso',
                    content_type: 'text', direction: 'outbound', status: 'pending',
                    created_at: new Date(), metadata: {} }];
            }
            if (sql.includes('FROM conversations c')) {
                return [{ channel_type: 'whatsapp', phone: '+573101234567',
                    channel_account_id: 'phone-1',
                    contact_id: '55555555-5555-4555-8555-555555555555' }];
            }
            return [];
        });
        const prisma: any = {
            $queryRaw: jest.fn(async () => [{ schema_name: 'tenant_acme' }]),
            getTenantSchemaName: jest.fn(async () => 'tenant_acme'),
            executeInTenantSchema,
            transactionInTenantSchema: jest.fn(
                async (_s: string, work: any) => work(executeInTenantSchema)),
        };
        const service = new AgentConsoleService(
            prisma, { get: jest.fn(), set: jest.fn(), del: jest.fn() } as any,
            { sendMessage: jest.fn(async () => ({ messageId: 'wamid.AGENT' })) } as any,
            resolvingChannelToken({
                getChannelToken: jest.fn(async () => ({ accessToken: 'token', accountId: 'phone-1' })),
            }),
            {} as any, {} as any, { emit: jest.fn() } as any, {} as any, spendGate,
        );
        jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
        jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

        await service.sendAgentMessage(tenantId, '22222222-2222-4222-8222-222222222222',
            '33333333-3333-4333-8333-333333333333', 'Ya lo reviso');

        expect(spendGate.admit).toHaveBeenCalledTimes(1);
        const request = spendGate.admit.mock.calls[0][0];
        expect(request.connection).toMatchObject({
            tenantId, channelType: 'whatsapp', channelAccountId: 'phone-1',
            payerKind: 'business_direct', payerWabaId: 'waba-1',
            credentialId: 'cred-1', credentialSource: 'channel_account',
        });
        // The contact travels too. Without it the effect can only be counted
        // against the account, never against the person it was sent to.
        expect(request.contactId).toBe('55555555-5555-4555-8555-555555555555');
    });
});
