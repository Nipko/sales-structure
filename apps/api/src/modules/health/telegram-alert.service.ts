import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Sends platform alerts to a dedicated Telegram chat (the super_admin ops
 * channel). Separate from the per-tenant customer Telegram bots — uses its own
 * TELEGRAM_ALERT_BOT_TOKEN + TELEGRAM_ALERT_CHAT_ID. No-op when unconfigured.
 */
@Injectable()
export class TelegramAlertService {
    private readonly logger = new Logger(TelegramAlertService.name);
    private readonly token?: string;
    private readonly chatId?: string;

    constructor(config: ConfigService) {
        this.token = config.get<string>('TELEGRAM_ALERT_BOT_TOKEN');
        this.chatId = config.get<string>('TELEGRAM_ALERT_CHAT_ID');
    }

    get enabled(): boolean {
        return !!(this.token && this.chatId);
    }

    /** Best-effort send. `text` may use the Telegram HTML subset (<b>, <i>, <code>, <a>). */
    async send(text: string): Promise<void> {
        if (!this.enabled) return;
        try {
            const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: this.chatId,
                    text: text.slice(0, 4000),
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                }),
            });
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                this.logger.warn(`Telegram alert failed: ${res.status} ${body.slice(0, 200)}`);
            }
        } catch (e: any) {
            this.logger.warn(`Telegram alert error: ${e.message}`);
        }
    }
}
