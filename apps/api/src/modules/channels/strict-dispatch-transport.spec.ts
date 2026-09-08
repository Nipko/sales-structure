import { WhatsAppAdapter } from './whatsapp/whatsapp.adapter';
import {
    classifyProviderResponse, classifyTransportFailure, transportNotAvailable,
    type StrictDispatchRequest,
} from './strict-dispatch-transport';

describe('classifying one provider answer', () => {
    it('accepts only an answer that carries a usable receipt', () => {
        expect(classifyProviderResponse(200, 'wamid.ABC')).toEqual({ kind: 'accepted', receipt: 'wamid.ABC' });
        expect(classifyProviderResponse(201, '  wamid.TRIM  ')).toEqual({ kind: 'accepted', receipt: 'wamid.TRIM' });
        // The effect happened but cannot be named: resending would duplicate it
        // and claiming acceptance without an id would be a false receipt.
        for (const missing of [null, undefined, '', '   ']) {
            expect(classifyProviderResponse(200, missing)).toEqual({ kind: 'unknown', errorCode: 'receipt_missing' });
        }
    });

    it('treats an answered refusal as a rejection, and says whether it may be retried', () => {
        for (const status of [400, 401, 403, 404, 405, 410, 413, 415, 422]) {
            expect(classifyProviderResponse(status, null))
                .toEqual({ kind: 'rejected', errorCode: `http_${status}`, retryable: false });
        }
        for (const status of [408, 425, 429]) {
            expect(classifyProviderResponse(status, null))
                .toEqual({ kind: 'rejected', errorCode: `http_${status}`, retryable: true });
        }
        expect(classifyProviderResponse(400, null, 'wa_131047'))
            .toEqual({ kind: 'rejected', errorCode: 'wa_131047', retryable: false });
    });

    it('reads an answered 5xx as a retryable rejection rather than stranding the reply', () => {
        // Deliberate product decision, recorded as such: no message id is issued,
        // and there would be nothing to reconcile a failed POST against.
        for (const status of [500, 502, 503, 504]) {
            expect(classifyProviderResponse(status, null))
                .toEqual({ kind: 'rejected', errorCode: `http_${status}`, retryable: true });
        }
    });

    it('never turns an answer it does not recognise into evidence that nothing happened', () => {
        expect(classifyProviderResponse(302, null)).toEqual({ kind: 'unknown', errorCode: 'http_302' });
        expect(classifyProviderResponse(199, null)).toEqual({ kind: 'unknown', errorCode: 'http_199' });
    });

    it('keeps a request that got no answer unknown, never rejected', () => {
        expect(classifyTransportFailure(Object.assign(new Error('timed out'), { name: 'TimeoutError' })))
            .toEqual({ kind: 'unknown', errorCode: 'provider_timeout' });
        expect(classifyTransportFailure(Object.assign(new Error('aborted'), { name: 'AbortError' })))
            .toEqual({ kind: 'unknown', errorCode: 'provider_timeout' });
        expect(classifyTransportFailure(new Error('ECONNRESET')))
            .toMatchObject({ kind: 'unknown', errorCode: expect.stringContaining('transport_failure') });
    });

    it('refuses an unmigrated channel explicitly instead of degrading it', () => {
        expect(transportNotAvailable('telegram'))
            .toEqual({ kind: 'rejected', errorCode: 'transport_not_migrated:telegram', retryable: false });
    });
});

describe('WhatsApp strict dispatch', () => {
    const adapter = new WhatsAppAdapter({ get: () => undefined } as any);
    const request = (over: Partial<StrictDispatchRequest> = {}): StrictDispatchRequest => ({
        itemKind: 'text', to: '+573000000000', channelAccountId: 'phone-1',
        payload: { text: 'Hola' }, ...over,
    });
    let sent: { url: string; body: any }[];
    const answer = (status: number, body: any) => {
        (global as any).fetch = jest.fn(async (url: string, init: any) => {
            sent.push({ url, body: JSON.parse(init.body) });
            return { status, json: async () => body } as any;
        });
    };
    beforeEach(() => { sent = []; });
    afterEach(() => { delete (global as any).fetch; });

    it('sends one text effect and returns the provider receipt', async () => {
        answer(200, { messages: [{ id: 'wamid.TEXT' }] });
        await expect(adapter.sendStrict(request(), 'token'))
            .resolves.toEqual({ kind: 'accepted', receipt: 'wamid.TEXT' });
        expect(sent[0].url).toContain('/phone-1/messages');
        expect(sent[0].body).toMatchObject({ messaging_product: 'whatsapp', to: '+573000000000',
            type: 'text', text: { body: 'Hola' } });
    });

    it('never attaches a caption to an image, because that would be two effects', async () => {
        answer(200, { messages: [{ id: 'wamid.MEDIA' }] });
        await adapter.sendStrict(request({ itemKind: 'media',
            payload: { mediaUrl: 'https://example.test/a.jpg', caption: 'Una foto' } }), 'token');
        expect(sent[0].body.image).toEqual({ link: 'https://example.test/a.jpg' });
        expect(JSON.stringify(sent[0].body)).not.toContain('Una foto');
    });

    it('sends a Flow as its own effect and never degrades it to text', async () => {
        answer(200, { messages: [{ id: 'wamid.FLOW' }] });
        const outcome = await adapter.sendStrict(request({ itemKind: 'flow',
            payload: { flowId: 'f-1', flowToken: 't-1', text: 'Agenda tu cita' } }), 'token');
        expect(outcome).toEqual({ kind: 'accepted', receipt: 'wamid.FLOW' });
        expect(sent[0].body.type).toBe('interactive');

        // A Flow that times out stays unknown. The old gateway answered this by
        // sending a text message the customer never agreed to receive twice.
        (global as any).fetch = jest.fn(async () => {
            throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
        });
        await expect(adapter.sendStrict(request({ itemKind: 'flow',
            payload: { flowId: 'f-1', flowToken: 't-1', text: 'Agenda tu cita' } }), 'token'))
            .resolves.toEqual({ kind: 'unknown', errorCode: 'provider_timeout' });
        expect((global as any).fetch).toHaveBeenCalledTimes(1);
    });

    it('refuses a payload it cannot express without spending an attempt on a retry', async () => {
        answer(200, { messages: [{ id: 'never' }] });
        for (const broken of [
            request({ payload: { text: '   ' } }),
            request({ itemKind: 'media', payload: {} }),
            request({ itemKind: 'flow', payload: { flowId: 'f-1' } }),
        ]) {
            await expect(adapter.sendStrict(broken, 'token'))
                .resolves.toMatchObject({ kind: 'rejected', retryable: false });
        }
        expect(sent).toHaveLength(0);
    });

    it('surfaces the provider error code and never retries inside the adapter', async () => {
        answer(400, { error: { code: 131047, message: 'Re-engagement message' } });
        await expect(adapter.sendStrict(request(), 'token'))
            .resolves.toEqual({ kind: 'rejected', errorCode: 'wa_131047', retryable: false });
        expect(sent).toHaveLength(1);
    });

    it('keeps an unreadable body from inventing an acceptance', async () => {
        (global as any).fetch = jest.fn(async () => ({ status: 200, json: async () => { throw new Error('bad json'); } }));
        await expect(adapter.sendStrict(request(), 'token'))
            .resolves.toEqual({ kind: 'unknown', errorCode: 'receipt_missing' });
    });
});
