import {
    TenantSecretCryptoError,
    TenantSecretCryptoService,
} from './tenant-secret-crypto.service';

/**
 * Las credenciales de Hostaway, Toast, Mindbody y Cliniko vivían EN CLARO en
 * `tenant.settings`, enmascaradas con `***` sólo al serializarlas en su propio
 * endpoint. Un backup, un volcado de la base o `GET /tenants/:id` las entregaba
 * enteras: la clase de protección que se ve pero no existe.
 *
 * El sobre ata cada valor a su tenant, su scope, su proveedor y su campo. Mover
 * un secreto de lugar —copiar la fila de un tenant a otro, o el `apiKey` de
 * Cliniko al slot de Mindbody— rompe la autenticación en vez de redirigir una
 * integración en silencio.
 */

const KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);
const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenant = '22222222-2222-4222-8222-222222222222';

const CONTEXT = {
    tenantId,
    scope: 'vertical_integration' as const,
    provider: 'cliniko',
    field: 'api_key',
};

describe('TenantSecretCryptoService', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        process.env.TENANT_SECRET_KEY = KEY;
        delete process.env.TENANT_SECRET_KEY_ID;
        delete process.env.TENANT_SECRET_PREVIOUS_KEYS;
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    it('lo que sale no se parece a lo que entró, y vuelve igual', () => {
        const service = new TenantSecretCryptoService();
        const envelope = service.encrypt('MS0xNjk5-secret', CONTEXT);

        expect(envelope).not.toContain('MS0xNjk5-secret');
        expect(envelope.startsWith('tsc:v1:')).toBe(true);
        expect(service.decrypt(envelope, CONTEXT)).toBe('MS0xNjk5-secret');
    });

    it('dos cifrados del mismo valor no son iguales', () => {
        const service = new TenantSecretCryptoService();
        // Sin IV aleatorio, ver dos sobres iguales delataría que dos tenants
        // comparten credencial.
        expect(service.encrypt('igual', CONTEXT)).not.toBe(service.encrypt('igual', CONTEXT));
    });

    it.each([
        ['otro tenant', { ...CONTEXT, tenantId: otherTenant }],
        ['otro proveedor', { ...CONTEXT, provider: 'mindbody' }],
        ['otro campo', { ...CONTEXT, field: 'password' }],
        ['otro scope', { ...CONTEXT, scope: 'channel_manager' as const }],
    ])('no se puede descifrar desde %s', (_case, context) => {
        const service = new TenantSecretCryptoService();
        const envelope = service.encrypt('secreto', CONTEXT);

        expect(() => service.decrypt(envelope, context)).toThrow(TenantSecretCryptoError);
    });

    it('una clave distinta no abre el sobre', () => {
        const service = new TenantSecretCryptoService();
        const envelope = service.encrypt('secreto', CONTEXT);

        process.env.TENANT_SECRET_KEY = OTHER_KEY;
        expect(() => new TenantSecretCryptoService().decrypt(envelope, CONTEXT))
            .toThrow(TenantSecretCryptoError);
    });

    it('una clave rotada sigue leyendo lo viejo y pide reescritura', () => {
        process.env.TENANT_SECRET_KEY_ID = 'k1';
        const envelope = new TenantSecretCryptoService().encrypt('secreto', CONTEXT);

        process.env.TENANT_SECRET_KEY = OTHER_KEY;
        process.env.TENANT_SECRET_KEY_ID = 'k2';
        process.env.TENANT_SECRET_PREVIOUS_KEYS = JSON.stringify({ k1: KEY });

        const result = new TenantSecretCryptoService().read(envelope, CONTEXT);
        expect(result.plaintext).toBe('secreto');
        expect(result.keyId).toBe('k1');
        // Rotar sin reescribir deja la clave vieja viva para siempre.
        expect(result.needsRewrap).toBe(true);
    });

    it('sin clave falla cerrado, y recién al usarla', () => {
        delete process.env.TENANT_SECRET_KEY;
        delete process.env.ENCRYPTION_KEY;
        // Construirlo no puede tumbar el arranque de una instancia que nunca
        // cifra nada; la primera operación real sí falla.
        const service = new TenantSecretCryptoService();
        expect(() => service.encrypt('secreto', CONTEXT)).toThrow(TenantSecretCryptoError);
    });

    describe('puente de migración', () => {
        it('lee lo que hoy está en claro y pide reescritura', () => {
            const service = new TenantSecretCryptoService();
            const result = service.readCompatible('clave-vieja-en-claro', CONTEXT);

            expect(result).toMatchObject({
                plaintext: 'clave-vieja-en-claro',
                format: 'plaintext',
                needsRewrap: true,
            });
        });

        it('un sobre válido se lee como sobre, no como texto plano', () => {
            const service = new TenantSecretCryptoService();
            const envelope = service.encrypt('secreto', CONTEXT);

            expect(service.readCompatible(envelope, CONTEXT)).toMatchObject({
                format: 'v1', needsRewrap: false,
            });
        });

        it('un sobre corrupto NO se degrada a texto plano', () => {
            const service = new TenantSecretCryptoService();
            const envelope = service.encrypt('secreto', CONTEXT);
            const tampered = `${envelope.slice(0, -4)}AAAA`;

            // Si un sobre roto cayera al camino de "texto plano", el ciphertext
            // se usaría como credencial y el error diría "el proveedor rechazó
            // la clave" en vez de "el sobre está roto".
            expect(() => service.readCompatible(tampered, CONTEXT))
                .toThrow(TenantSecretCryptoError);
        });
    });

    describe('contexto inválido', () => {
        it.each([
            ['tenant que no es UUID', { ...CONTEXT, tenantId: 'no-uuid' }],
            ['scope desconocido', { ...CONTEXT, scope: 'lo_que_sea' as any }],
            ['proveedor vacío', { ...CONTEXT, provider: '' }],
            ['campo con caracteres raros', { ...CONTEXT, field: 'api key!' }],
        ])('%s no cifra', (_case, context) => {
            const service = new TenantSecretCryptoService();
            expect(() => service.encrypt('secreto', context)).toThrow(TenantSecretCryptoError);
        });

        it('un valor vacío no es un secreto', () => {
            const service = new TenantSecretCryptoService();
            expect(() => service.encrypt('', CONTEXT)).toThrow(TenantSecretCryptoError);
        });
    });

    it('isEnvelope distingue lo cifrado de lo que todavía no lo está', () => {
        const service = new TenantSecretCryptoService();
        expect(service.isEnvelope(service.encrypt('secreto', CONTEXT))).toBe(true);
        expect(service.isEnvelope('clave-en-claro')).toBe(false);
        expect(service.isEnvelope('***')).toBe(false);
        expect(service.isEnvelope(undefined)).toBe(false);
    });
});
