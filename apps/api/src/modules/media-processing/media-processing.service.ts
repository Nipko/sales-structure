import { Injectable, Logger } from '@nestjs/common';
import { MediaDownloadService } from './media-download.service';
import { AudioTranscriptionService } from './audio-transcription.service';
import { ImageVisionService } from './image-vision.service';
import { MediaThrottleService } from './media-throttle.service';
import { RedisService } from '../redis/redis.service';
import type { NormalizedMessage, MediaProcessingResult } from '@parallext/shared';

@Injectable()
export class MediaProcessingService {
    private readonly logger = new Logger(MediaProcessingService.name);

    constructor(
        private readonly download: MediaDownloadService,
        private readonly transcription: AudioTranscriptionService,
        private readonly vision: ImageVisionService,
        private readonly mediaThrottle: MediaThrottleService,
        private readonly redis: RedisService,
    ) {}

    /**
     * Process an inbound media message.
     * Returns a text representation that can be injected into the AI conversation,
     * or null if the media can't be processed (quota exceeded, unsupported type, etc).
     */
    async processMedia(
        msg: NormalizedMessage,
        contactDbId: string,
        conversationId: string,
        conversationContext?: string,
    ): Promise<{ text: string; result: MediaProcessingResult } | null> {
        const { tenantId, channelType, content } = msg;
        const mediaType = content.type === 'audio' ? 'audio' : 'image';

        if (content.type !== 'audio' && content.type !== 'image') {
            return null;
        }

        if (!content.mediaUrl) {
            this.logger.warn(`[MediaProcessing] No mediaUrl for ${content.type} message from ${msg.contactId}`);
            return null;
        }

        // 1. Check all quotas
        const throttleResult = await this.mediaThrottle.checkQuota(
            tenantId, mediaType, contactDbId, conversationId,
        );

        if (!throttleResult.allowed) {
            this.logger.warn(`[MediaProcessing] Throttled: ${throttleResult.reason} for tenant ${tenantId}`);
            return null;
        }

        try {
            // 2. Download the media file
            const downloaded = await this.download.download(
                tenantId, channelType, content.mediaUrl, content.mimeType,
            );

            let result: MediaProcessingResult;

            if (mediaType === 'audio') {
                result = await this.processAudio(tenantId, downloaded.buffer, downloaded.mimeType, throttleResult.limits.maxAudioDurationSec);
            } else {
                result = await this.processImage(tenantId, downloaded.buffer, downloaded.mimeType, conversationContext);
            }

            // 3. Record usage
            await this.mediaThrottle.recordUsage(
                tenantId, mediaType, contactDbId, conversationId, result.costCentsUsd,
            );

            // 4. Track stats for observability
            await this.trackMediaStats(tenantId, mediaType, result).catch(() => {});

            // 5. Format for conversation injection
            const caption = content.caption ? ` (caption: "${content.caption}")` : '';
            let text: string;

            if (mediaType === 'audio') {
                text = `[El cliente envió un mensaje de voz${caption}: "${result.text}"]`;
            } else {
                text = `[El cliente envió una imagen${caption}: ${result.text}]`;
            }

            this.logger.log(`[MediaProcessing] ${mediaType} processed for tenant ${tenantId}: ${result.text.substring(0, 80)}...`);
            return { text, result };

        } catch (error: any) {
            this.logger.error(`[MediaProcessing] Failed to process ${mediaType}: ${error.message}`, error.stack);
            return null;
        }
    }

    private async processAudio(
        tenantId: string,
        buffer: Buffer,
        mimeType: string,
        maxDurationSec: number,
    ): Promise<MediaProcessingResult> {
        const result = await this.transcription.transcribe(buffer, mimeType, maxDurationSec);

        return {
            type: 'transcription',
            text: result.text,
            durationSec: result.durationSec,
            costCentsUsd: result.costCentsUsd,
            model: result.model,
            provider: 'openai',
        };
    }

    private async processImage(
        tenantId: string,
        buffer: Buffer,
        mimeType: string,
        conversationContext?: string,
    ): Promise<MediaProcessingResult> {
        const result = await this.vision.describe(buffer, mimeType, tenantId, conversationContext);

        return {
            type: 'vision',
            text: result.description,
            costCentsUsd: result.costCentsUsd,
            model: result.model,
            provider: result.provider,
        };
    }

    private async trackMediaStats(
        tenantId: string,
        mediaType: string,
        result: MediaProcessingResult,
    ): Promise<void> {
        const date = new Date().toISOString().slice(0, 10);
        const baseKey = `media:stats:${tenantId}:${date}`;
        const ttl = 90 * 86400;

        await Promise.allSettled([
            this.redis.incrBy(`${baseKey}:${mediaType}:count`, 1),
            this.redis.incrBy(`${baseKey}:${mediaType}:cost_cents`, result.costCentsUsd),
            this.redis.incrBy(`${baseKey}:${result.provider}:count`, 1),
        ]);
        await Promise.allSettled([
            this.redis.expire(`${baseKey}:${mediaType}:count`, ttl),
            this.redis.expire(`${baseKey}:${mediaType}:cost_cents`, ttl),
            this.redis.expire(`${baseKey}:${result.provider}:count`, ttl),
        ]);
    }

    /**
     * Get a human-readable message when media can't be processed.
     * Returns a polite fallback in the customer's language.
     */
    getFallbackMessage(mediaType: string, language: string): string {
        const lang = (language || 'es').slice(0, 2).toLowerCase();
        const messages: Record<string, Record<string, string>> = {
            audio: {
                es: 'Recibí tu mensaje de voz, pero no pude procesarlo en este momento. ¿Podrías escribirme lo que necesitas?',
                en: 'I received your voice message but couldn\'t process it right now. Could you type what you need?',
                pt: 'Recebi sua mensagem de voz, mas não consegui processá-la agora. Poderia escrever o que precisa?',
                fr: 'J\'ai reçu votre message vocal mais je n\'ai pas pu le traiter. Pourriez-vous écrire ce dont vous avez besoin ?',
            },
            image: {
                es: 'Recibí tu imagen, pero no pude analizarla en este momento. ¿Podrías describirme lo que necesitas?',
                en: 'I received your image but couldn\'t analyze it right now. Could you describe what you need?',
                pt: 'Recebi sua imagem, mas não consegui analisá-la agora. Poderia descrever o que precisa?',
                fr: 'J\'ai reçu votre image mais je n\'ai pas pu l\'analyser. Pourriez-vous décrire ce dont vous avez besoin ?',
            },
        };
        const typeMessages = messages[mediaType] || messages.image;
        return typeMessages[lang] || typeMessages.es;
    }
}
