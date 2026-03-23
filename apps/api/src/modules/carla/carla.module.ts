import { Module } from '@nestjs/common';
import { CarlaService } from './carla.service';
import { CarlaController } from './carla.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [CarlaController],
    providers: [CarlaService],
    exports: [CarlaService]
})
export class CarlaModule {}
