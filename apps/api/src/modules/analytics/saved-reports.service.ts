import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SavedReportsService {
    private readonly logger = new Logger(SavedReportsService.name);

    constructor(private prisma: PrismaService) {}

    async ensureTable(schemaName: string): Promise<void> {
        await this.prisma.executeInTenantSchema(schemaName, `
            CREATE TABLE IF NOT EXISTS saved_reports (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR(255) NOT NULL,
                description TEXT,
                config JSONB NOT NULL DEFAULT '{}',
                created_by UUID,
                is_favorite BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
    }

    async list(schemaName: string): Promise<any[]> {
        await this.ensureTable(schemaName);
        return this.prisma.executeInTenantSchema(schemaName,
            `SELECT * FROM saved_reports ORDER BY is_favorite DESC, updated_at DESC`,
        );
    }

    async getById(schemaName: string, reportId: string): Promise<any> {
        await this.ensureTable(schemaName);
        const rows: any[] = await this.prisma.executeInTenantSchema(schemaName,
            `SELECT * FROM saved_reports WHERE id = $1::uuid`,
            [reportId],
        );
        return rows?.[0] || null;
    }

    async create(schemaName: string, data: {
        name: string;
        description?: string;
        config: any;
        createdBy?: string;
    }): Promise<any> {
        await this.ensureTable(schemaName);
        const rows: any[] = await this.prisma.executeInTenantSchema(schemaName,
            `INSERT INTO saved_reports (name, description, config, created_by)
             VALUES ($1, $2, $3::jsonb, $4::uuid)
             RETURNING *`,
            [data.name, data.description || null, JSON.stringify(data.config), data.createdBy || null],
        );
        return rows?.[0] || null;
    }

    async update(schemaName: string, reportId: string, data: {
        name?: string;
        description?: string;
        config?: any;
        isFavorite?: boolean;
    }): Promise<any> {
        await this.ensureTable(schemaName);
        const sets: string[] = ['updated_at = NOW()'];
        const params: any[] = [];
        let idx = 1;

        if (data.name !== undefined) { sets.push(`name = $${idx}`); params.push(data.name); idx++; }
        if (data.description !== undefined) { sets.push(`description = $${idx}`); params.push(data.description); idx++; }
        if (data.config !== undefined) { sets.push(`config = $${idx}::jsonb`); params.push(JSON.stringify(data.config)); idx++; }
        if (data.isFavorite !== undefined) { sets.push(`is_favorite = $${idx}`); params.push(data.isFavorite); idx++; }

        params.push(reportId);
        const rows: any[] = await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE saved_reports SET ${sets.join(', ')} WHERE id = $${idx}::uuid RETURNING *`,
            params,
        );
        return rows?.[0] || null;
    }

    async remove(schemaName: string, reportId: string): Promise<void> {
        await this.ensureTable(schemaName);
        await this.prisma.executeInTenantSchema(schemaName,
            `DELETE FROM saved_reports WHERE id = $1::uuid`,
            [reportId],
        );
    }
}
