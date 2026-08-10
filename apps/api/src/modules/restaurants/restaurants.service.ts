import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import {
    normalizeCurrencyCode,
    optionalPositiveIntegerUnit,
} from '../../common/utils/commercial-units.util';
import {
    assertOptionalContactId,
    requireTenantContact,
} from '../../common/utils/tenant-contact.util';
import { resolveNativeEvidenceOpportunity } from '../../common/utils/native-evidence-opportunity.util';

/**
 * Restaurants module — menu catalog, food orders, and promotions.
 *
 * Reservations of tables go through the generic appointments module;
 * the order pipeline (received → preparing → ready → delivered) lives
 * here because its semantics (line items, modifiers, delivery details,
 * payment status) don't fit appointments.
 *
 * Pricing snapshots: when an order is placed we copy name + unit_price
 * to food_order_items.name_snapshot / unit_price so menu renames or
 * price changes don't rewrite financial history.
 */
@Injectable()
export class RestaurantsService {
    private readonly logger = new Logger(RestaurantsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    // ── Categories ────────────────────────────────────────────────

    async listCategories(schemaName: string, includeInactive = false): Promise<any[]> {
        const where = includeInactive ? '' : 'WHERE is_active = true';
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM menu_categories ${where} ORDER BY sort_order, name`,
        );
    }

    async createCategory(schemaName: string, data: { name: string; description?: string; sortOrder?: number }): Promise<any> {
        if (!data.name) throw new BadRequestException('name is required');
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO menu_categories (name, description, sort_order)
             VALUES ($1, $2, $3) RETURNING *`,
            [data.name, data.description || null, data.sortOrder ?? 0],
        );
        return rows[0];
    }

    async updateCategory(schemaName: string, id: string, data: any): Promise<any> {
        const fields: string[] = [];
        const values: any[] = [];
        let i = 1;
        const map: Record<string, string> = { name: 'name', description: 'description', sortOrder: 'sort_order', isActive: 'is_active' };
        for (const [k, col] of Object.entries(map)) {
            if (k in data) { fields.push(`${col} = $${i++}`); values.push(data[k]); }
        }
        if (!fields.length) return this.getCategoryById(schemaName, id);
        fields.push(`updated_at = NOW()`);
        values.push(id);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE menu_categories SET ${fields.join(', ')} WHERE id = $${i}::uuid RETURNING *`,
            values,
        );
        if (!rows.length) throw new NotFoundException('Category not found');
        return rows[0];
    }

    async getCategoryById(schemaName: string, id: string): Promise<any> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM menu_categories WHERE id = $1::uuid`,
            [id],
        );
        return rows[0] || null;
    }

    async deleteCategory(schemaName: string, id: string): Promise<void> {
        // Soft delete — items keep their category_id reference for history
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE menu_categories SET is_active = false, updated_at = NOW() WHERE id = $1::uuid`,
            [id],
        );
    }

    // ── Menu Items ────────────────────────────────────────────────

    async listItems(schemaName: string, opts: {
        categoryId?: string;
        availableOnly?: boolean;
        includeInactive?: boolean;
    } = {}): Promise<any[]> {
        const where: string[] = [];
        const params: any[] = [];
        let i = 1;
        if (!opts.includeInactive) where.push('mi.is_active = true');
        if (opts.availableOnly) where.push('mi.is_available = true');
        if (opts.categoryId) {
            where.push(`mi.category_id = $${i++}::uuid`);
            params.push(opts.categoryId);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT mi.*, mc.name as category_name
             FROM menu_items mi
             LEFT JOIN menu_categories mc ON mc.id = mi.category_id
             ${whereSql}
             ORDER BY mi.sort_order, mi.name`,
            params,
        );
    }

    async getItemById(schemaName: string, id: string): Promise<any> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT mi.*, mc.name as category_name
             FROM menu_items mi
             LEFT JOIN menu_categories mc ON mc.id = mi.category_id
             WHERE mi.id = $1::uuid`,
            [id],
        );
        return rows[0] || null;
    }

    async createItem(schemaName: string, data: {
        categoryId?: string;
        name: string;
        description?: string;
        price: number;
        currency?: string;
        imageUrl?: string;
        allergens?: string[];
        tags?: string[];
        prepTimeMinutes?: number;
        calories?: number;
        sortOrder?: number;
    }): Promise<any> {
        if (!data.name) throw new BadRequestException('name is required');
        if (data.price === undefined || data.price < 0) throw new BadRequestException('price must be >= 0');
        const currency = normalizeCurrencyCode(data.currency);
        const prepTimeMinutes = optionalPositiveIntegerUnit(data.prepTimeMinutes, 'prepTimeMinutes');
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO menu_items (
                category_id, name, description, price, currency, image_url,
                allergens, tags, prep_time_minutes, calories, sort_order
             ) VALUES (
                $1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11
             ) RETURNING *`,
            [
                data.categoryId || null,
                data.name,
                data.description || null,
                data.price,
                currency,
                data.imageUrl || null,
                JSON.stringify(data.allergens || []),
                JSON.stringify(data.tags || []),
                prepTimeMinutes,
                data.calories ?? null,
                data.sortOrder ?? 0,
            ],
        );
        return rows[0];
    }

    async updateItem(schemaName: string, id: string, data: any): Promise<any> {
        if (data.prepTimeMinutes !== undefined && data.prepTimeMinutes !== null) {
            data = {
                ...data,
                prepTimeMinutes: optionalPositiveIntegerUnit(data.prepTimeMinutes, 'prepTimeMinutes'),
            };
        }
        if (data.currency !== undefined) {
            data = { ...data, currency: normalizeCurrencyCode(data.currency) };
        }
        const fields: string[] = [];
        const values: any[] = [];
        let i = 1;
        const map: Record<string, { col: string; cast?: string }> = {
            categoryId: { col: 'category_id', cast: '::uuid' },
            name: { col: 'name' },
            description: { col: 'description' },
            price: { col: 'price' },
            currency: { col: 'currency' },
            imageUrl: { col: 'image_url' },
            allergens: { col: 'allergens', cast: '::jsonb' },
            tags: { col: 'tags', cast: '::jsonb' },
            prepTimeMinutes: { col: 'prep_time_minutes' },
            calories: { col: 'calories' },
            sortOrder: { col: 'sort_order' },
            isAvailable: { col: 'is_available' },
            isActive: { col: 'is_active' },
        };
        for (const [k, def] of Object.entries(map)) {
            if (k in data) {
                let value = data[k];
                if (def.cast === '::jsonb') value = JSON.stringify(value || []);
                fields.push(`${def.col} = $${i}${def.cast || ''}`);
                values.push(value);
                i++;
            }
        }
        if (!fields.length) return this.getItemById(schemaName, id);
        fields.push(`updated_at = NOW()`);
        values.push(id);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE menu_items SET ${fields.join(', ')} WHERE id = $${i}::uuid RETURNING *`,
            values,
        );
        if (!rows.length) throw new NotFoundException('Menu item not found');
        return rows[0];
    }

    async deleteItem(schemaName: string, id: string): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE menu_items SET is_active = false, updated_at = NOW() WHERE id = $1::uuid`,
            [id],
        );
    }

    /** AI tool — search menu by keyword, returns slim payload. */
    async searchMenu(schemaName: string, opts: {
        query?: string;
        category?: string;
        tag?: string;
        excludeAllergens?: string[];
        maxPrice?: number;
        limit?: number;
    } = {}): Promise<any[]> {
        const where: string[] = ['mi.is_active = true', 'mi.is_available = true'];
        const params: any[] = [];
        let i = 1;
        if (opts.query) {
            where.push(`(mi.name ILIKE $${i} OR mi.description ILIKE $${i})`);
            params.push(`%${opts.query}%`);
            i++;
        }
        if (opts.category) {
            where.push(`(mc.name ILIKE $${i} OR mi.category_id::text = $${i})`);
            params.push(opts.category);
            i++;
        }
        if (opts.tag) {
            where.push(`mi.tags @> $${i}::jsonb`);
            params.push(JSON.stringify([opts.tag]));
            i++;
        }
        if (opts.maxPrice !== undefined) {
            where.push(`mi.price <= $${i}`);
            params.push(opts.maxPrice);
            i++;
        }
        if (opts.excludeAllergens && opts.excludeAllergens.length > 0) {
            // Items where allergens does NOT contain any of the excluded ones
            for (const a of opts.excludeAllergens) {
                where.push(`NOT (mi.allergens @> $${i}::jsonb)`);
                params.push(JSON.stringify([a]));
                i++;
            }
        }
        const limit = Math.min(opts.limit || 30, 50);
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT mi.id, mi.name, mi.description, mi.price, mi.currency,
                    mi.tags, mi.allergens, mi.prep_time_minutes,
                    mc.name as category_name
             FROM menu_items mi
             LEFT JOIN menu_categories mc ON mc.id = mi.category_id
             WHERE ${where.join(' AND ')}
             ORDER BY mi.sort_order, mi.name
             LIMIT ${limit}`,
            params,
        );
    }

    // ── Orders ────────────────────────────────────────────────────

    async listOrders(schemaName: string, opts: { status?: string; limit?: number } = {}): Promise<any[]> {
        const where: string[] = [];
        const params: any[] = [];
        let i = 1;
        if (opts.status) { where.push(`status = $${i++}`); params.push(opts.status); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const limit = Math.min(opts.limit || 100, 500);
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM food_orders ${whereSql} ORDER BY created_at DESC LIMIT ${limit}`,
            params,
        );
    }

    async getOrderById(schemaName: string, id: string): Promise<any> {
        const orders = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM food_orders WHERE id = $1::uuid`,
            [id],
        );
        if (!orders.length) return null;
        const items = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM food_order_items WHERE order_id = $1::uuid ORDER BY created_at`,
            [id],
        );
        return { ...orders[0], items };
    }

    private async getEtaBufferMinutes(
        schemaName: string,
        orderType: 'delivery' | 'pickup' | 'dine_in',
    ): Promise<number> {
        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { schemaName },
                select: { settings: true },
            });
            const restaurantSettings = (tenant?.settings as any)?.restaurants;
            const configured = restaurantSettings?.etaBufferMinutes;
            const camelOrderType = orderType === 'dine_in' ? 'dineIn' : orderType;
            const raw = typeof configured === 'number'
                ? configured
                : configured?.[orderType] ?? configured?.[camelOrderType];
            const parsed = Number(raw);
            return Number.isFinite(parsed) && parsed >= 0
                ? Math.min(Math.floor(parsed), 24 * 60)
                : 0;
        } catch (error: any) {
            // ETA enrichment must not make order intake unavailable. With no
            // readable tenant configuration, the catalog preparation time is
            // still authoritative and the optional buffer is simply zero.
            this.logger.warn(`Could not load restaurant ETA buffer for ${schemaName}: ${error.message}`);
            return 0;
        }
    }

    private async calculateEstimatedMinutes(
        schemaName: string,
        orderType: 'delivery' | 'pickup' | 'dine_in',
        items: Array<{ prepTimeMinutes?: number | null }>,
    ): Promise<number | null> {
        if (items.some((item) => item.prepTimeMinutes == null)) {
            return null;
        }
        const prepTimes = items.map((item) => Number(item.prepTimeMinutes));
        if (prepTimes.some((minutes) => !Number.isFinite(minutes) || minutes < 0)) return null;
        const maxPrepMinutes = Math.max(...prepTimes.map((minutes) => Math.ceil(minutes)));
        const bufferMinutes = await this.getEtaBufferMinutes(schemaName, orderType);
        return maxPrepMinutes + bufferMinutes;
    }

    async createOrder(schemaName: string, data: {
        contactId?: string;
        conversationId?: string;
        opportunityId?: string;
        orderType: 'delivery' | 'pickup' | 'dine_in';
        customerName?: string;
        customerPhone?: string;
        deliveryAddress?: string;
        deliveryNotes?: string;
        tableNumber?: string;
        currency?: string;
        items: Array<{
            menuItemId?: string;
            name: string;
            quantity: number;
            unitPrice: number;
            currency?: string;
            prepTimeMinutes?: number | null;
            modifiers?: any[];
            specialInstructions?: string;
        }>;
        deliveryFee?: number;
        discount?: number;
        paymentMethod?: string;
        notes?: string;
    }): Promise<any> {
        if (!data.items?.length) throw new BadRequestException('Order must have at least one item');
        if (data.orderType === 'delivery' && !data.deliveryAddress) {
            throw new BadRequestException('deliveryAddress is required for delivery orders');
        }
        const contactId = assertOptionalContactId(data.contactId);

        const subtotal = data.items.reduce((sum, it) => sum + (it.quantity * it.unitPrice), 0);
        const deliveryFee = data.deliveryFee || 0;
        const discount = data.discount || 0;
        const total = Math.max(0, subtotal + deliveryFee - discount);
        const normalizeCurrency = (value?: string) => value?.trim()
            ? normalizeCurrencyCode(value)
            : null;
        const currencies = new Set([
            normalizeCurrency(data.currency),
            ...data.items.map((item) => normalizeCurrency(item.currency)),
        ].filter((value): value is string => !!value));
        if (currencies.size > 1) {
            throw new BadRequestException('All order items must use the same currency');
        }
        const currency = [...currencies][0] || 'COP';
        const estimatedMinutes = await this.calculateEstimatedMinutes(schemaName, data.orderType, data.items);

        // Header, line items and the read-back share one tenant-scoped database
        // transaction. If any line insert fails, PostgreSQL rolls the header
        // back as well, so a partial `received` order can never escape.
        const order = await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const canonicalContactId = await requireTenantContact(query, contactId);
            const opportunityId = await resolveNativeEvidenceOpportunity(query, {
                contactId: canonicalContactId,
                conversationId: data.conversationId,
                trustedOpportunityId: data.opportunityId,
            });
            const orderRows = await query<any[]>(
                `INSERT INTO food_orders (
                    contact_id, opportunity_id, conversation_id, order_type, customer_name, customer_phone,
                    delivery_address, delivery_notes, table_number,
                    subtotal, delivery_fee, discount, total, currency,
                    estimated_delivery_at, payment_method, notes
                 ) VALUES (
                    $1::uuid, $2::uuid, $3::uuid, $4, $5, $6,
                    $7, $8, $9,
                    $10, $11, $12, $13, $14,
                    CASE WHEN $15::int IS NULL THEN NULL
                         ELSE NOW() + ($15::int * INTERVAL '1 minute') END,
                    $16, $17
                 ) RETURNING *`,
                [
                    canonicalContactId,
                    opportunityId,
                    data.conversationId || null,
                    data.orderType,
                    data.customerName || null,
                    data.customerPhone || null,
                    data.deliveryAddress || null,
                    data.deliveryNotes || null,
                    data.tableNumber || null,
                    subtotal,
                    deliveryFee,
                    discount,
                    total,
                    currency,
                    estimatedMinutes,
                    data.paymentMethod || null,
                    data.notes || null,
                ],
            );
            const order = orderRows[0];
            if (!order) throw new Error('Order header was not created');

            for (const item of data.items) {
                await query(
                    `INSERT INTO food_order_items (
                        order_id, menu_item_id, name_snapshot, quantity,
                        unit_price, modifiers, special_instructions, subtotal
                     ) VALUES (
                        $1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7, $8
                     )`,
                    [
                        order.id,
                        item.menuItemId || null,
                        item.name,
                        item.quantity,
                        item.unitPrice,
                        JSON.stringify(item.modifiers || []),
                        item.specialInstructions || null,
                        item.quantity * item.unitPrice,
                    ],
                );
            }

            const items = await query<any[]>(
                `SELECT * FROM food_order_items WHERE order_id = $1::uuid ORDER BY created_at`,
                [order.id],
            );
            return { ...order, items, estimated_delivery_minutes: estimatedMinutes };
        });

        try {
            this.eventEmitter.emit('food_order.created', {
                orderId: order.id,
                tenantSchemaName: schemaName,
                schemaName,
                contactId,
                customerName: data.customerName,
                orderType: order.order_type,
                total: Number(order.total || 0),
                currency: order.currency,
                itemsCount: data.items.length,
                tableNumber: data.tableNumber,
            });
        } catch (error: any) {
            this.logger.error(`food_order.created listener failed after commit: ${error.message}`);
        }
        return order;
    }

    async updateOrderStatus(
        schemaName: string,
        id: string,
        status: string,
        context: { reason?: string } = {},
    ): Promise<any> {
        const validStatuses = ['received', 'preparing', 'ready', 'delivered', 'cancelled'];
        if (!validStatuses.includes(status)) throw new BadRequestException(`Invalid status: ${status}`);
        const result = await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const currentRows = await query<any[]>(
                `SELECT * FROM food_orders WHERE id = $1::uuid FOR UPDATE`,
                [id],
            );
            if (!currentRows.length) throw new NotFoundException('Order not found');
            const current = currentRows[0];
            if (current.status === status) return { order: current, changed: false };

            const rows = await query<any[]>(
                `UPDATE food_orders
                    SET status = $1, updated_at = NOW()
                  WHERE id = $2::uuid
                  RETURNING *`,
                [status, id],
            );
            if (!rows.length) throw new NotFoundException('Order not found');
            return { order: rows[0], changed: true };
        });

        // Emit from the canonical writer, after commit. REST/mobile/dashboard
        // and AI cancellations now have exactly the same automation contract;
        // an idempotent second cancellation does not emit a duplicate event.
        if (status === 'cancelled' && result.changed) {
            try {
                this.eventEmitter.emit('food_order.cancelled', {
                    orderId: result.order.id,
                    tenantSchemaName: schemaName,
                    schemaName,
                    contactId: result.order.contact_id || undefined,
                    reason: context.reason,
                });
            } catch (error: any) {
                this.logger.error(`food_order.cancelled listener failed after commit: ${error.message}`);
            }
        }
        return result.order;
    }

    // ── Promotions ────────────────────────────────────────────────

    async listPromotions(schemaName: string, activeOnly = true): Promise<any[]> {
        const where = activeOnly
            ? `WHERE is_active = true
               AND (valid_from IS NULL OR valid_from <= NOW())
               AND (valid_to IS NULL OR valid_to >= NOW())`
            : '';
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM menu_promotions ${where} ORDER BY created_at DESC`,
        );
    }

    async createPromotion(schemaName: string, data: any): Promise<any> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO menu_promotions (
                title, description, discount_type, discount_value,
                valid_from, valid_to, applicable_days, applicable_hours,
                min_order_amount
             ) VALUES (
                $1, $2, $3, $4, $5::timestamp, $6::timestamp, $7::jsonb, $8, $9
             ) RETURNING *`,
            [
                data.title,
                data.description || null,
                data.discountType || 'percent',
                data.discountValue || 0,
                data.validFrom || null,
                data.validTo || null,
                JSON.stringify(data.applicableDays || []),
                data.applicableHours || null,
                data.minOrderAmount || null,
            ],
        );
        return rows[0];
    }

    async deletePromotion(schemaName: string, id: string): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE menu_promotions SET is_active = false, updated_at = NOW() WHERE id = $1::uuid`,
            [id],
        );
    }
}
