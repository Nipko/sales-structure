import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PlatformCommunicationsService } from './platform-communications.service';

type AdminRequest = { user: { id: string; email: string; isImpersonation?: boolean } };

@Controller('platform-communications')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('super_admin')
export class PlatformCommunicationsController {
    constructor(private readonly service: PlatformCommunicationsService) {}

    private actor(req: AdminRequest) {
        if (req.user.isImpersonation) throw new ForbiddenException({ error: 'COMMUNICATION_IMPERSONATION_FORBIDDEN', message: 'COMMUNICATION_IMPERSONATION_FORBIDDEN' });
        return req.user;
    }

    @Get()
    async list(@Req() req: AdminRequest, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
        this.actor(req);
        return { success: true, data: await this.service.list(page, pageSize) };
    }

    @Get('tenants')
    async tenants(@Req() req: AdminRequest, @Query('search') search?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
        this.actor(req);
        return { success: true, data: await this.service.tenants(search, page, pageSize) };
    }

    @Post()
    async create(@Req() req: AdminRequest, @Body() body: unknown) {
        return { success: true, data: await this.service.create(body, this.actor(req).id) };
    }

    @Get(':id')
    async detail(@Req() req: AdminRequest, @Param('id') id: string) {
        this.actor(req);
        return { success: true, data: await this.service.detail(id) };
    }

    @Patch(':id')
    async update(@Req() req: AdminRequest, @Param('id') id: string, @Body() body: Record<string, unknown>) {
        return { success: true, data: await this.service.update(id, body, this.actor(req).id) };
    }

    @Delete(':id')
    async remove(@Req() req: AdminRequest, @Param('id') id: string, @Query('expectedRevision') expectedRevision?: string) {
        this.actor(req);
        return { success: true, data: await this.service.remove(id, Number(expectedRevision)) };
    }

    @Post(':id/preview')
    async preview(@Req() req: AdminRequest, @Param('id') id: string, @Body() body: { expectedRevision: number }) {
        return { success: true, data: await this.service.preview(id, body?.expectedRevision, this.actor(req).id) };
    }

    @Get(':id/recipients')
    async recipients(@Req() req: AdminRequest, @Param('id') id: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
        this.actor(req);
        return { success: true, data: await this.service.recipients(id, page, pageSize) };
    }

    @Post(':id/test')
    async test(@Req() req: AdminRequest, @Param('id') id: string, @Body() body: { language: string }) {
        return { success: true, data: await this.service.test(id, body?.language, this.actor(req).email) };
    }

    @Post(':id/send')
    async send(@Req() req: AdminRequest, @Param('id') id: string, @Body() body: { expectedRevision: number; previewVersion: string }) {
        return { success: true, data: await this.service.send(id, body, this.actor(req).id) };
    }

    @Post(':id/retry')
    async retry(@Req() req: AdminRequest, @Param('id') id: string, @Body() body: { expectedRevision: number }) {
        return { success: true, data: await this.service.retry(id, body?.expectedRevision, this.actor(req).id) };
    }
}
