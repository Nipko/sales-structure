import { Injectable, Logger } from '@nestjs/common';
import OpenAI, { toFile } from 'openai';
import { LlmKeyService } from '../settings/llm-key.service';

export interface TranscriptionResult {
    text: string;
    durationSec: number;
    language: string;
    model: string;
    costCentsUsd: number;
}

// Whisper-1: $0.006/min = 0.6 cents/min
// gpt-4o-mini-transcribe: not yet used (future)
const WHISPER_COST_PER_SEC = 0.006 / 60; // $0.0001/sec

@Injectable()
export class AudioTranscriptionService {
    private client: OpenAI | null = null;
    private currentKey = '';
    private readonly logger = new Logger(AudioTranscriptionService.name);

    constructor(private readonly llmKeys: LlmKeyService) {}

    private async ensureClient(): Promise<OpenAI> {
        const key = await this.llmKeys.getKey('openai');
        if (!key) throw new Error('OpenAI API key not configured (required for audio transcription)');
        if (this.client && key === this.currentKey) return this.client;
        this.client = new OpenAI({ apiKey: key });
        this.currentKey = key;
        return this.client;
    }

    async transcribe(
        buffer: Buffer,
        mimeType: string,
        maxDurationSec: number,
        language?: string,
    ): Promise<TranscriptionResult> {
        const openai = await this.ensureClient();

        // Estimate duration from file size (rough: ~16kbps for Opus voice)
        const estimatedDurationSec = this.estimateDuration(buffer.length, mimeType);
        if (estimatedDurationSec > maxDurationSec) {
            throw new Error(`Audio too long: ~${Math.round(estimatedDurationSec)}s (max ${maxDurationSec}s)`);
        }

        const ext = this.mimeToExtension(mimeType);
        const file = await toFile(buffer, `audio.${ext}`, { type: mimeType });

        const model = 'whisper-1';
        const response = await openai.audio.transcriptions.create({
            model,
            file,
            language: language ? language.slice(0, 2) : undefined,
            response_format: 'verbose_json',
        });

        const actualDuration = (response as any).duration || estimatedDurationSec;
        const costUsd = actualDuration * WHISPER_COST_PER_SEC;
        const costCentsUsd = Math.ceil(costUsd * 100);

        this.logger.log(`[AudioTranscription] ${Math.round(actualDuration)}s → ${response.text.length} chars, $${costUsd.toFixed(4)}`);

        return {
            text: response.text,
            durationSec: actualDuration,
            language: (response as any).language || language || 'unknown',
            model,
            costCentsUsd,
        };
    }

    private estimateDuration(sizeBytes: number, mimeType: string): number {
        // Opus (WhatsApp voice): ~16kbps → 2KB/sec
        if (mimeType.includes('ogg') || mimeType.includes('opus')) {
            return sizeBytes / 2000;
        }
        // MP3: ~128kbps → 16KB/sec
        if (mimeType.includes('mp3') || mimeType.includes('mpeg')) {
            return sizeBytes / 16000;
        }
        // M4A/AAC: ~64kbps → 8KB/sec
        if (mimeType.includes('m4a') || mimeType.includes('mp4') || mimeType.includes('aac')) {
            return sizeBytes / 8000;
        }
        // WAV (uncompressed): ~176KB/sec for 16-bit 44.1kHz stereo
        if (mimeType.includes('wav')) {
            return sizeBytes / 176000;
        }
        // Default: assume 8KB/sec (conservative)
        return sizeBytes / 8000;
    }

    private mimeToExtension(mimeType: string): string {
        if (mimeType.includes('ogg')) return 'ogg';
        if (mimeType.includes('mp3') || mimeType.includes('mpeg')) return 'mp3';
        if (mimeType.includes('m4a') || mimeType.includes('mp4')) return 'm4a';
        if (mimeType.includes('wav')) return 'wav';
        if (mimeType.includes('webm')) return 'webm';
        if (mimeType.includes('flac')) return 'flac';
        return 'ogg';
    }
}
