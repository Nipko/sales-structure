import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import * as crypto from 'crypto';
import {
    type PinnedHttpsTarget,
    parseSafeHttpsUrl,
    pinSafeHttpsUrl,
    safeAxiosOptions,
} from '../../common/utils/safe-outbound-url.util';

export interface EcommerceConfig {
    provider: 'shopify' | 'woocommerce';
    shopUrl: string;
    apiKey: string;
    apiSecret: string;
    accessToken?: string;
    webhookSecret?: string;
    syncProducts: boolean;
    // syncOrders y cartAbandonmentEnabled NO estan: eran flags fantasma.
    // Se persistian en la config del tenant y NINGUN codigo los leia — o sea
    // que el producto guardaba la promesa de sincronizar pedidos y de
    // recuperar carritos abandonados, y no corria ni una ni otra.
    // handleCartAbandonment existe (linea ~251) y tiene cero llamadores; el
    // dia que se conecte de verdad, el flag vuelve.
}

@Injectable()
export class EcommerceService {
    private readonly logger = new Logger(EcommerceService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly http: HttpService,
    ) {}

    private async prepareShopTarget(
        provider: EcommerceConfig['provider'],
        rawUrl: unknown,
    ): Promise<{ baseUrl: string; target: PinnedHttpsTarget }> {
        const parsed = parseSafeHttpsUrl(rawUrl, 'tienda');
        if (parsed.search || parsed.hash || parsed.pathname !== '/') {
            throw new BadRequestException('La URL de la tienda debe contener solo el origen HTTPS');
        }
        if (provider === 'shopify' && !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(parsed.hostname)) {
            throw new BadRequestException('Shopify requiere el dominio oficial de la tienda en myshopify.com');
        }

        const target = await pinSafeHttpsUrl(parsed, 'tienda');
        return { baseUrl: target.url.origin, target };
    }

    async getConfig(tenantId: string): Promise<EcommerceConfig | null> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        return (tenant?.settings as any)?.ecommerce || null;
    }

    async updateConfig(tenantId: string, config: Partial<EcommerceConfig>): Promise<EcommerceConfig> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');

        const settings = (tenant.settings as any) || {};
        const current = settings.ecommerce || {};

        const merged: EcommerceConfig = {
            provider: config.provider ?? current.provider ?? 'shopify',
            shopUrl: config.shopUrl ?? current.shopUrl ?? '',
            apiKey: config.apiKey ?? current.apiKey ?? '',
            apiSecret: config.apiSecret ?? current.apiSecret ?? '',
            accessToken: config.accessToken ?? current.accessToken,
            webhookSecret: config.webhookSecret ?? current.webhookSecret ?? crypto.randomBytes(32).toString('hex'),
            syncProducts: config.syncProducts ?? current.syncProducts ?? true,
        };

        if (!['shopify', 'woocommerce'].includes(merged.provider)) {
            throw new BadRequestException('Proveedor de e-commerce no soportado');
        }
        merged.shopUrl = (await this.prepareShopTarget(merged.provider, merged.shopUrl)).baseUrl;

        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: { settings: { ...settings, ecommerce: { ...merged } } as any },
        });

        await this.redis.del(`ecommerce:${tenantId}`);
        return merged;
    }

    async ensureTables(schemaName: string): Promise<void> {
        // DDL cannot go through executeInTenantSchema (it runs its statement via
        // $queryRawUnsafe), so the schema name is interpolated by hand below and
        // this is the only thing standing between a caller that hands over a
        // tenantId and a raw Postgres 3F000 from the bottom of the stack.
        this.prisma.assertTenantSchemaName(schemaName);

        const exists: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ecommerce_products'`,
            schemaName,
        );
        if (exists.length > 0) return;

        await this.prisma.$queryRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "${schemaName}".ecommerce_products (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                external_id TEXT NOT NULL,
                provider TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                handle TEXT,
                vendor TEXT,
                product_type TEXT,
                price_cents INT,
                currency TEXT DEFAULT 'USD',
                compare_at_price_cents INT,
                image_url TEXT,
                images TEXT[] DEFAULT '{}',
                variants JSONB DEFAULT '[]',
                tags TEXT[] DEFAULT '{}',
                status TEXT DEFAULT 'active',
                inventory_quantity INT DEFAULT 0,
                synced_at TIMESTAMPTZ DEFAULT now(),
                created_at TIMESTAMPTZ DEFAULT now(),
                UNIQUE(external_id, provider)
            )
        `);

        await this.prisma.$queryRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "${schemaName}".abandoned_carts (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                external_id TEXT,
                provider TEXT NOT NULL,
                contact_id UUID,
                contact_phone TEXT,
                contact_email TEXT,
                items JSONB DEFAULT '[]',
                total_cents INT DEFAULT 0,
                currency TEXT DEFAULT 'USD',
                checkout_url TEXT,
                status TEXT DEFAULT 'abandoned',
                recovery_sent_at TIMESTAMPTZ,
                recovered_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT now()
            )
        `);

        this.logger.log(`E-commerce tables created for schema ${schemaName}`);
    }

    async syncShopifyProducts(tenantId: string): Promise<{ synced: number }> {
        const config = await this.getConfig(tenantId);
        if (!config || config.provider !== 'shopify') throw new BadRequestException('Shopify not configured');
        const { baseUrl, target } = await this.prepareShopTarget('shopify', config.shopUrl);

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { schemaName: true },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');
        await this.ensureTables(tenant.schemaName);

        const url = `${baseUrl}/admin/api/2024-01/products.json?limit=250`;
        const response = await this.http.axiosRef.get(url, {
            ...safeAxiosOptions(target, 30000),
            headers: { 'X-Shopify-Access-Token': config.accessToken },
        });

        const products = response.data?.products || [];
        let synced = 0;

        // One transaction for the whole page, not one per product. Routing each
        // upsert through executeInTenantSchema would open 250 transactions per
        // Shopify page against PgBouncer for what is a single bulk import.
        await this.prisma.transactionInTenantSchema(tenant.schemaName, async (query) => {
        for (const p of products) {
            const variant = p.variants?.[0];
            await query(`
                INSERT INTO ecommerce_products
                (external_id, provider, title, description, handle, vendor, product_type,
                 price_cents, currency, compare_at_price_cents, image_url, images, tags, status, inventory_quantity, synced_at)
                VALUES ($1, 'shopify', $2, $3, $4, $5, $6, $7, 'USD',
                        $8, $9, $10::text[], $11::text[], $12, $13, now())
                ON CONFLICT (external_id, provider) DO UPDATE SET
                    title = EXCLUDED.title, description = EXCLUDED.description,
                    price_cents = EXCLUDED.price_cents, image_url = EXCLUDED.image_url,
                    images = EXCLUDED.images, status = EXCLUDED.status,
                    inventory_quantity = EXCLUDED.inventory_quantity, synced_at = now()
            `, [
                String(p.id), p.title, p.body_html || '',
                p.handle || '', p.vendor || '', p.product_type || '',
                variant ? Math.round(parseFloat(variant.price || '0') * 100) : 0,
                variant?.compare_at_price ? Math.round(parseFloat(variant.compare_at_price) * 100) : null,
                p.image?.src || null,
                (p.images || []).map((img: any) => img.src),
                p.tags ? p.tags.split(',').map((t: string) => t.trim()) : [],
                p.status || 'active',
                variant?.inventory_quantity || 0,
            ]);
            synced++;
        }
        });

        this.logger.log(`Synced ${synced} Shopify products for tenant ${tenantId}`);
        return { synced };
    }

    async syncWooCommerceProducts(tenantId: string): Promise<{ synced: number }> {
        const config = await this.getConfig(tenantId);
        if (!config || config.provider !== 'woocommerce') throw new BadRequestException('WooCommerce not configured');
        const { baseUrl, target } = await this.prepareShopTarget('woocommerce', config.shopUrl);

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { schemaName: true },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');
        await this.ensureTables(tenant.schemaName);

        const auth = Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64');
        const url = `${baseUrl}/wp-json/wc/v3/products?per_page=100`;
        const response = await this.http.axiosRef.get(url, {
            ...safeAxiosOptions(target, 30000),
            headers: { Authorization: `Basic ${auth}` },
        });

        const products = response.data || [];
        let synced = 0;

        // Same reasoning as the Shopify loop above: one transaction per page.
        await this.prisma.transactionInTenantSchema(tenant.schemaName, async (query) => {
        for (const p of products) {
            await query(`
                INSERT INTO ecommerce_products
                (external_id, provider, title, description, handle, price_cents, currency,
                 compare_at_price_cents, image_url, images, tags, status, inventory_quantity, synced_at)
                VALUES ($1, 'woocommerce', $2, $3, $4, $5, 'USD', $6, $7, $8::text[], $9::text[], $10, $11, now())
                ON CONFLICT (external_id, provider) DO UPDATE SET
                    title = EXCLUDED.title, description = EXCLUDED.description,
                    price_cents = EXCLUDED.price_cents, image_url = EXCLUDED.image_url,
                    status = EXCLUDED.status, inventory_quantity = EXCLUDED.inventory_quantity, synced_at = now()
            `, [
                String(p.id), p.name, p.description || '',
                p.slug || '', Math.round(parseFloat(p.price || '0') * 100),
                p.regular_price ? Math.round(parseFloat(p.regular_price) * 100) : null,
                p.images?.[0]?.src || null,
                (p.images || []).map((img: any) => img.src),
                (p.tags || []).map((t: any) => t.name),
                p.status || 'publish',
                p.stock_quantity || 0,
            ]);
            synced++;
        }
        });

        this.logger.log(`Synced ${synced} WooCommerce products for tenant ${tenantId}`);
        return { synced };
    }

    async listProducts(tenantId: string, filters?: {
        status?: string; search?: string; limit?: number; offset?: number;
    }): Promise<{ items: any[]; total: number }> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureTables(schemaName);
        const conditions: string[] = [];
        const params: any[] = [];
        let idx = 1;

        if (filters?.status) { conditions.push(`status = $${idx++}`); params.push(filters.status); }
        if (filters?.search) { conditions.push(`title ILIKE $${idx++}`); params.push(`%${filters.search}%`); }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = filters?.limit || 50;
        const offset = filters?.offset || 0;

        const countResult = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT COUNT(*)::int as total FROM ecommerce_products ${where}`,
            params,
        );

        params.push(limit, offset);
        const items = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM ecommerce_products ${where}
             ORDER BY synced_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
            params,
        );

        return { items, total: countResult[0]?.total || 0 };
    }

    async handleCartAbandonment(tenantId: string, data: {
        externalId?: string; provider: string; contactPhone?: string;
        contactEmail?: string; items: any[]; totalCents: number;
        currency?: string; checkoutUrl?: string;
    }): Promise<any> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureTables(schemaName);
        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName, `
            INSERT INTO abandoned_carts
            (external_id, provider, contact_phone, contact_email, items, total_cents, currency, checkout_url)
            VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
            RETURNING *
        `, [
            data.externalId || null, data.provider,
            data.contactPhone || null, data.contactEmail || null,
            JSON.stringify(data.items), data.totalCents,
            data.currency || 'USD', data.checkoutUrl || null,
        ]);
        return rows[0];
    }

    /**
     * Tenant-scoped entry point for HTTP callers, which only ever hold a
     * tenantId. Kept separate from searchProductsForAI because the AI tool
     * executor already runs with the schema resolved for the whole turn.
     */
    async searchProductsForAIByTenant(tenantId: string, query: {
        search?: string; maxPrice?: number; category?: string;
    }, options?: { createTablesIfMissing?: boolean }): Promise<any[]> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        return this.searchProductsForAI(schemaName, query, options);
    }

    async searchProductsForAI(schemaName: string, query: {
        search?: string; maxPrice?: number; category?: string;
    }, options?: { createTablesIfMissing?: boolean }): Promise<any[]> {
        // The existence probe below binds the schema as a parameter, so a wrong
        // value would just return "no catalog" and hand the customer an empty
        // store instead of an error. Fail loudly before that can happen.
        this.prisma.assertTenantSchemaName(schemaName);

        if (options?.createTablesIfMissing === false) {
            // Agent Test is read-only and runs against the real tenant schema. If
            // ecommerce has never been provisioned, an empty result is safer than
            // lazily creating tables from an introspection endpoint.
            const exists: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ecommerce_products'`,
                schemaName,
            );
            if (exists.length === 0) return [];
        } else {
            await this.ensureTables(schemaName);
        }
        const conditions: string[] = [`status = 'active'`];
        const params: any[] = [];
        let idx = 1;

        if (query.search) { conditions.push(`title ILIKE $${idx++}`); params.push(`%${query.search}%`); }
        if (query.maxPrice) { conditions.push(`price_cents <= $${idx++}`); params.push(query.maxPrice); }
        if (query.category) { conditions.push(`product_type = $${idx++}`); params.push(query.category); }

        return this.prisma.executeInTenantSchema<any[]>(schemaName, `
            SELECT external_id, title, price_cents, currency, image_url, inventory_quantity, handle
            FROM ecommerce_products
            WHERE ${conditions.join(' AND ')}
            ORDER BY price_cents ASC
            LIMIT 10
        `, params);
    }
}
