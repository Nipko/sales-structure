import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

// ============================================
// Types (exported for controller return type visibility)
// ============================================

export interface Product {
    id: string;
    name: string;
    sku: string;
    description: string;
    category: string;
    price: number;
    cost: number;
    currency: string;
    stock: number;
    minStock: number;
    maxStock: number;
    unit: string;
    imageUrl: string | null;
    isActive: boolean;
    tags: string[];
    metadata: Record<string, any>;
    createdAt: string;
    updatedAt: string;
}

export interface Category {
    id: string;
    name: string;
    color: string;
    productCount: number;
}

export interface InventoryOverview {
    totalProducts: number;
    activeProducts: number;
    totalValue: number;
    lowStockAlerts: number;
    outOfStockCount: number;
    categories: Category[];
    products: Product[];
    recentMovements: StockMovement[];
}

export interface StockMovement {
    id: string;
    productId: string;
    productName: string;
    type: 'in' | 'out' | 'adjustment';
    quantity: number;
    previousStock: number;
    newStock: number;
    reason: string;
    createdAt: string;
    createdBy: string;
}

// ============================================
// Service
// ============================================

@Injectable()
export class InventoryService {
    private readonly logger = new Logger(InventoryService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
    ) { }

    /**
     * Get full inventory overview for a tenant
     */
    async getOverview(tenantId: string): Promise<InventoryOverview> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) {
            return this.buildEmptyOverview();
        }

        try {
            await this.ensureInventoryTables(schema);

            const products = await this.prisma.executeInTenantSchema<any[]>(
                schema,
                `SELECT p.*, c.name as category_name, c.color as category_color
         FROM products p
         LEFT JOIN product_categories c ON p.category_id = c.id
         ORDER BY p.updated_at DESC`,
            );

            const categories = await this.prisma.executeInTenantSchema<any[]>(
                schema,
                `SELECT c.id, c.name, c.color, COUNT(p.id) as product_count
         FROM product_categories c
         LEFT JOIN products p ON p.category_id = c.id
         GROUP BY c.id, c.name, c.color
         ORDER BY c.name`,
            );

            const movements = await this.prisma.executeInTenantSchema<any[]>(
                schema,
                `SELECT sm.*, p.name as product_name
         FROM stock_movements sm
         LEFT JOIN products p ON sm.product_id = p.id
         ORDER BY sm.created_at DESC LIMIT 20`,
            );

            const mappedProducts = (products || []).map((p: any) => this.mapProduct(p));
            const totalValue = mappedProducts.reduce((sum, p) => sum + (p.price * p.stock), 0);
            const lowStock = mappedProducts.filter(p => p.stock > 0 && p.stock <= p.minStock).length;
            const outOfStock = mappedProducts.filter(p => p.stock === 0).length;

            return {
                totalProducts: mappedProducts.length,
                activeProducts: mappedProducts.filter(p => p.isActive).length,
                totalValue,
                lowStockAlerts: lowStock,
                outOfStockCount: outOfStock,
                categories: (categories || []).map((c: any) => ({
                    id: c.id, name: c.name, color: c.color, productCount: parseInt(c.product_count) || 0,
                })),
                products: mappedProducts,
                recentMovements: (movements || []).map((m: any) => this.mapMovement(m)),
            };
        } catch (error) {
            this.logger.error(`Error getting inventory overview: ${error}`);
            return this.buildEmptyOverview();
        }
    }

    /**
     * Get all products for a tenant
     */
    async getProducts(tenantId: string): Promise<Product[]> {
        const overview = await this.getOverview(tenantId);
        return overview.products;
    }

    /**
     * Create a new product
     */
    async createProduct(tenantId: string, data: {
        name: string; sku: string; description?: string; categoryId?: string;
        price: number; cost?: number; stock: number; minStock?: number; maxStock?: number;
        unit?: string; imageUrl?: string; tags?: string[];
    }): Promise<{ id: string }> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant schema not found');

        await this.ensureInventoryTables(schema);

        const result = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `INSERT INTO products (id, name, sku, description, category_id, price, cost, stock, min_stock, max_stock, unit, image_url, tags, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
       RETURNING id`,
            [data.name, data.sku, data.description || '', data.categoryId || null,
            data.price, data.cost || 0, data.stock, data.minStock || 5, data.maxStock || 1000,
            data.unit || 'unidad', data.imageUrl || null, JSON.stringify(data.tags || [])],
        );

        this.logger.log(`Product created: ${data.name} (${data.sku}) for tenant ${tenantId}`);
        return { id: result?.[0]?.id || '' };
    }

    /**
     * Update product
     */
    async updateProduct(tenantId: string, productId: string, data: Partial<{
        name: string; sku: string; description: string; categoryId: string;
        price: number; cost: number; minStock: number; maxStock: number;
        unit: string; imageUrl: string; isActive: boolean; tags: string[];
    }>): Promise<void> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant schema not found');

        const setClauses: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        if (data.name !== undefined) { setClauses.push(`name = $${paramIndex++}`); values.push(data.name); }
        if (data.sku !== undefined) { setClauses.push(`sku = $${paramIndex++}`); values.push(data.sku); }
        if (data.description !== undefined) { setClauses.push(`description = $${paramIndex++}`); values.push(data.description); }
        if (data.price !== undefined) { setClauses.push(`price = $${paramIndex++}`); values.push(data.price); }
        if (data.cost !== undefined) { setClauses.push(`cost = $${paramIndex++}`); values.push(data.cost); }
        if (data.isActive !== undefined) { setClauses.push(`is_active = $${paramIndex++}`); values.push(data.isActive); }
        setClauses.push('updated_at = NOW()');

        if (setClauses.length === 1) return; // Only updated_at

        values.push(productId);
        await this.prisma.executeInTenantSchema(
            schema,
            `UPDATE products SET ${setClauses.join(', ')} WHERE id = $${paramIndex}::uuid`,
            values,
        );
    }

    /**
     * Adjust stock (add/remove)
     */
    async adjustStock(tenantId: string, productId: string, data: {
        type: 'in' | 'out' | 'adjustment';
        quantity: number;
        reason: string;
    }): Promise<void> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant schema not found');

        await this.ensureInventoryTables(schema);

        // Get current stock
        const current = await this.prisma.executeInTenantSchema<any[]>(
            schema, `SELECT stock FROM products WHERE id = $1::uuid`, [productId],
        );

        const currentStock = parseInt(current?.[0]?.stock) || 0;
        let newStock: number;

        if (data.type === 'in') {
            newStock = currentStock + data.quantity;
        } else if (data.type === 'out') {
            newStock = Math.max(0, currentStock - data.quantity);
        } else {
            newStock = data.quantity; // Direct adjustment
        }

        // Update product stock
        await this.prisma.executeInTenantSchema(
            schema, `UPDATE products SET stock = $1, updated_at = NOW() WHERE id = $2::uuid`,
            [newStock, productId],
        );

        // Record the movement
        await this.prisma.executeInTenantSchema(
            schema,
            `INSERT INTO stock_movements (id, product_id, type, quantity, previous_stock, new_stock, reason, created_at)
       VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4, $5, $6, NOW())`,
            [productId, data.type, data.quantity, currentStock, newStock, data.reason],
        );

        this.logger.log(`Stock adjusted for product ${productId}: ${currentStock} → ${newStock} (${data.type})`);
    }

    /**
     * Create product category
     */
    async createCategory(tenantId: string, data: { name: string; color: string }): Promise<{ id: string }> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant schema not found');

        await this.ensureInventoryTables(schema);

        const result = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `INSERT INTO product_categories (id, name, color, created_at)
       VALUES (gen_random_uuid(), $1, $2, NOW()) RETURNING id`,
            [data.name, data.color],
        );

        return { id: result?.[0]?.id || '' };
    }

    /**
     * Ensure inventory tables exist in the tenant schema
     */
    private async ensureInventoryTables(schema: string): Promise<void> {
        const cacheKey = `inventory:tables:${schema}`;
        const cached = await this.redis.get(cacheKey);
        if (cached) return;

        try {
            await this.prisma.$queryRawUnsafe(`CREATE TABLE IF NOT EXISTS "${schema}".product_categories (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name VARCHAR(100) NOT NULL,
                    color VARCHAR(20) DEFAULT '#6c5ce7',
                    created_at TIMESTAMP DEFAULT NOW()
                )`);
            await this.prisma.$queryRawUnsafe(`CREATE TABLE IF NOT EXISTS "${schema}".products (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name VARCHAR(255) NOT NULL,
                    sku VARCHAR(100) UNIQUE NOT NULL,
                    description TEXT DEFAULT '',
                    category_id UUID REFERENCES "${schema}".product_categories(id) ON DELETE SET NULL,
                    price DECIMAL(12,2) DEFAULT 0,
                    cost DECIMAL(12,2) DEFAULT 0,
                    currency VARCHAR(3) DEFAULT 'COP',
                    stock INTEGER DEFAULT 0,
                    min_stock INTEGER DEFAULT 5,
                    max_stock INTEGER DEFAULT 1000,
                    unit VARCHAR(50) DEFAULT 'unidad',
                    image_url TEXT,
                    is_active BOOLEAN DEFAULT true,
                    tags JSONB DEFAULT '[]',
                    metadata JSONB DEFAULT '{}',
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )`);
            await this.prisma.$queryRawUnsafe(`CREATE TABLE IF NOT EXISTS "${schema}".stock_movements (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    product_id UUID REFERENCES "${schema}".products(id) ON DELETE CASCADE,
                    type VARCHAR(20) NOT NULL,
                    quantity INTEGER NOT NULL,
                    previous_stock INTEGER DEFAULT 0,
                    new_stock INTEGER DEFAULT 0,
                    reason TEXT DEFAULT '',
                    created_by VARCHAR(255),
                    created_at TIMESTAMP DEFAULT NOW()
                )`);
            await this.prisma.$queryRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_products_sku ON "${schema}".products(sku)`);
            await this.prisma.$queryRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_products_category ON "${schema}".products(category_id)`);
            await this.prisma.$queryRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON "${schema}".stock_movements(product_id)`);

            await this.redis.set(cacheKey, 'true', 86400); // Cache for 24h
        } catch (error) {
            this.logger.warn(`Could not create inventory tables in ${schema}: ${error}`);
        }
    }

    private mapProduct(p: any): Product {
        return {
            id: p.id,
            name: p.name,
            sku: p.sku,
            description: p.description || '',
            category: p.category_name || 'Sin categoría',
            price: parseFloat(p.price) || 0,
            cost: parseFloat(p.cost) || 0,
            currency: p.currency || 'COP',
            stock: parseInt(p.stock) || 0,
            minStock: parseInt(p.min_stock) || 5,
            maxStock: parseInt(p.max_stock) || 1000,
            unit: p.unit || 'unidad',
            imageUrl: p.image_url || null,
            isActive: p.is_active !== false,
            tags: Array.isArray(p.tags) ? p.tags : [],
            metadata: p.metadata || {},
            createdAt: p.created_at?.toISOString?.() || new Date().toISOString(),
            updatedAt: p.updated_at?.toISOString?.() || new Date().toISOString(),
        };
    }

    private mapMovement(m: any): StockMovement {
        return {
            id: m.id,
            productId: m.product_id,
            productName: m.product_name || 'Producto',
            type: m.type,
            quantity: parseInt(m.quantity) || 0,
            previousStock: parseInt(m.previous_stock) || 0,
            newStock: parseInt(m.new_stock) || 0,
            reason: m.reason || '',
            createdAt: m.created_at?.toISOString?.() || new Date().toISOString(),
            createdBy: m.created_by || 'Sistema',
        };
    }

    private buildEmptyOverview(): InventoryOverview {
        return {
            totalProducts: 0,
            activeProducts: 0,
            totalValue: 0,
            lowStockAlerts: 0,
            outOfStockCount: 0,
            categories: [],
            products: [],
            recentMovements: [],
        };
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
}
