import {
    EXPO_PUSH_MAX_RESPONSE_BYTES,
    WEB_PUSH_ABSOLUTE_DEADLINE_MS,
} from './web-push-isolation';
import { PushService } from './push.service';

class FakeReader {
    cancel = jest.fn().mockResolvedValue(undefined);
    constructor(private readonly readImpl: () => Promise<any>) {}
    read = () => this.readImpl();
}

describe('PushService Expo provider bounds', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    function service() {
        return new PushService({ $queryRawUnsafe: jest.fn() } as any, { get: jest.fn() } as any);
    }

    it('aborts a drip response at the absolute deadline', async () => {
        jest.useFakeTimers();
        let capturedSignal: AbortSignal | undefined;
        const reader = new FakeReader(() => new Promise(() => undefined));
        global.fetch = jest.fn().mockImplementation(async (_url, options: any) => {
            capturedSignal = options.signal;
            return {
                ok: true, status: 200,
                headers: { get: jest.fn().mockReturnValue(null) },
                body: { getReader: () => reader },
            };
        }) as any;

        const pending = (service() as any).sendExpo(['ExponentPushToken[test]'], {
            title: 'Nuevo mensaje', body: 'Hola',
        });
        await Promise.resolve();
        jest.advanceTimersByTime(WEB_PUSH_ABSOLUTE_DEADLINE_MS);

        await expect(pending).resolves.toBe(0);
        expect(capturedSignal?.aborted).toBe(true);
    });

    it('cancels an oversized streamed response before JSON assembly', async () => {
        const chunks = [
            { done: false, value: new Uint8Array(EXPO_PUSH_MAX_RESPONSE_BYTES + 1) },
            { done: true },
        ];
        const reader = new FakeReader(async () => chunks.shift());
        global.fetch = jest.fn().mockResolvedValue({
            ok: true, status: 200,
            headers: { get: jest.fn().mockReturnValue(null) },
            body: { getReader: () => reader },
        }) as any;

        await expect((service() as any).sendExpo(['ExponentPushToken[test]'], {
            title: 'Nuevo mensaje', body: 'Hola',
        })).resolves.toBe(0);
        expect(reader.cancel).toHaveBeenCalledWith('response_size_cap');
    });
});
