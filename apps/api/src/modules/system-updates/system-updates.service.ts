import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_WIDTH = 1200;

@Injectable()
export class SystemUpdatesService {
    private readonly logger = new Logger(SystemUpdatesService.name);
    private readonly storagePath: string;

    constructor(
        private prisma: PrismaService,
        private config: ConfigService,
    ) {
        // Base media path, e.g. /data/media or local development equivalent
        const basePath = config.get<string>('MEDIA_STORAGE_PATH', '/data/media');
        this.storagePath = path.join(basePath, 'system');
        
        try {
            fs.mkdirSync(this.storagePath, { recursive: true });
        } catch (err: any) {
            this.logger.error(`Could not create system updates media storage folder at ${this.storagePath}: ${err.message}`);
        }
        this.logger.log(`System Updates storage initialized at: ${this.storagePath}`);
    }

    /** List all active system updates (for any user) */
    async listActive() {
        return this.prisma.systemUpdate.findMany({
            where: { isActive: true },
            orderBy: { date: 'desc' },
        });
    }

    /** List all system updates (including inactive, super_admin only) */
    async listAll() {
        return this.prisma.systemUpdate.findMany({
            orderBy: { date: 'desc' },
        });
    }

    /** Find an update by ID */
    async findOne(id: string) {
        const update = await this.prisma.systemUpdate.findUnique({
            where: { id },
        });
        if (!update) throw new NotFoundException('Actualización no encontrada');
        return update;
    }

    /** Create a new system update */
    async create(data: {
        version: string;
        title: any;
        description: any;
        features: any;
        isActive?: boolean;
        date?: Date;
    }) {
        return this.prisma.systemUpdate.create({
            data: {
                version: data.version,
                title: data.title,
                description: data.description,
                features: data.features,
                isActive: data.isActive ?? true,
                date: data.date ? new Date(data.date) : new Date(),
            },
        });
    }

    /** Update an existing system update */
    async update(
        id: string,
        data: {
            version?: string;
            title?: any;
            description?: any;
            features?: any;
            isActive?: boolean;
            date?: Date;
        },
    ) {
        await this.findOne(id); // Ensure exists
        
        const updateData: any = { ...data };
        if (data.date) {
            updateData.date = new Date(data.date);
        }

        return this.prisma.systemUpdate.update({
            where: { id },
            data: updateData,
        });
    }

    /** Delete a system update */
    async delete(id: string) {
        const update = await this.findOne(id); // Ensure exists
        
        // Clean up any images associated with features if they are stored in the system directory
        if (update.features && Array.isArray(update.features)) {
            const features = update.features as any[];
            for (const feature of features) {
                if (feature && typeof feature === 'object' && feature.image && typeof feature.image === 'string' && feature.image.includes('/system-updates/image/')) {
                    const fileName = path.basename(feature.image);
                    const filePath = path.join(this.storagePath, fileName);
                    if (fs.existsSync(filePath)) {
                        try {
                            fs.unlinkSync(filePath);
                            this.logger.log(`Deleted associated image: ${filePath}`);
                        } catch (err: any) {
                            this.logger.error(`Could not delete feature image ${filePath}: ${err.message}`);
                        }
                    }
                }
            }
        }

        return this.prisma.systemUpdate.delete({
            where: { id },
        });
    }

    /** Save an uploaded image to the system announcements folder, resized to webp format */
    async uploadImage(file: Express.Multer.File): Promise<string> {
        if (!file || !file.buffer) {
            throw new BadRequestException('No se recibió el archivo de imagen');
        }
        if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            throw new BadRequestException(
                `Tipo de archivo no soportado: ${file.mimetype}. Solo se aceptan imágenes JPG, PNG, WebP, GIF, SVG`,
            );
        }
        if (file.size > MAX_FILE_SIZE) {
            throw new BadRequestException(
                `La imagen excede el límite de 5MB. Peso: ${(file.size / 1024 / 1024).toFixed(1)}MB`,
            );
        }

        const id = randomUUID();
        const fileName = `${id}.webp`;
        const filePath = path.join(this.storagePath, fileName);

        try {
            const sharpInstance = (sharp as any).default || sharp;

            // Resize main image to max 1200px width, convert to webp (quality 80)
            await sharpInstance(file.buffer)
                .resize(MAX_WIDTH, null, { fit: 'inside', withoutEnlargement: true })
                .webp({ quality: 80 })
                .toFile(filePath);

            const sizeBytes = fs.statSync(filePath).size;
            this.logger.log(`System Announcement Image saved to ${filePath} (${(sizeBytes / 1024).toFixed(1)}KB)`);

            // Return relative file url matching our public controller route
            return `/api/v1/system-updates/image/${fileName}`;
        } catch (err: any) {
            this.logger.error(`Sharp image processing failed for ${file.originalname}: ${err.message}`, err.stack);
            throw new BadRequestException(`Fallo al procesar la imagen: ${err.message}`);
        }
    }

    /** Read static announcement asset from disk for serving */
    readFile(fileName: string): { buffer: Buffer; exists: boolean } {
        const safeName = path.basename(fileName);
        const filePath = path.join(this.storagePath, safeName);
        this.logger.debug(`Serving system update image: ${filePath}`);

        if (!fs.existsSync(filePath)) {
            return { buffer: Buffer.alloc(0), exists: false };
        }
        return { buffer: fs.readFileSync(filePath), exists: true };
    }
}
