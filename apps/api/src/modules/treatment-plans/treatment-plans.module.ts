import { Module } from '@nestjs/common';
import { TreatmentPlansService } from './treatment-plans.service';
import { TreatmentPlansController } from './treatment-plans.controller';

@Module({
    controllers: [TreatmentPlansController],
    providers: [TreatmentPlansService],
    exports: [TreatmentPlansService],
})
export class TreatmentPlansModule {}
