import { TenantSecretCryptoService } from './tenant-secret-crypto.service';
import {
    SECRET_FIELDS,
    secretFieldId,
} from '../../modules/vertical-integrations/vertical-integrations.service';
import {
    CHANNEL_MANAGER_SECRET_FIELDS,
    CHANNEL_MANAGER_SECRET_FIELD_IDS,
} from '../../modules/channel-manager/channel-manager.service';

/* eslint-disable @typescript-eslint/no-var-requires */
const migration = require('../../../scripts/migrate-tenant-secrets.js');

/**
 * ═══ EL RE-CIFRADO OPORTUNISTA NO ALCANZA, Y LA PUERTA NO SE PUEDE CERRAR ═══
 *
 * Los secretos se re-cifran **cuando alguien los lee**. Un tenant que conectó
 * Hostaway y no volvió a tener una conversación de alojamiento conserva su clave
 * en claro por meses: no hay error, no hay alerta, y el panel la muestra
 * enmascarada igual — la protección que se ve y no existe, otra vez.
 *
 * Y mientras quede **uno solo**, la puerta que acepta texto plano tiene que
 * seguir abierta; con esa puerta abierta, cualquier valor que reaparezca en
 * claro —una restauración de backup vieja, una edición a mano del JSONB— se lee
 * como si nada y nadie se entera.
 *
 * De ahí los tres modos: contar sin tocar, cifrar, y recién entonces cortar.
 */

const tenantId = '11111111-1111-4111-8111-111111111111';

describe('el sobre del script es el mismo que el del servicio', () => {
    beforeEach(() => {
        process.env.TENANT_SECRET_KEY = 'b'.repeat(64);
        delete process.env.TENANT_SECRET_KEY_ID;
        delete process.env.TENANT_SECRET_PLAINTEXT;
    });

    it('lo que cifra el script lo descifra el servicio', () => {
        // El AAD del servicio es `JSON.stringify([...])`, no una cadena unida
        // por dos puntos. Un carácter de diferencia produce sobres que el
        // runtime no puede abrir, y el modo de falla es una integración tapiada
        // en producción DESPUÉS de una migración que dijo "listo".
        const context = {
            tenantId, scope: 'vertical_integration' as const,
            provider: 'cliniko', field: 'api_key',
        };
        const envelope = migration.encrypt('MS0xNjk5-clave-real', context);

        const service = new TenantSecretCryptoService();
        expect(service.read(envelope, context).plaintext).toBe('MS0xNjk5-clave-real');
    });

    it('y el del servicio lo reconoce el script como ya cifrado', () => {
        const service = new TenantSecretCryptoService();
        const envelope = service.encrypt('clave', {
            tenantId, scope: 'channel_manager', provider: 'hostaway', field: 'api_key',
        });
        // Si el script no lo reconociera, `--apply` volvería a cifrar un sobre
        // ya cifrado: doble capa, ilegible para siempre.
        expect(migration.isPlaintextSecret(envelope)).toBe(false);
    });

    it('el sobre queda atado a su proveedor: no se puede mover', () => {
        const envelope = migration.encrypt('clave', {
            tenantId, scope: 'vertical_integration', provider: 'cliniko', field: 'api_key',
        });
        const service = new TenantSecretCryptoService();
        expect(() => service.read(envelope, {
            tenantId, scope: 'vertical_integration', provider: 'mindbody', field: 'api_key',
        })).toThrow();
    });
});

describe('qué cuenta como pendiente', () => {
    it('encuentra lo que está en claro en las dos ramas', () => {
        const pending = migration.findPending({
            settings: {
                channelManager: { provider: 'hostaway', apiKey: 'clave-plana', syncInterval: 60 },
                verticalIntegrations: {
                    cliniko: { provider: 'cliniko', apiKey: 'otra-clave-plana' },
                },
            },
        });
        expect(pending.map((p: any) => `${p.branch}.${p.field}`).sort())
            .toEqual(['channelManager.apiKey', 'verticalIntegrations.apiKey']);
    });

    it('no cuenta lo que ya está cifrado', () => {
        process.env.TENANT_SECRET_KEY = 'b'.repeat(64);
        const envelope = migration.encrypt('clave', {
            tenantId, scope: 'channel_manager', provider: 'hostaway', field: 'api_key',
        });
        const pending = migration.findPending({
            settings: { channelManager: { provider: 'hostaway', apiKey: envelope } },
        });
        expect(pending).toEqual([]);
    });

    it('no cuenta la máscara como si fuera un secreto', () => {
        // `***` es lo que devuelve el panel. Cifrarlo guardaría los tres
        // asteriscos como credencial.
        expect(migration.isPlaintextSecret('***')).toBe(false);
    });

    it('no cuenta campos que no son secretos', () => {
        // `accountId`, `syncInterval`, `baseUrl` son identificadores y
        // configuración: cifrarlos rompería las consultas que los usan.
        const pending = migration.findPending({
            settings: {
                channelManager: { provider: 'hostaway', accountId: 'acc-1', syncInterval: 30 },
                verticalIntegrations: {
                    cliniko: { provider: 'cliniko', baseUrl: 'https://api.au1.cliniko.com/v1' },
                },
            },
        });
        expect(pending).toEqual([]);
    });

    it('un channel manager `direct` no tiene secretos que migrar', () => {
        const pending = migration.findPending({
            settings: { channelManager: { provider: 'direct', apiKey: 'residuo' } },
        });
        expect(pending).toEqual([]);
    });

    it('un tenant sin nada configurado no aparece', () => {
        expect(migration.findPending({ settings: {} })).toEqual([]);
        expect(migration.findPending({})).toEqual([]);
    });
});

describe('la lista del script no puede separarse de la del runtime', () => {
    it('los campos secretos son los mismos que declara cada módulo', () => {
        // El script no puede importar los servicios —arrastraría medio NestJS y
        // dejaría de correr con `node`—, así que copia las listas. Esto es lo
        // que impide que la copia derive: un campo secreto nuevo en el runtime
        // que el script no conozca queda en claro para siempre y la migración
        // reporta cero pendientes.
        for (const [provider, fields] of Object.entries(SECRET_FIELDS)) {
            const scriptFields = Object.keys(
                migration.SECRET_MAP.verticalIntegrations.byProvider[provider] ?? {},
            );
            expect({ provider, fields: scriptFields.sort() })
                .toEqual({ provider, fields: [...fields].sort() });
        }
        expect(Object.keys(migration.SECRET_MAP.verticalIntegrations.byProvider).sort())
            .toEqual(Object.keys(SECRET_FIELDS).sort());

        expect(Object.keys(migration.SECRET_MAP.channelManager.fields).sort())
            .toEqual([...CHANNEL_MANAGER_SECRET_FIELDS].sort());
    });

    it('y los identificadores de AAD también, campo por campo', () => {
        // El nombre del campo y su identificador en el AAD son dos cosas: el
        // script podría conocer `clientSecret` y mandar `clientsecret`, y el
        // sobre resultante sería ilegible para el runtime.
        for (const [provider, fields] of Object.entries(
            migration.SECRET_MAP.verticalIntegrations.byProvider as Record<string, any>,
        )) {
            for (const [field, id] of Object.entries(fields)) {
                expect({ provider, field, id }).toEqual({ provider, field, id: secretFieldId(field) });
            }
        }
        for (const [field, id] of Object.entries(migration.SECRET_MAP.channelManager.fields)) {
            expect({ field, id }).toEqual({ field, id: CHANNEL_MANAGER_SECRET_FIELD_IDS[field] });
        }
    });

    it('los identificadores de campo son snake_case, como el AAD', () => {
        // `clientSecret` → `client_secret`. Si el script mandara el nombre en
        // camelCase, el AAD no coincidiría y el sobre sería ilegible.
        const ids = [
            ...Object.values(migration.SECRET_MAP.channelManager.fields),
            ...Object.values(migration.SECRET_MAP.verticalIntegrations.byProvider)
                .flatMap((f: any) => Object.values(f)),
        ];
        for (const id of ids) expect(id).toMatch(/^[a-z0-9_]+$/);
    });
});

describe('el corte: después de migrar, el texto plano deja de leerse', () => {
    afterEach(() => { delete process.env.TENANT_SECRET_PLAINTEXT; });

    it('por defecto el puente sigue abierto', () => {
        const service = new TenantSecretCryptoService();
        expect(service.plaintextAccepted()).toBe(true);
        expect(service.readCompatible('clave-plana', {
            tenantId, scope: 'channel_manager', provider: 'hostaway', field: 'api_key',
        })).toMatchObject({ format: 'plaintext', needsRewrap: true });
    });

    it('con el corte activado, un secreto en claro falla ruidoso', () => {
        process.env.TENANT_SECRET_PLAINTEXT = 'reject';
        const service = new TenantSecretCryptoService();
        expect(service.plaintextAccepted()).toBe(false);
        expect(() => service.readCompatible('clave-plana', {
            tenantId, scope: 'channel_manager', provider: 'hostaway', field: 'api_key',
        })).toThrow('tenant_secret_plaintext_rejected');
    });

    it('...y los sobres siguen leyéndose igual', () => {
        process.env.TENANT_SECRET_KEY = 'b'.repeat(64);
        const service = new TenantSecretCryptoService();
        const context = {
            tenantId, scope: 'channel_manager' as const,
            provider: 'hostaway', field: 'api_key',
        };
        const envelope = service.encrypt('clave', context);
        process.env.TENANT_SECRET_PLAINTEXT = 'reject';
        expect(service.readCompatible(envelope, context).plaintext).toBe('clave');
    });
});
