import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { Cron } from '@nestjs/schedule';
import { CronLockService } from '../redis/cron-lock.service';
import { TenantSecretCryptoService } from '../../common/crypto/tenant-secret-crypto.service';
import {
    OUTBOUND_MAX_REQUEST_BYTES,
    OUTBOUND_MAX_RESPONSE_BYTES,
    type PinnedHttpsTarget,
    isUnsafeHostname,
    parseSafeHttpsUrl,
    pinSafeHttpsUrl,
    safeAxiosOptions,
} from '../../common/utils/safe-outbound-url.util';
import {
    initialIntegrationHealth,
    materializeIntegrationHealth,
    reduceIntegrationHealth,
    requiredScopesForProvider,
    type IntegrationHealth,
    type IntegrationHealthObservation,
    type StoredIntegrationHealth,
    type VerticalProvider,
} from './integration-health';

export type { VerticalProvider } from './integration-health';

export interface ToastConfig {
    provider: 'toast';
    hostname: string;       // e.g. https://ws-api.toasttab.com
    clientId: string;
    clientSecret: string;
    locationGuid: string;   // Toast-Restaurant-External-ID
}
export interface MindbodyConfig {
    provider: 'mindbody';
    apiKey: string;
    siteId: string;
    sourceName?: string;
    username?: string;
    password?: string;
}
export interface ClinikoConfig {
    provider: 'cliniko';
    apiKey: string;
    baseUrl: string;        // shard base, e.g. https://api.au1.cliniko.com/v1
    businessId?: string;
    practitionerId?: string;
}
export type VerticalIntegrationConfig = ToastConfig | MindbodyConfig | ClinikoConfig;

const PROVIDERS: VerticalProvider[] = ['toast', 'mindbody', 'cliniko'];

/**
 * Los campos que son un secreto, por proveedor.
 *
 * Estaban guardados EN CLARO en `tenant.settings`, enmascarados con `***` sólo
 * al serializarlos en su propio endpoint: la clase de protección que se ve pero
 * no existe. Cualquier lectura del tenant, cualquier backup y cualquier volcado
 * de la base los entregaba enteros.
 *
 * La lista es por proveedor y no una heurística sobre el nombre del campo:
 * `siteId` de Mindbody y `locationGuid` de Toast NO son secretos, y cifrarlos
 * sólo agregaría descifrados que pueden fallar.
 */
const SECRET_FIELDS: Readonly<Record<VerticalProvider, readonly string[]>> = Object.freeze({
    toast: Object.freeze(['clientSecret']),
    mindbody: Object.freeze(['apiKey', 'password']),
    cliniko: Object.freeze(['apiKey']),
});

/** `clientSecret` → `client_secret`: el AAD ata el valor a su campo exacto. */
function secretFieldId(field: string): string {
    return field.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}
const PROVIDER_ALLOWLIST_CONFIG: Partial<Record<VerticalProvider, string>> = {
    toast: 'VERTICAL_INTEGRATIONS_TOAST_ALLOWED_HOSTS',
    cliniko: 'VERTICAL_INTEGRATIONS_CLINIKO_ALLOWED_HOSTS',
};
const STATIC_PROVIDER_HTTP_LIMITS = {
    maxRedirects: 0,
    maxContentLength: OUTBOUND_MAX_RESPONSE_BYTES,
    maxBodyLength: OUTBOUND_MAX_REQUEST_BYTES,
    proxy: false as const,
};

/**
 * Real vertical integrations (T3.19) — "thin vertical, deep horizontal".
 * Connects existing verticals to their real system-of-record:
 *  - Toast (restaurantes): menú/items/precios
 *  - Mindbody (gimnasios): clases/horarios
 *  - Cliniko (salud): tipos de cita + disponibilidad (sin tocar EHR → evita HIPAA)
 *
 * Config lives in tenant.settings.verticalIntegrations.{provider}. Synced data is
 * cached in a generic tenant-schema table `vi_items`; availability is fetched live.
 * Follows the ecommerce/channel-manager adapter pattern.
 */
@Injectable()
export class VerticalIntegrationsService {
    private readonly logger = new Logger(VerticalIntegrationsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly http: HttpService,
        private readonly cronLock: CronLockService,
        private readonly appConfig: ConfigService,
        private readonly secrets: TenantSecretCryptoService,
    ) {}

    /**
     * Validates tenant-configurable provider endpoints before they are stored or
     * used. The official provider namespace is the default allowlist; operators
     * may add exact public hostnames through the provider-specific env vars.
     * Wildcards, URLs and IP literals are deliberately not accepted there.
     */
    private normalizeProviderEndpoint(provider: 'toast' | 'cliniko', rawValue: unknown): URL {
        const parsed = parseSafeHttpsUrl(rawValue, provider);
        if (parsed.search || parsed.hash) {
            throw new BadRequestException(`La URL de ${provider} no puede incluir query ni fragmento`);
        }

        const hostname = parsed.hostname.toLowerCase();
        if (!this.isAllowedProviderHostname(provider, hostname)) {
            throw new BadRequestException(`Hostname de ${provider} no permitido`);
        }

        if (provider === 'toast' && parsed.pathname !== '/') {
            throw new BadRequestException('El hostname de Toast no puede incluir una ruta');
        }
        const normalizedPath = parsed.pathname.replace(/\/+$/, '') || '/';
        if (provider === 'cliniko' && normalizedPath !== '/v1') {
            throw new BadRequestException('La URL base de Cliniko debe terminar en /v1');
        }

        parsed.pathname = provider === 'toast' ? '/' : '/v1';
        return parsed;
    }

    private providerBaseUrl(provider: 'toast' | 'cliniko', target: PinnedHttpsTarget): string {
        return provider === 'toast' ? target.url.origin : `${target.url.origin}/v1`;
    }

    private async prepareProviderEndpoint(
        provider: 'toast' | 'cliniko',
        rawValue: unknown,
    ): Promise<{ baseUrl: string; target: PinnedHttpsTarget }> {
        const target = await pinSafeHttpsUrl(this.normalizeProviderEndpoint(provider, rawValue), provider);
        return { baseUrl: this.providerBaseUrl(provider, target), target };
    }

    private async validateProviderEndpoint(provider: 'toast' | 'cliniko', rawValue: unknown): Promise<string> {
        return (await this.prepareProviderEndpoint(provider, rawValue)).baseUrl;
    }

    private isAllowedProviderHostname(provider: 'toast' | 'cliniko', hostname: string): boolean {
        const official = provider === 'toast'
            ? hostname.endsWith('.toasttab.com')
            : /^api\.[a-z]{2}\d{1,2}\.cliniko\.com$/i.test(hostname);
        if (official) return true;

        const configKey = PROVIDER_ALLOWLIST_CONFIG[provider];
        const configured = configKey ? this.appConfig.get<string>(configKey, '') : '';
        return configured
            .split(',')
            .map((entry) => entry.trim().toLowerCase())
            .filter((entry) => this.isSafeConfiguredHostname(entry))
            .includes(hostname);
    }

    private isSafeConfiguredHostname(hostname: string): boolean {
        if (!hostname || hostname.includes('://') || hostname.includes('*')) return false;
        if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(hostname)) {
            return false;
        }
        return !isUnsafeHostname(hostname);
    }

    private validateClinikoIdentifier(rawValue: unknown, label: string): string {
        const value = typeof rawValue === 'string' ? rawValue.trim() : '';
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) {
            throw new BadRequestException(`Identificador de ${label} invalido`);
        }
        return value;
    }

    // ── Config (tenant.settings) ─────────────────────────────
    /**
     * El config listo para USAR, con los secretos descifrados.
     *
     * Es el camino interno: los tres llamadores son sync, testConnection y la
     * consulta de disponibilidad de Cliniko. El endpoint del panel usa
     * `getAllConfigs`, que enmascara.
     */
    async getConfig(tenantId: string, provider: VerticalProvider): Promise<any | null> {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
        const stored = (tenant?.settings as any)?.verticalIntegrations?.[provider];
        if (!stored) return null;
        return this.decryptSecrets(tenantId, provider, stored);
    }

    /**
     * Descifra en memoria lo que se guardó cifrado, y deja pasar lo que todavía
     * está en claro marcándolo para reescritura.
     *
     * Lo viejo se re-guarda cifrado en el mismo camino, sin migración aparte y
     * sin que nadie tenga que acordarse de correrla. Si el re-guardado falla no
     * se rompe la sincronización en curso: se reintenta en la próxima lectura.
     */
    private async decryptSecrets(
        tenantId: string,
        provider: VerticalProvider,
        stored: Record<string, any>,
    ): Promise<Record<string, any>> {
        const config = { ...stored };
        const rewrap: Record<string, string> = {};
        for (const field of SECRET_FIELDS[provider]) {
            const value = stored[field];
            if (value === undefined || value === null || value === '') continue;
            try {
                const result = this.secrets.readCompatible(value, {
                    tenantId, scope: 'vertical_integration', provider, field: secretFieldId(field),
                });
                config[field] = result.plaintext;
                if (result.needsRewrap) {
                    // El re-cifrado es best-effort: sin clave usable, la
                    // credencial que se pudo leer se sigue usando y se reintenta
                    // en la próxima lectura. Fallar acá apagaría la integración
                    // por un problema de configuración que no la afecta.
                    try {
                        rewrap[field] = this.secrets.encrypt(result.plaintext, {
                            tenantId, scope: 'vertical_integration', provider, field: secretFieldId(field),
                        });
                    } catch (error: any) {
                        this.logger.warn(`[VI] no se pudo cifrar ${provider}.${field}: ${error?.code}`);
                    }
                }
            } catch (error: any) {
                // Un secreto ilegible NO se degrada a texto plano: se deja
                // ausente y la llamada al proveedor falla, que es lo honesto.
                this.logger.warn(`[VI] secreto ilegible ${provider}.${field}: ${error?.code || error?.message}`);
                delete config[field];
            }
        }
        if (Object.keys(rewrap).length) {
            this.persistRewrappedSecrets(tenantId, provider, rewrap).catch((error: any) => {
                this.logger.warn(`[VI] no se pudo re-cifrar ${provider}: ${error?.message}`);
            });
        }
        return config;
    }

    private async persistRewrappedSecrets(
        tenantId: string,
        provider: VerticalProvider,
        rewrap: Record<string, string>,
    ): Promise<void> {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
        if (!tenant) return;
        const settings = (tenant.settings as any) || {};
        const vi = settings.verticalIntegrations || {};
        const current = vi[provider];
        if (!current) return;
        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                settings: {
                    ...settings,
                    verticalIntegrations: { ...vi, [provider]: { ...current, ...rewrap } },
                } as any,
            },
        });
        this.logger.log(`[VI] secretos de ${provider} re-cifrados para ${tenantId}`);
    }

    async getAllConfigs(tenantId: string): Promise<Record<string, any>> {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
        const settings = (tenant?.settings as any) || {};
        const vi = settings.verticalIntegrations || {};
        const storedHealth = settings.verticalIntegrationHealth || {};
        // Mask secrets
        const out: Record<string, any> = {};
        for (const p of PROVIDERS) {
            if (vi[p]) {
                const health = materializeIntegrationHealth(p, true, storedHealth[p]);
                out[p] = {
                    ...vi[p],
                    clientSecret: vi[p].clientSecret ? '***' : undefined,
                    apiKey: vi[p].apiKey ? '***' : undefined,
                    password: vi[p].password ? '***' : undefined,
                    // `configured` = hay credencial guardada. `connected` =
                    // además se validó contra el proveedor. El panel los
                    // confundía y dejaba el botón "Probar" detrás de
                    // `connected`, que sólo se enciende PROBANDO: había que
                    // probar para poder probar. Guardar y validar son dos
                    // momentos distintos y ahora se nombran distinto.
                    configured: true,
                    connected: health.connected,
                    status: health.status,
                    health,
                };
            }
        }
        return out;
    }

    async updateConfig(tenantId: string, provider: VerticalProvider, config: Partial<VerticalIntegrationConfig>): Promise<any> {
        if (!PROVIDERS.includes(provider)) throw new BadRequestException('Proveedor no soportado');
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
        if (!tenant) throw new NotFoundException('Tenant not found');
        const settings = (tenant.settings as any) || {};
        const vi = settings.verticalIntegrations || {};
        const healthStore = settings.verticalIntegrationHealth || {};
        const current = vi[provider] || {};
        // Merge — keep existing secrets if masked/omitted
        const merged: any = { ...current, ...config, provider };
        const cfgAny = config as any;
        for (const secretKey of ['clientSecret', 'apiKey', 'password']) {
            if (cfgAny[secretKey] === '***' || cfgAny[secretKey] === undefined) {
                merged[secretKey] = current[secretKey];
            }
        }
        if (provider === 'toast') {
            merged.hostname = await this.validateProviderEndpoint('toast', merged.hostname);
        } else if (provider === 'cliniko') {
            merged.baseUrl = await this.validateProviderEndpoint('cliniko', merged.baseUrl);
            if (merged.businessId) {
                merged.businessId = this.validateClinikoIdentifier(merged.businessId, 'negocio Cliniko');
            }
            if (merged.practitionerId) {
                merged.practitionerId = this.validateClinikoIdentifier(merged.practitionerId, 'profesional Cliniko');
            }
        }
        // Los secretos se cifran ANTES de tocar la base. `merged` puede traer
        // un valor viejo que ya estaba cifrado (se conservó porque el panel
        // mandó `***`) o uno nuevo en claro: se cifra sólo lo segundo.
        const persisted: any = { ...merged };
        for (const field of SECRET_FIELDS[provider]) {
            const value = persisted[field];
            if (value === undefined || value === null || value === '') continue;
            if (this.secrets.isEnvelope(value)) continue;
            persisted[field] = this.secrets.encrypt(String(value), {
                tenantId, scope: 'vertical_integration', provider, field: secretFieldId(field),
            });
        }

        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                settings: {
                    ...settings,
                    verticalIntegrations: { ...vi, [provider]: persisted },
                    // Saving credentials never means they were validated. Reset
                    // health and require an explicit check/sync before tools exist.
                    verticalIntegrationHealth: {
                        ...healthStore,
                        [provider]: initialIntegrationHealth(provider),
                    },
                } as any,
            },
        });
        await this.invalidateHealthCache(tenantId);
        return merged;
    }

    async disconnect(tenantId: string, provider: VerticalProvider): Promise<void> {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
        if (!tenant) return;
        const settings = (tenant.settings as any) || {};
        const vi = { ...(settings.verticalIntegrations || {}) };
        const healthStore = { ...(settings.verticalIntegrationHealth || {}) };
        delete vi[provider];
        delete healthStore[provider];
        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                settings: {
                    ...settings,
                    verticalIntegrations: vi,
                    verticalIntegrationHealth: healthStore,
                } as any,
            },
        });
        await this.invalidateHealthCache(tenantId);
    }

    private async invalidateHealthCache(tenantId: string): Promise<void> {
        await this.redis.del(`vi:connected:${tenantId}`).catch(() => {});
    }

    async getProviderHealth(tenantId: string, provider: VerticalProvider): Promise<IntegrationHealth> {
        if (!PROVIDERS.includes(provider)) throw new BadRequestException('Proveedor no soportado');
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        const settings = (tenant?.settings as any) || {};
        return materializeIntegrationHealth(
            provider,
            !!settings.verticalIntegrations?.[provider],
            settings.verticalIntegrationHealth?.[provider],
        );
    }

    async getAllHealth(tenantId: string): Promise<Record<VerticalProvider, IntegrationHealth>> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        const settings = (tenant?.settings as any) || {};
        const configured = settings.verticalIntegrations || {};
        const stored = settings.verticalIntegrationHealth || {};
        return Object.fromEntries(PROVIDERS.map(provider => [
            provider,
            materializeIntegrationHealth(provider, !!configured[provider], stored[provider]),
        ])) as Record<VerticalProvider, IntegrationHealth>;
    }

    /**
     * Durable, provider-scoped and retry-idempotent health update. The JSONB
     * update merges only one provider, preserving concurrent tenant settings.
     */
    async updateHealth(
        tenantId: string,
        provider: VerticalProvider,
        observation: IntegrationHealthObservation,
    ): Promise<IntegrationHealth> {
        if (!PROVIDERS.includes(provider)) throw new BadRequestException('Proveedor no soportado');
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');
        const settings = (tenant.settings as any) || {};
        const current = settings.verticalIntegrationHealth?.[provider] as StoredIntegrationHealth | undefined;
        const next = reduceIntegrationHealth(current, provider, observation);
        if (next !== current) {
            const affected = await this.prisma.$executeRawUnsafe(
                `UPDATE public.tenants
                    SET settings = jsonb_set(
                        COALESCE(settings, '{}'::jsonb),
                        '{verticalIntegrationHealth}',
                        COALESCE(settings->'verticalIntegrationHealth', '{}'::jsonb)
                            || jsonb_build_object($2::text, $3::jsonb),
                        true
                    ),
                    updated_at = NOW()
                  WHERE id = $1::uuid`,
                tenantId,
                provider,
                JSON.stringify(next),
            );
            if (Number(affected) !== 1) throw new NotFoundException('Tenant not found');
            await this.invalidateHealthCache(tenantId);
        }
        return materializeIntegrationHealth(
            provider,
            !!settings.verticalIntegrations?.[provider],
            next,
        );
    }

    async getToolGate(
        tenantId: string,
        provider: VerticalProvider,
    ): Promise<{ allowed: boolean; health: IntegrationHealth }> {
        const health = await this.getProviderHealth(tenantId, provider);
        const allowed = health.status === 'healthy';
        if (!allowed) {
            this.logger.warn(
                `[VI health] tool blocked tenant=${tenantId} provider=${provider} `
                + `status=${health.status} circuit=${health.circuitState}`,
            );
        }
        return { allowed, health };
    }

    /** Which providers are healthy. Used to gate AI tool registration. */
    async getConnectedProviders(tenantId: string): Promise<Record<VerticalProvider, boolean>> {
        // Deliberately read durable health on every turn. A five-minute boolean
        // cache could keep registering a provider after it crossed staleAt.
        const health = await this.getAllHealth(tenantId);
        const result = {
            toast: health.toast.status === 'healthy',
            mindbody: health.mindbody.status === 'healthy',
            cliniko: health.cliniko.status === 'healthy',
        } as Record<VerticalProvider, boolean>;
        return result;
    }

    // ── Synced-items table ───────────────────────────────────
    async ensureTables(schemaName: string): Promise<void> {
        // The Redis key is derived from this value before any SQL runs, so a
        // tenantId passed where a schema name belongs would poison the cache and
        // only surface later as a raw Postgres 3F000. Fail readably, here.
        this.prisma.assertTenantSchemaName(schemaName);
        const cacheKey = `vi_cols:${schemaName}`;
        if (await this.redis.get(cacheKey)) return;
        try {
            await this.prisma.executeInTenantSchema(
                schemaName,
                `CREATE TABLE IF NOT EXISTS vi_items (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    provider VARCHAR(20) NOT NULL,
                    item_type VARCHAR(40) NOT NULL,
                    external_id TEXT NOT NULL,
                    title TEXT,
                    subtitle TEXT,
                    price_cents INTEGER,
                    currency VARCHAR(10),
                    data JSONB DEFAULT '{}'::jsonb,
                    synced_at TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE(provider, item_type, external_id)
                )`,
                [],
            );
            await this.prisma.executeInTenantSchema(
                schemaName,
                `CREATE INDEX IF NOT EXISTS idx_vi_items_lookup ON vi_items(provider, item_type)`,
                [],
            );
        } catch (e: any) {
            if (!/already exists|42P07|23505/.test(e.message || '')) throw e;
        }
        await this.redis.set(cacheKey, '1', 86400);
    }

    private async upsertItem(schemaName: string, item: {
        provider: string; itemType: string; externalId: string;
        title?: string; subtitle?: string; priceCents?: number | null; currency?: string; data?: any;
    }): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `INSERT INTO vi_items (provider, item_type, external_id, title, subtitle, price_cents, currency, data, synced_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
             ON CONFLICT (provider, item_type, external_id) DO UPDATE SET
                title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, price_cents = EXCLUDED.price_cents,
                currency = EXCLUDED.currency, data = EXCLUDED.data, synced_at = NOW()`,
            [item.provider, item.itemType, item.externalId, item.title || null, item.subtitle || null,
             item.priceCents ?? null, item.currency || null, JSON.stringify(item.data || {})],
        );
    }

    /**
     * Tenant-facing read. Callers outside this service only ever hold a tenantId,
     * so the physical schema is resolved here — the controller used to hand the
     * tenantId straight through as if it were the schema name.
     */
    async listItems(tenantId: string, provider?: string, itemType?: string, limit = 100): Promise<any[]> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) throw new NotFoundException('Tenant not found');
        return this.listItemsInSchema(schemaName, provider, itemType, limit);
    }

    /** For callers that already resolved the schema (AI tool reads, sync). */
    private async listItemsInSchema(schemaName: string, provider?: string, itemType?: string, limit = 100): Promise<any[]> {
        await this.ensureTables(schemaName);
        const conds: string[] = [];
        const params: any[] = [];
        if (provider) { conds.push(`provider = $${params.length + 1}`); params.push(provider); }
        if (itemType) { conds.push(`item_type = $${params.length + 1}`); params.push(itemType); }
        params.push(limit);
        const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT provider, item_type, external_id, title, subtitle, price_cents, currency, data, synced_at
             FROM vi_items ${where} ORDER BY title ASC LIMIT $${params.length}`,
            params,
        );
    }

    // ── Sync dispatch ────────────────────────────────────────
    async sync(tenantId: string, provider: VerticalProvider): Promise<{ synced: number }> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) throw new NotFoundException('Tenant not found');
        const config = await this.getConfig(tenantId, provider);
        if (!config) throw new BadRequestException(`${provider} no está configurado`);

        await this.ensureTables(schemaName);
        let result: { synced: number };
        try {
            switch (provider) {
                case 'toast': result = await this.syncToast(schemaName, config); break;
                case 'mindbody': result = await this.syncMindbody(schemaName, config); break;
                case 'cliniko': result = await this.syncCliniko(schemaName, config); break;
            }
        } catch (error: any) {
            const health = await this.updateHealth(
                tenantId,
                provider,
                this.failureObservation(provider, error),
            ).catch(() => null);
            this.logger.warn(
                `[VI health] sync failed tenant=${tenantId} provider=${provider} `
                + `status=${health?.status || 'unavailable'} code=${health?.lastError?.code || 'health_store_failed'}`,
            );
            throw error;
        }
        // Persisting health is part of completing the sync contract. If this
        // fails, leave the previous state fail-closed; do not misclassify the
        // successful provider call as another provider failure.
        const health = await this.updateHealth(tenantId, provider, {
            outcome: 'success',
            syncSucceeded: true,
            credentialValidated: true,
            grantedScopes: requiredScopesForProvider(provider),
        });
        this.logger.log(
            `[VI health] tenant=${tenantId} provider=${provider} status=${health.status} `
            + `synced=${result.synced}`,
        );
        return result;
    }

    /**
     * Re-sincronización diaria de lo que estas integraciones LEEN.
     *
     * Decisión de agosto 2026: las cuatro integraciones verticales (Toast,
     * Mindbody, Cliniko, Hostaway) se congelan — no se les construye write-path
     * — pero la lectura se fiabiliza. Son PMS de EE.UU. y Australia que un
     * negocio LatAm de 5-25 empleados probablemente no usa, así que no justifican
     * más inversión; pero lo ya construido no cuesta nada mantenerlo vivo.
     *
     * El problema concreto que resuelve: el sync sólo corría cuando alguien
     * apretaba el botón. Un restaurante que cambia el menú en Toast seguía
     * teniendo el menú viejo en `vi_items`, y el agente le recitaba a los
     * clientes platos y precios que ya no existen. Un dato desactualizado que se
     * presenta como actual es peor que no tenerlo.
     *
     * Una vez por día alcanza: son catálogos (menú, grilla de clases, servicios
     * de la clínica), no inventario en tiempo real.
     */
    @Cron('0 5 * * *')
    async resyncAllCron(): Promise<void> {
        await this.cronLock.runExclusive('vertical-integrations.resyncAll', 3600, () => this.resyncAll());
    }

    async resyncAll(): Promise<void> {
        let tenants: Array<{ id: string }> = [];
        try {
            tenants = await this.prisma.tenant.findMany({ where: { isActive: true }, select: { id: true } });
        } catch (e: any) {
            this.logger.warn(`[VI] No se pudo listar tenants: ${e.message}`);
            return;
        }

        let ok = 0;
        let failed = 0;
        for (const tenant of tenants) {
            // Configured is not the same as connected. The cron is allowed to
            // probe/sync legacy configs so they can earn a healthy state; tool
            // registration remains fail-closed until that succeeds.
            const configured = await this.getAllConfigs(tenant.id).catch(() => null);
            if (!configured) continue;
            for (const provider of ['toast', 'mindbody', 'cliniko'] as VerticalProvider[]) {
                if (!configured[provider]) continue;
                try {
                    const res = await this.sync(tenant.id, provider);
                    ok++;
                    this.logger.log(`[VI] ${provider} re-sincronizado para ${tenant.id}: ${res.synced} ítems`);
                } catch {
                    // Que una credencial vencida de un tenant no frene al resto.
                    failed++;
                    const health = await this.getProviderHealth(tenant.id, provider).catch(() => null);
                    this.logger.warn(
                        `[VI] re-sync tenant=${tenant.id} provider=${provider} `
                        + `status=${health?.status || 'unavailable'} `
                        + `code=${health?.lastError?.code || 'sync_failed'}`,
                    );
                }
            }
        }
        if (ok || failed) this.logger.log(`[VI] Re-sync diario: ${ok} ok, ${failed} con error`);
    }

    private failureObservation(
        provider: VerticalProvider,
        error: any,
    ): IntegrationHealthObservation {
        const status = Number(error?.response?.status ?? error?.status ?? error?.statusCode);
        return {
            outcome: 'failure',
            credentialValidated: status === 401 ? false : undefined,
            missingScopes: status === 403 ? requiredScopesForProvider(provider) : undefined,
            error,
        };
    }

    async testConnection(
        tenantId: string,
        provider: VerticalProvider,
    ): Promise<{ ok: boolean; message?: string; health: IntegrationHealth }> {
        const config = await this.getConfig(tenantId, provider);
        if (!config) {
            return {
                ok: false,
                message: 'No configurado',
                health: await this.getProviderHealth(tenantId, provider),
            };
        }
        let grantedScopes: string[] | undefined;
        try {
            if (provider === 'toast') {
                await this.toastToken(config);
            }
            if (provider === 'mindbody') {
                await this.http.axiosRef.get('https://api.mindbodyonline.com/public/v6/site/sites', {
                    ...STATIC_PROVIDER_HTTP_LIMITS,
                    headers: { 'Api-Key': config.apiKey, SiteId: config.siteId },
                    timeout: 15000,
                });
            }
            if (provider === 'cliniko') {
                const { baseUrl, target } = await this.prepareProviderEndpoint('cliniko', config.baseUrl);
                await this.http.axiosRef.get(`${baseUrl}/appointment_types?per_page=1`, {
                    ...safeAxiosOptions(target, 15000),
                    headers: this.clinikoHeaders(config),
                });
                // This exact probe proves appointment_types:read.
                grantedScopes = requiredScopesForProvider('cliniko');
            }
        } catch (e: any) {
            const health = await this.updateHealth(
                tenantId,
                provider,
                this.failureObservation(provider, e),
            ).catch(() => materializeIntegrationHealth(provider, true, undefined));
            this.logger.warn(
                `[VI health] check failed tenant=${tenantId} provider=${provider} `
                + `status=${health.status} code=${health.lastError?.code || 'health_store_failed'}`,
            );
            return {
                ok: false,
                message: health.lastError?.message || 'No se pudo comprobar la integración.',
                health,
            };
        }
        try {
            const health = await this.updateHealth(tenantId, provider, {
                outcome: 'success',
                credentialValidated: true,
                grantedScopes,
            });
            this.logger.log(
                `[VI health] check tenant=${tenantId} provider=${provider} status=${health.status}`,
            );
            return { ok: true, health };
        } catch {
            const health = await this.getProviderHealth(tenantId, provider)
                .catch(() => materializeIntegrationHealth(provider, true, undefined));
            this.logger.warn(
                `[VI health] check persistence failed tenant=${tenantId} provider=${provider} `
                + `status=${health.status}`,
            );
            return {
                ok: false,
                message: 'La credencial respondió, pero no se pudo guardar el estado de salud.',
                health,
            };
        }
    }

    // ── Toast (restaurantes) ─────────────────────────────────
    private async toastToken(config: ToastConfig): Promise<string> {
        const { baseUrl: hostname, target } = await this.prepareProviderEndpoint('toast', config.hostname);
        const res = await this.http.axiosRef.post(
            `${hostname}/authentication/v1/authentication/login`,
            { clientId: config.clientId, clientSecret: config.clientSecret, userAccessType: 'TOAST_MACHINE_CLIENT' },
            safeAxiosOptions(target, 15000),
        );
        const token = res.data?.token?.accessToken;
        if (!token) throw new Error('Toast no devolvió token');
        return token;
    }

    private async syncToast(schemaName: string, config: ToastConfig): Promise<{ synced: number }> {
        const token = await this.toastToken(config);
        const { baseUrl: hostname, target } = await this.prepareProviderEndpoint('toast', config.hostname);
        const res = await this.http.axiosRef.get(`${hostname}/menus/v2/menus`, {
            ...safeAxiosOptions(target, 30000),
            headers: { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': config.locationGuid },
        });
        const menus = res.data?.menus || res.data || [];
        let synced = 0;
        for (const menu of Array.isArray(menus) ? menus : []) {
            for (const group of menu.menuGroups || []) {
                for (const item of group.menuItems || []) {
                    const priceCents = item.price != null ? Math.round(Number(item.price) * 100) : null;
                    await this.upsertItem(schemaName, {
                        provider: 'toast', itemType: 'menu_item',
                        externalId: String(item.guid || item.referenceId || item.name),
                        title: item.name, subtitle: group.name, priceCents, currency: 'USD',
                        data: { description: item.description, group: group.name, menu: menu.name },
                    });
                    synced++;
                }
            }
        }
        this.logger.log(`[Toast] Synced ${synced} menu items`);
        return { synced };
    }

    // ── Mindbody (gimnasios) ─────────────────────────────────
    private mindbodyHeaders(config: MindbodyConfig): Record<string, string> {
        return { 'Api-Key': config.apiKey, SiteId: config.siteId };
    }

    private async syncMindbody(schemaName: string, config: MindbodyConfig): Promise<{ synced: number }> {
        const now = new Date();
        const end = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
        const res = await this.http.axiosRef.get('https://api.mindbodyonline.com/public/v6/class/classes', {
            ...STATIC_PROVIDER_HTTP_LIMITS,
            headers: this.mindbodyHeaders(config),
            params: { StartDateTime: now.toISOString(), EndDateTime: end.toISOString(), Limit: 200 },
            timeout: 30000,
        });
        const classes = res.data?.Classes || [];
        let synced = 0;
        for (const c of classes) {
            await this.upsertItem(schemaName, {
                provider: 'mindbody', itemType: 'class',
                externalId: String(c.Id),
                title: c.ClassDescription?.Name || 'Clase',
                subtitle: c.Staff?.Name,
                data: {
                    startDateTime: c.StartDateTime, endDateTime: c.EndDateTime,
                    staff: c.Staff?.Name, maxCapacity: c.MaxCapacity, totalBooked: c.TotalBooked,
                    isAvailable: (c.MaxCapacity ?? 0) > (c.TotalBooked ?? 0),
                    location: c.Location?.Name,
                },
            });
            synced++;
        }
        this.logger.log(`[Mindbody] Synced ${synced} classes`);
        return { synced };
    }

    // ── Cliniko (salud) ──────────────────────────────────────
    private clinikoHeaders(config: ClinikoConfig): Record<string, string> {
        const basic = Buffer.from(`${config.apiKey}:`).toString('base64');
        return { Authorization: `Basic ${basic}`, Accept: 'application/json', 'User-Agent': 'Parallly (vertical-integration)' };
    }

    private async syncCliniko(schemaName: string, config: ClinikoConfig): Promise<{ synced: number }> {
        const { baseUrl, target } = await this.prepareProviderEndpoint('cliniko', config.baseUrl);
        const res = await this.http.axiosRef.get(`${baseUrl}/appointment_types?per_page=100`, {
            ...safeAxiosOptions(target, 30000),
            headers: this.clinikoHeaders(config),
        });
        const types = res.data?.appointment_types || [];
        let synced = 0;
        for (const t of types) {
            await this.upsertItem(schemaName, {
                provider: 'cliniko', itemType: 'appointment_type',
                externalId: String(t.id),
                title: t.name,
                subtitle: t.category?.name,
                priceCents: t.billable_item?.price != null ? Math.round(Number(t.billable_item.price) * 100) : null,
                data: { durationInMinutes: t.duration_in_minutes, description: t.description },
            });
            synced++;
        }
        this.logger.log(`[Cliniko] Synced ${synced} appointment types`);
        return { synced };
    }

    /** Live availability lookup for Cliniko (availability is dynamic, not synced). */
    async checkClinikoAvailability(tenantId: string, appointmentTypeId: string, from?: string, to?: string): Promise<any> {
        const gate = await this.getToolGate(tenantId, 'cliniko');
        if (!gate.allowed) return this.blockedToolResult(gate.health);
        const config: ClinikoConfig = await this.getConfig(tenantId, 'cliniko');
        if (!config) return { error: 'Cliniko no está configurado' };
        if (!config.businessId || !config.practitionerId) {
            return { error: 'Faltan businessId / practitionerId en la configuración de Cliniko' };
        }
        const fromDate = from || new Date().toISOString().split('T')[0];
        const toDate = to || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        try {
            const businessId = encodeURIComponent(this.validateClinikoIdentifier(config.businessId, 'negocio Cliniko'));
            const practitionerId = encodeURIComponent(this.validateClinikoIdentifier(config.practitionerId, 'profesional Cliniko'));
            const safeAppointmentTypeId = encodeURIComponent(this.validateClinikoIdentifier(appointmentTypeId, 'tipo de cita Cliniko'));
            const { baseUrl, target } = await this.prepareProviderEndpoint('cliniko', config.baseUrl);
            const url = `${baseUrl}/businesses/${businessId}/practitioners/${practitionerId}/appointment_types/${safeAppointmentTypeId}/available_times`;
            const res = await this.http.axiosRef.get(url, {
                ...safeAxiosOptions(target, 20000),
                headers: this.clinikoHeaders(config),
                params: { from: fromDate, to: toDate },
            });
            const times = (res.data?.available_times || []).slice(0, 20).map((t: any) => t.appointment_start);
            await this.updateHealth(tenantId, 'cliniko', {
                outcome: 'success',
                credentialValidated: true,
                grantedScopes: requiredScopesForProvider('cliniko'),
            });
            return { availableTimes: times };
        } catch (e: any) {
            const health = e instanceof BadRequestException
                ? gate.health
                : await this.updateHealth(
                    tenantId,
                    'cliniko',
                    this.failureObservation('cliniko', e),
                ).catch(() => gate.health);
            this.logger.warn(
                `[VI health] availability failed tenant=${tenantId} provider=cliniko `
                + `status=${health.status} code=${health.lastError?.code || 'invalid_request'}`,
            );
            return {
                availableTimes: [],
                error: e instanceof BadRequestException
                    ? 'Identificador de disponibilidad inválido'
                    : 'No se pudo obtener disponibilidad',
                integrationStatus: health.status,
            };
        }
    }

    // ── AI-facing read methods (used by tool executor) ───────
    private blockedToolResult(health: IntegrationHealth): Record<string, unknown> {
        return {
            error: 'integration_unavailable',
            provider: health.provider,
            integrationStatus: health.status,
            connected: health.connected,
            retryable: health.status === 'stale' || health.status === 'degraded',
            message: 'La integración externa no está saludable; no uses ni inventes sus datos.',
        };
    }

    async getMenuForAI(tenantId: string, schemaName: string): Promise<any> {
        const gate = await this.getToolGate(tenantId, 'toast');
        if (!gate.allowed) return this.blockedToolResult(gate.health);
        const rows = await this.listItemsInSchema(schemaName, 'toast', 'menu_item', 80);
        return {
            items: rows.map((r) => ({
                name: r.title, group: r.subtitle,
                price: r.price_cents != null ? Number(r.price_cents) / 100 : null,
                currency: r.currency || 'USD',
                description: r.data?.description,
            })),
            source: 'toast',
        };
    }

    async getScheduleForAI(tenantId: string, schemaName: string): Promise<any> {
        const gate = await this.getToolGate(tenantId, 'mindbody');
        if (!gate.allowed) return this.blockedToolResult(gate.health);
        const rows = await this.listItemsInSchema(schemaName, 'mindbody', 'class', 80);
        // El sync de Mindbody trae una ventana de ~14 días que caduca sola: sin
        // este filtro, a la semana de conectar la IA ofrecía clases que ya
        // habían pasado — el tenant perdía confianza justo después de configurar.
        const now = Date.now();
        const upcoming = rows.filter((r) => {
            const start = r.data?.startDateTime ? Date.parse(r.data.startDateTime) : NaN;
            return Number.isNaN(start) ? false : start >= now;
        });
        return {
            classes: upcoming.map((r) => ({
                name: r.title, staff: r.subtitle,
                start: r.data?.startDateTime, end: r.data?.endDateTime,
                available: r.data?.isAvailable !== false, location: r.data?.location,
            })),
            // Si el filtro vació la lista pero había filas, el sync está viejo:
            // decírselo al modelo evita que responda "no hay clases" a secas.
            stale: rows.length > 0 && upcoming.length === 0,
            source: 'mindbody',
        };
    }

    async getClinicServicesForAI(tenantId: string, schemaName: string): Promise<any> {
        const gate = await this.getToolGate(tenantId, 'cliniko');
        if (!gate.allowed) return this.blockedToolResult(gate.health);
        const rows = await this.listItemsInSchema(schemaName, 'cliniko', 'appointment_type', 80);
        return {
            services: rows.map((r) => ({
                id: r.external_id, name: r.title, category: r.subtitle,
                durationMinutes: r.data?.durationInMinutes,
                price: r.price_cents != null ? Number(r.price_cents) / 100 : null,
            })),
            source: 'cliniko',
        };
    }
}
