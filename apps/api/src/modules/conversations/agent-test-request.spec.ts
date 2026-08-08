import type { ExecutionContext } from '@nestjs/common';
import { AgentTestRequestGuard } from './agent-test-request.guard';
import {
    AGENT_TEST_HISTORY_ITEM_MAX_CHARS,
    AGENT_TEST_HISTORY_MAX_ITEMS,
    AGENT_TEST_MESSAGE_MAX_CHARS,
    AgentTestRequestDto,
} from './dto/agent-test-request.dto';
import {
    AGENT_TEST_RATE_LIMIT,
    AGENT_TEST_RATE_WINDOW_SECONDS,
    AgentTestRateLimitGuard,
} from './agent-test-rate-limit.guard';

function httpContext(request: any, response: any = { setHeader: jest.fn() }): ExecutionContext {
    return {
        switchToHttp: () => ({
            getRequest: () => request,
            getResponse: () => response,
            getNext: () => undefined,
        }),
    } as unknown as ExecutionContext;
}

describe('Agent Test runtime request contract', () => {
    const guard = new AgentTestRequestGuard();

    it('accepts and transforms only the bounded public contract', async () => {
        const request = {
            body: {
                message: 'Hola',
                conversationHistory: [{ role: 'user', content: 'Anterior' }],
                options: { disableTools: true },
            },
        };

        await expect(guard.canActivate(httpContext(request))).resolves.toBe(true);
        expect(request.body).toBeInstanceOf(AgentTestRequestDto);
        expect(request.body).toMatchObject({
            message: 'Hola',
            options: { disableTools: true },
        });
    });

    it.each([
        ['top-level', { message: 'Hola', evalMode: true }],
        ['history item', { message: 'Hola', conversationHistory: [{ role: 'user', content: 'x', id: 'extra' }] }],
        ['options', { message: 'Hola', options: { disableTools: true, sandboxContactId: 'real-id' } }],
        ['inert channel selector', { message: 'Hola', channelType: 'whatsapp' }],
    ])('rejects unknown %s fields instead of silently stripping them', async (_label, body) => {
        await expect(guard.canActivate(httpContext({ body }))).rejects.toMatchObject({ status: 400 });
    });

    it.each([
        ['blank message', { message: '   ' }],
        ['oversized message', { message: 'x'.repeat(AGENT_TEST_MESSAGE_MAX_CHARS + 1) }],
        ['invalid role', { message: 'Hola', conversationHistory: [{ role: 'system', content: 'x' }] }],
        ['null history', { message: 'Hola', conversationHistory: null }],
        ['too many history items', {
            message: 'Hola',
            conversationHistory: Array.from(
                { length: AGENT_TEST_HISTORY_MAX_ITEMS + 1 },
                () => ({ role: 'user', content: 'x' }),
            ),
        }],
        ['history character budget', {
            message: 'Hola',
            conversationHistory: Array.from(
                { length: 7 },
                () => ({ role: 'user', content: 'x'.repeat(AGENT_TEST_HISTORY_ITEM_MAX_CHARS) }),
            ),
        }],
        ['coerced option', { message: 'Hola', options: { disableTools: 'true' } }],
    ])('rejects abusive payload: %s', async (_label, body) => {
        await expect(guard.canActivate(httpContext({ body }))).rejects.toMatchObject({ status: 400 });
    });
});

describe('AgentTestRateLimitGuard', () => {
    it('uses a stable tenant+user bucket and permits the configured budget', async () => {
        const redis = { incrementRateLimit: jest.fn().mockResolvedValue(AGENT_TEST_RATE_LIMIT) };
        const guard = new AgentTestRateLimitGuard(redis as any);
        const request = {
            params: { tenantId: 'tenant-1' },
            user: { id: 'user-1' },
            headers: { 'cf-connecting-ip': '203.0.113.10' },
        };

        await expect(guard.canActivate(httpContext(request))).resolves.toBe(true);
        expect(redis.incrementRateLimit).toHaveBeenCalledWith(
            'agent_test:rate:tenant-1:user-1',
            AGENT_TEST_RATE_WINDOW_SECONDS,
        );
    });

    it('returns 429 and Retry-After above the endpoint-specific limit', async () => {
        const redis = { incrementRateLimit: jest.fn().mockResolvedValue(AGENT_TEST_RATE_LIMIT + 1) };
        const guard = new AgentTestRateLimitGuard(redis as any);
        const response = { setHeader: jest.fn() };

        await expect(guard.canActivate(httpContext({
            params: { tenantId: 'tenant-1' },
            user: { id: 'user-1' },
            headers: {},
            ip: '127.0.0.1',
        }, response))).rejects.toMatchObject({ status: 429 });

        expect(response.setHeader).toHaveBeenCalledWith(
            'Retry-After',
            String(AGENT_TEST_RATE_WINDOW_SECONDS),
        );
    });
});
