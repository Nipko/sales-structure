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
        return this.service.changelog();
    }

    @Get()
    async list(
        @Req() req: any,
        @Query('status') status?: string,
        @Query('category') category?: string,
        @Query('search') search?: string,
        @Query('sort') sort?: string,
    ) {
        return this.service.list({ status, category, search, sort, userId: req.user.sub });
    }

    @Get('similar')
    async similar(@Query('text') text: string) {
        return this.service.findSimilar(text ?? '');
    }

    @Get(':id')
    async getById(@Param('id') id: string, @Req() req: any) {
        return this.service.getById(id, req.user.sub);
    }

    @Post()
    async create(
        @Body() body: { title: string; description: string; category?: string },
        @Req() req: any,
    ) {
        return this.service.create({
            title: body.title,
            description: body.description,
            category: body.category,
            userId: req.user.sub,
            tenantId: req.user.tenantId,
        });
    }

    @Post(':id/vote')
    async vote(@Param('id') id: string, @Req() req: any) {
        return this.service.vote(id, req.user.sub, req.user.tenantId);
    }

    @Delete(':id/vote')
    async unvote(@Param('id') id: string, @Req() req: any) {
        return this.service.unvote(id, req.user.sub);
    }

    @Get(':id/comments')
    async listComments(@Param('id') id: string) {
        return this.service.listComments(id);
    }

    @Post(':id/comments')
    async comment(@Param('id') id: string, @Body() body: { body: string }, @Req() req: any) {
        const isAdminReply = req.user.role === 'super_admin';
        return this.service.comment(id, req.user.sub, body.body, isAdminReply, req.user.tenantId);
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
        return this.service.updateStatus(id, body.status, body.declinedReason);
    }

    @Post(':id/merge')
    async merge(@Param('id') sourceId: string, @Body() body: { targetId: string }, @Req() req: any) {
        if (req.user.role !== 'super_admin') {
            throw new ForbiddenException('Only super_admin can merge requests');
        }
        return this.service.merge(sourceId, body.targetId);
    }
}
