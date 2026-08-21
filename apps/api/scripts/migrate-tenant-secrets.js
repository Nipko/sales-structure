/**
 * Cifra en reposo lo que todavía esté en claro en `tenant.settings`.
 *
 * ═══ POR QUÉ HACE FALTA UNA MIGRACIÓN SI YA SE RE-CIFRA SOLO ═══
 *
 * El re-cifrado oportunista corre **cuando alguien lee** la credencial. Un
 * tenant que conectó Hostaway y no volvió a tener una conversación de
 * alojamiento en meses conserva su clave en claro todo ese tiempo, y nadie lo
 * sabe: no hay error, no hay alerta, y el panel la muestra enmascarada igual.
 * Peor: la puerta que acepta texto plano no se puede cerrar mientras quede uno
 * solo, y mientras esté abierta cualquier valor que reaparezca en claro —una
 * restauración de backup vieja, una edición a mano del JSONB— se lee como si
 * nada.
 *
 * Los tres modos son el orden en que esto se hace sin romper nada:
 *
 *   --dry-run   Cuenta y ubica lo pendiente. No escribe. Es lo primero.
 *   --apply     Cifra lo pendiente, un tenant a la vez, sin tocar el resto de
 *               `settings`. Idempotente: correrlo dos veces no hace nada la
 *               segunda.
 *   --cutover   Verifica que no quede NADA en claro y dice qué variable poner.
 *               No la pone: activar el rechazo es una decisión de despliegue.
 *
 * Uso:
 *   docker exec parallext-api node scripts/migrate-tenant-secrets.js --dry-run
 *   docker exec parallext-api node scripts/migrate-tenant-secrets.js --apply
 *   docker exec parallext-api node scripts/migrate-tenant-secrets.js --cutover
 */

const { PrismaClient } = require('@prisma/client');
const { createCipheriv, randomBytes } = require('crypto');

const prisma = new PrismaClient();

const MODES = ['--dry-run', '--apply', '--cutover'];
const mode = MODES.find((m) => process.argv.includes(m));

/**
 * Qué es un secreto, por rama y por proveedor.
 *
 * Es una copia deliberada de `SECRET_FIELDS` y `CHANNEL_MANAGER_SECRET_FIELDS`:
 * un script de migración que importe el servicio arrastra medio NestJS y deja
 * de poder correr con `node`. La prueba `tenant-secret-migration.spec.ts`
 * verifica que las dos listas coincidan, así que la copia no puede derivar en
 * silencio.
 */
const SECRET_MAP = {
    channelManager: {
        // El channel manager guarda un solo proveedor por tenant, en la raíz de
        // la rama. `provider` dice cuál.
        flat: true,
        fields: { apiKey: 'api_key', apiSecret: 'api_secret' },
        scope: 'channel_manager',
    },
    verticalIntegrations: {
        flat: false,
        byProvider: {
            toast: { clientSecret: 'client_secret' },
            mindbody: { apiKey: 'api_key', password: 'password' },
            cliniko: { apiKey: 'api_key' },
        },
        scope: 'vertical_integration',
    },
};

const ENVELOPE_PREFIX = 'tsc:v1:';

function keyring() {
    const hex = process.env.TENANT_SECRET_KEY || process.env.ENCRYPTION_KEY;
    if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
        throw new Error('TENANT_SECRET_KEY (o ENCRYPTION_KEY) tiene que ser 64 hex');
    }
    return {
        keyId: process.env.TENANT_SECRET_KEY_ID || 'primary',
        key: Buffer.from(hex, 'hex'),
    };
}

/** El mismo sobre que produce `TenantSecretCryptoService.encrypt`. */
function encrypt(plaintext, ctx) {
    const { keyId, key } = keyring();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    // EXACTAMENTE el mismo AAD que arma `TenantSecretCryptoService.aad()`.
    // Un carácter distinto acá produce sobres que el servicio no puede
    // descifrar, y el modo de falla es una integración tapiada en producción
    // después de una migración "exitosa". `tenant-secret-migration.spec.ts`
    // hace el viaje de ida y vuelta contra el servicio real para que no quede
    // librado a compararlos a ojo.
    cipher.setAAD(Buffer.from(JSON.stringify([
        'tsc', 'v1', keyId, ctx.tenantId, ctx.scope, ctx.provider, ctx.field,
    ]), 'utf8'));
    const out = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [
        'tsc', 'v1', keyId,
        iv.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        out.toString('base64url'),
    ].join(':');
}

function isPlaintextSecret(value) {
    return typeof value === 'string'
        && value.length > 0
        && value !== '***'
        && !value.startsWith('tsc:');
}

/** Todo lo que está en claro, sin devolver ni un valor. */
function findPending(tenant) {
    const settings = tenant.settings || {};
    const pending = [];

    const cm = settings.channelManager;
    if (cm && cm.provider && cm.provider !== 'direct') {
        for (const [field, fieldId] of Object.entries(SECRET_MAP.channelManager.fields)) {
            if (isPlaintextSecret(cm[field])) {
                pending.push({
                    branch: 'channelManager',
                    leaf: null,
                    field,
                    fieldId,
                    scope: 'channel_manager',
                    provider: String(cm.provider).toLowerCase(),
                });
            }
        }
    }

    const vi = settings.verticalIntegrations || {};
    for (const [provider, fields] of Object.entries(SECRET_MAP.verticalIntegrations.byProvider)) {
        const cfg = vi[provider];
        if (!cfg) continue;
        for (const [field, fieldId] of Object.entries(fields)) {
            if (isPlaintextSecret(cfg[field])) {
                pending.push({
                    branch: 'verticalIntegrations',
                    leaf: provider,
                    field,
                    fieldId,
                    scope: 'vertical_integration',
                    provider,
                });
            }
        }
    }
    return pending;
}

async function scan() {
    const tenants = await prisma.tenant.findMany({
        select: { id: true, name: true, settings: true },
    });
    const rows = [];
    for (const tenant of tenants) {
        const pending = findPending(tenant);
        if (pending.length) rows.push({ tenant, pending });
    }
    return { total: tenants.length, rows };
}

async function main() {
    if (!mode) {
        console.error(`Falta el modo. Uno de: ${MODES.join(' | ')}`);
        process.exitCode = 2;
        return;
    }

    const { total, rows } = await scan();
    const pendingCount = rows.reduce((n, r) => n + r.pending.length, 0);

    console.log(`[migrate-tenant-secrets] ${mode}`);
    console.log(`Tenants revisados: ${total}`);
    console.log(`Secretos en claro: ${pendingCount} en ${rows.length} tenant(s)\n`);

    for (const { tenant, pending } of rows) {
        // Nunca el valor. Un script de migración que imprime la credencial la
        // deja en el log de Docker, que es exactamente de donde se la quiere
        // sacar.
        const detail = pending
            .map((p) => `${p.branch}${p.leaf ? `.${p.leaf}` : ''}.${p.field}`)
            .join(', ');
        console.log(`  ${tenant.id}  ${tenant.name}: ${detail}`);
    }

    if (mode === '--dry-run') {
        console.log(pendingCount
            ? '\nNada se escribió. Corré con --apply cuando quieras cifrarlos.'
            : '\nNo queda nada en claro. Podés seguir con --cutover.');
        return;
    }

    if (mode === '--cutover') {
        if (pendingCount > 0) {
            console.error(
                `\nNO se puede cortar: quedan ${pendingCount} secretos en claro. `
                + 'Corré --apply primero.',
            );
            process.exitCode = 1;
            return;
        }
        console.log(
            '\nNo queda nada en claro. Para cerrar la puerta de compatibilidad:\n'
            + '  1. Agregá TENANT_SECRET_PLAINTEXT=reject a los Secrets de GitHub.\n'
            + '  2. Agregalo TAMBIÉN a .github/workflows/deploy.yml, o el próximo\n'
            + '     deploy lo pierde al regenerar el .env.\n'
            + '  3. Desde ahí, un secreto en claro falla ruidoso en vez de leerse\n'
            + '     en silencio.',
        );
        return;
    }

    // --apply
    if (!pendingCount) {
        console.log('Nada que hacer.');
        return;
    }
    keyring(); // Falla temprano si la clave no está, antes de tocar nada.

    let applied = 0;
    let failed = 0;
    for (const { tenant, pending } of rows) {
        for (const item of pending) {
            const settings = tenant.settings || {};
            const container = item.leaf
                ? settings[item.branch][item.leaf]
                : settings[item.branch];
            const plaintext = container[item.field];
            try {
                const envelope = encrypt(plaintext, {
                    tenantId: tenant.id,
                    scope: item.scope,
                    provider: item.provider,
                    field: item.fieldId,
                });
                // Un `jsonb_set` por secreto, sobre la fila viva. Reescribir
                // `settings` entero desde esta foto pisaría cualquier cosa que
                // otro proceso haya guardado mientras el script corre — y el
                // script corre sobre producción, con el sistema andando.
                const path = item.leaf
                    ? `{${item.branch},${item.leaf},${item.field}}`
                    : `{${item.branch},${item.field}}`;
                await prisma.$executeRawUnsafe(
                    `UPDATE public.tenants
                        SET settings = jsonb_set(settings, $2::text[], $3::jsonb, false),
                            updated_at = NOW()
                      WHERE id = $1::uuid
                        AND settings #>> $2::text[] = $4`,
                    tenant.id, path, JSON.stringify(envelope), plaintext,
                );
                applied += 1;
            } catch (error) {
                failed += 1;
                console.error(`  ! ${tenant.id} ${item.branch}.${item.field}: ${error.message}`);
            }
        }
    }
    console.log(`\nCifrados: ${applied}. Con error: ${failed}.`);
    if (failed) process.exitCode = 1;
}

// Las piezas puras se exportan para que las pruebas verifiquen el sobre contra
// el servicio real y las listas de campos contra las del runtime. El script
// sólo corre cuando se lo invoca directamente.
module.exports = { encrypt, findPending, isPlaintextSecret, SECRET_MAP };

if (require.main === module) {
    main()
        .catch((error) => {
            console.error(error);
            process.exitCode = 1;
        })
        .finally(() => prisma.$disconnect());
}
