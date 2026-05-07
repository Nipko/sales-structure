import { Module } from '@nestjs/common';
import { HomeServicesService } from './home-services.service';
import { HomeServicesController } from './home-services.controller';

@Module({
    controllers: [HomeServicesController],
    providers: [HomeServicesService],
    exports: [HomeServicesService],
})
export class HomeServicesModule {}
