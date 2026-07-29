import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export type VerticalProvider = 'toast' | 'mindbody' | 'cliniko';

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
const CONNECTED_CACHE_TTL = 300;

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
    ) {}

    // ── Config (tenant.settings) ─────────────────────────────
    async getConfig(tenantId: string, provider: VerticalProvider): Promise<any | null> {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
        return (tenant?.settings as any)?.verticalIntegrations?.[provider] || null;
    }

    async getAllConfigs(tenantId: string): Promise<Record<string, any>> {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
        const vi = (tenant?.settings as any)?.verticalIntegrations || {};
        // Mask secrets
        const out: Record<string, any> = {};
        for (const p of PROVIDERS) {
            if (vi[p]) {
                out[p] = { ...vi[p], clientSecret: vi[p].clientSecret ? '***' : undefined, apiKey: vi[p].apiKey ? '***' : undefined, password: vi[p].password ? '***' : undefined, connected: true };
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
        const current = vi[provider] || {};
        // Merge — keep existing secrets if masked/omitted
        const merged: any = { ...current, ...config, provider };
        const cfgAny = config as any;
        for (const secretKey of ['clientSecret', 'apiKey', 'password']) {
            if (cfgAny[secretKey] === '***' || cfgAny[secretKey] === undefined) {
                merged[secretKey] = current[secretKey];
            }
        }
        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: { settings: { ...settings, verticalIntegrations: { ...vi, [provider]: merged } } as any },
        });
        await this.redis.del(`vi:connected:${tenantId}`).catch(() => {});
        return merged;
    }

    async disconnect(tenantId: string, provider: VerticalProvider): Promise<void> {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
        if (!tenant) return;
        const settings = (tenant.settings as any) || {};
        const vi = settings.verticalIntegrations || {};
        delete vi[provider];
        await this.prisma.tenant.update({ where: { id: tenantId }, data: { settings: { ...settings, verticalIntegrations: vi } as any } });
        await this.redis.del(`vi:connected:${tenantId}`).catch(() => {});
    }

    /** Which providers are connected (cached). Used to gate AI tool registration. */
    async getConnectedProviders(tenantId: string): Promise<Record<VerticalProvider, boolean>> {
        const cacheKey = `vi:connected:${tenantId}`;
        const cached = await this.redis.getJson<Record<VerticalProvider, boolean>>(cacheKey);
        if (cached) return cached;
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
        const vi = (tenant?.settings as any)?.verticalIntegrations || {};
        const result = {
            toast: !!vi.toast?.clientId,
            mindbody: !!vi.mindbody?.apiKey,
            cliniko: !!vi.cliniko?.apiKey,
        } as Record<VerticalProvider, boolean>;
        await this.redis.setJson(cacheKey, result, CONNECTED_CACHE_TTL);
        return result;
    }

    // ── Synced-items table ───────────────────────────────────
    async ensureTables(schemaName: string): Promise<void> {
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

    async listItems(schemaName: string, provider?: string, itemType?: string, limit = 100): Promise<any[]> {
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
        await this.ensureTables(schemaName);
        const config = await this.getConfig(tenantId, provider);
        if (!config) throw new BadRequestException(`${provider} no está configurado`);

        switch (provider) {
            case 'toast': return this.syncToast(schemaName, config);
            case 'mindbody': return this.syncMindbody(schemaName, config);
            case 'cliniko': return this.syncCliniko(schemaName, config);
        }
    }

    async testConnection(tenantId: string, provider: VerticalProvider): Promise<{ ok: boolean; message?: string }> {
        const config = await this.getConfig(tenantId, provider);
        if (!config) return { ok: false, message: 'No configurado' };
        try {
            if (provider === 'toast') { await this.toastToken(config); return { ok: true }; }
            if (provider === 'mindbody') {
                await this.http.axiosRef.get('https://api.mindbodyonline.com/public/v6/site/sites', {
                    headers: { 'Api-Key': config.apiKey, SiteId: config.siteId }, timeout: 15000,
                });
                return { ok: true };
            }
            if (provider === 'cliniko') {
                await this.http.axiosRef.get(`${config.baseUrl.replace(/\/$/, '')}/appointment_types?per_page=1`, {
                    headers: this.clinikoHeaders(config), timeout: 15000,
                });
                return { ok: true };
            }
        } catch (e: any) {
            return { ok: false, message: e?.response?.status ? `HTTP ${e.response.status}` : e.message };
        }
        return { ok: false, message: 'Proveedor desconocido' };
    }

    // ── Toast (restaurantes) ─────────────────────────────────
    private async toastToken(config: ToastConfig): Promise<string> {
        const res = await this.http.axiosRef.post(
            `${config.hostname.replace(/\/$/, '')}/authentication/v1/authentication/login`,
            { clientId: config.clientId, clientSecret: config.clientSecret, userAccessType: 'TOAST_MACHINE_CLIENT' },
            { timeout: 15000 },
        );
        const token = res.data?.token?.accessToken;
        if (!token) throw new Error('Toast no devolvió token');
        return token;
    }

    private async syncToast(schemaName: string, config: ToastConfig): Promise<{ synced: number }> {
        const token = await this.toastToken(config);
        const res = await this.http.axiosRef.get(`${config.hostname.replace(/\/$/, '')}/menus/v2/menus`, {
            headers: { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': config.locationGuid },
            timeout: 30000,
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
        const res = await this.http.axiosRef.get(`${config.baseUrl.replace(/\/$/, '')}/appointment_types?per_page=100`, {
            headers: this.clinikoHeaders(config), timeout: 30000,
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
        const config: ClinikoConfig = await this.getConfig(tenantId, 'cliniko');
        if (!config) return { error: 'Cliniko no está configurado' };
        if (!config.businessId || !config.practitionerId) {
            return { error: 'Faltan businessId / practitionerId en la configuración de Cliniko' };
        }
        const fromDate = from || new Date().toISOString().split('T')[0];
        const toDate = to || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        try {
            const url = `${config.baseUrl.replace(/\/$/, '')}/businesses/${config.businessId}/practitioners/${config.practitionerId}/appointment_types/${appointmentTypeId}/available_times`;
            const res = await this.http.axiosRef.get(url, {
                headers: this.clinikoHeaders(config), params: { from: fromDate, to: toDate }, timeout: 20000,
            });
            const times = (res.data?.available_times || []).slice(0, 20).map((t: any) => t.appointment_start);
            return { availableTimes: times };
        } catch (e: any) {
            this.logger.warn(`[Cliniko] availability failed: ${e.message}`);
            return { availableTimes: [], error: 'No se pudo obtener disponibilidad' };
        }
    }

    // ── AI-facing read methods (used by tool executor) ───────
    async getMenuForAI(schemaName: string): Promise<any> {
        const rows = await this.listItems(schemaName, 'toast', 'menu_item', 80);
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

    async getScheduleForAI(schemaName: string): Promise<any> {
        const rows = await this.listItems(schemaName, 'mindbody', 'class', 80);
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

    async getClinicServicesForAI(schemaName: string): Promise<any> {
        const rows = await this.listItems(schemaName, 'cliniko', 'appointment_type', 80);
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
