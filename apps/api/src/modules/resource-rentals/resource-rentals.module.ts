import { Module } from '@nestjs/common';
import { ResourceRentalsController } from './resource-rentals.controller';
import { ResourceRentalsService } from './resource-rentals.service';

@Module({
    controllers: [ResourceRentalsController],
    providers: [ResourceRentalsService],
    exports: [ResourceRentalsService],
})
export class ResourceRentalsModule {}
