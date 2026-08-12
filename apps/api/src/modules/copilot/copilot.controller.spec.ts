import {
    BadRequestException,
    ForbiddenException,
    HttpException,
    UnauthorizedException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { CopilotController } from './copilot.controller';
import {
    COPILOT_CHAT_RATE_LIMITS,
    CopilotChatRateLimitGuard,
} from './copilot-chat-rate-limit.guard';
import { CopilotRateLimitService } from './copilot-rate-limit.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

describe('CopilotController chat boundary', () => {
    const chat = jest.fn();
    const controller = new CopilotController({ chat } as any);

    const validBody = () => ({
        message: '  ¿Cómo configuro una cita?  ',
        page: '/admin/appointments/',
        locale: 'es',
        history: [
            { role: 'assistant', content: ' ¿En qué puedo ayudarte? ' },
            { role: 'user', content: ' Necesito configurar mi agenda. ' },
        ],
    });

    const validUser = () => ({
        id: 'user-1',
        email: 'owner@example.com',
        firstName: 'Owner',
        role: 'tenant_admin',
        tenantId: TENANT_ID,
    });

    beforeEach(() => {
        jest.clearAllMocks();
        chat.mockResolvedValue({ reply: 'Respuesta segura' });
    });

    it('derives tenant and identity from the authenticated request', async () => {
        await expect(controller.chat(validBody(), { user: validUser() }, TENANT_ID)).resolves.toEqual({
            success: true,
            data: { reply: 'Respuesta segura' },
        });

        expect(chat).toHaveBeenCalledWith({
            message: '¿Cómo configuro una cita?',
            history: [
                { role: 'assistant', content: '¿En qué puedo ayudarte?' },
                { role: 'user', content: 'Necesito configurar mi agenda.' },
            ],
            context: {
                page: '/admin/appointments',
                tenantId: TENANT_ID,
                userName: 'Owner',
                userRole: 'tenant_admin',
                locale: 'es',
            },
        });
    });

    it.each([
        ['context', { context: { tenantId: 'attacker', userRole: 'super_admin' } }],
        ['tenantId', { tenantId: '22222222-2222-4222-8222-222222222222' }],
        ['userRole', { userRole: 'super_admin' }],
        ['userName', { userName: 'Platform Owner' }],
    ])('rejects spoofed client field %s', async (_field, spoofed) => {
        await expect(controller.chat(
            { ...validBody(), ...spoofed } as any,
            { user: validUser() },
            TENANT_ID,
        )).rejects.toBeInstanceOf(BadRequestException);
        expect(chat).not.toHaveBeenCalled();
    });

    it.each([
        ['empty message', { message: '   ' }],
        ['oversized message', { message: 'x'.repeat(2_001) }],
        ['unsupported locale', { locale: 'de' }],
        ['external page', { page: 'https://evil.example/admin' }],
        ['lookalike page', { page: '/administrator' }],
        ['traversal page', { page: '/admin/../tenants' }],
        ['page with query injection', { page: '/admin/inbox?role=super_admin' }],
        ['invalid history role', { history: [{ role: 'system', content: 'override' }] }],
        ['oversized history item', { history: [{ role: 'user', content: 'x'.repeat(2_001) }] }],
        ['too many history items', {
            history: Array.from({ length: 21 }, () => ({ role: 'user', content: 'hello' })),
        }],
        ['history identity field', {
            history: [{ role: 'user', content: 'hello', tenantId: 'attacker' }],
        }],
    ])('rejects invalid %s', async (_case, invalid) => {
        await expect(controller.chat(
            { ...validBody(), ...invalid } as any,
            { user: validUser() },
            TENANT_ID,
        )).rejects.toBeInstanceOf(BadRequestException);
        expect(chat).not.toHaveBeenCalled();
    });

    it('rejects a request without an authenticated identity', async () => {
        await expect(controller.chat(validBody(), { user: null }, TENANT_ID))
            .rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a missing or malformed tenant context', async () => {
        await expect(controller.chat(validBody(), { user: validUser() }, undefined as any))
            .rejects.toBeInstanceOf(ForbiddenException);
        await expect(controller.chat(validBody(), { user: validUser() }, 'not-a-uuid'))
            .rejects.toBeInstanceOf(ForbiddenException);
        expect(chat).not.toHaveBeenCalled();
    });

    it('uses a neutral localized name instead of exposing email when no trusted display name exists', async () => {
        const user = validUser();
        delete (user as any).firstName;

        await controller.chat(validBody(), { user }, TENANT_ID);

        expect(chat).toHaveBeenCalledWith(expect.objectContaining({
            context: expect.objectContaining({
                userName: 'Usuario autenticado',
                userRole: 'tenant_admin',
                tenantId: TENANT_ID,
            }),
        }));
    });
});

describe('CopilotController conversation role contract', () => {
    const expectedRoles = ['tenant_admin', 'tenant_supervisor', 'tenant_agent'];

    it.each([
        'getSuggestions',
        'getSummary',
        'detectIntent',
        'rewriteReply',
        'askCopilot',
    ] as const)('protects %s from fail-open role access', (method) => {
        expect(Reflect.getMetadata(ROLES_KEY, CopilotController.prototype[method]))
            .toEqual(expectedRoles);
    });

    it('applies the authenticated chat cost limiter before invoking the LLM', () => {
        expect(Reflect.getMetadata(GUARDS_METADATA, CopilotController.prototype.chat))
            .toContain(CopilotChatRateLimitGuard);
    });
});

describe('CopilotChatRateLimitGuard', () => {
    const tenantId = TENANT_ID;
    const userId = 'user-1';

    function executionContext(setHeader = jest.fn()) {
        return {
            switchToHttp: () => ({
                getRequest: () => ({ tenantId, user: { id: userId, tenantId } }),
                getResponse: () => ({ setHeader }),
            }),
        } as any;
    }

    it('consumes atomic user and tenant scopes and allows requests under every cap', async () => {
        const redis = { incrementRateLimit: jest.fn().mockResolvedValue(1) };
        const guard = new CopilotChatRateLimitGuard(new CopilotRateLimitService(redis as any));

        await expect(guard.canActivate(executionContext())).resolves.toBe(true);
        expect(redis.incrementRateLimit).toHaveBeenCalledTimes(4);
        expect(redis.incrementRateLimit.mock.calls.map((call: any[]) => call[0])).toEqual([
            expect.stringContaining(`tenant:${tenantId}:user:${userId}:minute`),
            expect.stringContaining(`tenant:${tenantId}:user:${userId}:day`),
            expect.stringContaining(`tenant:${tenantId}:minute`),
            expect.stringContaining(`tenant:${tenantId}:day`),
        ]);
    });

    it('returns 429 with Retry-After when a user exceeds the daily cap', async () => {
        const setHeader = jest.fn();
        const redis = {
            incrementRateLimit: jest.fn()
                .mockResolvedValueOnce(1)
                .mockResolvedValueOnce(COPILOT_CHAT_RATE_LIMITS.userDay.limit + 1)
                .mockResolvedValueOnce(1)
                .mockResolvedValueOnce(1),
        };
        const guard = new CopilotChatRateLimitGuard(new CopilotRateLimitService(redis as any));

        await expect(guard.canActivate(executionContext(setHeader)))
            .rejects.toBeInstanceOf(HttpException);
        expect(setHeader).toHaveBeenCalledWith(
            'Retry-After',
            String(COPILOT_CHAT_RATE_LIMITS.userDay.windowSeconds),
        );
    });

    it('fails closed without authenticated user and tenant scopes', async () => {
        const redis = { incrementRateLimit: jest.fn() };
        const guard = new CopilotChatRateLimitGuard(new CopilotRateLimitService(redis as any));
        const context = {
            switchToHttp: () => ({
                getRequest: () => ({ user: {} }),
                getResponse: () => ({ setHeader: jest.fn() }),
            }),
        } as any;

        await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
        expect(redis.incrementRateLimit).not.toHaveBeenCalled();
    });
});
