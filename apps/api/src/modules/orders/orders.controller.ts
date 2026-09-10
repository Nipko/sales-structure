import { BadRequestException, Controller, Get, Post, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { OrdersService } from './orders.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentUser } from '../../common/decorators/tenant.decorator';

@Controller('orders')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
@ApiBearerAuth()
export class OrdersController {
    constructor(private ordersService: OrdersService) { }

    @Get('overview/:tenantId')
    async getOverview(
        @Param('tenantId') tenantId: string,
        @CurrentUser() user: any,
    ) {
        const data = await this.ordersService.getOverview(
            tenantId,
            user?.role !== 'tenant_agent',
        );
        return { success: true, data };
    }

    @Get('contacts/:tenantId')
    async getContacts(
        @Param('tenantId') tenantId: string,
        @Query('search') search?: string,
        @Query('limit') limit?: string,
        @Query('offset') offset?: string,
    ) {
        const data = await this.ordersService.getContacts(tenantId, {
            search,
            limit: limit === undefined ? undefined : Number(limit),
            offset: offset === undefined ? undefined : Number(offset),
        });
        return { success: true, data };
    }

    @Post('quote/:tenantId')
    async quoteOrder(@Param('tenantId') tenantId:string,@Body() body:any){
        return {success:true,data:await this.ordersService.quoteOrder(tenantId,body)};
    }

    @Post(':tenantId')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async createOrder(
        @Param('tenantId') tenantId: string,
        @Body() body: any,
        @CurrentUser() user: any,
    ) {
        if(typeof body?.expectedTermsHash!=='string'||!/^[a-f0-9]{64}$/.test(body.expectedTermsHash)
            ||typeof body?.idempotencyKey!=='string'||!body.idempotencyKey.trim()||body.idempotencyKey.length>200) throw new BadRequestException('catalog_terms_required');
        const order = await this.ordersService.createOrder(tenantId, body,user?.id||user?.sub);
        return { success: true, data: order };
    }

    @Put(':tenantId/:orderId/status')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async updateOrderStatus(
        @Param('tenantId') tenantId: string,
        @Param('orderId') orderId: string,
        @Body() body: { status: string; expectedVersion:number },
        @CurrentUser() user: any,
    ) {
        if(!Number.isInteger(body.expectedVersion)||body.expectedVersion<1) throw new BadRequestException('catalog_version_required');
        await this.ordersService.updateOrderStatus(tenantId, orderId, body.status, user?.role,body.expectedVersion,user?.id||user?.sub);
        return { success: true, message: 'Status updated' };
    }

    @Post(':tenantId/:orderId/stock-evidence')
    @Roles('tenant_admin','tenant_supervisor')
    async recordStockEvidence(@Param('tenantId') tenantId:string,@Param('orderId') orderId:string,@Body() body:any,@CurrentUser() user:any){
        return {success:true,data:await this.ordersService.recordStockEvidence(tenantId,orderId,body,{id:user?.id||user?.sub,role:user?.role})};
    }

    @Get(':tenantId/:orderId/invoice')
    async getInvoiceHtml(
        @Param('tenantId') tenantId: string,
        @Param('orderId') orderId: string,
        @Query('language') language?:string,
    ) {
        const html = await this.ordersService.getInvoiceHtml(tenantId, orderId,language);
        return html; // NestJS will return it as content-type: text/html automatically if it's a string, or you can force it, but string return is fine for simple display
    }
}
