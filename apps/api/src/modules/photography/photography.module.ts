import { Module } from '@nestjs/common';
import { PhotographyService } from './photography.service';
import { PhotographyController } from './photography.controller';
import { EmailTemplatesModule } from '../email-templates/email-templates.module';

@Module({
    // The session confirmation `tools.photography.emailConfirmations` governs.
    imports: [EmailTemplatesModule],
    controllers: [PhotographyController],
    providers: [PhotographyService],
    exports: [PhotographyService],
})
export class PhotographyModule {}
