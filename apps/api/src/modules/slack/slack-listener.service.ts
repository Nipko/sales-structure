import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SlackService } from './slack.service';

/**
 * Posts Slack notifications on key business events (T2.16).
 * Mirrors the push-listener pattern but targets a tenant's Slack webhook.
 */
@Injectable()
export class SlackListenerService {
    constructor(private readonly slack: SlackService) {}

    // One destination, one event. A transfer used to announce itself once to
    // all six consumers, so a single failure among them re-announced it to
    // the five that had already succeeded.
    @OnEvent('handoff.escalated.slack')
    async onHandoff(event: { tenantId: string; reason?: string; contactName?: string }) {
        if (!event?.tenantId) return;
        const who = event.contactName || 'Un cliente';
        const reason = event.reason ? ` — ${event.reason}` : '';
        return this.slack.notifyStrict(event.tenantId, 'handoff', `🙋 *Conversación escalada*: ${who}${reason}`);
    }
}
