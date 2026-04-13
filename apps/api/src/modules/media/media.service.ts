import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as sharp from 'sharp';
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
    label: string | null;
    description: string | null;
    tags: string[];
    createdAt: string;
}

const ALLOWED_MIME_TYPES = [
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const THUMB_WIDTH = 200;
const MAX_WIDTH = 1200;

@Injectable()
export class MediaService {
    private readonly logger = new Logger(MediaService.name);
    readonly storagePath: string;
    private readonly publicBaseUrl: string;

    constructor(
        private prisma: PrismaService,
        private config: ConfigService,
    ) {
        this.storagePath = config.get<string>('MEDIA_STORAGE_PATH', '/data/media');
        // Public URL without /api/v1 prefix (media is excluded from global prefix)
        const apiUrl = config.get<string>('NEXT_PUBLIC_API_URL', 'https://api.parallly-chat.cloud/api/v1');
        this.publicBaseUrl = apiUrl.replace(/\/api\/v1\/?$/, '');

        try { fs.mkdirSync(this.storagePath, { recursive: true }); } catch {}
        this.logger.log(`Media storage: ${this.storagePath} | Public URL: ${this.publicBaseUrl}`);
    }

    /** Build the public URL for a media file (includes /api/v1 prefix) */
    private fileUrl(tenantId: string, fileName: string): string {
        return `/api/v1/media/file/${tenantId}/${fileName}`;
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
        label?: string,
        description?: string,
        tags?: string[],
    ): Promise<MediaFile> {
        if (!file || !file.buffer) {
            throw new BadRequestException('No se recibio el archivo');
        }
        if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            throw new BadRequestException(
                `Tipo de archivo no permitido: ${file.mimetype}. Solo se aceptan: JPG, PNG, WebP, GIF, SVG`,
            );
        }
        if (file.size > MAX_FILE_SIZE) {
            throw new BadRequestException(
                `La imagen pesa ${(file.size / 1024 / 1024).toFixed(1)} MB. El maximo permitido es 5 MB. Comprime la imagen antes de subirla.`,
            );
        }

        const id = randomUUID();
        const fileName = `${id}.webp`;
        const thumbName = `${id}_thumb.webp`;
        const tenantDir = path.join(this.storagePath, tenantId);
        fs.mkdirSync(tenantDir, { recursive: true });

        try {
            const sharpInstance = (sharp as any).default || sharp;

            // Main image: max 1200px, webp quality 80
            const mainPath = path.join(tenantDir, fileName);
            const mainMeta = await sharpInstance(file.buffer)
                .resize(MAX_WIDTH, null, { fit: 'inside', withoutEnlargement: true })
                .webp({ quality: 80 })
                .toFile(mainPath);

            // Thumbnail: 200px, quality 65
            const thumbPath = path.join(tenantDir, thumbName);
            await sharpInstance(file.buffer)
                .resize(THUMB_WIDTH, null, { fit: 'inside' })
                .webp({ quality: 65 })
                .toFile(thumbPath);

            const mainSize = fs.statSync(mainPath).size;

            this.logger.log(`Saved: ${mainPath} (${(mainSize / 1024).toFixed(0)}KB, ${mainMeta.width}x${mainMeta.height})`);

            // DB insert
            const tagArray = tags || [];
            await this.prisma.executeInTenantSchema(schemaName,
                `INSERT INTO media_files (id, entity_type, entity_id, original_name, file_name, mime_type, size_bytes, width, height, thumbnail_name, label, description, tags, created_at)
                 VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())`,
                [id, entityType, entityId || null, file.originalname, fileName, 'image/webp', mainSize, mainMeta.width, mainMeta.height, thumbName, label || null, description || null, tagArray],
            );

            return {
                id, entityType, entityId: entityId || null,
                originalName: file.originalname, fileName,
                mimeType: 'image/webp', sizeBytes: mainSize,
                width: mainMeta.width, height: mainMeta.height,
                url: this.fileUrl(tenantId, fileName),
                thumbnailUrl: this.fileUrl(tenantId, thumbName),
                label: label || null, description: description || null,
                tags: tagArray,
                createdAt: new Date().toISOString(),
            };
        } catch (error: any) {
            this.logger.error(`Sharp failed for ${file.originalname}: ${error.message}`, error.stack);
            throw new BadRequestException(`No se pudo procesar la imagen: ${error.message}`);
        }
    }

    /**
     * Upload company logo
     */
    async uploadLogo(tenantId: string, schemaName: string, file: Express.Multer.File): Promise<{ logoUrl: string }> {
        const mediaFile = await this.upload(schemaName, tenantId, file, 'tenant_logo', undefined, 'Logo', undefined, ['logo']);

        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
        const settings = (tenant?.settings as Record<string, any>) || {};
        settings.logoUrl = mediaFile.url;

        await this.prisma.tenant.update({ where: { id: tenantId }, data: { settings } });
        this.logger.log(`Logo updated for tenant ${tenantId}: ${mediaFile.url}`);
        return { logoUrl: mediaFile.url };
    }

    /**
     * List media files with optional filters
     */
    async list(schemaName: string, tenantId: string, entityType?: string, tag?: string): Promise<MediaFile[]> {
        let sql = `SELECT id, entity_type, entity_id, original_name, file_name, mime_type, size_bytes, width, height, thumbnail_name, label, description, tags, created_at
                    FROM media_files WHERE 1=1`;
        const params: any[] = [];
        let idx = 1;

        if (entityType) { sql += ` AND entity_type = $${idx++}`; params.push(entityType); }
        if (tag) { sql += ` AND $${idx++} = ANY(tags)`; params.push(tag); }

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
            url: this.fileUrl(tenantId, row.file_name),
            thumbnailUrl: row.thumbnail_name ? this.fileUrl(tenantId, row.thumbnail_name) : null,
            label: row.label,
            description: row.description,
            tags: row.tags || [],
            createdAt: row.created_at,
        }));
    }

    /**
     * Get all unique tags used
     */
    async getTags(schemaName: string): Promise<string[]> {
        const rows = await this.prisma.executeInTenantSchema(schemaName,
            `SELECT DISTINCT unnest(tags) as tag FROM media_files WHERE tags IS NOT NULL AND array_length(tags, 1) > 0 ORDER BY tag`,
            [],
        );
        return (rows as any[]).map(r => r.tag);
    }

    /**
     * Update metadata (label, description, tags)
     */
    async updateMeta(schemaName: string, fileId: string, data: { label?: string; description?: string; tags?: string[] }): Promise<void> {
        const sets: string[] = [];
        const params: any[] = [];
        let idx = 1;

        if (data.label !== undefined) { sets.push(`label = $${idx++}`); params.push(data.label); }
        if (data.description !== undefined) { sets.push(`description = $${idx++}`); params.push(data.description); }
        if (data.tags !== undefined) { sets.push(`tags = $${idx++}`); params.push(data.tags); }
        if (sets.length === 0) return;

        params.push(fileId);
        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE media_files SET ${sets.join(', ')} WHERE id = $${idx}::uuid`,
            params,
        );
    }

    /**
     * Delete a media file
     */
    async delete(schemaName: string, tenantId: string, fileId: string): Promise<void> {
        const rows = await this.prisma.executeInTenantSchema(schemaName,
            `SELECT file_name, thumbnail_name FROM media_files WHERE id = $1::uuid`, [fileId],
        );
        const file = (rows as any[])[0];
        if (!file) throw new NotFoundException('File not found');

        const mainPath = path.join(this.storagePath, tenantId, file.file_name);
        const thumbPath = file.thumbnail_name ? path.join(this.storagePath, tenantId, file.thumbnail_name) : null;
        if (fs.existsSync(mainPath)) fs.unlinkSync(mainPath);
        if (thumbPath && fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);

        await this.prisma.executeInTenantSchema(schemaName,
            `DELETE FROM media_files WHERE id = $1::uuid`, [fileId],
        );
        this.logger.log(`Deleted ${fileId} (${file.file_name})`);
    }

    /**
     * Read file from disk for serving
     */
    readFile(tenantId: string, fileName: string): { buffer: Buffer; exists: boolean } {
        const safeName = path.basename(fileName);
        const filePath = path.join(this.storagePath, tenantId, safeName);
        this.logger.debug(`Serving: ${filePath} exists=${fs.existsSync(filePath)}`);

        if (!fs.existsSync(filePath)) {
            return { buffer: Buffer.alloc(0), exists: false };
        }
        return { buffer: fs.readFileSync(filePath), exists: true };
    }

    /**
     * Diagnostic: check storage health
     */
    checkStorage(): { path: string; exists: boolean; writable: boolean; files: number } {
        const exists = fs.existsSync(this.storagePath);
        let writable = false;
        let files = 0;
        try {
            const testFile = path.join(this.storagePath, '.write-test');
            fs.writeFileSync(testFile, 'ok');
            fs.unlinkSync(testFile);
            writable = true;
        } catch {}
        try {
            const dirs = fs.readdirSync(this.storagePath);
            for (const d of dirs) {
                const dirPath = path.join(this.storagePath, d);
                if (fs.statSync(dirPath).isDirectory()) {
                    files += fs.readdirSync(dirPath).length;
                }
            }
        } catch {}
        return { path: this.storagePath, exists, writable, files };
    }
}
