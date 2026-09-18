import * as fs from 'fs';
import * as path from 'path';
import { ChannelManagementController, TELEGRAM_CONNECT_ERROR } from './channel-management.controller';
import { TelegramAdapter, TelegramUnreachableError } from './telegram/telegram.adapter';
import { META_CONNECT_ERROR } from '@parallext/shared';

/**
 * What a refused channel connection says, and in what code.
 *
 * Telegram used to refuse a bad key with a bare sentence ("Token invalido —
 * verifica que el token de @BotFather sea correcto") and a failed webhook with
 * Telegram's own English. The dashboard's `api.fetch` kept only that sentence,
 * so the wizard could not tell the two apart and showed one generic card for
 * both. Each refusal now carries a code the panel builds its card from, and
 * the sentence beside it is ours, in tú.
 *
 * `validateBotToken` also answered `null` when Telegram could not be reached at
 * all, so a dropped connection read as "Telegram no reconoce esa clave". A
 * refused key is still `null`; no answer is `TelegramUnreachableError`, and the
 * connect says `telegram_unavailable`, retryable.
 *
 * The plan walls kept their codes (`channel_not_available`,
 * `plan_limit_reached`) but still said "Actualizá tu plan" to an owner the rest
 * of the product speaks to with tú.
 */

/** Telegram's own words for a refused webhook; they must never reach the body. */
const TELEGRAM_PROSE = 'Bad Request: bad webhook: HTTPS url must be provided for webhook';

/** Voseo forms that are voseo and nothing else — none is a tú form. */
const VOSEO = /(?:^|[^\wáéíóúñ])(?:vos|podés|tenés|querés|sabés|necesitás|indicá|actualizá|desconectá|conectá|revisá|verificá|probá|pegalo|abrí)(?![\wáéíóúñ])/i;

function buildController(overrides: Record<string, any> = {}): any {
    const controller: any = Object.create(ChannelManagementController.prototype);
    Object.assign(controller, {
        logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        configService: { get: (_key: string, fallback?: any) => fallback },
        cryptoService: { encryptToken: jest.fn(() => 'encrypted') },
        channelToken: { invalidateCache: jest.fn().mockResolvedValue(undefined) },
        events: { emit: jest.fn() },
        telegramAdapter: {
            validateBotToken: jest.fn().mockResolvedValue({ id: 7, username: 'cafe_luna_bot', firstName: 'Café Luna' }),
            setWebhook: jest.fn().mockResolvedValue({ ok: true }),
        },
        throttle: {
            getPlanFeatures: jest.fn().mockResolvedValue({ channels: ['whatsapp', 'telegram', 'messenger'] }),
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

describe('Telegram connect refuses with a code the panel can map', () => {
    it('a key Telegram does not accept is `invalid_bot_key`, and nothing is stored', async () => {
        const controller = buildController();
        controller.telegramAdapter.validateBotToken.mockResolvedValue(null);

        const { status, body } = await refusal(() => controller.connectTelegram({ botToken: '123:abc' }, req));

        expect(status).toBe(400);
        expect(body).toMatchObject({
            error: TELEGRAM_CONNECT_ERROR.INVALID_BOT_KEY,
            channel: 'telegram',
            retryable: false,
        });
        // The literal the dashboard maps (`wizardConnectFailure`) — renaming
        // it here without the panel would put the generic card back.
        expect(TELEGRAM_CONNECT_ERROR.INVALID_BOT_KEY).toBe('invalid_bot_key');
        expect(body.message).toContain('@BotFather');
        expect(body.message).not.toMatch(/token/i);
        expect(body.message).not.toMatch(VOSEO);
        expect(controller.telegramAdapter.setWebhook).not.toHaveBeenCalled();
        expect(controller.prisma.channelAccount.create).not.toHaveBeenCalled();
        expect(controller.prisma.whatsappCredential.create).not.toHaveBeenCalled();
    });

    it('Telegram out of reach is `telegram_unavailable` and retryable, never "no reconoce esa clave"', async () => {
        // The key may be perfectly good: the call to Telegram never got an
        // answer. Sending her back to @BotFather for it was the bug.
        const controller = buildController();
        controller.telegramAdapter.validateBotToken.mockRejectedValue(new TelegramUnreachableError('ECONNRESET'));

        const { status, body } = await refusal(() => controller.connectTelegram({ botToken: '123:abc' }, req));

        expect(status).toBe(503);
        expect(body).toMatchObject({ error: TELEGRAM_CONNECT_ERROR.UNAVAILABLE, channel: 'telegram', retryable: true });
        expect(body.error).not.toBe(TELEGRAM_CONNECT_ERROR.INVALID_BOT_KEY);
        expect(body.message).not.toMatch(/no reconoce|@BotFather|token/i);
        expect(body.message).not.toMatch(VOSEO);
        expect(JSON.stringify(controller.logger.warn.mock.calls)).toContain('ECONNRESET');
        expect(controller.telegramAdapter.setWebhook).not.toHaveBeenCalled();
        expect(controller.prisma.channelAccount.create).not.toHaveBeenCalled();
        expect(controller.prisma.whatsappCredential.create).not.toHaveBeenCalled();
    });

    it('any other failure while checking the key is not relabelled as Telegram\'s', async () => {
        const controller = buildController();
        const bug = new Error('something of ours broke');
        controller.telegramAdapter.validateBotToken.mockRejectedValue(bug);

        await expect(controller.connectTelegram({ botToken: '123:abc' }, req)).rejects.toBe(bug);
        expect(controller.prisma.channelAccount.create).not.toHaveBeenCalled();
    });

    it('a webhook Telegram refuses is `telegram_unavailable`, and Telegram\'s sentence stays in the log', async () => {
        const controller = buildController();
        controller.telegramAdapter.setWebhook.mockResolvedValue({ ok: false, description: TELEGRAM_PROSE });

        const { status, body } = await refusal(() => controller.connectTelegram({ botToken: '123:abc' }, req));

        expect(status).toBe(400);
        expect(body).toMatchObject({ error: TELEGRAM_CONNECT_ERROR.UNAVAILABLE, channel: 'telegram', retryable: true });
        expect(JSON.stringify(body)).not.toContain(TELEGRAM_PROSE);
        expect(JSON.stringify(body)).not.toMatch(/webhook/i);
        expect(JSON.stringify(controller.logger.error.mock.calls)).toContain(TELEGRAM_PROSE);
        expect(controller.prisma.channelAccount.create).not.toHaveBeenCalled();
    });

    it('a plan without Telegram keeps `channel_not_available` and says it in tú', async () => {
        const controller = buildController();
        controller.throttle.getPlanFeatures.mockResolvedValue({ channels: ['whatsapp'] });

        const { status, body } = await refusal(() => controller.connectTelegram({ botToken: '123:abc' }, req));

        expect(status).toBe(403);
        expect(body).toMatchObject({ error: 'channel_not_available', channel: 'telegram' });
        expect(body.message).toContain('Actualiza tu plan');
        expect(body.message).not.toMatch(VOSEO);
        expect(controller.telegramAdapter.validateBotToken).not.toHaveBeenCalled();
    });

    it('a key that works still connects and names the bot', async () => {
        const controller = buildController();

        const result = await controller.connectTelegram({ botToken: '123:abc' }, req);

        expect(result).toMatchObject({ success: true, data: { botUsername: 'cafe_luna_bot' } });
        expect(controller.prisma.channelAccount.create).toHaveBeenCalledTimes(1);
    });
});

describe('TelegramAdapter.validateBotToken tells a refused key from no answer', () => {
    const KEY = '123456:SECRET-KEY';
    const adapter = new TelegramAdapter({ get: () => undefined } as any);
    afterEach(() => { delete (global as any).fetch; });

    function answer(status: number, body: unknown): void {
        (global as any).fetch = jest.fn(async () => ({
            ok: status < 400,
            status,
            json: async () => {
                if (typeof body === 'string') throw new SyntaxError('Unexpected token <');
                return body;
            },
        }));
    }

    it('returns the bot when Telegram accepts the key', async () => {
        answer(200, { ok: true, result: { id: 7, username: 'cafe_luna_bot', first_name: 'Café Luna' } });
        await expect(adapter.validateBotToken(KEY)).resolves.toEqual({ id: 7, username: 'cafe_luna_bot', firstName: 'Café Luna' });
    });

    it('returns null only when Telegram answers and refuses the key', async () => {
        answer(401, { ok: false, error_code: 401, description: 'Unauthorized' });
        await expect(adapter.validateBotToken(KEY)).resolves.toBeNull();
        answer(404, { ok: false, error_code: 404, description: 'Not Found' });
        await expect(adapter.validateBotToken(KEY)).resolves.toBeNull();
    });

    it.each([
        ['the network fails', () => { (global as any).fetch = jest.fn().mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })); }],
        ['the call times out', () => { (global as any).fetch = jest.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'TimeoutError' })); }],
        ['Telegram answers 502', () => answer(502, '<html>Bad Gateway</html>')],
        ['Telegram answers 500 in JSON', () => answer(500, { ok: false, error_code: 500, description: 'Internal Server Error' })],
        ['Telegram rate-limits the call', () => answer(429, { ok: false, error_code: 429, description: 'Too Many Requests' })],
        ['a proxy answers 200 with a page', () => answer(200, '<html>captive portal</html>')],
    ])('throws TelegramUnreachableError, not null, when %s', async (_case, arrange) => {
        arrange();
        const outcome = adapter.validateBotToken(KEY);
        await expect(outcome).rejects.toBeInstanceOf(TelegramUnreachableError);
        // The key travels in the URL; it must never travel in the error.
        await expect(outcome).rejects.not.toHaveProperty('message', expect.stringContaining('SECRET-KEY'));
    });
});

describe('the Messenger plan wall keeps its code and speaks tú', () => {
    afterEach(() => { delete (global as any).fetch; });

    it('`plan_limit_reached` says "Actualiza tu plan o desconecta otra"', async () => {
        const controller = buildController();
        controller.throttle.getChannelAccountLimit.mockResolvedValue(0);
        (global as any).fetch = jest.fn(async (input: any) => {
            const url = String(input);
            const answer = url.includes('/oauth/access_token') ? { access_token: 'long-user-token' }
                : url.includes('/debug_token') ? { data: { is_valid: true, scopes: ['pages_show_list', 'pages_messaging', 'pages_manage_metadata'], app_id: 'app-id' } }
                : url.includes('/me/permissions') ? { data: ['pages_show_list', 'pages_messaging', 'pages_manage_metadata'].map((permission) => ({ permission, status: 'granted' })) }
                : url.includes('/me/accounts') ? { data: [{ id: 'page-1', name: 'Mi tienda', tasks: ['MESSAGING'], access_token: 'page-token' }] }
                : { success: true };
            return { ok: true, status: 200, json: async () => answer, text: async () => JSON.stringify(answer) };
        });

        const { status, body } = await refusal(() => controller.messengerOAuthConnect({ userAccessToken: 'tok' }, req));

        expect(status).toBe(403);
        expect(body.error).toBe(META_CONNECT_ERROR.PLAN_LIMIT);
        expect(body.message).toContain('Actualiza tu plan o desconecta otra');
        expect(body.message).not.toMatch(VOSEO);
    });
});

describe('the channel controller speaks tú in every sentence it sends', () => {
    // Comments may quote what a screen used to say; only code is sent.
    it('has no voseo left outside its comments', () => {
        const source = fs.readFileSync(path.join(__dirname, 'channel-management.controller.ts'), 'utf8');
        expect('Actualizá tu plan para conectarlo').toMatch(VOSEO);
        expect('Actualiza tu plan, revisa, conecta, prueba, abre').not.toMatch(VOSEO);
        const offences = source.split(/\r?\n/)
            .map((line, index) => ({ line: line.trim(), index: index + 1 }))
            .filter(({ line }) => !/^(?:\/\/|\/?\*)/.test(line))
            .filter(({ line }) => VOSEO.test(line))
            .map(({ line, index }) => `${index}: ${line.slice(0, 120)}`);
        expect(offences).toEqual([]);
    });
});
