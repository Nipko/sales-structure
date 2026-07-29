import { Module } from '@nestjs/common';
import { VerticalsService } from './verticals.service';
import { VerticalsController } from './verticals.controller';
import { StaffSchedulingService } from './staff-scheduling.service';
import { StaffSchedulingController } from './staff-scheduling.controller';
import { VehicleInventoryService } from './vehicle-inventory.service';
import { VehicleInventoryController } from './vehicle-inventory.controller';
import { ServiceRequestListener } from './service-request.listener';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { EmailModule } from '../email/email.module';

@Module({
    imports: [PrismaModule, RedisModule, EmailModule],
    controllers: [VerticalsController, StaffSchedulingController, VehicleInventoryController],
    providers: [VerticalsService, StaffSchedulingService, VehicleInventoryService, ServiceRequestListener],
    exports: [VerticalsService, StaffSchedulingService, VehicleInventoryService],
})
export class VerticalsModule {}
