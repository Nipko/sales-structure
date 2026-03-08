import { Controller, Get, Post, Put, Body, Param } from '@nestjs/common';
import { OrdersService } from './orders.service';

@Controller('api/v1/orders')
export class OrdersController {
    constructor(private ordersService: OrdersService) { }

    @Get('overview/:tenantId')
    async getOverview(@Param('tenantId') tenantId: string) {
        const data = await this.ordersService.getOverview(tenantId);
        return { success: true, data };
    }

    @Post(':tenantId')
    async createOrder(
        @Param('tenantId') tenantId: string,
        @Body() body: any
    ) {
        const order = await this.ordersService.createOrder(tenantId, body);
        return { success: true, data: order };
    }

    @Put(':tenantId/:orderId/status')
    async updateOrderStatus(
        @Param('tenantId') tenantId: string,
        @Param('orderId') orderId: string,
        @Body() body: { status: string }
    ) {
        await this.ordersService.updateOrderStatus(tenantId, orderId, body.status);
        return { success: true, message: 'Status updated' };
    }
}
