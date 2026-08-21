import { TenantSecretCryptoService } from '../../common/crypto/tenant-secret-crypto.service';
import { VerticalIntegrationsService } from './vertical-integrations.service';
import {
    RESERVED_TENANT_SETTING_KEYS,
    redactReservedTenantSettings,
} from '../../common/utils/tenant-settings.util';
import { fakeSettingsWriter } from '../../common/utils/tenant-settings-branch.fixture';

/**
 * Las credenciales de proveedor estaban EN CLARO en `tenant.settings`.
 *
 * El endpoint dedicado las tapaba con `***`, así que en pantalla parecían
 * protegidas; el JSONB las tenía enteras y `GET /tenants/:id` devolvía el JSONB
 * completo. Un backup, un volcado de la base o un super_admin leyendo un tenant
 * se llevaba la clave de Toast y la de Cliniko.
 *
 * Se cierran las dos mitades: cifrado en reposo con un sobre atado al tenant,
 * proveedor y campo, y la clave fuera del contrato genérico del tenant. Cifrar
 * sin lo segundo no serviría: una respuesta que devuelve el sobre entero sólo
 * mueve el problema un paso.
 */

const tenantId = '11111111-1111-4111-8111-111111111111';

function buildService(storedSettings: Record<string, any> = {}) {
    process.env.TENANT_SECRET_KEY = 'a'.repeat(64);
    let settings: Record<string, any> = storedSettings;
    const prisma: any = {
        tenant: {
            findUnique: jest.fn(async () => ({ settings })),
            update: jest.fn(async ({ data }: any) => {
                settings = data.settings;
                return { settings };
            }),
        },
    };
    // Las escrituras pasaron a `jsonb_set` sobre la fila viva. El doble aplica
    // esa semántica en vez de asignar el objeto entero: si asignara, la prueba
    // estaría verificando el patrón que se acaba de sacar.
    prisma.$executeRawUnsafe = fakeSettingsWriter(() => settings, (next) => { settings = next; });
    const service = new VerticalIntegrationsService(
        prisma as any,
        { del: jest.fn(), keys: jest.fn().mockResolvedValue([]) } as any,
        { axiosRef: { get: jest.fn(), post: jest.fn() } } as any,
        { runExclusive: jest.fn() } as any,
        { get: jest.fn().mockReturnValue('') } as any,
        new TenantSecretCryptoService(),
    );
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn(service as any, 'invalidateHealthCache').mockResolvedValue(undefined);
    return { service, prisma, readSettings: () => settings };
}

describe('las credenciales de integración no se guardan en claro', () => {
    it('el apiKey de Cliniko no aparece en lo persistido', async () => {
        const { service, readSettings } = buildService();

        await service.updateConfig(tenantId, 'cliniko', {
            provider: 'cliniko',
            apiKey: 'MS0xNjk5-clave-real',
            baseUrl: 'https://api.au1.cliniko.com/v1',
        } as any);

        const persisted = readSettings().verticalIntegrations.cliniko;
        expect(JSON.stringify(persisted)).not.toContain('MS0xNjk5-clave-real');
        expect(String(persisted.apiKey).startsWith('tsc:v1:')).toBe(true);
        // Y lo que NO es un secreto sigue legible: cifrar un identificador sólo
        // agrega descifrados que pueden fallar.
        expect(persisted.baseUrl).toBe('https://api.au1.cliniko.com/v1');
    });

    it('el config interno vuelve descifrado, listo para llamar al proveedor', async () => {
        const { service } = buildService();
        await service.updateConfig(tenantId, 'cliniko', {
            provider: 'cliniko',
            apiKey: 'MS0xNjk5-clave-real',
            baseUrl: 'https://api.au1.cliniko.com/v1',
        } as any);

        const config = await service.getConfig(tenantId, 'cliniko');
        expect(config.apiKey).toBe('MS0xNjk5-clave-real');
    });

    it('el panel nunca ve la credencial, ni cifrada', async () => {
        const { service } = buildService();
        await service.updateConfig(tenantId, 'cliniko', {
            provider: 'cliniko',
            apiKey: 'MS0xNjk5-clave-real',
            baseUrl: 'https://api.au1.cliniko.com/v1',
        } as any);

        const shown = await service.getAllConfigs(tenantId);
        expect(shown.cliniko.apiKey).toBe('***');
        expect(JSON.stringify(shown)).not.toContain('MS0xNjk5-clave-real');
    });

    it('guardar con `***` conserva la credencial y no la re-cifra dos veces', async () => {
        const { service, readSettings } = buildService();
        await service.updateConfig(tenantId, 'cliniko', {
            provider: 'cliniko', apiKey: 'clave-original',
            baseUrl: 'https://api.au1.cliniko.com/v1',
        } as any);
        const firstEnvelope = readSettings().verticalIntegrations.cliniko.apiKey;

        // El panel manda `***` cuando el usuario no tocó el campo.
        await service.updateConfig(tenantId, 'cliniko', {
            provider: 'cliniko', apiKey: '***',
            baseUrl: 'https://api.au1.cliniko.com/v1',
        } as any);

        expect(readSettings().verticalIntegrations.cliniko.apiKey).toBe(firstEnvelope);
        expect((await service.getConfig(tenantId, 'cliniko')).apiKey).toBe('clave-original');
    });

    it('lo que ya estaba en claro se sigue leyendo y se re-guarda cifrado', async () => {
        // Sin esto, cifrar habría roto a todo tenant ya integrado.
        const { service, readSettings } = buildService({
            verticalIntegrations: {
                cliniko: {
                    provider: 'cliniko', apiKey: 'clave-vieja-en-claro',
                    baseUrl: 'https://api.au1.cliniko.com/v1',
                },
            },
        });

        const config = await service.getConfig(tenantId, 'cliniko');
        expect(config.apiKey).toBe('clave-vieja-en-claro');

        // La reescritura va por fuera del camino crítico: se espera un tick.
        await new Promise((resolve) => setImmediate(resolve));
        expect(String(readSettings().verticalIntegrations.cliniko.apiKey).startsWith('tsc:v1:'))
            .toBe(true);
    });

    it('un secreto ilegible se omite: no se degrada a texto plano', async () => {
        const { service } = buildService({
            verticalIntegrations: {
                cliniko: { provider: 'cliniko', apiKey: 'tsc:v1:primary:AAAA:BBBB:CCCC' },
            },
        });

        const config = await service.getConfig(tenantId, 'cliniko');
        // Usar el ciphertext como credencial haría que el error dijera "el
        // proveedor rechazó la clave" en vez de "el sobre está roto".
        expect(config.apiKey).toBeUndefined();
    });

    it('cifra el secreto de cada proveedor, y sólo el secreto', async () => {
        const { service, readSettings } = buildService();

        await service.updateConfig(tenantId, 'mindbody', {
            provider: 'mindbody', apiKey: 'mb-secreto', siteId: '-99',
        } as any);

        const mindbody = readSettings().verticalIntegrations.mindbody;
        expect(String(mindbody.apiKey).startsWith('tsc:v1:')).toBe(true);
        // `siteId` es un identificador público del sitio, no una credencial.
        expect(mindbody.siteId).toBe('-99');
    });
});

describe('la credencial tampoco sale por el contrato genérico del tenant', () => {
    it('`verticalIntegrations` y `channelManager` son claves reservadas', () => {
        expect(RESERVED_TENANT_SETTING_KEYS).toEqual(
            expect.arrayContaining(['tenantPayments', 'channelManager', 'verticalIntegrations']),
        );
    });

    it('no viajan en la respuesta del tenant', () => {
        const safe = redactReservedTenantSettings({
            timezone: 'America/Bogota',
            channelManager: { provider: 'hostaway', apiSecret: 'tsc:v1:primary:x:y:z' },
            verticalIntegrations: { toast: { clientSecret: 'tsc:v1:primary:x:y:z' } },
        }) as Record<string, unknown>;

        expect(safe.channelManager).toBeUndefined();
        expect(safe.verticalIntegrations).toBeUndefined();
        // Y lo que no es secreto sigue viajando: la redacción es quirúrgica.
        expect(safe.timezone).toBe('America/Bogota');
    });
});
