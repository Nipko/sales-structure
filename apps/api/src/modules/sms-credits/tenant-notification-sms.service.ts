import { Injectable } from '@nestjs/common';

export interface TenantSmsSendResult {
    sent: boolean;
    reason?: 'invalid' | 'monetization_disabled' | 'platform_sms_unconfigured' | 'insufficient_credits' | 'send_failed' | 'opted_out';
    sid?: string;
    segments?: number;
    balance?: number;
    error?: string;
}

/**
 * SMS is a retired product (ADR 0020): there is no SMS transport, credit
 * balance or platform switch any more. This stub only keeps the contract that
 * `conversations/chat-identity.service.ts` still consumes: SMS is never
 * available and every send is refused with a reason no retry can change, so an
 * identity challenge is closed as `suppressed` instead of promising a code.
 */
@Injectable()
export class TenantNotificationSmsService {
    async isAvailable(): Promise<boolean> {
        return false;
    }

    async send(
        _tenantId: string,
        _to: string,
        _body: string,
        _opts?: { reason?: string; ref?: string; metadata?: Record<string, any> },
    ): Promise<TenantSmsSendResult> {
        return { sent: false, reason: 'platform_sms_unconfigured' };
    }
}
