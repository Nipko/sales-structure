import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
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
// Documents/files are stored as-is (no image processing). Sent outbound as WhatsApp documents.
const DOCUMENT_MIME_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv', 'application/zip',
];
const DOC_EXT: Record<string, string> = {
    'application/pdf': '.pdf', 'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'text/plain': '.txt', 'text/csv': '.csv', 'application/zip': '.zip',
};
// Audio (voice notes from the mobile app). Stored as-is, sent outbound as WhatsApp audio.
const AUDIO_MIME_TYPES = [
    'audio/mp4', 'audio/aac', 'audio/m4a', 'audio/x-m4a',
    'audio/mpeg', 'audio/ogg', 'audio/amr', 'audio/wav', 'audio/webm',
];
const AUDIO_EXT: Record<string, string> = {
    'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/m4a': '.m4a', 'audio/x-m4a': '.m4a',
    'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/amr': '.amr', 'audio/wav': '.wav', 'audio/webm': '.webm',
};
// Video (outbound from the mobile app). Stored as-is, sent as WhatsApp video.
const VIDEO_MIME_TYPES = ['video/mp4', 'video/3gpp', 'video/quicktime'];
const VIDEO_EXT: Record<string, string> = {
    'video/mp4': '.mp4', 'video/3gpp': '.3gp', 'video/quicktime': '.mov',
};
// Imágenes ENTRANTES del chat. Se guardan tal cual llegan (sin pasar por sharp,
// a diferencia de `upload`): la foto del cliente es evidencia y recomprimirla no
// aporta nada. Sin este mapa `saveBuffer` les ponía `.bin`, y el endpoint que
// las sirve resuelve el Content-Type POR EXTENSIÓN: llegaban como
// application/octet-stream y el navegador las ofrecía para descargar en vez de
// mostrarlas.
const IMAGE_EXT: Record<string, string> = {
    'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
    'image/webp': '.webp', 'image/gif': '.gif',
};
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB (images)
const MAX_DOC_SIZE = 25 * 1024 * 1024; // 25MB (documents)
const MAX_AUDIO_SIZE = 16 * 1024 * 1024; // 16MB (WhatsApp audio limit)
const MAX_VIDEO_SIZE = 16 * 1024 * 1024; // 16MB (WhatsApp video limit)
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
        private throttle: TenantThrottleService,
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
     * Persist a raw media buffer (e.g. an INBOUND voice note already downloaded for
     * transcription) so the agent can play it back. No image processing, no DB row —
     * the public serve endpoint reads it straight from disk by filename.
     * Returns the relative served URL, or null on failure (best-effort).
     */
    async saveBuffer(tenantId: string, buffer: Buffer, mimeType: string): Promise<string | null> {
        try {
            if (!buffer?.length) return null;
            const ext =
                AUDIO_EXT[mimeType] || VIDEO_EXT[mimeType] || DOC_EXT[mimeType] || IMAGE_EXT[mimeType] ||
                (mimeType?.startsWith('audio/') ? '.ogg'
                    : mimeType?.startsWith('video/') ? '.mp4'
                        : mimeType?.startsWith('image/') ? '.jpg' : '.bin');
            const id = randomUUID();
            const fileName = `${id}${ext}`;
            const tenantDir = path.join(this.storagePath, tenantId);
            fs.mkdirSync(tenantDir, { recursive: true });
            fs.writeFileSync(path.join(tenantDir, fileName), buffer);
            this.logger.log(`Saved raw media: ${fileName} (${(buffer.length / 1024).toFixed(0)}KB, ${mimeType})`);
            return this.fileUrl(tenantId, fileName);
        } catch (e: any) {
            this.logger.warn(`saveBuffer failed: ${e.message}`);
            return null;
        }
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
        const isImage = ALLOWED_MIME_TYPES.includes(file.mimetype);
        const isDoc = DOCUMENT_MIME_TYPES.includes(file.mimetype);
        const isAudio = AUDIO_MIME_TYPES.includes(file.mimetype);
        const isVideo = VIDEO_MIME_TYPES.includes(file.mimetype);
        if (!isImage && !isDoc && !isAudio && !isVideo) {
            throw new BadRequestException(
                `Tipo de archivo no permitido: ${file.mimetype || 'desconocido'}. ` +
                `Permitidos: imágenes (jpg, png, webp, gif), documentos (pdf, word, excel, ppt, txt, csv, zip), ` +
                `audio (m4a, mp3, ogg, aac, amr, wav) y video (mp4, 3gp, mov).`,
            );
        }
        if (isImage && file.size > MAX_FILE_SIZE) {
            throw new BadRequestException(
                `La imagen pesa ${(file.size / 1024 / 1024).toFixed(1)} MB. El maximo permitido es 5 MB.`,
            );
        }
        if (isDoc && file.size > MAX_DOC_SIZE) {
            throw new BadRequestException(
                `El archivo pesa ${(file.size / 1024 / 1024).toFixed(1)} MB. El maximo permitido es 25 MB.`,
            );
        }
        if (isAudio && file.size > MAX_AUDIO_SIZE) {
            throw new BadRequestException(
                `El audio pesa ${(file.size / 1024 / 1024).toFixed(1)} MB. El maximo permitido es 16 MB.`,
            );
        }
        if (isVideo && file.size > MAX_VIDEO_SIZE) {
            throw new BadRequestException(
                `El video pesa ${(file.size / 1024 / 1024).toFixed(1)} MB. El maximo permitido es 16 MB.`,
            );
        }

        // Per-tenant media storage quota. Counts THIS upload (un-rounded floats,
        // so a legitimate file just under the cap isn't rejected by rounding) and
        // blocks before any overshoot. Single choke point — also covers logo
        // uploads (uploadLogo → upload) and future callers. Inbound customer media
        // uses saveBuffer() (no DB row) and is exempt here.
        // Note: for images, incomingMb is the RAW upload size while the stored webp
        // is smaller, so this is a conservative (fail-closed) upper bound that may
        // trip slightly early. Accurate per-image accounting would require checking
        // after compression — deferred (low impact, bounded by the 5 MB image cap).
        const usageMb = await this.getTenantStorageUsageMb(schemaName);
        const incomingMb = file.size / (1024 * 1024);
        await this.throttle.enforcePlanLimit(
            tenantId,
            'mediaStorageMb',
            usageMb + incomingMb,
            'MB de almacenamiento multimedia',
        );

        const id = randomUUID();
        const tenantDir = path.join(this.storagePath, tenantId);
        fs.mkdirSync(tenantDir, { recursive: true });

        // Documents + audio + video: store as-is (no image processing), keep original mime + name.
        if (isDoc || isAudio || isVideo) {
            const ext = DOC_EXT[file.mimetype] || AUDIO_EXT[file.mimetype] || VIDEO_EXT[file.mimetype] || path.extname(file.originalname || '') || '';
            const docName = `${id}${ext}`;
            fs.writeFileSync(path.join(tenantDir, docName), file.buffer);
            const size = file.buffer.length;
            await this.prisma.executeInTenantSchema(schemaName,
                `INSERT INTO media_files (id, entity_type, entity_id, original_name, file_name, mime_type, size_bytes, width, height, thumbnail_name, label, description, tags, created_at)
                 VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())`,
                [id, entityType, entityId || null, file.originalname, docName, file.mimetype, size, null, null, null, label || null, description || null, tags || []],
            );
            this.logger.log(`Saved document: ${docName} (${(size / 1024).toFixed(0)}KB, ${file.mimetype})`);
            return {
                id, entityType, entityId: entityId || null,
                originalName: file.originalname, fileName: docName,
                mimeType: file.mimetype, sizeBytes: size,
                width: null, height: null,
                url: this.fileUrl(tenantId, docName),
                thumbnailUrl: null,
                label: label || null, description: description || null,
                tags: tags || [],
                createdAt: new Date().toISOString(),
            };
        }

        const fileName = `${id}.webp`;
        const thumbName = `${id}_thumb.webp`;

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
                 VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())`,
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
    async list(schemaName: string, tenantId: string, entityType?: string, tag?: string, entityId?: string): Promise<MediaFile[]> {
        let sql = `SELECT id, entity_type, entity_id, original_name, file_name, mime_type, size_bytes, width, height, thumbnail_name, label, description, tags, created_at
                    FROM media_files WHERE 1=1`;
        const params: any[] = [];
        let idx = 1;

        if (entityType) { sql += ` AND entity_type = $${idx++}`; params.push(entityType); }
        // Galería de UN contacto: las fotos que mandó por el chat. Sin este
        // filtro `list` sólo sabía devolver el banco entero del tenant.
        if (entityId) { sql += ` AND entity_id = $${idx++}::uuid`; params.push(entityId); }
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
     * Wipe every file uploaded by a tenant — used during tenant purge
     * (offboarding final or super_admin force-delete). Removes the entire
     * /data/media/{tenantId}/ directory; the DB rows in media_files live
     * in the tenant schema and are dropped with DROP SCHEMA CASCADE.
     */
    async deleteAllTenantFiles(tenantId: string): Promise<{
        removed: number;
        tenantDir: string;
        archiveDir: string;
    }> {
        // Defensive: never let path traversal through the tenantId param
        const safeTenantId = tenantId.replace(/[^a-zA-Z0-9_-]/g, '');
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId);
        if (!safeTenantId || safeTenantId !== tenantId || !isUuid) {
            this.logger.warn(`Refusing to wipe media for suspicious tenantId: ${tenantId}`);
            throw new BadRequestException('Invalid tenantId for media purge');
        }
        const tenantDir = path.join(this.storagePath, safeTenantId);
        const archiveDir = path.join(this.storagePath, 'archives', safeTenantId);
        let removed = 0;
        try {
            // Count files first (one pass)
            const countFiles = (dir: string): number => {
                let n = 0;
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    if (entry.isDirectory()) n += countFiles(path.join(dir, entry.name));
                    else n++;
                }
                return n;
            };
            for (const target of [tenantDir, archiveDir]) {
                if (!fs.existsSync(target)) continue;
                removed += countFiles(target);
                fs.rmSync(target, { recursive: true, force: true });
            }
            this.logger.log(`Wiped ${removed} hot/cold file(s) for tenant ${tenantId}`);
        } catch (err: any) {
            this.logger.error(`Failed to wipe media dir for tenant ${tenantId}: ${err.message}`);
        }
        return { removed, tenantDir, archiveDir };
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
    async getTenantStorageUsageMb(schemaName: string): Promise<number> {
        try {
            const rows = await this.prisma.executeInTenantSchema(schemaName,
                `SELECT COALESCE(SUM(size_bytes), 0) AS total FROM media_files`,
                [],
            ) as any[];
            return Number(rows[0]?.total ?? 0) / (1024 * 1024);
        } catch {
            return 0;
        }
    }

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
