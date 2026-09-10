import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OperationalNoticeReviewService } from './operational-notice-review.service';

@Controller('operational-notices')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class OperationalNoticeController {
    constructor(private readonly notices: OperationalNoticeReviewService) {}

    @Get(':tenantId')
    @Roles('super_admin','tenant_admin','tenant_supervisor')
    async list(@Param('tenantId') tenantId:string,@Query('state') state?:string,@Query('conversationId') conversationId?:string,@Query('cursor') cursor?:string) {
        return {success:true,data:await this.notices.list(tenantId,{state,conversationId,cursor})};
    }

    @Get(':tenantId/:noticeId')
    @Roles('super_admin','tenant_admin','tenant_supervisor')
    async detail(@Param('tenantId') tenantId:string,@Param('noticeId') noticeId:string){
        return {success:true,data:await this.notices.detail(tenantId,noticeId)};
    }

    @Post(':tenantId/:noticeId/reviews')
    @Roles('super_admin','tenant_admin','tenant_supervisor')
    async review(@Param('tenantId') tenantId:string,@Param('noticeId') noticeId:string,@Req() req:any,@Body() body:unknown){
        return {success:true,data:await this.notices.review(tenantId,noticeId,req.user?.id,body)};
    }
}
