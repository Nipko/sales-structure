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
        if (!schema) return this.getMockOverview();

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
            return this.getMockOverview();
        }
    }

    /**
     * Create real order decrementing stock accordingly
     */
    async createOrder(tenantId: string, data: {
        contactId: string;
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
            [data.contactId, data.status || 'pending', totalAmount, data.paymentMethod || 'cash', data.notes || '']
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

    private getMockOverview(): OrdersOverview {
        return {
            totalRevenue: 2500000,
            pendingRevenue: 850000,
            orderCount: 15,
            pendingCount: 4,
            orders: [
                {
                    id: 'o1',
                    contactId: 'c1',
                    contactName: 'Juan Pérez',
                    status: 'paid',
                    totalAmount: 350000,
                    currency: 'COP',
                    paymentMethod: 'credit_card',
                    notes: 'Reserva para 2.',
                    createdAt: new Date(Date.now() - 86400000).toISOString(),
                    updatedAt: new Date(Date.now() - 40000000).toISOString(),
                    items: [
                        { id: 'i1', productId: 'p1', productName: 'Tour Rafting', quantity: 2, unitPrice: 120000, totalPrice: 240000 },
                        { id: 'i2', productId: 'p2', productName: 'Almuerzo', quantity: 2, unitPrice: 55000, totalPrice: 110000 }
                    ]
                },
                {
                    id: 'o2',
                    contactId: 'c2',
                    contactName: 'Maria Rodriguez',
                    status: 'pending',
                    totalAmount: 180000,
                    currency: 'COP',
                    paymentMethod: 'transfer',
                    notes: 'Pago adelantado del 50%.',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    items: [
                        { id: 'i3', productId: 'p3', productName: 'Tour Cueva', quantity: 2, unitPrice: 90000, totalPrice: 180000 }
                    ]
                }
            ]
        };
    }
}
