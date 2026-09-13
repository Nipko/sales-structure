import { HttpRequestHandler } from './http-request.handler';

describe('HttpRequestHandler external outcome boundary', () => {
    const stable = { idempotencyKey: 'automation-job:stable-1' };

    function build() {
        const transport = {
            validateUrl: jest.fn(),
            execute: jest.fn(),
        };
        return { transport, handler: new HttpRequestHandler(transport as any) };
    }

    it('owns the idempotency header and records an accepted provider receipt', async () => {
        const { transport, handler } = build();
        transport.execute.mockResolvedValue({
            statusCode: 201,
            headers: {},
            body: { remote_id: 'order-7' },
        });

        await expect(handler.execute('tenant_schema', {
            method: 'POST',
            url: 'https://hooks.example.test/orders',
            headers: { 'idempotency-key': 'tenant-overwrite', 'X-Tenant': 'ok' },
            response_mapping: {
                remoteId: 'remote_id',
                outcome: 'remote_id',
                idempotencyKey: 'remote_id',
            },
        }, {}, stable)).resolves.toEqual({
            outcome: 'accepted',
            statusCode: 201,
            idempotencyKey: stable.idempotencyKey,
            remoteId: 'order-7',
        });

        expect(transport.execute).toHaveBeenCalledWith(expect.objectContaining({
            headers: {
                'X-Tenant': 'ok',
                'Idempotency-Key': stable.idempotencyKey,
            },
        }));
    });

    it('does not retry a mutating request whose answer was lost', async () => {
        const { transport, handler } = build();
        transport.execute.mockRejectedValue(new Error('timeout after write'));

        await expect(handler.execute('tenant_schema', {
            method: 'POST',
            url: 'https://hooks.example.test/orders',
            retry_count: 3,
        }, {}, stable)).resolves.toEqual({
            outcome: 'unknown',
            statusCode: null,
            idempotencyKey: stable.idempotencyKey,
            error: 'timeout after write',
        });
        expect(transport.execute).toHaveBeenCalledTimes(1);
    });

    it('keeps retries only for read methods and records a conclusive rejection', async () => {
        const { transport, handler } = build();
        transport.execute
            .mockRejectedValueOnce(new Error('temporary read failure'))
            .mockResolvedValueOnce({ statusCode: 503, headers: {}, body: {} });

        await expect(handler.execute('tenant_schema', {
            method: 'GET',
            url: 'https://hooks.example.test/status',
            retry_count: 1,
        }, {}, stable)).resolves.toMatchObject({
            outcome: 'rejected',
            statusCode: 503,
        });
        expect(transport.execute).toHaveBeenCalledTimes(2);
    });

    it('fails before transport when destination validation rejects the request', async () => {
        const { transport, handler } = build();
        transport.validateUrl.mockImplementation(() => { throw new Error('blocked destination'); });

        await expect(handler.execute('tenant_schema', {
            method: 'POST',
            url: 'http://127.0.0.1/private',
        }, {}, stable)).rejects.toThrow('blocked destination');
        expect(transport.execute).not.toHaveBeenCalled();
    });
});
