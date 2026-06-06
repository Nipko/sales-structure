import { Module, forwardRef } from '@nestjs/common';
import { MediaProcessingService } from './media-processing.service';
import { MediaDownloadService } from './media-download.service';
import { AudioTranscriptionService } from './audio-transcription.service';
import { ImageVisionService } from './image-vision.service';
import { MediaThrottleService } from './media-throttle.service';
import { MediaProcessingController } from './media-processing.controller';
import { ChannelsModule } from '../channels/channels.module';
import { SettingsModule } from '../settings/settings.module';
import { MediaModule } from '../media/media.module';

@Module({
    imports: [
        forwardRef(() => ChannelsModule),
        SettingsModule,
        MediaModule,
    ],
    providers: [
        MediaProcessingService,
        MediaDownloadService,
        AudioTranscriptionService,
        ImageVisionService,
        MediaThrottleService,
    ],
    controllers: [MediaProcessingController],
    exports: [MediaProcessingService, MediaThrottleService],
})
export class MediaProcessingModule {}
