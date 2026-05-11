import { Module } from '@nestjs/common';
import { WhiteLabelService } from './white-label.service';
import { WhiteLabelController } from './white-label.controller';

@Module({
    controllers: [WhiteLabelController],
    providers: [WhiteLabelService],
    exports: [WhiteLabelService],
})
export class WhiteLabelModule {}
