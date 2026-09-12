import { Module } from '@nestjs/common';
import { EmailTemplatesService } from './email-templates.service';
import { EmailTemplatesController } from './email-templates.controller';
import { OperationConfirmationService } from './operation-confirmation.service';

@Module({
    controllers: [EmailTemplatesController],
    // `OperationConfirmationService` is the one decision every vertical writer
    // asks before it sends a customer receipt. It lives here because it is a
    // template send with a policy in front of it, and because nine copies of
    // that policy in nine modules is nine chances to drift.
    providers: [EmailTemplatesService, OperationConfirmationService],
    exports: [EmailTemplatesService, OperationConfirmationService],
})
export class EmailTemplatesModule {}
