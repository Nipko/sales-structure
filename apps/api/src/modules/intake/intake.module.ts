import { Module } from '@nestjs/common';
import { IntakeController } from './intake.controller';
import { LandingController } from './landing.controller';
import { FormController } from './form.controller';
import { AdminLandingController } from './admin-landing.controller';
import { IntakeService } from './intake.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [IntakeController, LandingController, FormController, AdminLandingController],
    providers: [IntakeService],
    exports: [IntakeService],
})
export class IntakeModule { }
