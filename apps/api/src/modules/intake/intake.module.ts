import { Module } from '@nestjs/common';
import { IntakeController } from './intake.controller';
import { IntakeService } from './intake.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [IntakeController],
    providers: [IntakeService],
    exports: [IntakeService],   // exported so pipeline/channels can use checkAndRecordOptOut
})
export class IntakeModule { }
