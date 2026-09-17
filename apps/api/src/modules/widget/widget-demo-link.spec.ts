import { WidgetGateway } from './widget.gateway';
import { WidgetRateLimitService } from './widget-rate-limit.service';
import { isWidgetOriginAllowed, platformWidgetHostnames } from './widget-security';
import { demoAllowanceExhaustedText, demoDailyCapText, demoLinkPath, ensureDemoWidget, widgetRateLimitedText } from './widget-demo-link';

/**
 * D11/D19 (sep-2026): "El enlace de {Nombre}" is a public page on top of the
 * web chat widget, born at day 0 with is_demo = true, paid by the platform
 * up to a cap, capped per calendar day, never a connected channel and never
 * an activation.
 */
const TENANT = '11111111-1111-4111-8111-111111111111';

describe('the demo link is provisioned once and never breaks its caller', () => {
    function prisma(rows: Record<string, any[]> = {}) {
        const calls: Array<[string, any[]]> = [];
        return {
            calls,
            $queryRawUnsafe: jest.fn(async (sql: string, ...params: any[]) => {
                calls.push([sql, params]);
                if (sql.includes('FROM public.widget_configs') && sql.includes('is_demo = true') && sql.startsWith('SELECT')) return rows.existing ?? [];
                if (sql.includes('FROM public.tenants')) return rows.tenant ?? [{ language: 'es', schema_name: 'tenant_demo' }];
                if (sql.includes('agent_personas')) return rows.agents ?? [{ name: 'Valentina' }];
                if (sql.startsWith('INSERT INTO public.widget_configs')) return rows.inserted ?? [{ widget_id: params[1], agent_name: params[3] }];
                return [];
            }),
        };
    }
    it('reuses the existing demo widget', async () => {
        const db = prisma({ existing: [{ widget_id: 'wgt_existing0001', agent_name: 'Valentina' }] });
        const link = await ensureDemoWidget(db as any, TENANT);
        expect(link).toEqual({ widgetId: 'wgt_existing0001', path: '/w/wgt_existing0001', agentName: 'Valentina' });
        expect(db.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
    });
    it('follows the agent when the owner renames it, and drops the cached config', async () => {
        // The link is born before the owner names the agent; the page, the chat
        // header and the share text must not keep saying "Asistente".
        const db = prisma({ existing: [{ widget_id: 'wgt_existing0001', agent_name: 'Asistente', locale: 'es' }] });
        const redis = { del: jest.fn().mockResolvedValue(1) };
        const link = await ensureDemoWidget(db as any, TENANT, { agentName: ' Valentina ', redis });
        expect(link).toEqual({ widgetId: 'wgt_existing0001', path: '/w/wgt_existing0001', agentName: 'Valentina' });
        const update = db.calls.find(([sql]) => sql.startsWith('UPDATE public.widget_configs'))!;
        expect(update[1]).toEqual(['wgt_existing0001', 'Valentina', 'El enlace de Valentina']);
        expect(redis.del).toHaveBeenCalledWith('widget:config:wgt_existing0001');
    });
    it('does not rewrite the row when the name already matches or none is known', async () => {
        const db = prisma({ existing: [{ widget_id: 'wgt_existing0001', agent_name: 'Valentina', locale: 'es' }] });
        await ensureDemoWidget(db as any, TENANT, { agentName: 'Valentina' });
        await ensureDemoWidget(db as any, TENANT);
        expect(db.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
    });
    it('creates it from the default agent name and the tenant language, guarded against a race', async () => {
        const db = prisma();
        const link = await ensureDemoWidget(db as any, TENANT, { locale: 'en' });
        expect(link?.widgetId).toMatch(/^wgt_[a-f0-9]{12}$/);
        expect(link?.path).toBe(demoLinkPath(link!.widgetId));
        expect(link?.agentName).toBe('Valentina');
        const insert = db.calls.find(([sql]) => sql.startsWith('INSERT INTO public.widget_configs'))!;
        expect(insert[0]).toContain('WHERE NOT EXISTS');
        expect(insert[0]).toContain('is_demo = true');
        expect(insert[1].slice(2, 4)).toEqual(['The link of Valentina', 'Valentina']);
        expect(insert[1][5]).toBe('en');
    });
    it('reads the winner when the insert lost the race', async () => {
        const db = prisma({ inserted: [] });
        db.$queryRawUnsafe.mockImplementationOnce(async () => []) // first existence check: nothing
            .mockImplementationOnce(async () => [{ language: 'es', schema_name: 'tenant_demo' }])
            .mockImplementationOnce(async () => [{ name: 'Valentina' }])
            .mockImplementationOnce(async () => [])
            .mockImplementationOnce(async () => [{ widget_id: 'wgt_theother0001', agent_name: 'Valentina' }]);
        const link = await ensureDemoWidget(db as any, TENANT);
        expect(link?.widgetId).toBe('wgt_theother0001');
    });
    it('treats the unique index violation as somebody else already created it', async () => {
        const db = prisma();
        db.$queryRawUnsafe.mockImplementationOnce(async () => [])
            .mockImplementationOnce(async () => [{ language: 'es', schema_name: 'tenant_demo' }])
            .mockImplementationOnce(async () => [{ name: 'Valentina' }])
            .mockImplementationOnce(async () => { throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }); })
            .mockImplementationOnce(async () => [{ widget_id: 'wgt_winner000001', agent_name: 'Valentina' }]);
        await expect(ensureDemoWidget(db as any, TENANT)).resolves.toMatchObject({ widgetId: 'wgt_winner000001' });
    });
    it('returns null instead of throwing when the database is unavailable', async () => {
        const db = { $queryRawUnsafe: jest.fn().mockRejectedValue(new Error('down')) };
        await expect(ensureDemoWidget(db as any, TENANT)).resolves.toBeNull();
    });
    it('returns null when the query harness answers with an unexpected shape', async () => {
        const db = { $queryRawUnsafe: jest.fn(async () => [{ c: 1 }]) };
        await expect(ensureDemoWidget(db as any, TENANT)).resolves.toBeNull();
    });
});

describe('the platform host is always an allowed origin', () => {
    const previous = { DASHBOARD_URL: process.env.DASHBOARD_URL, NEXT_PUBLIC_DASHBOARD_URL: process.env.NEXT_PUBLIC_DASHBOARD_URL };
    afterEach(() => {
        process.env.DASHBOARD_URL = previous.DASHBOARD_URL;
        process.env.NEXT_PUBLIC_DASHBOARD_URL = previous.NEXT_PUBLIC_DASHBOARD_URL;
        if (previous.DASHBOARD_URL === undefined) delete process.env.DASHBOARD_URL;
        if (previous.NEXT_PUBLIC_DASHBOARD_URL === undefined) delete process.env.NEXT_PUBLIC_DASHBOARD_URL;
    });
    const hosted = { platformHosted: true };
    it('admits the production dashboard and the configured host for the public link', () => {
        process.env.DASHBOARD_URL = 'https://panel.example.test';
        expect(platformWidgetHostnames()).toEqual(expect.arrayContaining(['admin.parallly-chat.cloud', 'panel.example.test']));
        expect(isWidgetOriginAllowed('https://admin.parallly-chat.cloud', ['shop.example.com'], hosted)).toBe(true);
        expect(isWidgetOriginAllowed('https://panel.example.test', ['shop.example.com'], hosted)).toBe(true);
    });
    it('never widens a tenant own widget: only the public link is platform-hosted', () => {
        // Otherwise a site widget restricted to shop.example.com becomes a page
        // anyone can open, or iframe, from the platform's own origin.
        expect(isWidgetOriginAllowed('https://admin.parallly-chat.cloud', ['shop.example.com'])).toBe(false);
        expect(isWidgetOriginAllowed('https://admin.parallly-chat.cloud', ['shop.example.com'], { platformHosted: false })).toBe(false);
        expect(isWidgetOriginAllowed('https://shop.example.com', ['shop.example.com'])).toBe(true);
    });
    it('keeps localhost out of the production allowance', () => {
        const previousEnv = process.env.NODE_ENV;
        try {
            (process.env as any).NODE_ENV = 'production';
            expect(platformWidgetHostnames()).not.toContain('localhost');
            expect(isWidgetOriginAllowed('http://localhost:3001', ['shop.example.com'], hosted)).toBe(false);
            (process.env as any).NODE_ENV = 'development';
            expect(isWidgetOriginAllowed('http://localhost:3001', ['shop.example.com'], hosted)).toBe(true);
        } finally { (process.env as any).NODE_ENV = previousEnv; }
    });
    it('does not widen the allowlist for anyone else, and still rejects a missing Origin', () => {
        expect(isWidgetOriginAllowed('https://admin.parallly-chat.cloud.evil.test', ['shop.example.com'], hosted)).toBe(false);
        expect(isWidgetOriginAllowed('https://other.example.com', ['shop.example.com'], hosted)).toBe(false);
        expect(isWidgetOriginAllowed(undefined, [], hosted)).toBe(false);
        expect(isWidgetOriginAllowed('null', [], hosted)).toBe(false);
    });
});

describe('the demo page has a cap per calendar day', () => {
    it('counts on a key that embeds the UTC date and blocks above the limit', async () => {
        const counts = new Map<string, number>();
        const redis = { incrementRateLimit: jest.fn(async (key: string) => { counts.set(key, (counts.get(key) ?? 0) + 1); return counts.get(key)!; }) };
        const service = new WidgetRateLimitService(redis as any);
        const now = new Date('2026-09-17T23:59:00.000Z');
        for (let i = 0; i < 2; i++) expect((await service.consumeDemoDaily({ widgetId: 'wgt_abc', limit: 2, now })).allowed).toBe(true);
        const blocked = await service.consumeDemoDaily({ widgetId: 'wgt_abc', limit: 2, now });
        expect(blocked).toMatchObject({ allowed: false, blockedScope: 'widget_day', retryAfterSeconds: 86400 });
        expect([...counts.keys()]).toEqual(['widget:rl:demo:day:20260917:wgt_abc']);
        // A new day is a new counter.
        expect((await service.consumeDemoDaily({ widgetId: 'wgt_abc', limit: 2, now: new Date('2026-09-18T00:00:01.000Z') })).allowed).toBe(true);
        expect(redis.incrementRateLimit).toHaveBeenLastCalledWith('widget:rl:demo:day:20260918:wgt_abc', 86400);
    });
});

describe('the gateway keeps a capped demo visitor connected and out of the human inbox', () => {
    function socket(): any {
        return {
            handshake: { auth: { token: 'token-1' }, query: {}, headers: { origin: 'https://admin.parallly-chat.cloud' }, address: '203.0.113.10' },
            emit: jest.fn(), disconnect: jest.fn(), join: jest.fn(), use: jest.fn(), widgetToken: 'token-1',
        };
    }
    function makeGateway(allowance: any = { enabled: true, messagesPerTenant: 200, dailyCapPerPage: 60 }) {
        const session = { id: 'session-1', tenant_id: 'tenant-1', widget_id: 'wgt_demo', visitor_id: 'visitor-1', allowed_domains: [], is_demo: true, widget_locale: 'es' };
        const widgetService = { getSessionByToken: jest.fn().mockResolvedValue(session) };
        const prisma = {
            tenant: { findUnique: jest.fn().mockResolvedValue({
                id: 'tenant-1', schemaName: 'tenant_1', isActive: true, onboardingCompletedAt: new Date(), subscriptionStatus: 'trialing',
                subscription: { status: 'trialing', trialEndsAt: new Date(Date.now() + 86_400_000), cancelAtPeriodEnd: false, currentPeriodEnd: null, cancellationReason: null, dunningStartedAt: null },
            }) },
            executeInTenantSchema: jest.fn(), getTenantSchemaName: jest.fn().mockResolvedValue('tenant_1'),
        };
        const redis = { get: jest.fn().mockResolvedValue(null), acquireLock: jest.fn().mockResolvedValue(true), releaseLock: jest.fn().mockResolvedValue(undefined) };
        const conversations = { processWidgetMessage: jest.fn().mockResolvedValue(null), streamWidgetMessage: jest.fn() };
        const messages = { receive: jest.fn().mockResolvedValue({ session: { ...session, conversation_id: 'c1', contact_id: 'k1' }, messageId: '44444444-4444-4444-8444-444444444444' }) };
        const rateLimit = {
            consumeMessage: jest.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }),
            consumeDemoDaily: jest.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }),
        };
        const demoAllowance = { get: jest.fn().mockResolvedValue(allowance) };
        const gateway = new WidgetGateway(widgetService as any, prisma as any, redis as any, conversations as any, rateLimit as any, messages as any, undefined, demoAllowance as any);
        (gateway as any).resolveCurrentCapabilities = () => ({ formalChannel: true, capabilities: ['human_handoff'] });
        return { gateway, rateLimit, conversations, messages, demoAllowance };
    }
    it('applies the daily cap after the abuse ceilings and answers in the widget language without disconnecting', async () => {
        const { gateway, rateLimit, conversations, messages } = makeGateway();
        rateLimit.consumeDemoDaily.mockResolvedValue({ allowed: false, blockedScope: 'widget_day', retryAfterSeconds: 86400 });
        const client = socket();
        await gateway.handleMessage(client, { content: 'hola' } as any);
        expect(rateLimit.consumeDemoDaily).toHaveBeenCalledWith({ widgetId: 'wgt_demo', limit: 60 });
        expect(client.emit).toHaveBeenCalledWith('widget:error', expect.objectContaining({ code: 'demo_daily_cap', message: demoDailyCapText('es') }));
        expect(client.disconnect).not.toHaveBeenCalled();
        expect(messages.receive).not.toHaveBeenCalled();
        expect(conversations.processWidgetMessage).not.toHaveBeenCalled();
    });
    it('marks the turn as demo and forbids human handoff', async () => {
        const { gateway, conversations } = makeGateway();
        await gateway.handleMessage(socket(), { content: 'hola' } as any);
        expect(conversations.processWidgetMessage).toHaveBeenCalledWith(
            'tenant-1', 'tenant_1', 'c1', 'k1', 'hola',
            expect.objectContaining({ demo: true, allowHumanHandoff: false, channelAccountId: 'wgt_demo' }),
        );
    });
    it('says the abuse ceiling in the widget language instead of English', async () => {
        const { gateway, rateLimit } = makeGateway();
        rateLimit.consumeMessage.mockResolvedValue({ allowed: false, blockedScope: 'ip', retryAfterSeconds: 3600 });
        const client = socket();
        await gateway.handleMessage(client, { content: 'hola' } as any);
        expect(client.emit).toHaveBeenCalledWith('widget:error', expect.objectContaining({
            code: 'rate_limited', message: widgetRateLimitedText('es'), retryAfterSeconds: 3600,
        }));
        expect(client.emit).not.toHaveBeenCalledWith('widget:error', expect.objectContaining({ message: 'Rate limit exceeded' }));
    });
    it('has a message for every widget language', () => {
        for (const locale of ['es', 'en', 'pt', 'fr']) {
            expect(demoDailyCapText(locale)).toBeTruthy();
            expect(demoAllowanceExhaustedText(locale)).toBeTruthy();
            expect(widgetRateLimitedText(locale)).toBeTruthy();
        }
        expect(demoDailyCapText('xx')).toBe(demoDailyCapText('es'));
        expect(widgetRateLimitedText(null)).toBe(widgetRateLimitedText('es'));
        expect(new Set(['es', 'en', 'pt', 'fr'].map(widgetRateLimitedText)).size).toBe(4);
    });
});
