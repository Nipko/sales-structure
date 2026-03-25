import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

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
    async getContacts(tenantId: string): Promise<OrderContact[]> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return [];

        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(
                schema,
                `SELECT id, name, phone
                 FROM contacts
                 ORDER BY created_at DESC
                 LIMIT 200`,
            );

            return (rows || []).map((row: any) => ({
                id: row.id,
                name: row.name || 'Cliente',
                phone: row.phone || '',
            }));
        } catch (error) {
            this.logger.warn(`Could not load order contacts for tenant ${tenantId}: ${error}`);
            return [];
        }
    }

    /**
     * Create real order decrementing stock accordingly
     */
    async createOrder(tenantId: string, data: {
        contactId?: string | null;
        status?: 'pending' | 'confirmed' | 'paid' | 'cancelled';
        paymentMethod?: string;
        notes?: string;
        items: { productId: string; productName: string; quantity: number; unitPrice: number }[];
    }): Promise<{ id: string }> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant schema not found');

        await this.ensureOrdersTables(schema);

        let totalAmount = 0;
        data.items.forEach(i => totalAmount += (i.quantity * i.unitPrice));

        // Let's do this sequentially to allow the database to persist correctly
        const orderRes = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `INSERT INTO orders (id, contact_id, status, total_amount, currency, payment_method, notes, created_at, updated_at)
             VALUES (gen_random_uuid(), $1::uuid, $2, $3, 'COP', $4, $5, NOW(), NOW()) RETURNING id`,
            [data.contactId || null, data.status || 'pending', totalAmount, data.paymentMethod || 'cash', data.notes || '']
        );

        const orderId = orderRes?.[0]?.id;
        if (!orderId) throw new Error('Failed to create order');

        // Insert items and adjust stock
        for (const item of data.items) {
            const totalPrice = item.quantity * item.unitPrice;
            await this.prisma.executeInTenantSchema(
                schema,
                `INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, total_price)
                 VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, $5, $6)`,
                [orderId, item.productId, item.productName, item.quantity, item.unitPrice, totalPrice]
            );

            // Deduct stock if there is a matching product
            try {
                // Ensure inventory table exists to avoid crashes if it doesn't
                const productCheck = await this.prisma.executeInTenantSchema<any[]>(
                    schema, `SELECT stock FROM products WHERE id = $1::uuid LIMIT 1`, [item.productId]
                );

                if (productCheck && productCheck.length > 0) {
                    const currentStock = parseInt(productCheck[0].stock) || 0;
                    const newStock = Math.max(0, currentStock - item.quantity);

                    await this.prisma.executeInTenantSchema(
                        schema,
                        `UPDATE products SET stock = $1, updated_at = NOW() WHERE id = $2::uuid`,
                        [newStock, item.productId]
                    );

                    await this.prisma.executeInTenantSchema(
                        schema,
                        `INSERT INTO stock_movements (id, product_id, type, quantity, previous_stock, new_stock, reason, created_at)
                          VALUES (gen_random_uuid(), $1::uuid, 'out', $2, $3, $4, $5, NOW())`,
                        [item.productId, item.quantity, currentStock, newStock, `Orden ${orderId.slice(0, 8)}`]
                    );
                }
            } catch (err) {
                this.logger.warn(`Could not deduct stock for product ${item.productId} in tenant ${tenantId}. It might be deleted or not have inventory setup.`);
            }
        }

        return { id: orderId };
    }

    /**
     * Update order status
     */
    async updateOrderStatus(tenantId: string, orderId: string, status: string): Promise<void> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant schema not found');

        await this.prisma.executeInTenantSchema(
            schema,
            `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2::uuid`,
            [status, orderId]
        );
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
            paymentMethod: o.payment_method || 'cash',
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

    /**
     * Schema runtime setups
     */
    private async ensureOrdersTables(schema: string): Promise<void> {
        const cacheKey = `orders:tables:${schema}`;
        const cached = await this.redis.get(cacheKey);
        if (cached) return;

        try {
            await this.prisma.$queryRawUnsafe(`
                CREATE TABLE IF NOT EXISTS "${schema}".orders (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    contact_id UUID REFERENCES "${schema}".contacts(id) ON DELETE SET NULL,
                    status VARCHAR(50) DEFAULT 'pending',
                    total_amount DECIMAL(12,2) DEFAULT 0,
                    currency VARCHAR(3) DEFAULT 'COP',
                    payment_method VARCHAR(50) DEFAULT 'cash',
                    notes TEXT DEFAULT '',
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS "${schema}".order_items (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    order_id UUID REFERENCES "${schema}".orders(id) ON DELETE CASCADE,
                    product_id UUID,
                    product_name VARCHAR(255) NOT NULL,
                    quantity INTEGER NOT NULL DEFAULT 1,
                    unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
                    total_price DECIMAL(12,2) NOT NULL DEFAULT 0
                );

                CREATE INDEX IF NOT EXISTS idx_orders_contact ON "${schema}".orders(contact_id);
                CREATE INDEX IF NOT EXISTS idx_orders_status ON "${schema}".orders(status);
            `);

            await this.redis.set(cacheKey, 'true', 86400); // 24h
        } catch (error) {
            this.logger.warn(`Could not create orders tables in ${schema}: ${error}`);
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
                <p style="font-size: 13px; color: #636e72;">Medio: ${orderRow.payment_method}</p>
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
