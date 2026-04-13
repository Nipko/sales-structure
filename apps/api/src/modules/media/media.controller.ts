import {
    Controller, Post, Get, Put, Delete, Param, Query, Body,
    UseGuards, UseInterceptors, UploadedFile, Res,
    HttpCode, HttpStatus, BadRequestException, Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { Response } from 'express';
import { memoryStorage } from 'multer';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentUser } from '../../common/decorators/tenant.decorator';
import { MediaService } from './media.service';

const storage = memoryStorage();

@ApiTags('media')
@Controller('media')
export class MediaController {
    private readonly logger = new Logger(MediaController.name);

    constructor(private mediaService: MediaService) {}

    // ── Protected routes ─────────────────────────────────────────

    @Post('upload/:tenantId')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @ApiBearerAuth()
    @ApiConsumes('multipart/form-data')
    @UseInterceptors(FileInterceptor('file', { storage, limits: { fileSize: 5 * 1024 * 1024 } }))
    async upload(
        @Param('tenantId') tenantId: string,
        @CurrentUser() user: any,
        @UploadedFile() file: Express.Multer.File,
        @Query('entityType') entityType?: string,
        @Query('entityId') entityId?: string,
    ) {
        if (!file) throw new BadRequestException('No se recibio ningun archivo');
        const result = await this.mediaService.upload(
            user.schemaName, tenantId, file, entityType || 'general', entityId,
        );
        return { success: true, data: result };
    }

    @Post('logo/:tenantId')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @ApiBearerAuth()
    @ApiConsumes('multipart/form-data')
    @UseInterceptors(FileInterceptor('file', { storage, limits: { fileSize: 5 * 1024 * 1024 } }))
    async uploadLogo(
        @Param('tenantId') tenantId: string,
        @CurrentUser() user: any,
        @UploadedFile() file: Express.Multer.File,
    ) {
        if (!file) throw new BadRequestException('No se recibio ningun archivo');
        const result = await this.mediaService.uploadLogo(tenantId, user.schemaName, file);
        return { success: true, data: result };
    }

    @Get('list/:tenantId')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @ApiBearerAuth()
    async list(
        @Param('tenantId') tenantId: string,
        @CurrentUser() user: any,
        @Query('entityType') entityType?: string,
        @Query('tag') tag?: string,
    ) {
        const files = await this.mediaService.list(user.schemaName, tenantId, entityType, tag);
        return { success: true, data: files };
    }

    @Get('tags/:tenantId')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @ApiBearerAuth()
    async getTags(@Param('tenantId') tenantId: string, @CurrentUser() user: any) {
        const tags = await this.mediaService.getTags(user.schemaName);
        return { success: true, data: tags };
    }

    @Put('update/:tenantId/:fileId')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    async updateMeta(
        @Param('tenantId') tenantId: string,
        @Param('fileId') fileId: string,
        @Body() body: { label?: string; description?: string; tags?: string[] },
        @CurrentUser() user: any,
    ) {
        await this.mediaService.updateMeta(user.schemaName, fileId, body);
        return { success: true };
    }

    @Delete('delete/:tenantId/:fileId')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    async delete(
        @Param('tenantId') tenantId: string,
        @Param('fileId') fileId: string,
        @CurrentUser() user: any,
    ) {
        await this.mediaService.delete(user.schemaName, tenantId, fileId);
        return { success: true };
    }

    // ── Diagnostic ───────────────────────────────────────────────

    @Get('health')
    async health() {
        const storage = this.mediaService.checkStorage();
        return { success: true, data: storage };
    }

    // ── Public file serving (excluded from /api/v1 prefix) ───────

    @Get('file/:tenantId/:fileName')
    async serve(
        @Param('tenantId') tenantId: string,
        @Param('fileName') fileName: string,
        @Res() res: Response,
    ) {
        this.logger.log(`Serve request: tenantId=${tenantId} fileName=${fileName}`);

        const { buffer, exists } = this.mediaService.readFile(tenantId, fileName);
        if (!exists) {
            this.logger.warn(`File not found: ${tenantId}/${fileName}`);
            return res.status(404).json({ message: 'Archivo no encontrado' });
        }

        // Allow cross-origin loading from dashboard
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Content-Length', buffer.length);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.end(buffer);
    }
}
