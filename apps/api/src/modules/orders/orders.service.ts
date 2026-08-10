import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { requireTenantContact } from '../../common/utils/tenant-contact.util';
import { resolveNativeEvidenceOpportunity } from '../../common/utils/native-evidence-opportunity.util';

function normalizeOrderCurrencyCode(value: unknown, fallback = 'COP'): string {
    const candidate = typeof value === 'string' && value.trim()
        ? value.trim().toUpperCase()
        : fallback;
    if (!/^[A-Z]{3}$/.test(candidate)) {
        throw new BadRequestException('currency must be a three-letter uppercase code');
    }
    return candidate;
}

const ORDER_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INITIAL_ORDER_STATUSES = new Set(['pending', 'confirmed', 'paid']);

// ============================================
// Types
// ============================================

export interface OrderItem {
    id: string;
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
}

export interface Order {
    id: string;
    contactId: string;
    contactName: string;
    status: 'pending' | 'confirmed' | 'paid' | 'cancelled';
    totalAmount: number;
    currency: string;
    paymentMethod: string;
    notes: string;
    createdAt: string;
    updatedAt: string;
    items: OrderItem[];
}

export interface OrdersOverview {
    totalRevenue: number;
    pendingRevenue: number;
    orderCount: number;
    pendingCount: number;
    orders: Order[];
}

export interface OrderContact {
    id: string;
    name: string;
    phone: string;
    email: string;
}

export interface OrderContactPage {
    items: OrderContact[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
}

// ============================================
// Service
// ============================================

@Injectable()
export class OrdersService {
    private readonly logger = new Logger(OrdersService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
    ) { }

    /**
     * Get orders overview
     */
    async getOverview(tenantId: string): Promise<OrdersOverview> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return this.buildEmptyOverview();

        try {
            await this.ensureOrdersTables(schema);

            const ordersQuery = await this.prisma.executeInTenantSchema<any[]>(
                schema,
                `SELECT o.*, c.name as contact_name
                 FROM orders o
                 LEFT JOIN contacts c ON o.contact_id = c.id
                 ORDER BY o.created_at DESC`
            );

            if (!ordersQuery || ordersQuery.length === 0) {
                return { totalRevenue: 0, pendingRevenue: 0, orderCount: 0, pendingCount: 0, orders: [] };
            }

            const itemsQuery = await this.prisma.executeInTenantSchema<any[]>(
                schema,
                `SELECT * FROM order_items`
            );

            // Group items by order_id
            const itemsByOrder: Record<string, any[]> = {};
            if (itemsQuery) {
                for (const item of itemsQuery) {
                    if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
                    itemsByOrder[item.order_id].push(item);
                }
            }

            const orders: Order[] = ordersQuery.map(o => this.mapOrder(o, itemsByOrder[o.id] || []));

            const totalRevenue = orders.filter(o => o.status === 'paid').reduce((sum, o) => sum + o.totalAmount, 0);
            const pendingRevenue = orders.filter(o => o.status === 'pending' || o.status === 'confirmed').reduce((sum, o) => sum + o.totalAmount, 0);
            const pendingCount = orders.filter(o => o.status === 'pending' || o.status === 'confirmed').length;

            return {
                totalRevenue,
                pendingRevenue,
                orderCount: orders.length,
                pendingCount,
                orders,
            };
        } catch (error) {
            this.logger.error(`Error getting orders overview: ${error}`);
            return this.buildEmptyOverview();
        }
    }

    /**
     * List contacts available for order creation
     */
    async getContacts(
        tenantId: string,
        options: { search?: string; limit?: number; offset?: number } = {},
    ): Promise<OrderContactPage> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new NotFoundException('Tenant schema not found');

        const requestedLimit = options.limit ?? 50;
        const requestedOffset = options.offset ?? 0;
        if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
            throw new BadRequestException('limit must be a positive integer');
        }
        if (!Number.isInteger(requestedOffset) || requestedOffset < 0) {
            throw new BadRequestException('offset must be a non-negative integer');
        }
        const limit = Math.min(requestedLimit, 100);
        const offset = requestedOffset;
        const search = typeof options.search === 'string' ? options.search.trim() : '';
        const params: any[] = [];
        let where = '';
        if (search) {
            params.push(`%${search}%`);
            where = 'WHERE name ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1';
        }

        const countRows = await this.prisma.executeInTenantSchema<Array<{ total: number }>>(
            schema,
            `SELECT COUNT(*)::int AS total FROM contacts ${where}`,
            params,
        );
        const total = Number(countRows?.[0]?.total || 0);
        const limitParam = params.length + 1;
        const offsetParam = params.length + 2;
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT id, name, phone, email
             FROM contacts
             ${where}
             ORDER BY created_at DESC, id DESC
             LIMIT $${limitParam} OFFSET $${offsetParam}`,
            [...params, limit, offset],
        );

        const items = (rows || []).map((row: any) => ({
            id: row.id,
            name: row.name || 'Cliente',
            phone: row.phone || '',
            email: row.email || '',
        }));
        return { items, total, limit, offset, hasMore: offset + items.length < total };
    }

    /**
     * Create real order decrementing stock accordingly
     */
    async createOrder(tenantId: string, data: {
        contactId?: string | null;
        conversationId?: string | null;
        opportunityId?: string | null;
        status?: 'pending' | 'confirmed' | 'paid';
        paymentMethod?: string;
        notes?: string;
        currency?: string;
        items: { productId: string; productName: string; quantity: number; unitPrice: number; currency?: string }[];
    }): Promise<{ id: string }> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant schema not found');

        await this.ensureOrdersTables(schema);
        if (!data || typeof data !== 'object') {
            throw new BadRequestException('Order payload is required');
        }
        if (data.contactId != null
            && (typeof data.contactId !== 'string' || !ORDER_UUID_PATTERN.test(data.contactId))) {
            throw new BadRequestException('contactId must be a valid UUID when provided');
        }
        const initialStatus = String(data.status || 'pending').trim().toLowerCase();
        if (!INITIAL_ORDER_STATUSES.has(initialStatus)) {
            throw new BadRequestException('Initial order status must be pending, confirmed or paid');
        }
        if (!Array.isArray(data.items) || data.items.length < 1 || data.items.length > 100) {
            throw new BadRequestException('Order must have between 1 and 100 items');
        }
        const requested = new Map<string, number>();
        for (const item of data.items) {
            if (!ORDER_UUID_PATTERN.test(String(item.productId || ''))) {
                throw new BadRequestException('Each productId must be a valid UUID');
            }
            if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10_000) {
                throw new BadRequestException('Each quantity must be a positive integer');
            }
            if (requested.has(item.productId)) {
                throw new BadRequestException('Duplicate productId in order');
            }
            requested.set(item.productId, item.quantity);
        }
        const productIds = [...requested.keys()];

        // One tenant-scoped transaction owns the catalog snapshots, header,
        // lines and stock movements. Names, prices and currency come from the
        // locked catalog, so a client cannot lower a price or invent stock.
        return this.prisma.transactionInTenantSchema(schema, async (query) => {
            const canonicalContactId = await requireTenantContact(query, data.contactId || null);
            const opportunityId = await resolveNativeEvidenceOpportunity(query, {
                contactId: canonicalContactId,
                conversationId: data.conversationId,
                trustedOpportunityId: data.opportunityId,
            });
            const products = await query<any[]>(
                `SELECT id, name, price, currency, stock, is_available
                   FROM products
                  WHERE id = ANY($1::uuid[])
                  FOR UPDATE`,
                [productIds],
            );
            if (products.length !== productIds.length) {
                throw new NotFoundException('One or more products do not exist');
            }
            const byId = new Map(products.map((product: any) => [product.id, product]));
            const currencies = new Set<string>();
            let totalAmount = 0;
            for (const [productId, quantity] of requested) {
                const product = byId.get(productId);
                if (!product || product.is_available === false) {
                    throw new ConflictException('One or more products are unavailable');
                }
                const stock = Number(product.stock || 0);
                if (!Number.isInteger(stock) || stock < quantity) {
                    throw new ConflictException(`Insufficient stock for ${product.name || productId}`);
                }
                const price = Number(product.price);
                if (!Number.isFinite(price) || price < 0) {
                    throw new ConflictException('A catalog product has an invalid price');
                }
                currencies.add(normalizeOrderCurrencyCode(product.currency));
                totalAmount += price * quantity;
            }
            if (currencies.size !== 1) {
                throw new BadRequestException('All order items must use the same currency');
            }
            const currency = [...currencies][0];
            if (data.currency && normalizeOrderCurrencyCode(data.currency) !== currency) {
                throw new BadRequestException('Order currency does not match the catalog');
            }

            const orderRows = await query<any[]>(
                `INSERT INTO orders (
                    id, contact_id, opportunity_id, conversation_id, status, total_amount, currency, notes,
                    metadata, created_at, updated_at
                 ) VALUES (
                    gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7,
                    $8::jsonb, NOW(), NOW()
                 ) RETURNING id`,
                [
                    canonicalContactId,
                    opportunityId,
                    data.conversationId || null,
                    initialStatus,
                    totalAmount,
                    currency,
                    data.notes || '',
                    JSON.stringify({ payment_method: data.paymentMethod || 'cash' }),
                ],
            );
            const orderId = orderRows?.[0]?.id;
            if (!orderId) throw new Error('Failed to create order');

            for (const [productId, quantity] of requested) {
                const product = byId.get(productId);
                const unitPrice = Number(product.price);
                const previousStock = Number(product.stock);
                const newStock = previousStock - quantity;
                await query(
                    `INSERT INTO order_items (
                        id, order_id, product_id, product_name,
                        quantity, unit_price, total_price
                     ) VALUES (
                        gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, $5, $6
                     )`,
                    [orderId, productId, product.name, quantity, unitPrice, unitPrice * quantity],
                );
                const updated = await query<any[]>(
                    `UPDATE products
                        SET stock = stock - $2, updated_at = NOW()
                      WHERE id = $1::uuid AND stock >= $2
                    RETURNING stock`,
                    [productId, quantity],
                );
                if (!updated.length) throw new ConflictException(`Insufficient stock for ${product.name}`);
                await query(
                    `INSERT INTO stock_movements (
                        id, product_id, type, quantity, previous_stock,
                        new_stock, reason, created_at
                     ) VALUES (
                        gen_random_uuid(), $1::uuid, 'out', $2, $3, $4, $5, NOW()
                     )`,
                    [productId, quantity, previousStock, newStock, `Orden ${orderId.slice(0, 8)}`],
                );
            }
            return { id: orderId };
        });
    }

    /**
     * Update order status
     */
    async updateOrderStatus(
        tenantId: string,
        orderId: string,
        status: string,
        actorRole?: string,
    ): Promise<void> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant schema not found');
        const next = String(status || '').trim().toLowerCase();
        const allowed: Record<string, string[]> = {
            pending: ['confirmed', 'cancelled'],
            confirmed: ['paid', 'cancelled'],
        };
        if (!['confirmed', 'paid', 'cancelled'].includes(next)) {
            throw new BadRequestException('Invalid order status');
        }
        if (next === 'cancelled' && !this.canCancelOrder(actorRole)) {
            throw new ForbiddenException('Only tenant administrators and supervisors can cancel orders');
        }

        await this.prisma.transactionInTenantSchema(schema, async (query) => {
            const orders = await query<any[]>(
                `SELECT id, status FROM orders WHERE id = $1::uuid FOR UPDATE`,
                [orderId],
            );
            const order = orders[0];
            if (!order) throw new NotFoundException('Order not found');
            const current = String(order.status || '').toLowerCase();
            if (!allowed[current]?.includes(next)) {
                throw new ConflictException(`Order cannot transition from ${current} to ${next}`);
            }

            if (next === 'cancelled') {
                const items = await query<any[]>(
                    `SELECT product_id, product_name, quantity
                       FROM order_items
                      WHERE order_id = $1::uuid
                      FOR UPDATE`,
                    [orderId],
                );
                for (const item of items) {
                    const locked = await query<any[]>(
                        `SELECT stock FROM products WHERE id = $1::uuid FOR UPDATE`,
                        [item.product_id],
                    );
                    if (!locked.length) continue;
                    const previousStock = Number(locked[0].stock || 0);
                    const quantity = Number(item.quantity || 0);
                    const newStock = previousStock + quantity;
                    await query(
                        `UPDATE products SET stock = $2, updated_at = NOW() WHERE id = $1::uuid`,
                        [item.product_id, newStock],
                    );
                    await query(
                        `INSERT INTO stock_movements (
                            id, product_id, type, quantity, previous_stock,
                            new_stock, reason, created_at
                         ) VALUES (
                            gen_random_uuid(), $1::uuid, 'in', $2, $3, $4, $5, NOW()
                         )`,
                        [item.product_id, quantity, previousStock, newStock, `Cancelación orden ${orderId.slice(0, 8)}`],
                    );
                }
            }

            await query(
                `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2::uuid`,
                [next, orderId],
            );
        });
    }

    /**
     * Map rows to objects
     */
    private mapOrder(o: any, items: any[]): Order {
        return {
            id: o.id,
            contactId: o.contact_id,
            contactName: o.contact_name || 'Consumidor Final',
            status: o.status,
            totalAmount: parseFloat(o.total_amount) || 0,
            currency: o.currency || 'COP',
            paymentMethod: o.metadata?.payment_method || 'cash',
            notes: o.notes || '',
            createdAt: o.created_at?.toISOString?.() || new Date().toISOString(),
            updatedAt: o.updated_at?.toISOString?.() || new Date().toISOString(),
            items: items.map(i => ({
                id: i.id,
                productId: i.product_id,
                productName: i.product_name,
                quantity: parseInt(i.quantity) || 0,
                unitPrice: parseFloat(i.unit_price) || 0,
                totalPrice: parseFloat(i.total_price) || 0,
            }))
        };
    }

    private canCancelOrder(role?: string): boolean {
        return role === 'tenant_admin' || role === 'tenant_supervisor' || role === 'super_admin';
    }

    /**
     * Schema runtime setups
     */
    private async ensureOrdersTables(schema: string): Promise<void> {
        const cacheKey = `orders:tables:v2:${schema}`;
        const cached = await this.redis.get(cacheKey);
        if (cached) return;

        try {
            await this.prisma.$queryRawUnsafe(`
                CREATE TABLE IF NOT EXISTS "${schema}".orders (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    contact_id UUID REFERENCES "${schema}".contacts(id) ON DELETE SET NULL,
                    opportunity_id UUID REFERENCES "${schema}".opportunities(id) ON DELETE RESTRICT,
                    conversation_id UUID REFERENCES "${schema}".conversations(id) ON DELETE SET NULL,
                    status VARCHAR(50) DEFAULT 'pending',
                    total_amount DECIMAL(12,2) DEFAULT 0,
                    currency VARCHAR(3) DEFAULT 'COP',
                    payment_status VARCHAR(50) DEFAULT 'pending',
                    payment_reference VARCHAR(255),
                    notes TEXT DEFAULT '',
                    metadata JSONB DEFAULT '{}',
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            `);

            await this.prisma.$queryRawUnsafe(`
                ALTER TABLE "${schema}".orders
                ADD COLUMN IF NOT EXISTS opportunity_id UUID
            `);

            await this.prisma.$queryRawUnsafe(`
                CREATE INDEX IF NOT EXISTS idx_orders_opportunity_id
                ON "${schema}".orders(opportunity_id)
                WHERE opportunity_id IS NOT NULL
            `);

            await this.prisma.$queryRawUnsafe(`
                CREATE TABLE IF NOT EXISTS "${schema}".order_items (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    order_id UUID REFERENCES "${schema}".orders(id) ON DELETE CASCADE,
                    product_id UUID,
                    product_name VARCHAR(255) NOT NULL,
                    quantity INTEGER NOT NULL DEFAULT 1,
                    unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
                    total_price DECIMAL(12,2) NOT NULL DEFAULT 0
                )
            `);

            await this.prisma.$queryRawUnsafe(`
                CREATE INDEX IF NOT EXISTS idx_orders_contact ON "${schema}".orders(contact_id)
            `);

            await this.prisma.$queryRawUnsafe(`
                CREATE INDEX IF NOT EXISTS idx_orders_status ON "${schema}".orders(status)
            `);

            // A lazy-created/existing orders table must receive the same exact
            // ownership FK + guard as schemas migrated during API startup.
            await this.prisma.ensureNativeEvidenceOpportunityOwnershipForTable(schema, 'orders');

            await this.redis.set(cacheKey, 'true', 86400); // 24h
        } catch (error) {
            this.logger.warn(`Could not create orders tables in ${schema}: ${error}`);
            throw error;
        }
    }

    private async getTenantSchema(tenantId: string): Promise<string | null> {
        const cached = await this.redis.get(`tenant:${tenantId}:schema`);
        if (cached) return cached;
        const tenant = await this.prisma.$queryRaw<any[]>`
  SELECT schema_name FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1
`;
        if (tenant?.[0]) {
            await this.redis.set(`tenant:${tenantId}:schema`, tenant[0].schema_name, 3600);
            return tenant[0].schema_name;
        }
        return null;
    }

    private buildEmptyOverview(): OrdersOverview {
        return {
            totalRevenue: 0,
            pendingRevenue: 0,
            orderCount: 0,
            pendingCount: 0,
            orders: [],
        };
    }

    /**
     * Generate HTML Document for Order (Invoice / Quote)
     */
    async getInvoiceHtml(tenantId: string, orderId: string): Promise<string> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return '<html><body><h1>Tenant not found</h1></body></html>';

        const orderRes = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT o.*, c.name as contact_name
             FROM orders o LEFT JOIN contacts c ON o.contact_id = c.id
             WHERE o.id = $1::uuid LIMIT 1`, [orderId]
        );
        if (!orderRes || orderRes.length === 0) return '<html><body><h1>No se encontró la orden</h1></body></html>';
        const orderRow = orderRes[0];

        const itemsRows = await this.prisma.executeInTenantSchema<any[]>(
            schema, `SELECT * FROM order_items WHERE order_id = $1::uuid`, [orderId]
        ) || [];

        const tenantRes = await this.prisma.$queryRaw<any[]>`SELECT name FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1`;
        const tenantRow = tenantRes?.[0] || { name: 'Negocio Local' };

        const isPaid = orderRow.status === 'paid';
        const docTitle = isPaid ? 'FACTURA / RECIBO DE PAGO' : 'COTIZACIÓN / ORDEN PENDIENTE';
        const color = isPaid ? '#2ecc71' : '#6c5ce7';

        const formatCurrency = (n: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 0 }).format(parseFloat(n as any));
        const dateStr = new Date(orderRow.created_at).toLocaleDateString("es-CO", { day: '2-digit', month: 'long', year: 'numeric' });

        return `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>${docTitle} - ${orderRow.id.split('-')[0]}</title>
    <style>
        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 0; padding: 0; background: #f4f4f4; color: #333; }
        .container { max-width: 800px; margin: 40px auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #eee; padding-bottom: 20px; margin-bottom: 30px; }
        .business-name { font-size: 24px; font-weight: bold; color: #2d3436; margin: 0; }
        .doc-title { font-size: 20px; font-weight: bold; color: ${color}; margin: 0; text-align: right; text-transform: uppercase; }
        .doc-meta { font-size: 14px; color: #636e72; text-align: right; margin-top: 8px; }
        
        .info-section { display: flex; justify-content: space-between; margin-bottom: 30px; }
        .info-box { width: 48%; }
        .info-box h3 { margin: 0 0 10px 0; font-size: 14px; color: #b2bec3; text-transform: uppercase; }
        .info-box p { margin: 0 0 5px 0; font-size: 15px; font-weight: 500; }
        
        table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
        th { text-align: left; padding: 12px; background: #f8f9fa; color: #2d3436; font-size: 14px; border-bottom: 2px solid #eee; }
        td { padding: 12px; border-bottom: 1px solid #eee; font-size: 14px; }
        .text-right { text-align: right; }
        .text-center { text-align: center; }
        
        .totals { width: 300px; margin-left: auto; border-top: 2px solid ${color}; padding-top: 15px; }
        .total-row { display: flex; justify-content: space-between; font-size: 15px; margin-bottom: 10px; }
        .total-row.grand-total { font-size: 20px; font-weight: bold; color: ${color}; }
        
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #aaa; text-align: center; }
        
        @media print {
            body { background: white; margin: 0; }
            .container { box-shadow: none; margin: 0; padding: 0; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div>
                <h1 class="business-name">${tenantRow.name}</h1>
            </div>
            <div>
                <h2 class="doc-title">${docTitle}</h2>
                <div class="doc-meta">No. ${orderRow.id.split('-')[0].toUpperCase()}</div>
                <div class="doc-meta">Fecha: ${dateStr}</div>
            </div>
        </div>

        <div class="info-section">
            <div class="info-box">
                <h3>Facturar / Cotizar a</h3>
                <p>${orderRow.contact_name || 'Cliente / Consumidor Final'}</p>
            </div>
            <div class="info-box" style="text-align: right;">
                <h3>Estado</h3>
                <p style="color: ${color};">${isPaid ? 'Pagado' : (orderRow.status === 'confirmed' ? 'Confirmada (Crédito)' : 'Pendiente')}</p>
                <p style="font-size: 13px; color: #636e72;">Medio: ${orderRow.metadata?.payment_method || 'N/A'}</p>
            </div>
        </div>

        <table>
            <thead>
                <tr>
                    <th>Descripción del Producto / Servicio</th>
                    <th class="text-center">Cant.</th>
                    <th class="text-right">V. Unitario</th>
                    <th class="text-right">Total</th>
                </tr>
            </thead>
            <tbody>
                ${itemsRows.map(i => `
                <tr>
                    <td>${i.product_name}</td>
                    <td class="text-center">${i.quantity}</td>
                    <td class="text-right">${formatCurrency(i.unit_price)}</td>
                    <td class="text-right">${formatCurrency(i.total_price)}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>

        <div class="totals">
            <div class="total-row grand-total">
                <span>TOTAL</span>
                <span>${formatCurrency(orderRow.total_amount)}</span>
            </div>
        </div>

        <div style="margin-top: 30px;">
            <p style="font-size: 13px; color: #636e72;"><strong>Notas:</strong> ${orderRow.notes || 'Ninguna'}</p>
        </div>

        <div class="footer">
            Este documento ${isPaid ? 'es un comprobante de pago electrónico' : 'es una cotización sin validez fiscal hasta su cancelación'}.
            <br>Generado por Parallext Cloud.
        </div>
    </div>
</body>
</html>`;
    }
}
