import { EventEmitter } from 'node:events';
import {
    IsolatedWebPushExecutor,
    WEB_PUSH_ABSOLUTE_DEADLINE_MS,
    WEB_PUSH_MAX_PAYLOAD_BYTES,
    WEB_PUSH_WORKER_RESOURCE_LIMITS,
    assertBoundedWebPushPayload,
    assertBoundedWebPushResponse,
    isAllowlistedPushServiceHostname,
} from './web-push-isolation';

const REQUEST = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/id',
    hostname: 'fcm.googleapis.com',
    address: '203.0.114.50',
    family: 4 as const,
    keys: { p256dh: 'key', auth: 'secret' },
    payload: '{"title":"hello"}',
    vapidDetails: { subject: 'mailto:test@example.com', publicKey: 'public', privateKey: 'private' },
};

class FakeWorker extends EventEmitter {
    terminate = jest.fn().mockResolvedValue(0);
}

describe('isolated Web Push boundary', () => {
    afterEach(() => jest.useRealTimers());

    it.each([
        'fcm.googleapis.com',
        'updates.push.services.mozilla.com',
        'web.push.apple.com',
        'wns2-bl2p.notify.windows.com',
    ])('allowlists a known push service: %s', (hostname) => {
        expect(isAllowlistedPushServiceHostname(hostname)).toBe(true);
    });

    it.each([
        'standards-compliant-push.example',
        'fcm.googleapis.com.attacker.example',
        'notify.windows.com.attacker.example',
    ])('rejects an arbitrary or suffix-confused service: %s', (hostname) => {
        expect(isAllowlistedPushServiceHostname(hostname)).toBe(false);
    });

    it('enforces payload/response byte caps', () => {
        expect(() => assertBoundedWebPushPayload('x'.repeat(WEB_PUSH_MAX_PAYLOAD_BYTES + 1))).toThrow();
        expect(() => assertBoundedWebPushResponse('x'.repeat(16 * 1024 + 1))).toThrow();
    });

    it('runs with explicit worker memory limits and terminates after response', async () => {
        const worker = new FakeWorker();
        const factory = jest.fn().mockReturnValue(worker);
        const executor = new IsolatedWebPushExecutor(factory, 'worker.js');
        const pending = executor.send(REQUEST);
        worker.emit('message', { ok: true, statusCode: 201 });
        await pending;

        expect(factory).toHaveBeenCalledWith('worker.js', expect.objectContaining({
            resourceLimits: WEB_PUSH_WORKER_RESOURCE_LIMITS,
        }));
        expect(worker.terminate).toHaveBeenCalled();
    });

    it('terminates the worker at the absolute wall-clock deadline', async () => {
        jest.useFakeTimers();
        const worker = new FakeWorker();
        const executor = new IsolatedWebPushExecutor(() => worker, 'worker.js');
        const pending = executor.send(REQUEST);
        jest.advanceTimersByTime(WEB_PUSH_ABSOLUTE_DEADLINE_MS);
        await expect(pending).rejects.toThrow('absolute deadline');
        expect(worker.terminate).toHaveBeenCalled();
    });
});
