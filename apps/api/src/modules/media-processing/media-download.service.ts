import { Injectable, Logger } from '@nestjs/common';
import { ChannelTokenService } from '../channels/channel-token.service';

export interface DownloadedMedia {
    buffer: Buffer;
    mimeType: string;
    sizeBytes: number;
}

const MAX_DOWNLOAD_SIZE = 25 * 1024 * 1024; // 25MB (Whisper limit)
const DOWNLOAD_TIMEOUT_MS = 30_000;

@Injectable()
export class MediaDownloadService {
    private readonly logger = new Logger(MediaDownloadService.name);

    constructor(private readonly channelToken: ChannelTokenService) {}

    async download(
        tenantId: string,
        channelType: string,
        mediaUrl: string,
        mimeType?: string,
    ): Promise<DownloadedMedia> {
        switch (channelType) {
            case 'whatsapp':
                return this.downloadWhatsApp(tenantId, mediaUrl, mimeType);
            case 'instagram':
            case 'messenger':
                return this.downloadDirectUrl(mediaUrl, mimeType);
            case 'telegram':
                return this.downloadTelegram(tenantId, mediaUrl, mimeType);
            default:
                throw new Error(`Media download not supported for channel: ${channelType}`);
        }
    }

    /**
     * WhatsApp Cloud API: mediaUrl is a Media ID.
     * Step 1: GET graph.facebook.com/{mediaId} → get download URL
     * Step 2: GET the download URL → binary data
     * URLs expire in 5 minutes.
     */
    private async downloadWhatsApp(tenantId: string, mediaId: string, mimeType?: string): Promise<DownloadedMedia> {
        const creds = await this.channelToken.getChannelToken(tenantId, 'whatsapp');
        if (!creds.accessToken) throw new Error('WhatsApp access token not available');

        // Step 1: Resolve media ID to download URL
        const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
            headers: { Authorization: `Bearer ${creds.accessToken}` },
            signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        });

        if (!metaRes.ok) {
            throw new Error(`WhatsApp media metadata failed: ${metaRes.status} ${await metaRes.text().catch(() => '')}`);
        }

        const metaData = await metaRes.json() as { url: string; mime_type: string; file_size?: number };
        const resolvedMime = mimeType || metaData.mime_type || 'application/octet-stream';

        if (metaData.file_size && metaData.file_size > MAX_DOWNLOAD_SIZE) {
            throw new Error(`Media too large: ${metaData.file_size} bytes (max ${MAX_DOWNLOAD_SIZE})`);
        }

        // Step 2: Download the actual binary
        const mediaRes = await fetch(metaData.url, {
            headers: { Authorization: `Bearer ${creds.accessToken}` },
            signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        });

        if (!mediaRes.ok) {
            throw new Error(`WhatsApp media download failed: ${mediaRes.status}`);
        }

        const arrayBuf = await mediaRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);

        if (buffer.length > MAX_DOWNLOAD_SIZE) {
            throw new Error(`Downloaded media too large: ${buffer.length} bytes`);
        }

        this.logger.log(`[MediaDownload] WhatsApp media ${mediaId}: ${buffer.length} bytes, ${resolvedMime}`);
        return { buffer, mimeType: resolvedMime, sizeBytes: buffer.length };
    }

    /**
     * Instagram / Messenger: mediaUrl is a full CDN URL.
     * Pre-signed URLs expire in hours.
     */
    private async downloadDirectUrl(url: string, mimeType?: string): Promise<DownloadedMedia> {
        const res = await fetch(url, {
            signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        });

        if (!res.ok) {
            throw new Error(`Direct media download failed: ${res.status}`);
        }

        const contentType = res.headers.get('content-type') || mimeType || 'application/octet-stream';
        const arrayBuf = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);

        if (buffer.length > MAX_DOWNLOAD_SIZE) {
            throw new Error(`Downloaded media too large: ${buffer.length} bytes`);
        }

        this.logger.log(`[MediaDownload] Direct URL: ${buffer.length} bytes, ${contentType}`);
        return { buffer, mimeType: contentType.split(';')[0].trim(), sizeBytes: buffer.length };
    }

    /**
     * Telegram: mediaUrl is a file_id.
     * Step 1: GET api.telegram.org/bot{token}/getFile?file_id={id} → file_path
     * Step 2: GET api.telegram.org/file/bot{token}/{file_path} → binary
     */
    private async downloadTelegram(tenantId: string, fileId: string, mimeType?: string): Promise<DownloadedMedia> {
        const creds = await this.channelToken.getChannelToken(tenantId, 'telegram');
        if (!creds.accessToken) throw new Error('Telegram bot token not available');

        const fileRes = await fetch(
            `https://api.telegram.org/bot${creds.accessToken}/getFile?file_id=${encodeURIComponent(fileId)}`,
            { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) },
        );

        if (!fileRes.ok) {
            throw new Error(`Telegram getFile failed: ${fileRes.status}`);
        }

        const fileData = await fileRes.json() as { ok: boolean; result?: { file_path: string; file_size?: number } };
        if (!fileData.ok || !fileData.result?.file_path) {
            throw new Error('Telegram getFile returned no file_path');
        }

        if (fileData.result.file_size && fileData.result.file_size > MAX_DOWNLOAD_SIZE) {
            throw new Error(`Telegram media too large: ${fileData.result.file_size} bytes`);
        }

        const downloadUrl = `https://api.telegram.org/file/bot${creds.accessToken}/${fileData.result.file_path}`;
        const mediaRes = await fetch(downloadUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });

        if (!mediaRes.ok) {
            throw new Error(`Telegram media download failed: ${mediaRes.status}`);
        }

        const arrayBuf = await mediaRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);

        const resolvedMime = mimeType || this.guessMimeFromPath(fileData.result.file_path) || 'application/octet-stream';
        this.logger.log(`[MediaDownload] Telegram file ${fileId}: ${buffer.length} bytes, ${resolvedMime}`);
        return { buffer, mimeType: resolvedMime, sizeBytes: buffer.length };
    }

    private guessMimeFromPath(path: string): string | null {
        const ext = path.split('.').pop()?.toLowerCase();
        const map: Record<string, string> = {
            jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
            ogg: 'audio/ogg', oga: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav',
            mp4: 'video/mp4', webm: 'video/webm',
        };
        return (ext && map[ext]) || null;
    }
}
