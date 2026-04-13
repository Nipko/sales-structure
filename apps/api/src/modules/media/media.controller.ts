import {
    Controller, Post, Get, Delete, Param, Query,
    UseGuards, UseInterceptors, UploadedFile, Res,
    HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
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
    constructor(private mediaService: MediaService) {}

    // ── Protected routes FIRST (more specific paths) ─────────────

    @Post('upload/:tenantId')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Upload a media file' })
    @ApiConsumes('multipart/form-data')
    @UseInterceptors(FileInterceptor('file', { storage, limits: { fileSize: 10 * 1024 * 1024 } }))
    async upload(
        @Param('tenantId') tenantId: string,
        @CurrentUser() user: any,
        @UploadedFile() file: Express.Multer.File,
        @Query('entityType') entityType?: string,
        @Query('entityId') entityId?: string,
    ) {
        if (!file) throw new BadRequestException('No file uploaded');
        const result = await this.mediaService.upload(
            user.schemaName, tenantId, file,
            entityType || 'general', entityId,
        );
        return { success: true, data: result };
    }

    @Post('logo/:tenantId')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Upload company logo' })
    @ApiConsumes('multipart/form-data')
    @UseInterceptors(FileInterceptor('file', { storage, limits: { fileSize: 5 * 1024 * 1024 } }))
    async uploadLogo(
        @Param('tenantId') tenantId: string,
        @CurrentUser() user: any,
        @UploadedFile() file: Express.Multer.File,
    ) {
        if (!file) throw new BadRequestException('No file uploaded');
        const result = await this.mediaService.uploadLogo(tenantId, user.schemaName, file);
        return { success: true, data: result };
    }

    @Get('list/:tenantId')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'List media files for tenant' })
    async list(
        @Param('tenantId') tenantId: string,
        @CurrentUser() user: any,
        @Query('entityType') entityType?: string,
    ) {
        const files = await this.mediaService.list(user.schemaName, tenantId, entityType);
        return { success: true, data: files };
    }

    @Delete('delete/:tenantId/:fileId')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Delete a media file' })
    async delete(
        @Param('tenantId') tenantId: string,
        @Param('fileId') fileId: string,
        @CurrentUser() user: any,
    ) {
        await this.mediaService.delete(user.schemaName, tenantId, fileId);
        return { success: true };
    }

    // ── Public: serve media files (no auth) — LAST (catch-all) ───
    @Get('file/:tenantId/:fileName')
    @ApiOperation({ summary: 'Serve a media file (public)' })
    async serve(
        @Param('tenantId') tenantId: string,
        @Param('fileName') fileName: string,
        @Res() res: Response,
    ) {
        const filePath = this.mediaService.getFilePath(tenantId, fileName);
        if (!filePath) {
            return res.status(404).json({ message: 'File not found' });
        }
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('Content-Type', 'image/webp');
        return res.sendFile(filePath);
    }
}
