import {
    Controller, Post, Get, Put, Delete, Param, Body, UseGuards,
    UseInterceptors, UploadedFile, Res, BadRequestException, Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { Response } from 'express';
import { memoryStorage } from 'multer';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { SystemUpdatesService } from './system-updates.service';

const storage = memoryStorage();

@ApiTags('system-updates')
@Controller('system-updates')
export class SystemUpdatesController {
    private readonly logger = new Logger(SystemUpdatesController.name);

    constructor(private readonly service: SystemUpdatesService) {}

    // ── Public Endpoint ─────────────────────────────────────────

    @Get('image/:fileName')
    async serveImage(
        @Param('fileName') fileName: string,
        @Res() res: Response,
    ) {
        const { buffer, exists } = this.service.readFile(fileName);
        if (!exists) {
            this.logger.warn(`Announcement image not found: ${fileName}`);
            return res.status(404).json({ message: 'Imagen de anuncio no encontrada' });
        }

        // Allow embedding across subdomains/origins
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Content-Length', buffer.length);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.end(buffer);
    }

    // ── Authenticated User Endpoint ─────────────────────────────

    @Get()
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @ApiBearerAuth()
    async listActive() {
        const updates = await this.service.listActive();
        return { success: true, data: updates };
    }

    // ── Super Admin Gated Endpoints ─────────────────────────────

    @Get('admin')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('super_admin')
    @ApiBearerAuth()
    async listAll() {
        const updates = await this.service.listAll();
        return { success: true, data: updates };
    }

    @Get(':id')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('super_admin')
    @ApiBearerAuth()
    async findOne(@Param('id') id: string) {
        const update = await this.service.findOne(id);
        return { success: true, data: update };
    }

    @Post()
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('super_admin')
    @ApiBearerAuth()
    async create(@Body() body: {
        version: string;
        title: any;
        description: any;
        features: any;
        isActive?: boolean;
        date?: Date;
    }) {
        const update = await this.service.create(body);
        return { success: true, data: update };
    }

    @Put(':id')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('super_admin')
    @ApiBearerAuth()
    async update(
        @Param('id') id: string,
        @Body() body: {
            version?: string;
            title?: any;
            description?: any;
            features?: any;
            isActive?: boolean;
            date?: Date;
        },
    ) {
        const update = await this.service.update(id, body);
        return { success: true, data: update };
    }

    @Delete(':id')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('super_admin')
    @ApiBearerAuth()
    async delete(@Param('id') id: string) {
        await this.service.delete(id);
        return { success: true };
    }

    @Post('upload-image')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('super_admin')
    @ApiBearerAuth()
    @ApiConsumes('multipart/form-data')
    @UseInterceptors(FileInterceptor('file', { storage, limits: { fileSize: 5 * 1024 * 1024 } }))
    async uploadImage(@UploadedFile() file: Express.Multer.File) {
        if (!file) throw new BadRequestException('No se recibió la imagen');
        const url = await this.service.uploadImage(file);
        return { success: true, url };
    }
}
