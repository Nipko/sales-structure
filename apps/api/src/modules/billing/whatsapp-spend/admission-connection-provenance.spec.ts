import * as fs from 'fs';
import * as path from 'path';
import { of } from 'rxjs';
import { WhatsappMessagingService } from '../../whatsapp/services/whatsapp-messaging.service';
import { permissiveSpendGate, resolvingChannelToken }
    from '../../channels/__fixtures__/spend-gate-double';

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
 * that the direct REST sink carries a real payer and credential. Console
 * replies now enter the same durable sink exercised by the outbox suites.
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
        // `connection:` on one line would vanish from both counts. The two
        // direct authorities are the durable processor and the REST sender;
        // console replies enter that same durable processor.
        expect(resolved).toBeGreaterThanOrEqual(2);
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

});
