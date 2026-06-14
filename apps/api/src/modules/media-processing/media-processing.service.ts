import { Injectable, Logger } from '@nestjs/common';
import { MediaDownloadService } from './media-download.service';
import { AudioTranscriptionService } from './audio-transcription.service';
import { ImageVisionService } from './image-vision.service';
import { MediaThrottleService } from './media-throttle.service';
import { RedisService } from '../redis/redis.service';
import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import type { NormalizedMessage, MediaProcessingResult } from '@parallext/shared';

// Agent-facing annotation injected into the conversation (and saved to history)
// when a customer sends voice/image. i18n'd by the tenant's language so agents read
// it in their language; the transcription/description is the customer's own words.
// (Runs before per-turn language detection, so we key off tenant.language.)
const MEDIA_ANNOT: Record<string, { audio: (cap: string, txt: string) => string; image: (cap: string, txt: string) => string }> = {
    es: { audio: (c, t) => `[El cliente envió un mensaje de voz${c ? ` (descripción: "${c}")` : ''}: "${t}"]`, image: (c, t) => `[El cliente envió una imagen${c ? ` (descripción: "${c}")` : ''}: ${t}]` },
    en: { audio: (c, t) => `[The customer sent a voice message${c ? ` (caption: "${c}")` : ''}: "${t}"]`, image: (c, t) => `[The customer sent an image${c ? ` (caption: "${c}")` : ''}: ${t}]` },
    pt: { audio: (c, t) => `[O cliente enviou uma mensagem de voz${c ? ` (legenda: "${c}")` : ''}: "${t}"]`, image: (c, t) => `[O cliente enviou uma imagem${c ? ` (legenda: "${c}")` : ''}: ${t}]` },
    fr: { audio: (c, t) => `[Le client a envoyé un message vocal${c ? ` (légende : "${c}")` : ''} : "${t}"]`, image: (c, t) => `[Le client a envoyé une image${c ? ` (légende : "${c}")` : ''} : ${t}]` },
};
const mediaAnnot = (lang?: string) => MEDIA_ANNOT[(lang || 'es').slice(0, 2).toLowerCase()] || MEDIA_ANNOT.es;

@Injectable()
export class MediaProcessingService {
    private readonly logger = new Logger(MediaProcessingService.name);

    constructor(
        private readonly download: MediaDownloadService,
        private readonly transcription: AudioTranscriptionService,
        private readonly vision: ImageVisionService,
        private readonly mediaThrottle: MediaThrottleService,
        private readonly redis: RedisService,
        private readonly media: MediaService,
        private readonly prisma: PrismaService,
    ) {}

    /** Tenant's UI language (2-char), cached 10min — for agent-facing media annotations. */
    private async getTenantLang(tenantId: string): Promise<string> {
        try {
            const cached = await this.redis.get(`tenant:${tenantId}:lang`);
            if (cached) return cached;
            const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { language: true } });
            const lang = (tenant?.language || 'es').slice(0, 2).toLowerCase();
            await this.redis.set(`tenant:${tenantId}:lang`, lang, 600);
            return lang;
        } catch { return 'es'; }
    }

    /**
     * Persist an inbound voice note (already downloaded for transcription) to media
     * storage and stamp its URL on the message, so the agent can play it back.
     * Best-effort: never throws (transcription/AI flow must not break).
     */
    private async persistInboundAudio(
        tenantId: string,
        conversationId: string,
        buffer: Buffer,
        mimeType: string,
    ): Promise<void> {
        try {
            const url = await this.media.saveBuffer(tenantId, buffer, mimeType);
            if (!url) return;
            const schemaName = await this.prisma.getTenantSchemaName(tenantId);
            if (!schemaName) return;
            // Stamp the URL on the most recent inbound audio message in this conversation
            // (the one we just saved before the AI pipeline ran).
            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE messages
                 SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{mediaUrl}', to_jsonb($2::text))
                 WHERE id = (
                     SELECT id FROM messages
                     WHERE conversation_id = $1::uuid AND direction = 'inbound' AND content_type = 'audio'
                     ORDER BY created_at DESC LIMIT 1
                 )`,
                [conversationId, url],
            );
        } catch (e: any) {
            this.logger.warn(`persistInboundAudio failed: ${e.message}`);
        }
    }

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
            this.logger.warn(`[MediaProcessing] No mediaUrl for ${content.type} message from ${msg.contactId} — check webhook normalization`);
            return null;
        }

        this.logger.log(`[MediaProcessing] Processing ${content.type} from ${msg.channelType}, mime=${content.mimeType || 'unknown'}`);

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
                // Persist the voice note so the agent can play it back in the app (best-effort).
                await this.persistInboundAudio(tenantId, conversationId, downloaded.buffer, downloaded.mimeType);
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

            // 5. Format for conversation injection — agent-facing wrapper i18n'd by
            // the tenant's language (the transcription/description is the customer's words).
            const annotLang = await this.getTenantLang(tenantId);
            const cap = content.caption || '';
            const text = mediaType === 'audio'
                ? mediaAnnot(annotLang).audio(cap, result.text)
                : mediaAnnot(annotLang).image(cap, result.text);

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
            // Track tenants with media usage so the unified usage report includes
            // tenants that used ONLY media that day (the LLM tenant set misses them).
            this.redis.sadd(`media:stats:tenants:${date}`, tenantId),
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
