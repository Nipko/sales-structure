import { BadRequestException } from '@nestjs/common';
import { WhatsappMessagingService } from './whatsapp-messaging.service';

/**
 * ═══ A 2xx IS NOT AN ACCEPTANCE UNTIL IT NAMES THE MESSAGE ═══
 *
 * `response.data?.messages?.[0]?.id || `unknown-${Date.now()}`` — a fallback
 * that turns a broken provider answer into a success, with three silent
 * consequences:
 *
 *   · the REST caller is handed a "messageId" that identifies nothing, and will
 *     go looking for it in Meta's own tooling;
 *   · the ledger records an ACCEPTANCE under that id, so the reservation waits
 *     for a status webhook that can never match it, and the sweep eventually
 *     calls it indeterminate — money held for a message nobody can name;
 *   · `whatsapp_messages` stores it, so the support engineer reading the thread
 *     sees a receipt and believes the send worked.
 *
 * Meta's contract is that a Graph answer either creates the message and returns
 * its id, or returns an `error` and creates nothing. A 2xx with neither is the
 * contract being broken. The honest outcome is INDETERMINATE — the effect may
 * exist and cannot be named — plus an incident, because no automatic behaviour
 * can resolve it and a person has to reconcile against Meta's own record.
 *
 * And the classifier is the SAME one the strict transport uses. A second
 * opinion about what a provider answer proves is how the two roads came to
 * disagree about a rate limit.
 */
describe('a Graph answer that names no message', () => {
    const SCHEMA = 'tenant_contract';
    const NUMBER = '15550001111';

    function harness(options: { response?: any; failure?: any } = {}) {
        const outcomes: any[] = [];
        const incidents = { record: jest.fn(async (..._args: unknown[]) => undefined) };
        const logged: any[] = [];
        const service: any = Object.create(WhatsappMessagingService.prototype);
        Object.assign(service, {
            incidents,
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
            httpService: {
                post: () => ({
                    subscribe: (observer: any) => {
                        if (options.failure) observer.error(options.failure);
                        else observer.next(options.response ?? { status: 200, data: {} });
                        observer.complete?.();
                        return { unsubscribe() { /* nothing to clean up */ } };
                    },
                }),
            },
        });
        // Admission and the transmission right are proven where they live. Here
        // they are permitted so the classifier's verdict is the only variable.
        service.admitSpend = jest.fn(async () => ({ effectKey: 'k', permitted: true }));
        service.spendGate = { beginTransmission: jest.fn(async () => true) };
        service.recordSpend = jest.fn(async (_schema: string, _admission: unknown, outcome: any) => {
            outcomes.push(outcome);
        });
        service.resumeIfPaused = jest.fn(async () => undefined);
        service.observeFunding = jest.fn(async () => undefined);
        service.logMessage = jest.fn(async (..._args: any[]) => { logged.push(_args[2]); });
        return { service, outcomes, incidents, logged };
    }

    /**
     * The one central path. Every public send — template, text, interactive,
     * media, location — funnels through `sendToMeta`, so testing it is testing
     * all five rather than one of them.
     */
    const send = (h: ReturnType<typeof harness>) =>
        h.service.sendToMeta(SCHEMA, 'channel-1', NUMBER, 'token',
            { messaging_product: 'whatsapp', to: '57300', type: 'text', text: { body: 'hola' } });

    it('refuses to invent a receipt for a 2xx with no id', async () => {
        const h = harness({ response: { status: 200, data: { messages: [] } } });
        await expect(send(h)).rejects.toBeInstanceOf(BadRequestException);
        // Nothing that looks like a message id was produced.
        expect(JSON.stringify(h.outcomes)).not.toContain('unknown-');
    });

    it('records it as indeterminate, which never releases and never resends', async () => {
        const h = harness({ response: { status: 200, data: {} } });
        await send(h).catch(() => undefined);
        expect(h.outcomes).toHaveLength(1);
        expect(h.outcomes[0]).toMatchObject({ kind: 'timeout', errorCode: 'receipt_missing' });
    });

    it('raises an incident, because only a person can reconcile it', async () => {
        const h = harness({ response: { status: 200, data: {} } });
        await send(h).catch(() => undefined);
        expect(h.incidents.record).toHaveBeenCalledWith(
            'whatsapp_graph_contract_breach', 'warning',
            expect.any(String), expect.stringContaining(NUMBER), 1);
    });

    it('still accepts a 2xx that does name the message', async () => {
        // The control. Without it the refusals above could be a broken harness.
        const h = harness({
            response: { status: 200, data: { messages: [{ id: 'wamid.REAL' }] } },
        });
        await expect(send(h)).resolves.toMatchObject({ success: true, messageId: 'wamid.REAL' });
        expect(h.outcomes[0]).toMatchObject(
            { kind: 'accepted', providerMessageId: 'wamid.REAL' });
    });

    // ── AND THE FAILURE SIDE, WHICH HAD THE SAME PROBLEM ────────────────────

    it('calls a rate limit retryable rather than a rejection', async () => {
        // `metaError ? rejected : timeout` released the money and resolved the
        // transmission right, so the retry found a finished effect.
        const h = harness({
            failure: { response: { status: 429, data: { error: { code: 80007 } } } },
        });
        await send(h).catch(() => undefined);
        expect(h.outcomes[0]).toMatchObject({ kind: 'rejected_retryable' });
    });

    it('still calls a rejected template a rejection', async () => {
        const h = harness({
            failure: { response: { status: 400, data: { error: { code: 132001 } } } },
        });
        await send(h).catch(() => undefined);
        expect(h.outcomes[0]).toMatchObject({ kind: 'rejected' });
    });

    it('calls a socket failure a timeout, because nothing answered', async () => {
        const h = harness({ failure: Object.assign(new Error('socket hang up'), {}) });
        await send(h).catch(() => undefined);
        expect(h.outcomes[0]).toMatchObject({ kind: 'timeout' });
    });

    it('calls an unreadable 5xx body a timeout, not a refusal', async () => {
        // HTML from an edge proxy proves nothing about whether Meta acted.
        const h = harness({
            failure: { response: { status: 502, data: '<html>bad gateway</html>' } },
        });
        await send(h).catch(() => undefined);
        expect(h.outcomes[0]).toMatchObject({ kind: 'timeout' });
    });
});
