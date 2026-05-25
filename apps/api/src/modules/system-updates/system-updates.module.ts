import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SystemUpdatesService } from './system-updates.service';
import { SystemUpdatesController } from './system-updates.controller';

@Module({
    imports: [ConfigModule],
    controllers: [SystemUpdatesController],
    providers: [SystemUpdatesService],
    exports: [SystemUpdatesService],
})
export class SystemUpdatesModule {}
