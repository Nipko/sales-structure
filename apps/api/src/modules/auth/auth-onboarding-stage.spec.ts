import * as fs from 'fs';
import * as path from 'path';
import { AuthService } from './auth.service';

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
            : { settings: input.settings ?? {}, schemaName: 'tenant_norte' };

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
            }
        });
    });
});
