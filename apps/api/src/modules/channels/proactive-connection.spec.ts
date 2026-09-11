import * as fs from 'fs';
import * as path from 'path';
import { ProactiveSendConnection } from './proactive-connection';
import { ConnectionRefusedError } from './connection-refusal';

/**
 * ═══ A PROACTIVE MESSAGE INHERITS NOTHING ═══
 *
 * A reply goes back out of the number the customer wrote to. A reminder, a
 * nurture follow-up or a campaign inherits nothing: somebody has to choose.
 *
 * For a tenant with one number that choice is trivial. For a tenant with two it
 * is a real decision with a real consequence — a reminder from a number the
 * customer has never seen arrives as a message from a stranger, and it is
 * billed to a WABA the business may not have meant to spend from.
 *
 * The resolver already refused to pick. What was missing was what happened
 * NEXT: each producer caught the refusal, logged a line, and returned. The
 * reminder did not happen, nobody was told, and the only trace was a warning in
 * a container log — for every appointment, silently, for as long as nobody read
 * the logs.
 */
describe('which number a proactive message leaves from', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';

    function harness(refusal?: ConnectionRefusedError | Error) {
        const writes: Array<{ sql: string; params: any[] }> = [];
        const prisma: any = {
            executeInTenantSchema: jest.fn(async (_s: string, sql: string, params: any[] = []) => {
                writes.push({ sql, params });
                return [];
            }),
        };
        const channelToken = {
            getChannelToken: jest.fn(async () => {
                if (refusal) throw refusal;
                return { accessToken: 'token', accountId: 'phone-1' };
            }),
        };
        const service = new ProactiveSendConnection(prisma, channelToken as any);
        jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
        jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
        return { service, prisma, channelToken, writes };
    }

    const resolve = (h: ReturnType<typeof harness>, channelAccountId?: string | null) =>
        h.service.resolve({
            tenantId, schemaName: 'tenant_acme', channelType: 'whatsapp',
            channelAccountId, purpose: 'los recordatorios de turnos',
        });

    it('answers with the connection when there is one to answer with', async () => {
        const h = harness();
        await expect(resolve(h)).resolves.toEqual({ accessToken: 'token', accountId: 'phone-1' });
        expect(h.writes).toEqual([]);
    });

    it('asks for the account the producer already knows, rather than re-choosing', async () => {
        const h = harness();
        await resolve(h, 'phone-2');
        expect(h.channelToken.getChannelToken).toHaveBeenCalledWith(tenantId, 'whatsapp', 'phone-2');
    });

    it('sends nothing and raises a task when the tenant has more than one number', async () => {
        const h = harness(new ConnectionRefusedError('connection_ambiguous', {
            tenantId, channelType: 'whatsapp',
        }));

        await expect(resolve(h)).resolves.toBeNull();

        const task = h.writes.find(write => write.sql.includes('INSERT INTO tasks'));
        expect(task).toBeDefined();
        expect(task!.params[0]).toContain('WhatsApp');
        // The sentence has to say what to do, and it has to say WHY nothing was
        // sent — "elegir por nuestra cuenta" is the whole reason this is a
        // decision and not a default.
        expect(task!.params[1]).toContain('Canales');
        expect(task!.params[1]).toContain('más de un número');
    });

    it('says something different when there is no number at all', async () => {
        // "You have several and none is chosen" is a decision; "you have none
        // connected" is a connection. Collapsing them sends the wrong person
        // the wrong way.
        const h = harness(new ConnectionRefusedError('connection_absent', {
            tenantId, channelType: 'whatsapp',
        }));
        await expect(resolve(h)).resolves.toBeNull();
        const task = h.writes.find(write => write.sql.includes('INSERT INTO tasks'));
        expect(task!.params[1]).toContain('No hay ningún número');
    });

    it('raises the task once, not once per reminder', async () => {
        // A reminder cron runs every few minutes. A new task each time would
        // bury the inbox it is trying to reach — so the INSERT is conditional
        // on there being no open task with the same title.
        const h = harness(new ConnectionRefusedError('connection_ambiguous', {
            tenantId, channelType: 'whatsapp',
        }));
        await resolve(h);
        const task = h.writes.find(write => write.sql.includes('INSERT INTO tasks'));
        expect(task!.sql).toContain('WHERE NOT EXISTS');
        expect(task!.sql).toContain("status = 'pending'");
    });

    it('raises no task when the failure is ours rather than theirs', async () => {
        // A database that could not be read is not a decision anybody can make.
        // A task would send somebody to change a setting that is not the
        // problem, and it would stay open after the outage ended.
        const h = harness(new Error('pool exhausted'));
        await expect(resolve(h)).resolves.toBeNull();
        expect(h.writes).toEqual([]);
    });

    it('is what the proactive producers actually use', () => {
        // Structural: the value of this resolver is entirely in being the one
        // road, and a producer that kept its own `getChannelToken` fallback
        // would keep its own silent failure with it.
        const root = path.join(__dirname, '..');
        for (const relative of [
            'appointments/appointment-notifications.service.ts',
            'automation/nurturing.service.ts',
        ]) {
            const source = fs.readFileSync(path.join(root, relative), 'utf8');
            expect(source).toContain('ProactiveSendConnection');
        }
    });
});
