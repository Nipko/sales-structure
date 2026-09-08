import * as fs from 'fs';
import * as path from 'path';
import { of, throwError } from 'rxjs';
import { WebhookProcessor } from './webhook.processor';

const tenantId = '11111111-1111-4111-8111-111111111111';
const schemaName = 'tenant_wa_worker';
const phoneNumberId = '15550001111';

/**
 * The delivery-status path of the WORKER THAT IS ACTUALLY DEPLOYED.
 *
 * `wa.parallly-chat.cloud` publishes this service, so this is where Meta's
 * `delivered/read/failed` land — and it had no test at all, which is how it ran
 * for months applying nothing: it looked the wamid up in `messages.external_id`
 * (our deduplication identity, not the provider's), it named an `updated_at`
 * column `messages` has never had, and it ranked `failed` above `delivered`.
 * The first two made every write raise into a catch; the third would have lied
 * to a customer's history if the write had ever worked.
 *
 * The worker's job is now to forward the event faithfully and to keep no
 * opinion of its own about it. That is what these pin.
 */
describe('WhatsApp worker delivery status', () => {
    function harness(options: {
        response?: any;
        failure?: any;
        internalKey?: string | null;
    } = {}) {
        const statements: Array<{ schema: string; sql: string; params: any[] }> = [];
        const posts: Array<{ url: string; body: any; headers: any }> = [];
        const prisma: any = {
            executeInTenantSchema: jest.fn(async (schema: string, sql: string, params: any[] = []) => {
                statements.push({ schema, sql, params });
                return [];
            }),
        };
        const httpService: any = {
            post: jest.fn((url: string, body: any, config: any) => {
                posts.push({ url, body, headers: config?.headers });
                if (options.failure) return throwError(() => options.failure);
                return of({ data: options.response ?? { applied: true, reason: 'applied' } });
            }),
        };
        const configService: any = {
            get: jest.fn((key: string) => {
                if (key === 'API_INTERNAL_URL') return 'http://api:3000/api/v1';
                if (key === 'INTERNAL_API_KEY') {
                    return options.internalKey === undefined ? 'the-internal-key' : options.internalKey;
                }
                return undefined;
            }),
        };
        const processor: any = Object.create(WebhookProcessor.prototype);
        Object.assign(processor, {
            prisma, httpService, configService,
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
        return { processor, statements, posts, prisma, httpService };
    }

    const job = (status: any) => ({ tenantId, schemaName, phoneNumberId, status });
    const run = (h: ReturnType<typeof harness>, status: any) => h.processor.processStatus(job(status));
    const audit = (h: ReturnType<typeof harness>) =>
        h.statements.filter(entry => /whatsapp_webhook_events/.test(entry.sql));

    it('forwards the event keyed on tenant, channel, account and receipt', async () => {
        const h = harness();
        await run(h, { id: 'wamid.A', status: 'delivered', recipient_id: '57300' });
        expect(h.posts).toHaveLength(1);
        expect(h.posts[0].url).toBe('http://api:3000/api/v1/internal/channel-delivery-status');
        expect(h.posts[0].headers['x-internal-key']).toBe('the-internal-key');
        expect(h.posts[0].body).toEqual({
            tenantId,
            channelType: 'whatsapp',
            channelAccountId: phoneNumberId,
            providerMessageId: 'wamid.A',
            status: 'delivered',
            errorCode: null,
            recipient: '57300',
        });
    });

    it('carries the provider error code so the rejection can be diagnosed', async () => {
        const h = harness();
        await run(h, { id: 'wamid.B', status: 'failed', errors: [{ code: 131047, title: 'Re-engagement' }] });
        expect(h.posts[0].body).toMatchObject({ status: 'failed', errorCode: 131047 });
    });

    it('keeps no opinion of its own: it writes nothing to the conversation record', async () => {
        const h = harness();
        await run(h, { id: 'wamid.C', status: 'read' });
        // Every statement it issues is its own webhook audit. The ranking, the
        // receipt lookup and the legacy fallback belong to the API.
        expect(h.statements.every(entry => /whatsapp_webhook_events/.test(entry.sql))).toBe(true);
        expect(h.statements.some(entry => /\bmessages\b/i.test(entry.sql))).toBe(false);
    });

    it('records what Meta said before trying to apply it, and stamps it only once applied', async () => {
        const h = harness();
        await run(h, { id: 'wamid.D', status: 'delivered' });
        expect(audit(h)).toHaveLength(2);
        expect(audit(h)[0].sql).toContain("'received'");
        expect(audit(h)[0].sql).toContain('ON CONFLICT (dedupe_key) DO NOTHING');
        expect(audit(h)[0].params[2]).toBe('status:wamid.D:delivered');
        expect(audit(h)[1].sql).toContain("processing_status = 'processed'");
        // The audit row exists before the forward, so an event survives an API outage.
        expect(h.statements.indexOf(audit(h)[0])).toBeLessThan(1);
    });

    describe('what the API decides, the worker accepts', () => {
        const decided = async (reason: string, status: string) => {
            const h = harness({ response: { applied: false, reason } });
            await expect(run(h, { id: 'wamid.E', status })).resolves.toBeUndefined();
            expect(h.posts).toHaveLength(1);
            expect(h.statements.some(entry => /\bmessages\b/i.test(entry.sql))).toBe(false);
            return h;
        };

        it('completes on a duplicate the record has already applied', async () => {
            const h = await decided('not_newer', 'delivered');
            // A repeat is not a failure: re-forwarding it is safe precisely
            // because the record only ever moves forward.
            expect(audit(h)[1].sql).toContain("processing_status = 'processed'");
        });

        it('completes on a status that arrives out of order', () => decided('not_newer', 'sent'));

        it('completes on a rejection that arrives after acceptance', async () => {
            const h = harness({ response: { applied: true, reason: 'applied' } });
            await run(h, { id: 'wamid.F', status: 'failed', errors: [{ code: 131026 }] });
            // The record was on `sent`, so the API took the rejection. The
            // worker neither knew nor needed to.
            expect(h.posts[0].body.status).toBe('failed');
        });

        it('does not degrade a delivered message when the API refuses the rejection', async () => {
            const h = await decided('already_delivered', 'failed');
            // The old worker ranked `failed` above `delivered` and would have
            // overwritten it here. Now there is nothing local left to overwrite.
            expect(h.statements.some(entry => /UPDATE\s+messages/i.test(entry.sql))).toBe(false);
        });
    });

    it('fails visibly when the internal key is missing, instead of dropping the status', async () => {
        const h = harness({ internalKey: null });
        await expect(run(h, { id: 'wamid.G', status: 'delivered' })).rejects.toThrow(/INTERNAL_API_KEY/);
        expect(h.posts).toHaveLength(0);
        // The event is still on record; only the application is owed a retry.
        expect(audit(h)).toHaveLength(1);
    });

    it('fails so BullMQ retries when the API cannot be reached', async () => {
        const h = harness({ failure: Object.assign(new Error('socket hang up'), { response: undefined }) });
        await expect(run(h, { id: 'wamid.H', status: 'read' })).rejects.toThrow('socket hang up');
        expect(audit(h)).toHaveLength(1);
        expect(audit(h)[0].sql).toContain("'received'");
    });

    it('does not retry a body the API refuses, such as a status the record does not model', async () => {
        const h = harness({ failure: Object.assign(new Error('Bad Request'), { response: { status: 400 } }) });
        await expect(run(h, { id: 'wamid.I', status: 'deleted' })).resolves.toBeUndefined();
        expect(audit(h)).toHaveLength(2);
    });
});

/**
 * The bug that survived because nothing ever ran this SQL in a test.
 *
 * `messages` is provisioned from one place, `apps/api/prisma/tenant-schema.sql`,
 * and it has never had an `updated_at`. The worker's UPDATE named it, so
 * PostgreSQL raised 42703 (undefined_column) into a `catch` that only logged a
 * warning — and no delivery status, for any producer, was ever recorded.
 */
describe('the statement the worker no longer runs', () => {
    const PRISMA_DIR = path.resolve(__dirname, '../../../../api/prisma');

    /** The real column set of `messages`, from the provisioning DDL plus migrations. */
    function messagesColumns(): Set<string> {
        const columns = new Set<string>();
        const provisioning = fs.readFileSync(path.join(PRISMA_DIR, 'tenant-schema.sql'), 'utf8');
        const create = /CREATE TABLE IF NOT EXISTS "\{\{SCHEMA_NAME\}\}"\."messages" \(([^;]*)\);/.exec(provisioning);
        if (!create) throw new Error('messages table not found in tenant-schema.sql');
        for (const line of create[1].split('\n')) {
            const column = /^\s*"([a-z_]+)"/.exec(line);
            if (column) columns.add(column[1]);
        }
        const migrations = path.join(PRISMA_DIR, 'migrations');
        const sources = [provisioning].concat(
            fs.existsSync(migrations)
                ? fs.readdirSync(migrations)
                    .filter(file => file.endsWith('.sql'))
                    .map(file => fs.readFileSync(path.join(migrations, file), 'utf8'))
                : [],
        );
        const alter = /ALTER TABLE\s+(?:"\{\{SCHEMA_NAME\}\}"\.)?"?messages"?\s+ADD COLUMN(?:\s+IF NOT EXISTS)?\s+"?([a-z_]+)"?/gi;
        for (const source of sources) {
            let match: RegExpExecArray | null;
            alter.lastIndex = 0;
            while ((match = alter.exec(source))) columns.add(match[1].toLowerCase());
        }
        return columns;
    }

    /** Columns a statement against `messages` assigns or filters by equality. */
    function columnsNamed(sql: string): string[] {
        if (!/\b(UPDATE|INSERT\s+INTO|FROM)\s+messages\b/i.test(sql)) return [];
        const named = new Set<string>();
        const reference = /\b([a-z_]+)\s*=/gi;
        let match: RegExpExecArray | null;
        while ((match = reference.exec(sql))) named.add(match[1].toLowerCase());
        return [...named];
    }

    const LEGACY_STATUS_UPDATE =
        `UPDATE messages SET status = $1, updated_at = NOW()
         WHERE external_id = $2`;

    it('named a column the schema has never had', () => {
        const columns = messagesColumns();
        expect(columns).toContain('external_id');
        expect(columns).toContain('status');
        expect(columnsNamed(LEGACY_STATUS_UPDATE)).toContain('updated_at');
        expect(columns.has('updated_at')).toBe(false);
    });

    it('is gone from the worker, which now names no column of `messages` at all', () => {
        const source = fs.readFileSync(path.join(__dirname, 'webhook.processor.ts'), 'utf8');
        const processStatus = source.slice(
            source.indexOf('private async processStatus('),
            source.indexOf('private async processTemplateUpdate('),
        );
        expect(processStatus).not.toMatch(/\bUPDATE\s+messages\b/i);
        expect(processStatus).toContain('forwardDeliveryStatus');
    });
});
