import {
    Controller, Post, Get, Delete, Param, Query,
    UseGuards, UseInterceptors, UploadedFile, Res,
    HttpCode, HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { Response } from 'express';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentUser } from '../../common/decorators/tenant.decorator';
import { MediaService } from './media.service';

@ApiTags('media')
@Controller('media')
export class MediaController {
    constructor(private mediaService: MediaService) {}

    // ── Public: serve media files (no auth) ──────────────────────
    @Get(':tenantId/:fileName')
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
        // Cache for 1 year (immutable filenames with UUID)
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('Content-Type', 'image/webp');
        return res.sendFile(filePath);
    }

    // ── Protected: upload, list, delete ──────────────────────────

    @Post('upload/:tenantId')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Upload a media file' })
    @ApiConsumes('multipart/form-data')
    @UseInterceptors(FileInterceptor('file', {
        limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    }))
    async upload(
        @Param('tenantId') tenantId: string,
        @CurrentUser() user: any,
        @UploadedFile() file: Express.Multer.File,
        @Query('entityType') entityType?: string,
        @Query('entityId') entityId?: string,
    ) {
        const result = await this.mediaService.upload(
            user.schemaName,
            tenantId,
            file,
            entityType || 'general',
            entityId,
        );
        return { success: true, data: result };
    }

    @Post('logo/:tenantId')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Upload company logo' })
    @ApiConsumes('multipart/form-data')
    @UseInterceptors(FileInterceptor('file', {
        limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    }))
    async uploadLogo(
        @Param('tenantId') tenantId: string,
        @CurrentUser() user: any,
        @UploadedFile() file: Express.Multer.File,
    ) {
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
        const files = await this.mediaService.list(user.schemaName, entityType);
        return { success: true, data: files };
    }

    @Delete(':tenantId/:fileId')
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
}
