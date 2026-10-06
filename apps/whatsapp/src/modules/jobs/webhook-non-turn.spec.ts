import { of } from 'rxjs';
import { WebhookProcessor } from './webhook.processor';

/**
 * The deployed worker (`wa.parallly-chat.cloud`): a reaction, a `system` notice or a
 * `request_welcome` is audited but never forwarded to the agent (it used to become the text
 * "[reaction]" and get an answer). Sticker, contacts, order and button keep flowing.
 */
describe('the deployed worker: events that are not a customer turn', () => {
    function harness() {
        const statements: Array<{ sql: string; params: any[] }> = [];
        const posts: any[] = [];
        const processor: any = Object.create(WebhookProcessor.prototype);
        Object.assign(processor, {
            prisma: { executeInTenantSchema: jest.fn(async (_s: string, sql: string, params: any[] = []) => { statements.push({ sql, params }); return []; }) },
            httpService: { post: jest.fn((url: string, body: any) => { posts.push({ url, body }); return of({ data: { ok: true } }); }) },
            configService: { get: jest.fn((k: string) => (k === 'API_INTERNAL_URL' ? 'http://api:3000/api/v1' : k === 'INTERNAL_API_KEY' ? 'key' : undefined)) },
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
        return { processor, statements, posts };
    }
    const run = (h: ReturnType<typeof harness>, message: any) => h.processor.processMessage({
        tenantId: '11111111-1111-4111-8111-111111111111', schemaName: 'tenant_wa_worker', phoneNumberId: '15550001111',
        message: { id: 'wamid.X', from: '573001112233', timestamp: '1791000000', ...message },
        contacts: [{ wa_id: '573001112233', profile: { name: 'Ana' } }], channelAccountId: '15550001111', wabaId: 'waba-77',
    });

    it('a text message is forwarded', async () => {
        const h = harness();
        await run(h, { type: 'text', text: { body: 'hola' } });
        expect(h.posts).toHaveLength(1);
    });

    it.each([
        ['reaction', { reaction: { emoji: '👍' } }], ['system', { system: { body: 'x' } }], ['request_welcome', {}],
    ])('%s is audited, creates no contact and forwards nothing', async (type, extra) => {
        const h = harness();
        await run(h, { type, ...extra });
        expect(h.posts).toHaveLength(0);
        expect(h.statements.some(s => /INSERT INTO contacts/.test(s.sql))).toBe(false);
        expect(h.statements.some(s => /INSERT INTO whatsapp_webhook_events/.test(s.sql))).toBe(true);
    });

    it.each(['sticker', 'contacts', 'order', 'button'])('%s is still forwarded', async (type) => {
        const h = harness();
        await run(h, { type, button: { text: 'Si' } });
        expect(h.posts).toHaveLength(1);
    });
});
