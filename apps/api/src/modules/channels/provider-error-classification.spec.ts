import { WhatsAppAdapter } from './whatsapp/whatsapp.adapter';
import {
    classifyTransportFailure, metaGraphAnswer, metaGraphClassifier, transportNotAvailable,
} from './provider-error-classification';
import type { StrictDispatchRequest } from './strict-dispatch-transport';

/**
 * Answers shaped like the ones Meta actually returns, with identifiers replaced.
 * Every code asserted below appears in the WhatsApp Cloud API / Graph error
 * reference; nothing is classified on a guess about what a status line means.
 */
const graph = (status: number, body: any) => metaGraphAnswer(status, body, 'messages');
const ok = { messaging_product: 'whatsapp', contacts: [{ input: '573000000000', wa_id: '573000000000' }],
    messages: [{ id: 'wamid.HBgMNTczMDAwMDAwMDAwFQIAERgSN' }] };
const err = (code: number, extra: Record<string, any> = {}) => ({
    error: { message: 'synthetic', type: 'OAuthException', code, fbtrace_id: 'Axxxxxxxxxxx', ...extra },
});

describe('what one Meta answer proves', () => {
    it('accepts only an answer that issued a message id', () => {
        expect(metaGraphClassifier(graph(200, ok)))
            .toEqual({ kind: 'accepted', receipt: 'wamid.HBgMNTczMDAwMDAwMDAwFQIAERgSN' });
    });

    it('treats an accepted answer without an id as unknown, never as a receipt', () => {
        // The effect may exist and cannot be named. Resending would duplicate it.
        expect(metaGraphClassifier(graph(200, { messaging_product: 'whatsapp', messages: [] })))
            .toEqual({ kind: 'unknown', errorCode: 'receipt_missing' });
    });

    it('retries only codes the provider documents as temporary', () => {
        // Rate limits and the documented temporary service state: in each the
        // message was NOT created, which is the evidence a retry needs.
        for (const code of [2, 4, 368, 613, 80007, 130429, 131048, 131056, 133016]) {
            expect(metaGraphClassifier(graph(400, err(code))))
                .toEqual({ kind: 'rejected', errorCode: `meta_${code}`, retryable: true });
        }
    });

    it('refuses permanently for codes that document a definite refusal', () => {
        for (const code of [10, 100, 190, 131026, 131047, 131051, 131053, 132001, 132015, 133010]) {
            expect(metaGraphClassifier(graph(400, err(code))))
                .toEqual({ kind: 'rejected', errorCode: `meta_${code}`, retryable: false });
        }
    });

    it('honours the provider transient flag, and only when it is explicitly true', () => {
        expect(metaGraphClassifier(graph(500, err(999999, { is_transient: true }))))
            .toEqual({ kind: 'rejected', errorCode: 'meta_999999', retryable: true });
        expect(metaGraphClassifier(graph(500, err(999999, { is_transient: false }))))
            .toEqual({ kind: 'rejected', errorCode: 'meta_999999', retryable: false });
    });

    it('keeps a subcode in the recorded reason', () => {
        expect(metaGraphClassifier(graph(400, err(131047, { error_subcode: 2494010 }))))
            .toEqual({ kind: 'rejected', errorCode: 'meta_131047_2494010', retryable: false });
    });

    it('refuses an unmapped code without inviting another attempt', () => {
        // An error object with no id means nothing was created, so it is a
        // refusal — but an unmapped code is no evidence that a retry would differ.
        expect(metaGraphClassifier(graph(400, err(4242424))))
            .toEqual({ kind: 'rejected', errorCode: 'meta_4242424', retryable: false });
    });

    it('does not read a 5xx as proof that the provider did nothing', () => {
        // The rule this replaced said every answered 5xx was a retryable
        // rejection. A 5xx with no Graph error carries no such evidence.
        expect(metaGraphClassifier(graph(500, {})))
            .toEqual({ kind: 'unknown', errorCode: 'unclassified_http_500' });
        expect(metaGraphClassifier(graph(503, { something: 'else' })))
            .toEqual({ kind: 'unknown', errorCode: 'unclassified_http_503' });
    });

    it('treats a body it could not read at all as unknown', () => {
        // HTML from an edge, a cut stream: the status line alone proves nothing.
        expect(metaGraphClassifier(graph(502, null)))
            .toEqual({ kind: 'unknown', errorCode: 'unreadable_body_http_502' });
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

    it('reads the Messenger receipt from its own field', () => {
        expect(metaGraphAnswer(200, { recipient_id: '1', message_id: 'mid.ABC' }, 'message_id'))
            .toMatchObject({ receipt: 'mid.ABC' });
        expect(metaGraphAnswer(200, ok, 'message_id')).toMatchObject({ receipt: null });
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
        answer(200, ok);
        await expect(adapter.sendStrict(request(), 'token'))
            .resolves.toMatchObject({ kind: 'accepted' });
        expect(sent[0].url).toContain('/phone-1/messages');
        expect(sent[0].body).toMatchObject({ messaging_product: 'whatsapp', to: '+573000000000',
            type: 'text', text: { body: 'Hola' } });
    });

    it('never attaches a caption to an image, because that would be two effects', async () => {
        answer(200, ok);
        await adapter.sendStrict(request({ itemKind: 'media',
            payload: { mediaUrl: 'https://example.test/a.jpg', caption: 'Una foto' } }), 'token');
        expect(sent[0].body.image).toEqual({ link: 'https://example.test/a.jpg' });
        expect(JSON.stringify(sent[0].body)).not.toContain('Una foto');
    });

    it('sends a Flow as its own effect and never degrades it to text', async () => {
        answer(200, ok);
        const outcome = await adapter.sendStrict(request({ itemKind: 'flow',
            payload: { flowId: 'f-1', flowToken: 't-1', text: 'Agenda tu cita' } }), 'token');
        expect(outcome).toMatchObject({ kind: 'accepted' });
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
        answer(200, ok);
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
        answer(400, err(131047));
        await expect(adapter.sendStrict(request(), 'token'))
            .resolves.toEqual({ kind: 'rejected', errorCode: 'meta_131047', retryable: false });
        expect(sent).toHaveLength(1);
    });

    it('keeps an unreadable body from inventing an acceptance', async () => {
        (global as any).fetch = jest.fn(async () => ({ status: 200, json: async () => { throw new Error('bad json'); } }));
        await expect(adapter.sendStrict(request(), 'token'))
            .resolves.toEqual({ kind: 'unknown', errorCode: 'receipt_missing' });
    });
});
