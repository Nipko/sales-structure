import { AIToolExecutorService } from '../conversations/ai-tool-executor.service';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';

const TENANT = '11111111-2222-4333-8444-555555555555';

/**
 * El envoltorio público de `execute` mide y delega. Se arma sin el constructor
 * (que necesita ~30 servicios) porque lo único bajo prueba es la delegación.
 */
function harness(recorder?: { record: jest.Mock }) {
    const executor = Object.create(AIToolExecutorService.prototype) as any;
    executor.toolUsage = recorder;
    executor.executeUnobserved = jest.fn();
    return executor as { execute: AIToolExecutorService['execute']; executeUnobserved: jest.Mock };
}

const opts = { authority: { source: 'llm_loop' } as any, channelType: 'whatsapp' };

describe('AIToolExecutorService.execute usage wrapper', () => {
    it('returns the very same result object and passes every argument through', async () => {
        const record = jest.fn();
        const executor = harness({ record });
        const result = { items: [1, 2], status: 'ok' };
        executor.executeUnobserved.mockResolvedValue(result);
        const args = { query: 'x' };

        await expect(executor.execute('tenant_x', TENANT, 'contact', 'search_products', args, 'conv', opts)).resolves.toBe(result);

        expect(executor.executeUnobserved).toHaveBeenCalledWith('tenant_x', TENANT, 'contact', 'search_products', args, 'conv', opts);
        expect(record).toHaveBeenCalledTimes(1);
        expect(record.mock.calls[0][0]).toEqual(expect.objectContaining({
            tenantId: TENANT, toolName: 'search_products', mode: 'live', channel: 'whatsapp', outcome: 'ok', errorCode: null,
        }));
        expect(record.mock.calls[0][0].durationMs).toBeGreaterThanOrEqual(0);
    });

    it('rethrows the original exception unchanged and records it as an error', async () => {
        const record = jest.fn();
        const executor = harness({ record });
        const failure = new Error('eval_namespace_scope_mismatch');
        executor.executeUnobserved.mockRejectedValue(failure);

        await expect(executor.execute('s', TENANT, 'c', 'create_order', {}, undefined, opts)).rejects.toBe(failure);
        expect(record.mock.calls[0][0]).toEqual(expect.objectContaining({ outcome: 'error', errorCode: 'exception' }));
    });

    it('classifies blocked results and the agent-test mode', async () => {
        const record = jest.fn();
        const executor = harness({ record });
        const blocked = { error: 'agent_test_read_only', persisted: false };
        executor.executeUnobserved.mockResolvedValue(blocked);

        const result = await executor.execute('s', TENANT, 'c', 'create_order', {}, undefined, {
            authority: opts.authority, executionContext: AGENT_TEST_EXECUTION_CONTEXT,
        });

        expect(result).toBe(blocked);
        expect(record.mock.calls[0][0]).toEqual(expect.objectContaining({
            outcome: 'blocked', errorCode: 'agent_test_read_only', mode: 'agent_test', channel: 'unknown',
        }));
    });

    it('is untouched by a recorder that throws', async () => {
        const record = jest.fn(() => { throw new Error('recorder down'); });
        const executor = harness({ record });
        const result = { error: 'no_contact' };
        executor.executeUnobserved.mockResolvedValue(result);

        await expect(executor.execute('s', TENANT, 'c', 'get_order_status', {}, undefined, opts)).resolves.toBe(result);

        const failure = new Error('boom');
        executor.executeUnobserved.mockRejectedValue(failure);
        await expect(executor.execute('s', TENANT, 'c', 'get_order_status', {}, undefined, opts)).rejects.toBe(failure);
    });

    it('delegates straight through when no recorder is wired (hand-built specs)', async () => {
        const executor = harness(undefined);
        const result = { ok: true };
        executor.executeUnobserved.mockResolvedValue(result);
        await expect(executor.execute('s', TENANT, 'c', 'search_faqs', {}, undefined, opts)).resolves.toBe(result);
    });
});
