import { ChannelManagementController } from './channel-management.controller';
import {
    META_CONNECT_ERROR,
    META_CONNECT_ERROR_CODES,
    isRetryableMetaConnectError,
} from '@parallext/shared';

/**
 * Every failure of connecting Instagram or Messenger has to end in something
 * the person can do, and Meta's own sentence must never be what they read.
 *
 * So each case here drives the real handler with the Graph answers that produce
 * it and asserts three things at once: the code, that `retryable` says what the
 * shared helper says (one list, not two), and that nothing Meta wrote survived
 * into the body. The sentinel below is planted in every Graph error payload the
 * mocks return — if it ever shows up in a response, the wall from the recording
 * is back.
 */
const META_PROSE = '(#200) Provide valid app ID — la frase de Meta que nadie debe leer';

type GraphAnswer = Record<string, any>;

function installFetch(route: (url: string) => GraphAnswer): jest.Mock {
    const mock = jest.fn(async (input: any) => ({
        ok: true,
        status: 200,
        json: async () => route(String(input)),
        text: async () => JSON.stringify(route(String(input))),
    }));
    (global as any).fetch = mock;
    return mock;
}

/** Deps every connect path touches before it can refuse. */
function buildController(overrides: Record<string, any> = {}): any {
    const controller: any = Object.create(ChannelManagementController.prototype);
    Object.assign(controller, {
        logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        configService: {
            get: (key: string, fallback?: any) => ({
                META_APP_ID: 'app-id',
                META_APP_SECRET: 'app-secret',
                META_GRAPH_VERSION: 'v21.0',
                INSTAGRAM_APP_ID: 'ig-app',
                INSTAGRAM_APP_SECRET: 'ig-secret',
                INSTAGRAM_REDIRECT_URI: 'https://admin.example/callback',
            } as Record<string, string>)[key] ?? fallback,
        },
        cryptoService: { encryptToken: jest.fn(() => 'encrypted') },
        channelToken: { invalidateCache: jest.fn().mockResolvedValue(undefined) },
        events: { emit: jest.fn() },
        throttle: {
            getPlanFeatures: jest.fn().mockResolvedValue({ channels: ['instagram', 'messenger'] }),
            getChannelAccountLimit: jest.fn().mockResolvedValue(5),
            enforceChannelAccountLimit: jest.fn().mockResolvedValue(undefined),
        },
        prisma: {
            channelAccount: {
                findMany: jest.fn().mockResolvedValue([]),
                findFirst: jest.fn().mockResolvedValue(null),
                count: jest.fn().mockResolvedValue(0),
                create: jest.fn().mockResolvedValue({}),
                update: jest.fn().mockResolvedValue({}),
            },
            whatsappCredential: {
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue({}),
                update: jest.fn().mockResolvedValue({}),
            },
            tenant: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        },
        ...overrides,
    });
    return controller;
}

const req = { user: { tenantId: 'tenant-1', sub: 'user-1' } };

/** Run a connect that must refuse, and hand back the envelope it refused with. */
async function refusal(run: () => Promise<unknown>): Promise<{ status: number; body: any }> {
    try {
        await run();
    } catch (e: any) {
        return {
            status: typeof e?.getStatus === 'function' ? e.getStatus() : 0,
            body: typeof e?.getResponse === 'function' ? e.getResponse() : e,
        };
    }
    throw new Error('expected the connect to refuse, but it resolved');
}

/** The three invariants every refusal owes the panel. */
function expectTypedRefusal(body: any, code: string, channel: 'instagram' | 'messenger') {
    expect(body.error).toBe(code);
    expect(body.channel).toBe(channel);
    expect(body.retryable).toBe(isRetryableMetaConnectError(code));
    expect(META_CONNECT_ERROR_CODES).toContain(body.error);
    expect(JSON.stringify(body)).not.toContain(META_PROSE);
    expect(JSON.stringify(body)).not.toContain('(#200)');
}

// ── Instagram answers ──────────────────────────────────────────────

function instagramRoute(opts: {
    short?: GraphAnswer;
    long?: GraphAnswer;
    profile?: GraphAnswer;
} = {}) {
    return (url: string): GraphAnswer => {
        if (url.includes('api.instagram.com/oauth/access_token')) {
            return opts.short ?? { access_token: 'short-token', user_id: 'app-scoped-1' };
        }
        if (url.includes('graph.instagram.com/access_token')) {
            return opts.long ?? { access_token: 'long-token', expires_in: 5184000 };
        }
        if (url.includes('/me?') || url.includes('/me&')) {
            return opts.profile ?? { user_id: 'ig-1', username: 'tienda', account_type: 'BUSINESS' };
        }
        return { success: true };
    };
}

// ── Messenger answers ──────────────────────────────────────────────

function messengerRoute(opts: {
    debugValid?: boolean;
    granted?: string[];
    declined?: string[];
    pages?: GraphAnswer[];
    pagesError?: boolean;
} = {}) {
    const granted = opts.granted ?? ['pages_show_list', 'pages_messaging', 'pages_manage_metadata'];
    const declined = opts.declined ?? [];
    return (url: string): GraphAnswer => {
        if (url.includes('/oauth/access_token')) return { access_token: 'long-user-token' };
        if (url.includes('/debug_token')) {
            return { data: { is_valid: opts.debugValid !== false, scopes: granted, app_id: 'app-id' } };
        }
        if (url.includes('/me/permissions')) {
            return {
                data: [
                    ...granted.map((permission) => ({ permission, status: 'granted' })),
                    ...declined.map((permission) => ({ permission, status: 'declined' })),
                ],
            };
        }
        if (url.includes('/me/accounts')) {
            if (opts.pagesError) return { error: { code: 200, message: META_PROSE } };
            return { data: opts.pages ?? [] };
        }
        return { success: true };
    };
}

describe('Meta connect failures answer with a code, never with Meta prose', () => {
    afterEach(() => {
        delete (global as any).fetch;
        jest.restoreAllMocks();
    });

    // ── Instagram ──────────────────────────────────────────────────

    it('window_cancelled — the callback arrives without an authorization code', async () => {
        const controller = buildController();
        installFetch(instagramRoute());

        const { status, body } = await refusal(() => controller.instagramOAuthConnect({}, req));

        expect(status).toBe(400);
        expectTypedRefusal(body, META_CONNECT_ERROR.WINDOW_CANCELLED, 'instagram');
        expect(body.retryable).toBe(true);
    });

    it('token_exchange_failed — Meta refuses the code, and keeps its sentence to itself', async () => {
        const controller = buildController();
        installFetch(instagramRoute({ short: { error_message: META_PROSE, error_type: 'OAuthException' } }));

        const { status, body } = await refusal(() => controller.instagramOAuthConnect({ code: 'abc' }, req));

        expect(status).toBe(400);
        expectTypedRefusal(body, META_CONNECT_ERROR.TOKEN_EXCHANGE_FAILED, 'instagram');
        // The sentence is not lost — it is where support can read it.
        expect(JSON.stringify(controller.logger.warn.mock.calls)).toContain(META_PROSE);
        expect(JSON.stringify(controller.logger.warn.mock.calls)).toContain('tenant-1');
    });

    it('token_exchange_failed — the long-lived exchange is refused too', async () => {
        const controller = buildController();
        installFetch(instagramRoute({ long: { error: { message: META_PROSE } } }));

        const { body } = await refusal(() => controller.instagramOAuthConnect({ code: 'abc' }, req));

        expectTypedRefusal(body, META_CONNECT_ERROR.TOKEN_EXCHANGE_FAILED, 'instagram');
    });

    it('account_not_professional — the account behind the login is a personal one', async () => {
        const controller = buildController();
        installFetch(instagramRoute({
            profile: { user_id: 'ig-1', username: 'yo', account_type: 'PERSONAL' },
        }));

        const { status, body } = await refusal(() => controller.instagramOAuthConnect({ code: 'abc' }, req));

        expect(status).toBe(400);
        expectTypedRefusal(body, META_CONNECT_ERROR.ACCOUNT_NOT_PROFESSIONAL, 'instagram');
        expect(body.retryable).toBe(false);
        expect(body.evidence).toEqual({ accountType: 'PERSONAL' });
        // Nothing may be written for an account we refuse to connect.
        expect(controller.prisma.channelAccount.create).not.toHaveBeenCalled();
        expect(controller.prisma.channelAccount.update).not.toHaveBeenCalled();
    });

    it('no_instagram_business_account — Meta answers, and names no professional account', async () => {
        const controller = buildController();
        installFetch(instagramRoute({
            short: { access_token: 'short-token' },
            profile: { name: 'Sin cuenta profesional' },
        }));

        const { body } = await refusal(() => controller.instagramOAuthConnect({ code: 'abc' }, req));

        expectTypedRefusal(body, META_CONNECT_ERROR.NO_INSTAGRAM_BUSINESS_ACCOUNT, 'instagram');
        expect(body.retryable).toBe(false);
        // An empty accountId would collapse every unknown sender onto one row.
        expect(controller.prisma.channelAccount.create).not.toHaveBeenCalled();
    });

    it('unavailable — the profile read fails and we cannot name a cause', async () => {
        const controller = buildController();
        installFetch(instagramRoute({
            short: { access_token: 'short-token' },
            profile: { error: { code: 200, message: META_PROSE } },
        }));

        const { body } = await refusal(() => controller.instagramOAuthConnect({ code: 'abc' }, req));

        expectTypedRefusal(body, META_CONNECT_ERROR.UNAVAILABLE, 'instagram');
        expect(body.retryable).toBe(true);
    });

    it('plan_limit — the plan wall keeps its body and gains the flag', async () => {
        const { ForbiddenException } = await import('@nestjs/common');
        const controller = buildController();
        controller.prisma.channelAccount.count.mockResolvedValue(1);
        controller.throttle.enforceChannelAccountLimit.mockRejectedValue(new ForbiddenException({
            error: 'plan_limit_reached',
            limitKey: 'maxChannelAccounts',
            resource: 'instagram_accounts',
            channelType: 'instagram',
            currentCount: 1,
            maxAllowed: 1,
            plan: 'starter',
            message: 'Tu plan starter permite hasta 1 cuenta(s) de instagram.',
        }));
        installFetch(instagramRoute());

        const { status, body } = await refusal(() => controller.instagramOAuthConnect({ code: 'abc' }, req));

        expect(status).toBe(403);
        expect(body.error).toBe(META_CONNECT_ERROR.PLAN_LIMIT);
        expect(body.retryable).toBe(isRetryableMetaConnectError(META_CONNECT_ERROR.PLAN_LIMIT));
        expect(body.retryable).toBe(false);
        // Everything the surface already read is still there.
        expect(body.limitKey).toBe('maxChannelAccounts');
        expect(body.plan).toBe('starter');
    });

    // ── Messenger ──────────────────────────────────────────────────

    it('window_cancelled — FB.login() comes back with no token', async () => {
        const controller = buildController();
        installFetch(messengerRoute());

        const { status, body } = await refusal(() => controller.messengerOAuthConnect({}, req));

        expect(status).toBe(400);
        expectTypedRefusal(body, META_CONNECT_ERROR.WINDOW_CANCELLED, 'messenger');
        expect(body.retryable).toBe(true);
    });

    it('token_exchange_failed — /debug_token says the token is not valid', async () => {
        const controller = buildController();
        installFetch(messengerRoute({ debugValid: false }));

        const { body } = await refusal(() => controller.messengerOAuthConnect({ userAccessToken: 'tok' }, req));

        expectTypedRefusal(body, META_CONNECT_ERROR.TOKEN_EXCHANGE_FAILED, 'messenger');
    });

    it('permissions_missing — carries the declined and missing scope names as evidence', async () => {
        const controller = buildController();
        installFetch(messengerRoute({
            granted: ['pages_show_list'],
            declined: ['pages_messaging'],
            pages: [],
        }));

        const { status, body } = await refusal(() => controller.messengerOAuthConnect({ userAccessToken: 'tok' }, req));

        expect(status).toBe(400);
        expectTypedRefusal(body, META_CONNECT_ERROR.PERMISSIONS_MISSING, 'messenger');
        expect(body.retryable).toBe(true);
        expect(body.evidence.declinedScopes).toEqual(['pages_messaging']);
        expect(body.evidence.missingScopes).toEqual(['pages_messaging', 'pages_manage_metadata']);
    });

    it('no_page — every scope is granted and the account manages no page', async () => {
        const controller = buildController();
        installFetch(messengerRoute({ pages: [] }));

        const { body } = await refusal(() => controller.messengerOAuthConnect({ userAccessToken: 'tok' }, req));

        expectTypedRefusal(body, META_CONNECT_ERROR.NO_PAGE, 'messenger');
        expect(body.retryable).toBe(false);
    });

    it('not_page_admin — the page came back without MESSAGING or MANAGE', async () => {
        const controller = buildController();
        installFetch(messengerRoute({
            pages: [{ id: 'page-1', name: 'Mi tienda', tasks: ['ANALYZE'], access_token: 'page-token' }],
        }));

        const { body } = await refusal(() => controller.messengerOAuthConnect({ userAccessToken: 'tok' }, req));

        expectTypedRefusal(body, META_CONNECT_ERROR.NOT_PAGE_ADMIN, 'messenger');
        expect(body.retryable).toBe(false);
        expect(body.evidence).toEqual({ pageCount: 1 });
    });

    it('not_page_admin — the page is listed but Meta hands us no page token', async () => {
        const controller = buildController();
        installFetch(messengerRoute({
            pages: [{ id: 'page-1', name: 'Mi tienda', tasks: ['MESSAGING'] }],
        }));

        const { body } = await refusal(() => controller.messengerOAuthConnect({ userAccessToken: 'tok' }, req));

        expectTypedRefusal(body, META_CONNECT_ERROR.NOT_PAGE_ADMIN, 'messenger');
        expect(body.evidence).toEqual({ pagesWithoutToken: 1 });
        expect(controller.prisma.channelAccount.create).not.toHaveBeenCalled();
    });

    it('plan_limit — no new page fits, and the existing envelope survives', async () => {
        const controller = buildController();
        controller.throttle.getChannelAccountLimit.mockResolvedValue(0);
        installFetch(messengerRoute({
            pages: [{ id: 'page-1', name: 'Mi tienda', tasks: ['MESSAGING'], access_token: 'page-token' }],
        }));

        const { status, body } = await refusal(() => controller.messengerOAuthConnect({ userAccessToken: 'tok' }, req));

        expect(status).toBe(403);
        expect(body.error).toBe(META_CONNECT_ERROR.PLAN_LIMIT);
        expect(body.channel).toBe('messenger');
        expect(body.retryable).toBe(isRetryableMetaConnectError(META_CONNECT_ERROR.PLAN_LIMIT));
        expect(body.limitKey).toBe('maxChannelAccounts');
        expect(body.channelType).toBe('messenger');
        expect(body.evidence).toEqual({ skippedPages: ['Mi tienda'], limit: 0 });
        expect(JSON.stringify(body)).not.toContain(META_PROSE);
    });

    it('unavailable — /me/accounts fails with every scope granted', async () => {
        const controller = buildController();
        installFetch(messengerRoute({ pagesError: true }));

        const { body } = await refusal(() => controller.messengerOAuthConnect({ userAccessToken: 'tok' }, req));

        expectTypedRefusal(body, META_CONNECT_ERROR.UNAVAILABLE, 'messenger');
        expect(body.retryable).toBe(true);
        // Meta's sentence went to the log, not to the person.
        expect(JSON.stringify(controller.logger.error.mock.calls)).toContain(META_PROSE);
    });

    it('covers every code the shared contract declares', () => {
        expect(new Set(META_CONNECT_ERROR_CODES).size).toBe(9);
        expect(META_CONNECT_ERROR_CODES.filter(isRetryableMetaConnectError).sort()).toEqual([
            META_CONNECT_ERROR.PERMISSIONS_MISSING,
            META_CONNECT_ERROR.TOKEN_EXCHANGE_FAILED,
            META_CONNECT_ERROR.UNAVAILABLE,
            META_CONNECT_ERROR.WINDOW_CANCELLED,
        ].sort());
    });
});
