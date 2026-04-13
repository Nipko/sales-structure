import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export interface MediaFile {
    id: string;
    entityType: string;
    entityId: string | null;
    originalName: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    width: number | null;
    height: number | null;
    url: string;
    thumbnailUrl: string | null;
    createdAt: string;
}

const ALLOWED_MIME_TYPES = [
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const THUMB_WIDTH = 200;
const MEDIUM_WIDTH = 600;
const MAX_WIDTH = 1200;

@Injectable()
export class MediaService {
    private readonly logger = new Logger(MediaService.name);
    private readonly storagePath: string;
    private readonly baseUrl: string;

    constructor(
        private prisma: PrismaService,
        private config: ConfigService,
    ) {
        this.storagePath = config.get<string>('MEDIA_STORAGE_PATH', '/data/media');
        const apiUrl = config.get<string>('DASHBOARD_URL', 'https://api.parallly-chat.cloud');
        this.baseUrl = config.get<string>('API_PUBLIC_URL', apiUrl.replace('admin.', 'api.').replace(':3001', ':3000'));
    }

    /**
     * Upload and process an image file
     */
    async upload(
        schemaName: string,
        tenantId: string,
        file: Express.Multer.File,
        entityType: string = 'general',
        entityId?: string,
    ): Promise<MediaFile> {
        // Validate
        if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            throw new BadRequestException(`File type not allowed: ${file.mimetype}. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`);
        }
        if (file.size > MAX_FILE_SIZE) {
            throw new BadRequestException(`File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Max: 10MB`);
        }

        const id = randomUUID();
        const ext = 'webp'; // Always convert to webp for optimization
        const fileName = `${id}.${ext}`;
        const thumbName = `${id}_thumb.${ext}`;
        const tenantDir = path.join(this.storagePath, tenantId);

        // Ensure directory exists
        fs.mkdirSync(tenantDir, { recursive: true });

        // Process and save main image (max 1200px wide)
        const mainPath = path.join(tenantDir, fileName);
        const mainMeta = await sharp(file.buffer)
            .resize(MAX_WIDTH, null, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 85 })
            .toFile(mainPath);

        // Generate thumbnail (200px wide)
        const thumbPath = path.join(tenantDir, thumbName);
        await sharp(file.buffer)
            .resize(THUMB_WIDTH, null, { fit: 'inside' })
            .webp({ quality: 70 })
            .toFile(thumbPath);

        const mainSize = fs.statSync(mainPath).size;

        // Save to database
        const url = `/media/file/${tenantId}/${fileName}`;
        const thumbnailUrl = `/media/file/${tenantId}/${thumbName}`;

        await this.prisma.executeInTenantSchema(schemaName,
            `INSERT INTO media_files (id, entity_type, entity_id, original_name, file_name, mime_type, size_bytes, width, height, thumbnail_name, created_at)
             VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
            [id, entityType, entityId || null, file.originalname, fileName, 'image/webp', mainSize, mainMeta.width, mainMeta.height, thumbName],
        );

        this.logger.log(`Uploaded ${file.originalname} → ${fileName} (${(mainSize / 1024).toFixed(0)}KB, ${mainMeta.width}x${mainMeta.height})`);

        return {
            id,
            entityType,
            entityId: entityId || null,
            originalName: file.originalname,
            fileName,
            mimeType: 'image/webp',
            sizeBytes: mainSize,
            width: mainMeta.width,
            height: mainMeta.height,
            url,
            thumbnailUrl,
            createdAt: new Date().toISOString(),
        };
    }

    /**
     * Upload company logo (special case — stored in public.tenants.settings)
     */
    async uploadLogo(
        tenantId: string,
        schemaName: string,
        file: Express.Multer.File,
    ): Promise<{ logoUrl: string }> {
        const mediaFile = await this.upload(schemaName, tenantId, file, 'tenant_logo');

        // Update tenant settings with logo URL
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });

        const settings = (tenant?.settings as Record<string, any>) || {};
        settings.logoUrl = mediaFile.url;

        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: { settings },
        });

        this.logger.log(`Logo updated for tenant ${tenantId}: ${mediaFile.url}`);
        return { logoUrl: mediaFile.url };
    }

    /**
     * List media files for a tenant
     */
    async list(schemaName: string, tenantId: string, entityType?: string): Promise<MediaFile[]> {
        let sql = `SELECT id, entity_type, entity_id, original_name, file_name, mime_type, size_bytes, width, height, thumbnail_name, created_at
                    FROM media_files`;
        const params: any[] = [];

        if (entityType) {
            sql += ` WHERE entity_type = $1`;
            params.push(entityType);
        }

        sql += ` ORDER BY created_at DESC`;

        const rows = await this.prisma.executeInTenantSchema(schemaName, sql, params);

        return (rows as any[]).map(row => ({
            id: row.id,
            entityType: row.entity_type,
            entityId: row.entity_id,
            originalName: row.original_name,
            fileName: row.file_name,
            mimeType: row.mime_type,
            sizeBytes: row.size_bytes,
            width: row.width,
            height: row.height,
            url: `/media/file/${tenantId}/${row.file_name}`,
            thumbnailUrl: row.thumbnail_name ? `/media/file/${tenantId}/${row.thumbnail_name}` : null,
            createdAt: row.created_at,
        }));
    }

    /**
     * Delete a media file
     */
    async delete(schemaName: string, tenantId: string, fileId: string): Promise<void> {
        const rows = await this.prisma.executeInTenantSchema(schemaName,
            `SELECT file_name, thumbnail_name FROM media_files WHERE id = $1::uuid`,
            [fileId],
        );

        const file = (rows as any[])[0];
        if (!file) throw new NotFoundException('File not found');

        // Delete from disk
        const mainPath = path.join(this.storagePath, tenantId, file.file_name);
        const thumbPath = file.thumbnail_name ? path.join(this.storagePath, tenantId, file.thumbnail_name) : null;

        if (fs.existsSync(mainPath)) fs.unlinkSync(mainPath);
        if (thumbPath && fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);

        // Delete from DB
        await this.prisma.executeInTenantSchema(schemaName,
            `DELETE FROM media_files WHERE id = $1::uuid`,
            [fileId],
        );

        this.logger.log(`Deleted media file ${fileId} (${file.file_name})`);
    }

    /**
     * Resolve file path on disk for serving
     */
    getFilePath(tenantId: string, fileName: string): string | null {
        const filePath = path.join(this.storagePath, tenantId, fileName);
        // Prevent directory traversal
        if (!filePath.startsWith(this.storagePath)) return null;
        if (!fs.existsSync(filePath)) return null;
        return filePath;
    }
}
