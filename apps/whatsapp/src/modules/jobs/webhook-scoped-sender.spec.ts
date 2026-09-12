import { of } from 'rxjs';
import { WebhookProcessor } from './webhook.processor';

const tenantId = '11111111-1111-4111-8111-111111111111';
const schemaName = 'tenant_wa_worker';
const phoneNumberId = '15550001111';

/**
 * ═══ THE SAME CUSTOMER, ON THE ROAD THAT IS ACTUALLY DEPLOYED ═══
 *
 * `wa.parallly-chat.cloud` publishes THIS worker, so most inbound messages
 * arrive here rather than at the API's own webhook. Both roads have to reach
 * the same two records, and on this one a sender with no phone number failed
 * worse than on the other.
 *
 * `fromPhone = message.from` was `undefined` for a business-scoped sender. The
 * contact INSERT then wrote `external_id = NULL`, and because PostgreSQL treats
 * two NULLs as distinct in a unique index, EVERY message from that person
 * created a brand-new contact: no thread, no history, and no bound on the rows.
 */
describe('the deployed worker, and a sender with no phone number', () => {
    function harness() {
        const statements: Array<{ sql: string; params: any[] }> = [];
        const posts: any[] = [];
        const prisma: any = {
            executeInTenantSchema: jest.fn(async (_schema: string, sql: string, params: any[] = []) => {
                statements.push({ sql, params });
                return [];
            }),
        };
        const httpService: any = {
            post: jest.fn((url: string, body: any) => {
                posts.push({ url, body });
                return of({ data: { ok: true } });
            }),
        };
        const configService: any = {
            get: jest.fn((key: string) => (key === 'API_INTERNAL_URL'
                ? 'http://api:3000/api/v1'
                : (key === 'INTERNAL_API_KEY' ? 'the-internal-key' : undefined))),
        };
        const processor: any = Object.create(WebhookProcessor.prototype);
        Object.assign(processor, {
            prisma, httpService, configService,
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
        return { processor, statements, posts };
    }

    const run = (h: ReturnType<typeof harness>, message: any, contacts: any[] = []) =>
        h.processor.processMessage({
            tenantId, schemaName, phoneNumberId, message, contacts,
            channelAccountId: phoneNumberId,
        });

    const contactInsert = (h: ReturnType<typeof harness>) =>
        h.statements.find(entry => /INSERT INTO contacts/.test(entry.sql));

    const base = { id: 'wamid.IN', type: 'text', text: { body: 'hola' }, timestamp: '1791000000' };

    it('keys a phone sender exactly as it always did', async () => {
        const h = harness();
        await run(h, { ...base, from: '573001112233' },
            [{ wa_id: '573001112233', profile: { name: 'Ana' } }]);

        const insert = contactInsert(h)!;
        // external_id AND phone are the number, byte for byte.
        expect(insert.params[0]).toBe('573001112233');
        expect(insert.params[2]).toBe('573001112233');
    });

    it('gives a business-scoped sender ONE contact, not one per message', async () => {
        // THE CASE THIS EXISTS FOR. `external_id` used to be undefined here.
        const h = harness();
        await run(h, { ...base, from_user_id: 'BSU_abc123XYZ' });

        const insert = contactInsert(h)!;
        expect(insert.params[0]).toBe(`bsuid:${phoneNumberId}:BSU_abc123XYZ`);
        // And `phone` is NULL rather than the opaque key: an identifier in the
        // phone column is a wrong dial waiting to happen.
        expect(insert.params[2]).toBeNull();
    });

    it('is the same key on the second message, which is the whole point', async () => {
        const h = harness();
        await run(h, { ...base, id: 'wamid.ONE', from_user_id: 'BSU_abc123XYZ' });
        await run(h, { ...base, id: 'wamid.TWO', from_user_id: 'BSU_abc123XYZ' });

        const inserts = h.statements.filter(entry => /INSERT INTO contacts/.test(entry.sql));
        expect(inserts).toHaveLength(2);
        expect(inserts[0].params[0]).toBe(inserts[1].params[0]);
    });

    it('tells the API which kind it was, like the other road does', async () => {
        const h = harness();
        await run(h, { ...base, from_user_id: 'BSU_abc123XYZ' },
            [{ user_id: 'BSU_abc123XYZ', wa_id: '573001112233' }]);

        const forwarded = h.posts.find(post => post.body?.contactId);
        expect(forwarded.body.contactId).toBe(`bsuid:${phoneNumberId}:BSU_abc123XYZ`);
        expect(forwarded.body.metadata.senderKind).toBe('business_scoped');
        expect(forwarded.body.metadata.senderPhone).toBe('573001112233');
    });

    it('discards a message that names nobody, without writing a contact', async () => {
        // The raw body is already saved in `whatsapp_webhook_events` above, so
        // nothing is lost by refusing here — and an INSERT with a null key is
        // what created the unbounded contacts in the first place.
        const h = harness();
        await run(h, { ...base });
        expect(contactInsert(h)).toBeUndefined();
        expect(h.posts.filter(post => post.body?.contactId)).toEqual([]);
    });
});
