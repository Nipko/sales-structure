import { Module } from '@nestjs/common';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { MediaCleanupService } from './media-cleanup.service';

@Module({
    controllers: [MediaController],
    providers: [MediaService, MediaCleanupService],
    exports: [MediaService, MediaCleanupService],
})
export class MediaModule {}
