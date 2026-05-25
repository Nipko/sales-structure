import {
    Controller,
    Get,
    Post,
    Delete,
    Patch,
    Param,
    Body,
    Query,
    Req,
    UseGuards,
    ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FeatureRequestsService } from './feature-requests.service';

@Controller('feature-requests')
@UseGuards(AuthGuard('jwt'))
export class FeatureRequestsController {
    constructor(private readonly service: FeatureRequestsService) {}

    @Get('changelog')
    async changelog() {
        const data = await this.service.changelog();
        return { success: true, data };
    }

    @Get()
    async list(
        @Req() req: any,
        @Query('status') status?: string,
        @Query('category') category?: string,
        @Query('search') search?: string,
        @Query('sort') sort?: string,
    ) {
        const data = await this.service.list({ status, category, search, sort, userId: req.user.id });
        return { success: true, data };
    }

    @Get('similar')
    async similar(@Query('text') text: string) {
        const data = await this.service.findSimilar(text ?? '');
        return { success: true, data };
    }

    @Get(':id')
    async getById(@Param('id') id: string, @Req() req: any) {
        const data = await this.service.getById(id, req.user.id);
        return { success: true, data };
    }

    @Post()
    async create(
        @Body() body: { title: string; description: string; category?: string },
        @Req() req: any,
    ) {
        const data = await this.service.create({
            title: body.title,
            description: body.description,
            category: body.category,
            userId: req.user.id,
            tenantId: req.user.tenantId,
        });
        return { success: true, data };
    }

    @Post(':id/vote')
    async vote(@Param('id') id: string, @Req() req: any) {
        await this.service.vote(id, req.user.id, req.user.tenantId);
        return { success: true };
    }

    @Delete(':id/vote')
    async unvote(@Param('id') id: string, @Req() req: any) {
        await this.service.unvote(id, req.user.id);
        return { success: true };
    }

    @Get(':id/comments')
    async listComments(@Param('id') id: string) {
        const data = await this.service.listComments(id);
        return { success: true, data };
    }

    @Post(':id/comments')
    async comment(@Param('id') id: string, @Body() body: { body: string }, @Req() req: any) {
        const isAdminReply = req.user.role === 'super_admin';
        await this.service.comment(id, req.user.id, body.body, isAdminReply, req.user.tenantId);
        return { success: true };
    }

    @Patch(':id/status')
    async updateStatus(
        @Param('id') id: string,
        @Body() body: { status: string; declinedReason?: string },
        @Req() req: any,
    ) {
        if (req.user.role !== 'super_admin') {
            throw new ForbiddenException('Only super_admin can change status');
        }
        await this.service.updateStatus(id, body.status, body.declinedReason);
        return { success: true };
    }

    @Post(':id/merge')
    async merge(@Param('id') sourceId: string, @Body() body: { targetId: string }, @Req() req: any) {
        if (req.user.role !== 'super_admin') {
            throw new ForbiddenException('Only super_admin can merge requests');
        }
        await this.service.merge(sourceId, body.targetId);
        return { success: true };
    }
}
