import { ChannelManagerService } from './channel-manager.service';
import { TenantSecretCryptoService } from '../../common/crypto/tenant-secret-crypto.service';
import { fakeSettingsWriter } from '../../common/utils/tenant-settings-branch.fixture';

/**
 * ═══ GUARDAR LA CONFIGURACIÓN DESTRUÍA LA CREDENCIAL DE DOS FORMAS ═══
 *
 * El panel enmascara los secretos con `***` y devuelve eso al guardar. Las
 * integraciones verticales lo reconocían; el channel manager **no**, así que
 * cambiar el intervalo de sincronización desde la pantalla cifraba los tres
 * asteriscos y los guardaba como clave de API. La integración quedaba rota, sin
 * error, con una credencial que era literalmente `***`.
 *
 * Y cambiar de proveedor arrastraba el secreto del anterior. El sobre ata el
 * valor a su proveedor por AAD —una clave de Hostaway no se descifra como si
 * fuera de Guesty—, así que el sobre viejo sobrevivía intacto (`isEnvelope` →
 * no se re-cifra), la config decía `guesty`, y a partir de ahí CADA lectura
 * tiraba `tenant_secret_decryption_failed`. La integración quedaba tapiada sin
 * decir por qué, y con las reservas del alojamiento bloqueadas de rebote.
 */

const tenantId = '11111111-1111-4111-8111-111111111111';

function buildService(stored: Record<string, any> = {}) {
    process.env.TENANT_SECRET_KEY = 'c'.repeat(64);
    delete process.env.TENANT_SECRET_PLAINTEXT;
    let settings: Record<string, any> = stored;
    const prisma: any = {
        tenant: {
            findUnique: jest.fn(async () => ({ settings })),
            update: jest.fn(),
        },
    };
    prisma.$executeRawUnsafe = fakeSettingsWriter(() => settings, (n) => { settings = n; });
    const service = new ChannelManagerService(
        prisma as any,
        { get: jest.fn(), set: jest.fn(), del: jest.fn() } as any,
        { axiosRef: { get: jest.fn(), post: jest.fn() } } as any,
        new TenantSecretCryptoService(),
    );
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
        jest.spyOn((service as any).logger, level).mockImplementation(() => undefined);
    }
    return { service, prisma, readSettings: () => settings };
}

describe('la máscara del panel significa "dejá lo que había"', () => {
    it('guardar con `***` conserva la credencial en vez de cifrar los asteriscos', async () => {
        const { service, readSettings } = buildService();
        await service.updateConfig(tenantId, {
            provider: 'hostaway', apiKey: 'clave-real', apiSecret: 'secreto-real', syncInterval: 60,
        });
        const first = readSettings().channelManager.apiKey;
        expect(first.startsWith('tsc:v1:')).toBe(true);

        // El dueño abre la pantalla, cambia el intervalo y guarda. El panel
        // manda `***` porque nunca vio la clave.
        await service.updateConfig(tenantId, {
            apiKey: '***', apiSecret: '***', syncInterval: 30,
        } as any);

        const after = readSettings().channelManager;
        expect(after.apiKey).toBe(first);
        expect(after.syncInterval).toBe(30);
        // Y sobre todo: la clave real sigue siendo la clave real.
        const config = await service.getConfig(tenantId);
        expect(config!.apiKey).toBe('clave-real');
    });

    it('un valor nuevo de verdad sí reemplaza al anterior', async () => {
        const { service } = buildService();
        await service.updateConfig(tenantId, { provider: 'hostaway', apiKey: 'vieja', syncInterval: 60 });
        await service.updateConfig(tenantId, { apiKey: 'nueva' } as any);
        expect((await service.getConfig(tenantId))!.apiKey).toBe('nueva');
    });
});

describe('cambiar de proveedor no arrastra la credencial del anterior', () => {
    it('la clave de Hostaway no queda colgada bajo Guesty', async () => {
        const { service, readSettings } = buildService();
        await service.updateConfig(tenantId, {
            provider: 'hostaway', apiKey: 'clave-hostaway', accountId: 'acc-hostaway', syncInterval: 60,
        });

        await service.updateConfig(tenantId, { provider: 'guesty' } as any);

        const after = readSettings().channelManager;
        expect(after.provider).toBe('guesty');
        // Sin esto el sobre de Hostaway sobrevivía y CADA lectura posterior
        // tiraba `tenant_secret_decryption_failed`: la integración tapiada sin
        // ninguna forma de saber por qué.
        expect(after.apiKey).toBeUndefined();
        expect(after.accountId).toBeUndefined();
    });

    it('...y la configuración vuelve a leerse sin explotar', async () => {
        const { service } = buildService();
        await service.updateConfig(tenantId, {
            provider: 'hostaway', apiKey: 'clave-hostaway', syncInterval: 60,
        });
        await service.updateConfig(tenantId, { provider: 'guesty' } as any);

        const config = await service.getConfig(tenantId);
        expect(config).toMatchObject({ provider: 'guesty' });
        expect(config!.apiKey).toBeUndefined();
    });

    it('volver al mismo proveedor no borra nada', async () => {
        const { service } = buildService();
        await service.updateConfig(tenantId, {
            provider: 'hostaway', apiKey: 'clave-hostaway', syncInterval: 60,
        });
        await service.updateConfig(tenantId, { provider: 'hostaway', syncInterval: 15 } as any);

        const config = await service.getConfig(tenantId);
        expect(config!.apiKey).toBe('clave-hostaway');
        expect(config!.syncInterval).toBe(15);
    });

    it('cambiar de proveedor Y traer credencial nueva la usa', async () => {
        const { service } = buildService();
        await service.updateConfig(tenantId, {
            provider: 'hostaway', apiKey: 'clave-hostaway', syncInterval: 60,
        });
        await service.updateConfig(tenantId, {
            provider: 'guesty', apiKey: 'clave-guesty',
        } as any);

        expect((await service.getConfig(tenantId))!.apiKey).toBe('clave-guesty');
    });
});

describe('lo que el panel puede ver', () => {
    it('la máscara sale del registro de campos, no de una lista escrita a mano', async () => {
        const { service } = buildService();
        await service.updateConfig(tenantId, {
            provider: 'hostaway', apiKey: 'clave', apiSecret: 'secreto',
            accountId: 'acc-1', syncInterval: 60,
        });

        const redacted = await service.getRedactedConfig(tenantId);
        expect(redacted).toMatchObject({ apiKey: '***', apiSecret: '***' });
        // Un identificador no es un secreto: enmascararlo dejaría al dueño sin
        // poder verificar contra qué cuenta está conectado.
        expect(redacted.accountId).toBe('acc-1');
        // Y nunca el sobre: devolverlo cifrado sólo mueve el problema un paso.
        expect(JSON.stringify(redacted)).not.toContain('tsc:v1:');
    });
});

describe('escribir una rama no pisa el resto de `settings`', () => {
    it('guardar el channel manager conserva lo que otro módulo escribió', async () => {
        // El caso real: el re-cifrado corre en segundo plano disparado por una
        // lectura cualquiera, y compite con el dueño guardando su SSO. Con
        // `{...settings, channelManager}` el perdedor de esa carrera perdía su
        // configuración entera, sin error ni traza.
        const { service, readSettings } = buildService({
            saml: { entryPoint: 'https://idp.example/sso' },
            whiteLabel: { brandName: 'Acme' },
        });

        await service.updateConfig(tenantId, {
            provider: 'hostaway', apiKey: 'clave', syncInterval: 60,
        });

        const after = readSettings();
        expect(after.saml).toEqual({ entryPoint: 'https://idp.example/sso' });
        expect(after.whiteLabel).toEqual({ brandName: 'Acme' });
        expect(after.channelManager.provider).toBe('hostaway');
    });
});
