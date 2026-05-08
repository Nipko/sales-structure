import { Module } from '@nestjs/common';
import { PhotographyService } from './photography.service';
import { PhotographyController } from './photography.controller';

@Module({
    controllers: [PhotographyController],
    providers: [PhotographyService],
    exports: [PhotographyService],
})
export class PhotographyModule {}
