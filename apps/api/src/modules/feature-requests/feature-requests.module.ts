import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FeatureRequestsService } from './feature-requests.service';
import { FeatureRequestsController } from './feature-requests.controller';

@Module({
    imports: [PrismaModule],
    controllers: [FeatureRequestsController],
    providers: [FeatureRequestsService],
    exports: [FeatureRequestsService],
})
export class FeatureRequestsModule {}
