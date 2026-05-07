import { Module } from '@nestjs/common';
import { GymsService } from './gyms.service';
import { GymsController } from './gyms.controller';

@Module({
    controllers: [GymsController],
    providers: [GymsService],
    exports: [GymsService],
})
export class GymsModule {}
