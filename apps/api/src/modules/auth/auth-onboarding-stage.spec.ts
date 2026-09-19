import * as fs from 'fs';
import * as path from 'path';
import { isOnboardingBeforeLive } from '@parallext/shared';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

/**
 * Dónde aterriza un login.
 *
 * El panel decide con `user.onboardingStage`. Cuando la API no lo mandaba, el
 * panel derivaba `account_created` y mandaba a TODO tenant_admin al asistente
 * de configuración en cada entrada — incluido un tenant de dos años con
 * WhatsApp conectado. Estas pruebas fijan las dos mitades del arreglo: que la
 * etapa se derive de la realidad del tenant, y que viaje en todos los payloads
 * de sesión.
 */
const CREATED_AT = new Date('2026-09-14T13:00:00.000Z');

describe('AuthService onboarding stage', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';

    function makeService(input: {
        settings?: Record<string, unknown>;
        channels?: number;
        agents?: number;
        tenant?: any;
        failChannels?: boolean;
    } = {}) {
        const tenant = input.tenant !== undefined
            ? input.tenant
            : { settings: input.settings ?? {}, schemaName: 'tenant_norte', createdAt: CREATED_AT };

        const prisma: any = {
            tenant: { findUnique: jest.fn().mockResolvedValue(tenant) },
            $queryRawUnsafe: jest.fn(async (sql: string) => {
                if (sql.includes('channel_accounts')) {
                    if (input.failChannels) throw new Error('connection terminated');
                    return [{ c: input.channels ?? 0 }];
                }
                return [{ c: input.agents ?? 0 }];
            }),
        };

        const service = new AuthService(
            prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
            {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
        );
        return { service, prisma };
    }

    it('un tenant viejo con canal conectado NO vuelve al asistente', async () => {
        // Sin `onboardingStage` guardado (es anterior al campo) pero con
        // WhatsApp en vivo: la etapa se reconstruye desde la realidad.
        const { service } = makeService({ settings: {}, channels: 1, agents: 1 });

        await expect(service.resolveOnboardingStageForTenant(tenantId)).resolves.toBe('channel_connected');
    });

    it('un `account_created` viejo pierde contra el canal que ya existe', async () => {
        const { service } = makeService({
            settings: { onboardingStage: 'account_created' },
            channels: 2,
            agents: 1,
        });

        await expect(service.resolveOnboardingStageForTenant(tenantId)).resolves.toBe('channel_connected');
    });

    it('una cuenta recién creada sigue siendo account_created', async () => {
        const { service } = makeService({ settings: {}, channels: 0, agents: 0 });

        await expect(service.resolveOnboardingStageForTenant(tenantId)).resolves.toBe('account_created');
    });

    it('sin tenant no inventa etapa (el usuario sin tenant no va al asistente)', async () => {
        const { service, prisma } = makeService();

        await expect(service.resolveOnboardingStageForTenant(undefined)).resolves.toBeUndefined();
        expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    });

    it('un fallo de base devuelve `undefined`, nunca rompe el login', async () => {
        const { service } = makeService({ settings: {}, failChannels: true });

        await expect(service.resolveOnboardingStageForTenant(tenantId)).resolves.toBeUndefined();
    });

    it('un tenant inexistente devuelve `undefined`', async () => {
        const { service } = makeService({ tenant: null });

        await expect(service.resolveOnboardingStageForTenant(tenantId)).resolves.toBeUndefined();
    });

    /**
     * La activación viaja con la etapa (slice A, sep-2026).
     *
     * La etapa sola ya no alcanza: es monótona y `completed` le gana a `live`,
     * así que el último botón del asistente dejaba `live` inescribible y
     * levantaba el silencio del día 0 antes de que el agente le respondiera a
     * nadie. El panel decide con `isOnboardingBeforeLive(stage, { firstReplyAt,
     * createdAt })`, y los dos hechos salen de la MISMA fila que la etapa.
     */
    describe('la primera respuesta y el alta', () => {
        it('lee la hora de la primera respuesta y el alta de la misma fila', async () => {
            const { service, prisma } = makeService({
                settings: { onboardingStage: 'completed', firstReplyAt: '2026-09-14T15:04:05.000Z' },
                channels: 1, agents: 1,
            });

            await expect(service.resolveOnboardingFactsForTenant(tenantId)).resolves.toEqual({
                onboardingStage: 'completed',
                firstReplyAt: '2026-09-14T15:04:05.000Z',
                tenantCreatedAt: CREATED_AT.toISOString(),
                hasAnyChannel: true,
            });
            expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(1);
            expect(prisma.tenant.findUnique.mock.calls[0][0].select).toMatchObject({ settings: true, createdAt: true });
        });

        it('una fila leída sin primera respuesta dice `null`, no "no sé"', async () => {
            const { service } = makeService({ settings: { onboardingStage: 'completed' }, channels: 1, agents: 1 });
            const facts = await service.resolveOnboardingFactsForTenant(tenantId);
            expect(facts.firstReplyAt).toBeNull();
            expect(facts.tenantCreatedAt).toBe(CREATED_AT.toISOString());
        });

        it('un valor que no es una fecha no activa a nadie', async () => {
            const { service } = makeService({ settings: { onboardingStage: 'completed', firstReplyAt: 'pronto' } });
            await expect(service.resolveOnboardingFactsForTenant(tenantId))
                .resolves.toMatchObject({ firstReplyAt: null });
        });

        it('sin tenant, sin fila o con la base caída no inventa nada', async () => {
            const unknown = { onboardingStage: undefined, firstReplyAt: undefined, tenantCreatedAt: undefined, hasAnyChannel: undefined };
            await expect(makeService().service.resolveOnboardingFactsForTenant(undefined)).resolves.toEqual(unknown);
            await expect(makeService({ tenant: null }).service.resolveOnboardingFactsForTenant(tenantId))
                .resolves.toEqual(unknown);
            await expect(makeService({ settings: {}, failChannels: true }).service.resolveOnboardingFactsForTenant(tenantId))
                .resolves.toEqual(unknown);
        });

        it('es exactamente lo que el panel necesita: `completed` sin respuesta sigue en día 0, con respuesta ya no', async () => {
            const now = CREATED_AT.getTime() + 60 * 60 * 1000;
            const waiting = await makeService({ settings: { onboardingStage: 'completed' }, channels: 1, agents: 1 })
                .service.resolveOnboardingFactsForTenant(tenantId);
            expect(isOnboardingBeforeLive(waiting.onboardingStage,
                { firstReplyAt: waiting.firstReplyAt, createdAt: waiting.tenantCreatedAt, now })).toBe(true);

            const answered = await makeService({
                settings: { onboardingStage: 'completed', firstReplyAt: '2026-09-14T13:30:00.000Z' }, channels: 1, agents: 1,
            }).service.resolveOnboardingFactsForTenant(tenantId);
            expect(isOnboardingBeforeLive(answered.onboardingStage,
                { firstReplyAt: answered.firstReplyAt, createdAt: answered.tenantCreatedAt, now })).toBe(false);
        });

        it('una cuenta vieja sin etapa guardada no vuelve al día 0: el alta la saca', async () => {
            // Sin `tenantCreatedAt` el contrato no puede cerrar el día 0 de una
            // cuenta que nunca responde; por eso viaja SIEMPRE con la etapa.
            const facts = await makeService({ settings: {}, channels: 1, agents: 1, tenant: {
                settings: {}, schemaName: 'tenant_norte', createdAt: new Date('2025-01-10T10:00:00.000Z') } })
                .service.resolveOnboardingFactsForTenant(tenantId);
            expect(facts.onboardingStage).toBe('channel_connected');
            expect(isOnboardingBeforeLive(facts.onboardingStage,
                { firstReplyAt: facts.firstReplyAt, createdAt: facts.tenantCreatedAt })).toBe(false);
        });

        it('/auth/me los devuelve junto a la etapa', async () => {
            const controller: any = Object.create(AuthController.prototype);
            controller.authService = {
                resolveOnboardingFactsForTenant: jest.fn().mockResolvedValue({
                    onboardingStage: 'completed', firstReplyAt: null, tenantCreatedAt: CREATED_AT.toISOString(),
                    hasAnyChannel: true,
                }),
            };
            const answer = await controller.me({ id: 'u1', tenantId });
            expect(controller.authService.resolveOnboardingFactsForTenant).toHaveBeenCalledWith(tenantId);
            expect(answer).toEqual({ success: true, data: {
                id: 'u1', tenantId, onboardingStage: 'completed', firstReplyAt: null,
                tenantCreatedAt: CREATED_AT.toISOString(), hasAnyChannel: true,
            } });
        });
    });

    /**
     * El canal que existe, dicho por la API (Ola 6).
     *
     * El panel tenía que adivinar que había un canal a partir de la señal de
     * aterrizaje de Inicio. `hasAnyChannel` es el MISMO hecho con el que se
     * deriva la etapa, así que los dos no pueden contradecirse.
     */
    describe('hasAnyChannel', () => {
        it('true con una conexión activa, false sin ninguna', async () => {
            const connected = await makeService({ settings: { onboardingStage: 'completed' }, channels: 1, agents: 1 })
                .service.resolveOnboardingFactsForTenant(tenantId);
            expect(connected.hasAnyChannel).toBe(true);

            const none = await makeService({ settings: { onboardingStage: 'agent_reviewed' }, channels: 0, agents: 1 })
                .service.resolveOnboardingFactsForTenant(tenantId);
            expect(none.hasAnyChannel).toBe(false);
        });

        it('sale de la misma lectura que la etapa: nunca dicen cosas distintas', async () => {
            const { service, prisma } = makeService({ settings: { onboardingStage: 'account_created' }, channels: 2, agents: 1 });
            const facts = await service.resolveOnboardingFactsForTenant(tenantId);
            // La etapa subió a `channel_connected` por el mismo conteo.
            expect(facts).toMatchObject({ onboardingStage: 'channel_connected', hasAnyChannel: true });
            const channelReads = prisma.$queryRawUnsafe.mock.calls
                .filter(([sql]: [string]) => sql.includes('channel_accounts'));
            expect(channelReads).toHaveLength(1);
        });

        it('una lectura caída es `undefined`, no "sin canal"', async () => {
            const facts = await makeService({ settings: {}, failChannels: true }).service.resolveOnboardingFactsForTenant(tenantId);
            expect(facts.hasAnyChannel).toBeUndefined();
        });
    });

    /**
     * Contrato estático: la etapa viaja en TODOS los payloads de sesión.
     *
     * Es lo que un cambio futuro reintroduce sin querer — se agrega un camino
     * de login nuevo (SSO, un proveedor más) copiando el payload de al lado, y
     * si ese payload no la lleva el panel vuelve a mandar a todos al asistente.
     */
    describe('contrato de los payloads de sesión', () => {
        const source = fs.readFileSync(path.join(__dirname, 'auth.service.ts'), 'utf8');

        it('cada payload de usuario que informa onboardingCompleted informa la etapa', () => {
            const lines = source.split('\n');
            const offenders: number[] = [];
            lines.forEach((line, index) => {
                if (!line.includes('onboardingCompleted: effectiveOnboarding')) return;
                const window = lines.slice(index, index + 8).join('\n');
                if (!window.includes('onboardingStage')) offenders.push(index + 1);
            });

            expect({ offenders }).toEqual({ offenders: [] });
        });

        it('la renovación de token también la devuelve', () => {
            const refresh = source.slice(source.indexOf('async refreshToken('), source.indexOf('async logout('));
            const returns = refresh.match(/return \{ accessToken[^}]*\}/g) || [];

            expect(returns.length).toBeGreaterThan(0);
            for (const statement of returns) {
                expect(statement).toContain('onboardingStage');
                expect(statement).toContain('firstReplyAt');
                expect(statement).toContain('tenantCreatedAt');
                expect(statement).toContain('hasAnyChannel');
            }
        });

        it('cada payload que lleva la etapa lleva también la primera respuesta y el alta', () => {
            // Un camino de login nuevo copiado del de al lado sin estos dos
            // campos haría que el panel no pudiera cerrar el día 0 de nadie.
            // Un payload de usuario es la línea `onboardingStage` que sigue a un
            // `onboardingCompleted:`; la semilla de `settings` del alta no lo es.
            const lines = source.split('\n');
            const sites: number[] = [];
            const offenders: number[] = [];
            lines.forEach((line, index) => {
                if (!/^\s*onboardingStage(,|:)/.test(line)) return;
                if (!lines.slice(Math.max(0, index - 6), index).some(prev => /^\s*onboardingCompleted:/.test(prev))) return;
                sites.push(index + 1);
                const window = lines.slice(index, index + 8).join('\n');
                if (!window.includes('firstReplyAt') || !window.includes('tenantCreatedAt')
                    || !window.includes('hasAnyChannel')) offenders.push(index + 1);
            });

            expect({ offenders }).toEqual({ offenders: [] });
            // login, Google, Microsoft, 2FA, alta reintentada, alta nueva, impersonación.
            expect(sites.length).toBeGreaterThanOrEqual(7);
        });
    });
});
