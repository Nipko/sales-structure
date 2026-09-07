import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CatalogOrderCommands } from './catalog-order-commands';
import { catalogOrderDocument } from './catalog-order-document';
import { CatalogCreateInput } from './catalog-order-contract';
import { catalogHash } from './catalog-order-contract';

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
    stockDeducted:number|null;
}

export interface Order {
    id: string;
    contactId: string;
    contactName: string;
    status: 'pending' | 'confirmed' | 'paid' | 'cancelled';
    version: number;
    paymentStatus: string;
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
    financialsVisible: boolean;
    orderCount: number;
    pendingCount: number;
    orders: Order[];
    financialSummaries?: { currency:string; providerPaid:number; manuallyMarkedPaid:number; pending:number }[];
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
    async getOverview(tenantId: string, includeFinancials = true): Promise<OrdersOverview> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new NotFoundException('Tenant schema not found');

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
                return {
                    totalRevenue: 0,
                    pendingRevenue: 0,
                    financialsVisible: includeFinancials,
                    orderCount: 0,
                    pendingCount: 0,
                    orders: [],
                };
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

            const totalRevenue = includeFinancials
                ? orders.filter(o => o.status === 'paid').reduce((sum, o) => sum + o.totalAmount, 0)
                : 0;
            const pendingRevenue = includeFinancials
                ? orders.filter(o => o.status === 'pending' || o.status === 'confirmed').reduce((sum, o) => sum + o.totalAmount, 0)
                : 0;
            const pendingCount = orders.filter(o => o.status === 'pending' || o.status === 'confirmed').length;

            const financialSummaries = includeFinancials ? [...new Set(orders.map(order=>order.currency))].map(currency=>{
                const group=orders.filter(order=>order.currency===currency);
                return {currency,providerPaid:group.filter(order=>order.paymentStatus==='paid').reduce((sum,order)=>sum+order.totalAmount,0),
                    manuallyMarkedPaid:group.filter(order=>order.status==='paid').reduce((sum,order)=>sum+order.totalAmount,0),
                    pending:group.filter(order=>['pending','confirmed'].includes(order.status)&&['pending','failed'].includes(order.paymentStatus)).reduce((sum,order)=>sum+order.totalAmount,0)};
            }) : [];
            return {
                totalRevenue:financialSummaries.length>1?0:totalRevenue,
                pendingRevenue:financialSummaries.length>1?0:pendingRevenue,
                financialSummaries,
                financialsVisible: includeFinancials,
                orderCount: orders.length,
                pendingCount,
                orders,
            };
        } catch (error) {
            this.logger.error(`Error getting orders overview: ${error}`);
            throw error;
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
    async createOrder(tenantId: string, data: CatalogCreateInput,actorId?:string): Promise<any> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new NotFoundException('Tenant schema not found');
        await this.ensureOrdersTables(schema);
        return new CatalogOrderCommands(this.prisma).create(schema, data, { source: 'tenant_user',expectedTermsHash:data.expectedTermsHash,actorId });
    }

    async quoteOrder(tenantId:string,data:CatalogCreateInput):Promise<any>{
        const schema=await this.getTenantSchema(tenantId);
        if(!schema) throw new NotFoundException('Tenant schema not found');
        await this.ensureOrdersTables(schema);
        const terms=await this.catalogCommands().quote(schema,data,'tenant_user');
        return {terms,termsHash:catalogHash(terms)};
    }

    /** Server-only scoped command port used by production and the owned evaluation namespace. */
    catalogCommands(): CatalogOrderCommands { return new CatalogOrderCommands(this.prisma); }

    async recordStockEvidence(tenantId:string,orderId:string,input:any,actor:{id:string;role:string}):Promise<any>{
        if(!this.canCancelOrder(actor.role))throw new ForbiddenException('catalog_stock_review_role_required');
        const schema=await this.getTenantSchema(tenantId);if(!schema)throw new NotFoundException('Tenant schema not found');
        await this.ensureOrdersTables(schema);
        return this.catalogCommands().recordStockEvidence(schema,orderId,input,actor.id);
    }

    async updateOrderStatus(tenantId: string, orderId: string, status: string, actorRole?: string, expectedVersion?: number,actorId?:string): Promise<void> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new NotFoundException('Tenant schema not found');
        await this.ensureOrdersTables(schema);
        const next = String(status || '').trim().toLowerCase();
        const commands = this.catalogCommands();
        if (next === 'cancelled') {
            if (!this.canCancelOrder(actorRole)) throw new ForbiddenException('Only tenant administrators and supervisors can cancel orders');
            await commands.cancel(schema, orderId, null, { source: 'tenant_user', expectedVersion,actorId });
        } else await commands.advance(schema, orderId, next, expectedVersion);
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
            version:o.version,
            paymentStatus:o.payment_status || 'unknown',
            totalAmount: parseFloat(o.total_amount) || 0,
            currency: o.currency || '',
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
                stockDeducted:i.stock_deducted??null,
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
        const cacheKey = `orders:tables:v3:${schema}`;
        const cached = await this.redis.get(cacheKey);
        if (cached) return;

        try {
            // Una sola fuente de schema.
            //
            // Acá vivía una SEGUNDA definición de `orders` y `order_items`, y
            // ya había divergido: le faltaba la columna `items` —que el
            // canónico declara JSONB NOT NULL— y ponía `currency` como
            // VARCHAR(3) contra VARCHAR(10). Un tenant creado por este camino
            // tenía una tabla distinta de la que el resto del código supone, y
            // el fallo aparece en ese tenant y en ninguno más.
            await this.prisma.ensureCanonicalTables(schema, ['orders', 'order_items', 'stock_movements']);

            // Índice propio de este módulo: no está en el canónico y es
            // aditivo, así que se mantiene acá.
            await this.prisma.$queryRawUnsafe(`
                CREATE INDEX IF NOT EXISTS idx_orders_opportunity_id
                ON "${schema}".orders(opportunity_id)
                WHERE opportunity_id IS NOT NULL
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

    /**
     * Generate HTML Document for Order (Invoice / Quote)
     */
    async getInvoiceHtml(tenantId: string, orderId: string,language = 'es'): Promise<string> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new NotFoundException('catalog_tenant_not_found');

        const orderRes = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT o.*, c.name as contact_name
             FROM orders o LEFT JOIN contacts c ON o.contact_id = c.id
             WHERE o.id = $1::uuid LIMIT 1`, [orderId]
        );
        if (!orderRes || orderRes.length === 0) throw new NotFoundException('catalog_order_not_found');
        const orderRow = orderRes[0];

        const itemsRows = await this.prisma.executeInTenantSchema<any[]>(
            schema, `SELECT * FROM order_items WHERE order_id = $1::uuid`, [orderId]
        ) || [];

        const tenantRes = await this.prisma.$queryRaw<any[]>`SELECT name FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1`;
        const tenantRow = tenantRes?.[0];
        if(!tenantRow) throw new NotFoundException('catalog_tenant_not_found');

        return catalogOrderDocument(tenantRow.name,orderRow,itemsRows,language);
    }
}
